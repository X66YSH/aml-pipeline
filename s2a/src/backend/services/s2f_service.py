"""S2F compilation service -- LLM-powered feature generation without CrewAI.

Implements the Perceive -> Reason -> Act pipeline:
1. Perceive: Parse regulatory text, extract indicators, identify parameters
2. Reason: Plan feature computation, select operations, resolve ambiguity
3. Act: Generate Python code (compute_feature function)

Each step yields trace events for SSE streaming.
"""

import asyncio
import json
import re
from typing import AsyncGenerator

import httpx
from openai import AsyncOpenAI

# ── Pipeline decision system ──────────────────────────────────────────────────
# In-memory store for pipeline pause/resume via user decisions.
_pipeline_events: dict[str, asyncio.Event] = {}
_pipeline_decisions: dict[str, str] = {}


def register_pipeline(pipeline_id: str) -> None:
    """Register a pipeline session for decision waiting."""
    _pipeline_events[pipeline_id] = asyncio.Event()


def submit_decision(pipeline_id: str, decision: str) -> bool:
    """Submit a user decision, unblocking the waiting pipeline."""
    evt = _pipeline_events.get(pipeline_id)
    if not evt:
        return False
    _pipeline_decisions[pipeline_id] = decision
    evt.set()
    return True


async def _wait_for_decision(pipeline_id: str) -> str:
    """Block until a decision is submitted."""
    evt = _pipeline_events.get(pipeline_id)
    if not evt:
        return "skip"
    await evt.wait()
    decision = _pipeline_decisions.pop(pipeline_id, "skip")
    evt.clear()
    return decision


def cleanup_pipeline(pipeline_id: str) -> None:
    """Clean up pipeline session."""
    _pipeline_events.pop(pipeline_id, None)
    _pipeline_decisions.pop(pipeline_id, None)

from config import (
    DEFAULT_LLM,
    FAST_LLM,
    LLM_TEMPERATURE,
    MAX_CORRECTION_ITERATIONS,
    MAX_PERCEIVE_TOKENS,
    MAX_ADAPT_TOKENS,
    MAX_REASON_TOKENS,
    MAX_CORRECT_TOKENS,
    MAX_MULTI_FEATURE_TOKENS,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENAI_TIMEOUT_CONNECT,
    OPENAI_TIMEOUT_READ,
)
from core.ontology import ALLOWED_OPERATIONS, CATEGORY_DESCRIPTIONS, IndicatorCategory
from utils.trace_logger import TraceLogger


def _get_client() -> AsyncOpenAI:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured")
    timeout = httpx.Timeout(
        connect=OPENAI_TIMEOUT_CONNECT,
        read=OPENAI_TIMEOUT_READ,
        write=OPENAI_TIMEOUT_READ,
        pool=OPENAI_TIMEOUT_CONNECT,
    )
    kwargs: dict = {"api_key": OPENAI_API_KEY, "timeout": timeout, "max_retries": 1}
    if OPENAI_BASE_URL:
        kwargs["base_url"] = OPENAI_BASE_URL
    return AsyncOpenAI(**kwargs)

MAX_FEATURE_CANDIDATES = 3

MULTI_FEATURE_SYSTEM_PROMPT = """You are an expert AML feature discovery agent.
Your job is to read regulatory text and a dataset schema, then propose multiple candidate
AML detection features that could be implemented as independent compiled features.

Each candidate must be grounded in the regulatory text, use only existing schema columns,
and be described as a feasible feature specification."""

MULTI_FEATURE_PROMPT = """STEP 0 — FEATURE DISCOVERY

Return ONLY valid JSON. First character `{{`, last `}}`.

Propose exactly {max_candidates} distinct AML detection features from the regulatory text.
Requirements:
- Output EXACTLY {max_candidates} candidates — do NOT return fewer
- Each candidate MUST use a DIFFERENT operation AND a DIFFERENT time_window
- Each candidate MUST derive its primary signal from a DIFFERENT column: at least one candidate must use `{amt_col}`; at least one must use a non-amount column (e.g., `{secondary_col}` or another column from DATASET SCHEMA)
- The name's window suffix MUST exactly match time_window: `_30d` means time_window "30d"; use `_hist` for full_history
- Keep all string values to ONE sentence
- Use ONLY column names from DATASET SCHEMA for required_columns
- "name" MUST be snake_case describing what is COMPUTED, format: {{operation}}_{{category}}_{{window}}
  Good examples: count_velocity_30d, sum_structuring_7d, count_distinct_network_hist
  Bad examples: money_laundering, suspicious_activity, std_behavioral_90d (window suffix does not match time_window)

SCHEMA COLUMNS (CRITICAL — use EXACTLY these names, do NOT substitute):
  Account ID column  : {id_col}   ← use this for aggregation_level in every candidate
  Amount column      : {amt_col}
  Datetime column    : {dt_col}
  Secondary column   : {secondary_col}  ← use this (or another non-amount schema column) in at least one candidate

Shape (all {max_candidates} items required — vary operation, time_window, AND primary signal column across entries):
{{"feature_candidates":[
{{"name":"sum_structuring_30d","description":"<1-sentence>","indicator":{{"category":"structuring","description":"<1-sentence>","risk_rationale":"<1-sentence>"}},"parameters":[],"computation_plan":{{"operation":"sum","aggregation_level":"{id_col}","time_window":"30d","required_columns":["{amt_col}","{dt_col}"],"join_strategy":"left"}}}},
{{"name":"count_velocity_7d","description":"<1-sentence>","indicator":{{"category":"velocity","description":"<1-sentence>","risk_rationale":"<1-sentence>"}},"parameters":[],"computation_plan":{{"operation":"count","aggregation_level":"{id_col}","time_window":"7d","required_columns":["{id_col}","{dt_col}"],"join_strategy":"left"}}}},
{{"name":"count_distinct_behavioral_hist","description":"<1-sentence>","indicator":{{"category":"behavioral","description":"<1-sentence>","risk_rationale":"<1-sentence>"}},"parameters":[],"computation_plan":{{"operation":"count_distinct","aggregation_level":"{id_col}","time_window":"full_history","required_columns":["{secondary_col}","{id_col}"],"join_strategy":"left"}}}}
]}}

DATASET SCHEMA:
{schema_info}

REGULATORY TEXT:
{regulatory_text}
"""


def _slim_schema(schema_info: dict) -> dict:
    """Return schema_info with sample rows stripped — column names are all LLMs need for planning."""
    return {k: v for k, v in schema_info.items() if k not in ("sample_rows", "accounts_sample")}


def _build_ontology_reference() -> str:
    """Format the ontology categories for the LLM prompt."""
    lines = []
    for cat in IndicatorCategory:
        desc = CATEGORY_DESCRIPTIONS.get(cat, "")
        lines.append(f"  - {cat.value}: {desc}")
    return "\n".join(lines)


SYSTEM_PROMPT = """You are an AML Feature Engineer.
Your goal is to produce one Python function `compute_feature(df, accounts_df=None)`.

The function must:
- Use only pandas and numpy; no extra imports, no I/O, no eval/exec
- Use only columns from the provided schema — never invent column names
- Convert datetimes with `pd.to_datetime(..., errors='coerce')` before using `.dt` or rolling
- Store the intermediate signal in `df['feature']` as a numeric (float/int) Series
- Aggregate to account level: one row per account ID
- Avoid pivot/unstack and multiple output columns
- End with exactly the return line shown in the FUNCTION TEMPLATE in the prompt

ROLLING WINDOWS — always use Pattern B (keep datetime as a column):
  df.sort_values(dt_col) → .groupby(id_col, group_keys=False).apply(lambda g: g.rolling('Nd', on=dt_col)[signal_col].agg())
  Assign the result to df['feature'].
  NEVER call df.set_index(dt_col) and then .rolling(on=dt_col) — that raises ValueError.
"""

PERCEIVE_PROMPT = """STEP 1 — REGULATORY ANALYST

Return ONLY a JSON object (no markdown, no commentary). First character must be `{{`, last must be `}}`.

Required shape — keep all string values to ONE sentence each:
{{"perceive":"<1-sentence observation>","reason":"<1-sentence rationale>","act":{{"indicator":{{"category":"<ontology value>","description":"<1-sentence>","risk_rationale":"<1-sentence>"}},"parameters":[],"computation_plan":{{"operation":"<sum|count|avg|max|std|entropy>","aggregation_level":"customer_id","time_window":"<7d|30d|90d|full_history>","required_columns":["amount_cad","transaction_datetime"],"join_strategy":"left"}}}}}}

DATASET SCHEMA:
{schema_info}

REGULATORY TEXT:
{regulatory_text}
"""

REASON_PROMPT = """STEP 2 — FEATURE ENGINEER

Generate Python code for `compute_feature(df, accounts_df=None)`.

Requirements:
- return one ID column and one continuous numeric feature column
- use only pandas and numpy; no extra imports, no I/O
- use only columns from SCHEMA COLUMNS
- convert datetimes with `pd.to_datetime(..., errors='coerce')` before `.dt`
- prefer velocity, deviation, or behavior-based scores over binary flags
- keep the function body under 25 lines
- use EXACTLY the operation and time_window from COMPUTATION PLAN (e.g., "count_distinct"→.nunique(), "30d"→rolling('30d'), "full_history"→no rolling)
- use the primary signal column from required_columns (the first non-id, non-datetime entry); do NOT default to the amount column when the plan specifies a different column

First two lines must be:
# PERCEIVE: <one sentence — the selected signal>
# REASON: <one sentence — why time-aware or behavioral>

INDICATOR: {indicator}
PARAMETERS: {parameters}
COMPUTATION PLAN: {computation_plan}
SCHEMA COLUMNS: {columns}

Return ONLY Python code. No markdown fences.
"""

SCHEMA_ADAPT_PROMPT = """STEP 1.5 — SCHEMA ADAPTER

Return ONLY a JSON object. First character `{{`, last `}}`.

For each channel decide: "direct_match" (has all required columns), "proxy_required" (missing some but proxies work), or "not_feasible" (cannot compute).

Keep "perceive" and "reason" to ONE sentence each. Keep each "strategy" to ONE sentence.

REGULATORY INDICATOR: {indicator}
REQUIRED COLUMNS: {required_columns}
AVAILABLE CHANNELS: {channel_schemas}

Shape:
{{"perceive":"<1-sentence>","reason":"<1-sentence overall>","act":{{"channel_adaptations":{{"<channel_key>":{{"status":"direct_match|proxy_required|not_feasible","strategy":"<1-sentence>","columns_used":["col1"]}}}}}}}}"""

CORRECT_PROMPT = """The previous code FAILED validation.

ERROR: {error}

PREVIOUS CODE:
```python
{code}
```

TRANSACTION COLUMNS (the ONLY columns that exist in df): {columns}
ACCOUNT COLUMNS (the ONLY columns that exist in accounts_df): {accounts_columns}

CRITICAL RULES:
1. You MUST ONLY use column names from the lists above. Do NOT invent column names.
2. If your code referenced a column that does not exist, replace it with the closest match from the list above.
{schema_column_hints}

Fix the code and return ONLY the corrected Python code, no markdown fences."""


def _schema_column_hints(schema_key: str) -> str:
    if schema_key == "ibm_aml":
        return (
            "3. The main transaction amount columns are 'Amount Paid' and 'Amount Received'\n"
            "4. The main account ID column is 'Sender_Account'\n"
            "5. The main timestamp column is 'Timestamp' (already parsed as datetime)\n"
            "6. RETURN VALUE RULE — the function MUST end with:\n"
            "     return df.groupby('Sender_Account')['feature'].last().reset_index()\n"
            "   After reset_index(), result has exactly two columns: 'Sender_Account' and 'feature'.\n"
            "   NEVER build the return with pd.DataFrame({'Sender_Account': df['Sender_Account'].unique(), ...}) — lengths may not align.\n"
            "7. ROLLING WINDOW RULE — always use Pattern B (keep Timestamp as column, use on=):\n"
            "     df['Timestamp'] = pd.to_datetime(df['Timestamp'], errors='coerce')\n"
            "     df = df.sort_values('Timestamp')\n"
            "     df['feature'] = df.groupby('Sender_Account', group_keys=False).apply(\n"
            "         lambda g: g.rolling('30D', on='Timestamp')['Amount Paid'].sum()\n"
            "     )\n"
            "     return df.groupby('Sender_Account')['feature'].last().reset_index()\n"
            "   NEVER call df.set_index('Timestamp') — always keep Timestamp as a column and use on='Timestamp'.\n"
            "   NEVER build a separate result_df — assign to df['feature'] and use the return line above."
        )
    return (
        "3. The main transaction amount column is 'amount_cad'\n"
        "4. The main account ID column is 'customer_id'\n"
        "5. The main timestamp column is 'transaction_datetime'\n"
        "6. RETURN VALUE RULE — the function MUST end with exactly:\n"
        "     return df.groupby('customer_id')['feature'].last().reset_index()\n"
        "   This gives two columns: 'customer_id' and 'feature'.\n"
        "7. Assign your computed signal to df['feature'] (a numeric per-row Series).\n"
        "   Do NOT build a separate result_df — just assign df['feature'] = <your_computation>."
    )


def _schema_template(schema_key: str) -> dict:
    """Return the canonical column names for a schema.

    Used by _kernel_prompt_section and _enforce_return_line to build schema-specific
    function templates without generic placeholders that confuse the LLM.
    """
    if schema_key == "ibm_aml":
        return {
            "id_col": "Sender_Account",
            "datetime_col": "Timestamp",
            "amount_col": "Amount Paid",
            "secondary_col": "Payment Format",
        }
    # FINTRAC / all other schemas
    return {
        "id_col": "customer_id",
        "datetime_col": "transaction_datetime",
        "amount_col": "amount_cad",
        "secondary_col": "debit_credit",
    }


def _infer_signal_dtype(schema_key: str, signal_col: str) -> str:
    """Return 'numeric', 'categorical', or 'unknown' for a signal column.

    Loads a small sample from the actual data (IBM AML CSV) or from the
    synthetic FINTRAC DataFrame so the result is accurate for any schema,
    including new ones added in the future.  Returns 'unknown' on any error
    so callers can fall back to safe defaults without crashing.
    """
    try:
        import pandas as _pd
        if schema_key == "ibm_aml":
            from config import IBM_AML_TRANS_PATH
            sample = _pd.read_csv(IBM_AML_TRANS_PATH, nrows=100, usecols=[signal_col])
        else:
            # Use the synthetic FINTRAC DataFrame — no CSV dependency
            synthetic = _make_synthetic_fintrac_df(schema_key)
            if signal_col not in synthetic.columns:
                return "unknown"
            sample = synthetic[[signal_col]]

        dtype = sample[signal_col].dtype
        if _pd.api.types.is_numeric_dtype(dtype):
            return "numeric"
        if _pd.api.types.is_datetime64_any_dtype(dtype):
            return "datetime"
        return "categorical"
    except Exception:
        return "unknown"


def _kernel_prompt_section(schema_key: str, computation_plan: dict | None = None) -> str:
    """Schema-specific function template appended to REASON_PROMPT.

    Shows the EXACT structure the LLM must follow — real column names, hardcoded return line.
    When computation_plan is supplied, the template is tailored to the actual time_window and
    signal column so the LLM produces the right code on the first attempt.

    Runtime dtype inference: loads a 100-row sample to determine whether the signal column
    is numeric or categorical. Categorical columns require pd.factorize encoding before any
    rolling aggregation — this is injected deterministically, not left to the LLM to decide.
    """
    sv = _schema_template(schema_key)
    id_col = sv["id_col"]
    dt_col = sv["datetime_col"]
    amt_col = sv["amount_col"]

    cp = computation_plan or {}
    time_window = cp.get("time_window", "full_history")
    operation = cp.get("operation", "sum")
    required_cols = cp.get("required_columns", [])

    # Resolve signal column: first required_column that is not the id or datetime column
    id_like = {id_col, dt_col}
    signal_candidates = [c for c in required_cols if c not in id_like]
    signal_col = signal_candidates[0] if signal_candidates else amt_col

    # Infer dtype from actual data — determines encoding strategy, no LLM judgment needed
    signal_dtype = _infer_signal_dtype(schema_key, signal_col)
    is_categorical = signal_dtype == "categorical"

    op_map = {
        "sum": "sum", "count": "count", "avg": "mean",
        "max": "max", "std": "std", "count_distinct": "nunique",
    }
    pandas_op = op_map.get(operation, "sum")

    # Build column-type annotation for the prompt
    dtype_note = (
        f"  - '{signal_col}' dtype: {signal_dtype}"
        + (" ← string/object column, pandas rolling requires numeric — encoding is mandatory" if is_categorical else " ← numeric, safe for rolling aggregations")
    )

    if time_window == "full_history":
        # Fast path — no rolling; transform gives one aggregate value per row per group.
        # Note: transform('nunique') works on string columns, so no encoding needed here.
        computation_line = (
            f"    df['feature'] = df.groupby('{id_col}')['{signal_col}'].transform('{pandas_op}')"
        )
        window_rule = (
            f"  - TIME WINDOW is 'full_history' → use transform, NO rolling:\n"
            f"    df['feature'] = df.groupby('{id_col}')[signal_col].transform(op)\n"
            f"    op map: sum→'sum', count→'count', avg→'mean', max→'max', std→'std', count_distinct→'nunique'\n"
            f"    signal_col = first non-id/non-dt entry in required_columns\n"
        )
    else:
        # Rolling path — time_window is a specific duration (e.g. 7d, 30d, 90d)
        pandas_window = time_window.upper()  # "7d" → "7D", "30d" → "30D"

        if is_categorical:
            # Any rolling aggregation on a non-numeric column raises DataError.
            # Encode to float codes first — works for count_distinct and all other ops.
            if operation == "count_distinct":
                # Distinct count: encode then count unique integer codes per window
                computation_line = (
                    f"    df['_enc'] = pd.factorize(df['{signal_col}'])[0].astype(float)\n"
                    f"    df['feature'] = df.groupby('{id_col}', group_keys=False).apply(\n"
                    f"        lambda g: g.rolling('{pandas_window}', on='{dt_col}')['_enc'].apply(lambda x: float(len(set(x))), raw=True)\n"
                    f"    )"
                )
            else:
                # Other ops (sum/count/avg) on encoded categorical column
                computation_line = (
                    f"    df['_enc'] = pd.factorize(df['{signal_col}'])[0].astype(float)\n"
                    f"    df['feature'] = df.groupby('{id_col}', group_keys=False).apply(\n"
                    f"        lambda g: g.rolling('{pandas_window}', on='{dt_col}')['_enc'].{pandas_op}()\n"
                    f"    )"
                )
            window_rule = (
                f"  - TIME WINDOW is '{time_window}' → rolling window of '{pandas_window}'.\n"
                f"    '{signal_col}' is a string column — MUST encode with pd.factorize before rolling:\n"
                f"    df['_enc'] = pd.factorize(df['{signal_col}'])[0].astype(float)\n"
                f"    Then roll over '_enc', NOT over '{signal_col}' directly.\n"
                f"    Do NOT call .{pandas_op}() directly on a string column — raises DataError.\n"
                f"    Do NOT use df.set_index('{dt_col}') — always keep as column and use on='{dt_col}'.\n"
            )
        else:
            # Numeric column — standard rolling, no encoding needed
            computation_line = (
                f"    df['feature'] = df.groupby('{id_col}', group_keys=False).apply(\n"
                f"        lambda g: g.rolling('{pandas_window}', on='{dt_col}')['{signal_col}'].{pandas_op}()\n"
                f"    )"
            )
            window_rule = (
                f"  - TIME WINDOW is '{time_window}' → you MUST use a rolling window of '{pandas_window}', NOT transform:\n"
                f"    Use Pattern B (keep '{dt_col}' as a column, pass on='{dt_col}' to rolling).\n"
                f"    Do NOT use df.set_index('{dt_col}') AND rolling(on='{dt_col}') together — that raises ValueError.\n"
                f"    Do NOT use transform() — the plan requires a {time_window} sliding window.\n"
            )

    return (
        f"\n\nFUNCTION TEMPLATE — follow this structure exactly:\n"
        f"def compute_feature(df, accounts_df=None):\n"
        f"    # PERCEIVE: <1-sentence signal description>\n"
        f"    # REASON: <1-sentence rationale>\n"
        f"    df['{dt_col}'] = pd.to_datetime(df['{dt_col}'], errors='coerce')  # keep as-is\n"
        f"    df = df.sort_values('{dt_col}')  # keep as-is\n"
        f"    # --- YOUR COMPUTATION: assign a numeric signal to df['feature'] ---\n"
        f"{computation_line}\n"
        f"    # -------------------------------------------------------------------\n"
        f"    return df.groupby('{id_col}')['feature'].last().reset_index()  # DO NOT CHANGE\n"
        f"\n"
        f"COLUMN TYPES (from actual data — use these to choose your computation approach):\n"
        f"{dtype_note}\n"
        f"\n"
        f"RULES:\n"
        f"  - df['feature'] MUST be a numeric Series (float or int)\n"
        f"  - The return line MUST be exactly: return df.groupby('{id_col}')['feature'].last().reset_index()\n"
        f"{window_rule}"
        f"  - NEVER change the id column ('{id_col}') or the return line\n"
    )


def _enforce_return_line(code: str, schema_key: str) -> str:
    """Deterministically enforce the correct return statement in compute_feature.

    Replaces ANY `return ...` line with the canonical:
        return df.groupby('<id_col>')['feature'].sum().reset_index()

    This eliminates the entire class of wrong-return-structure errors (wrong column
    name, wrong shape, etc.) at zero LLM token cost. Called after every code
    generation / correction pass.

    Edge cases handled:
    - LLM writes `return result_df` → replaced
    - LLM forgets `reset_index()` → replaced
    - LLM uses wrong id_col name → replaced
    - No return found → canonical return appended with 4-space indent
    - Nested functions: only the LAST return in the string is replaced (which is
      the compute_feature return — inner helpers have their own returns earlier)
    """
    sv = _schema_template(schema_key)
    id_col = sv["id_col"]
    canonical = f"return df.groupby('{id_col}')['feature'].last().reset_index()"

    lines = code.splitlines()
    # Walk backward to find the last `return` statement
    for i in range(len(lines) - 1, -1, -1):
        stripped = lines[i].strip()
        if stripped.startswith("return "):
            indent = lines[i][: len(lines[i]) - len(lines[i].lstrip())]
            lines[i] = f"{indent}{canonical}"
            return "\n".join(lines)

    # No return found — append one (4-space indent inside compute_feature)
    lines.append(f"    {canonical}")
    return "\n".join(lines)


def _make_synthetic_fintrac_df(schema_key: str) -> "pd.DataFrame":
    """Build a tiny synthetic FINTRAC DataFrame for sandbox testing.

    Covers all common FINTRAC columns plus any channel-specific extras.
    Using synthetic data avoids a dependency on the actual CSV files being present
    while still catching real runtime errors (wrong column name, wrong aggregation, etc.).
    """
    import numpy as _np
    import pandas as _pd
    from config import CHANNELS, CHANNEL_COMMON_COLUMNS

    _n = 300
    _rng = _np.random.default_rng(42)
    _cids = [f"C{i:04d}" for i in _rng.integers(0, 50, _n)]

    _df = _pd.DataFrame({
        "transaction_id": [f"T{i}" for i in range(_n)],
        "customer_id": _cids,
        "amount_cad": _rng.uniform(10.0, 5000.0, _n),
        "debit_credit": _rng.choice(["D", "C"], _n),
        "transaction_datetime": _pd.date_range("2022-01-01", periods=_n, freq="h"),
    })

    # Add channel-specific extra columns (filled with synthetic values)
    if schema_key in CHANNELS:
        for _extra in CHANNELS[schema_key].get("extra_columns", []):
            if _extra in ("country", "province", "city"):
                _df[_extra] = _rng.choice(["CA", "US", "GB"], _n)
            elif _extra in ("cash_indicator", "ecommerce_ind"):
                _df[_extra] = _rng.integers(0, 2, _n)
            elif _extra == "merchant_category":
                _df[_extra] = _rng.choice(["retail", "food", "travel"], _n)
            else:
                _df[_extra] = "synthetic"

    _df["channel"] = schema_key
    return _df


def _sandbox_exec(code: str, schema_key: str) -> str | None:
    """Execute generated code on a tiny data sample to catch runtime errors early.

    Returns None on success, or an error string on failure.
    Now covers both IBM AML (real CSV sample) and all FINTRAC channels (synthetic data).
    File/OS errors for IBM AML are suppressed so missing data never blocks the pipeline.
    """
    try:
        import numpy as _np
        import pandas as _pd

        if schema_key == "ibm_aml":
            from config import IBM_AML_TRANS_PATH
            _df = _pd.read_csv(IBM_AML_TRANS_PATH, nrows=300)
            # Pre-parse datetime-like columns
            for _col in _df.columns:
                _cl = _col.lower()
                if (
                    _cl == "timestamp" or _cl.endswith("_timestamp")
                    or _cl.endswith("_time") or _cl.endswith("date")
                    or _cl.endswith("datetime")
                ):
                    if _df[_col].dtype == object:
                        _df[_col] = _pd.to_datetime(_df[_col], errors="coerce")
        else:
            # Use synthetic data for FINTRAC channels — datetime already parsed
            _df = _make_synthetic_fintrac_df(schema_key)

        _sv = _schema_template(schema_key)
        _id_col = _sv["id_col"]
        _canonical_return = f"return df.groupby('{_id_col}')['feature'].sum().reset_index()"

        _ns: dict = {"pd": _pd, "np": _np}
        exec(code, _ns)
        _fn = _ns.get("compute_feature")
        if _fn is not None:
            _result = _fn(_df.copy(), None)
            # ── Return-value shape validator (zero LLM tokens) ──────────────
            if _result is None or not isinstance(_result, _pd.DataFrame):
                return (
                    f"compute_feature() returned {type(_result).__name__} — must return a pandas DataFrame. "
                    f"End with: {_canonical_return}"
                )
            if len(_result.columns) != 2:
                return (
                    f"compute_feature() returned {len(_result.columns)} columns {list(_result.columns)} "
                    f"— must return exactly 2: [{_id_col}, feature]. "
                    f"Use: {_canonical_return}"
                )
            if not _pd.api.types.is_numeric_dtype(_result.iloc[:, 1]):
                return (
                    f"Second column '{_result.columns[1]}' has dtype {_result.iloc[:, 1].dtype} "
                    "— feature column must be numeric (float/int). "
                    "Compute a numeric aggregation (sum/count/max/std) and assign to df['feature']."
                )
            if _result.iloc[:, 0].duplicated().any():
                _n_dup = int(_result.iloc[:, 0].duplicated().sum())
                return (
                    f"ID column '{_result.columns[0]}' has {_n_dup} duplicate values "
                    f"— must be one row per account. Fix: {_canonical_return}"
                )
        return None  # success

    except (FileNotFoundError, OSError):
        return None  # IBM AML CSV not available locally — skip sandbox

    except Exception as _e:
        # Build schema-aware hints for common error classes
        _sv2 = _schema_template(schema_key)
        _id2 = _sv2["id_col"]
        _dt2 = _sv2["datetime_col"]
        _canonical2 = f"return df.groupby('{_id2}')['feature'].sum().reset_index()"

        err = str(_e)
        if "invalid on specified" in err:
            err = (
                f"{err} — Rolling-window conflict: use EITHER "
                f"(A) df.set_index('{_dt2}') then .rolling('Nd') with NO on= "
                f"OR (B) keep '{_dt2}' as a column and .rolling('Nd', on='{_dt2}'). "
                f"Never call .rolling(on='{_dt2}') after df.set_index('{_dt2}')."
            )
        elif f"'{_id2}'" in err or _id2 in err:
            err = (
                f"{err} — Column '{_id2}' was not found. "
                f"Do NOT call df.set_index('{_id2}') — keep it as a plain column throughout. "
                f"End the function with: {_canonical2}"
            )
        elif "not in index" in err or "'feature'" in err.lower():
            err = (
                f"{err} — A column was not found. "
                f"Make sure to assign your result to df['feature'] (a numeric Series), "
                f"then end with: {_canonical2}"
            )
        return err


async def compile_feature(
    regulatory_text: str,
    schema_info: dict,
    schema_key: str = "ibm_aml",
    model: str = DEFAULT_LLM,
    temperature: float = LLM_TEMPERATURE,
    max_corrections: int = MAX_CORRECTION_ITERATIONS,
    pipeline_id: str | None = None,
    # Cached phase results for rethink shortcuts (skip LLM calls)
    cached_perceive: dict | None = None,
    cached_adaptation: dict | None = None,
    feedback_context: str | None = None,
) -> AsyncGenerator[dict, None]:
    """Compile regulatory text into feature code via LLM.

    Yields SSE-compatible trace events as the pipeline progresses.
    Final event contains the complete result.

    If cached_perceive is provided, skips the Perceive (Analyst) LLM call.
    If cached_adaptation is provided, skips the Schema Adapt LLM call.
    feedback_context is injected into the relevant LLM prompt without bloating regulatory_text.
    """
    client = _get_client()
    trace = TraceLogger()

    # Format schema for prompts — strip sample rows (column names are sufficient for LLM planning)
    columns_str = json.dumps(schema_info.get("columns", []), indent=2)
    accounts_columns_str = json.dumps(schema_info.get("accounts_columns", []), indent=2)
    schema_str = json.dumps(_slim_schema(schema_info), indent=2, default=str)[:3000]

    # SYSTEM_PROMPT has no format variables — use it directly.
    # (Calling .format() on it previously raised KeyError because the prompt
    # contains literal Python dict syntax with { } characters.)
    system = SYSTEM_PROMPT

    # ── PERCEIVE ──────────────────────────────────────────────────────────────
    if cached_perceive:
        # Rethink shortcut: reuse previous Analyst results (skip LLM call)
        indicator = cached_perceive["indicator"]
        parameters = cached_perceive["parameters"]
        computation_plan = cached_perceive["computation_plan"]
        perceive_pra = cached_perceive.get("perceive_pra", {"perceive": "", "reason": ""})
        perceive_raw = cached_perceive.get("perceive_raw", "")

        trace.info("Feature Engineer", f"PERCEIVE skipped — reusing cached indicator: {indicator.get('category', 'unknown')}")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}
        yield {
            "event": "perceive",
            "data": {
                "pra": perceive_pra,
                "indicator": indicator,
                "parameters": parameters,
                "computation_plan": computation_plan,
                "cached": True,
            },
        }
    else:
        trace.agent("Feature Engineer", "Starting PERCEIVE phase — analyzing regulatory text")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        trace.tool("Feature Engineer", f"Parsing regulatory text ({len(regulatory_text)} chars)")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        # Keep regulatory text within a predictable character budget to control LLM tokens.
        MAX_REG_CHARS = 4000
        if len(regulatory_text) > MAX_REG_CHARS:
            # Lightweight extractive truncation: keep head + tail with a truncation marker.
            head = regulatory_text[:3000]
            tail = regulatory_text[-800:]
            perceive_text = head + "\n\n...[TRUNCATED]... original_length=" + str(len(regulatory_text)) + "\n\n" + tail
            trace.tool("Feature Engineer", f"Regulatory text truncated from {len(regulatory_text)} to {len(perceive_text)} chars for LLM cost control")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}
        else:
            perceive_text = regulatory_text

        if feedback_context:
            perceive_text += f"\n\n{feedback_context}"

        perceive_prompt = PERCEIVE_PROMPT.format(
            regulatory_text=perceive_text,
            schema_info=schema_str,
        )

        trace.info("Feature Engineer", f"Calling {model} — extracting indicators and parameters...")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        try:
            perceive_response = await client.chat.completions.create(
                model=model,
                temperature=temperature,
                max_tokens=MAX_PERCEIVE_TOKENS,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": perceive_prompt},
                ],
            )
        except Exception as e:
            err_msg = f"{type(e).__name__}: {str(e)[:800]}"
            trace.error("Feature Engineer", f"PERCEIVE LLM call failed — {err_msg}")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}
            # Send error event to frontend
            yield {
                "event": "error",
                "data": {
                    "message": f"LLM Error in Perceive phase: {err_msg}",
                    "phase": "perceive",
                    "timestamp": trace.events[-1].timestamp,
                },
            }
            raise RuntimeError(f"PERCEIVE failed: {err_msg}") from e

        perceive_raw = perceive_response.choices[0].message.content

        perceive_data = _extract_json(perceive_raw)
        # Handle PRA format: act contains the structured output
        act_data = perceive_data.get("act", perceive_data)  # fallback to flat format
        indicator = act_data.get("indicator", {})
        parameters = act_data.get("parameters", [])
        computation_plan = act_data.get("computation_plan", {})

        # Defensive validation: ensure indicator contains required keys. If not, emit structured SSE error
        required_indicator_keys = {"category", "description", "risk_rationale"}
        missing = required_indicator_keys - set(k for k in indicator.keys())
        if missing:
            trace.error("Feature Engineer", f"PERCEIVE returned incomplete indicator keys: {', '.join(sorted(missing))}")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}
            # Send structured error event to frontend with limited raw excerpt for debugging
            raw_excerpt = perceive_raw[:1000]
            yield {
                "event": "error",
                "data": {
                    "message": "PERCEIVE returned incomplete indicator fields",
                    "phase": "perceive",
                    "missing_keys": list(missing),
                    "raw_excerpt": raw_excerpt,
                    "timestamp": trace.events[-1].timestamp,
                    "recovery_suggestion": "Proceeding with fallback indicator; consider shortening or clarifying regulatory text",
                },
            }
            # Fallback indicator so the pipeline can continue robustly
            indicator = {
                "category": "unknown",
                "description": "LLM did not return a complete description",
                "risk_rationale": "",
            }
        perceive_pra = {
            "perceive": perceive_data.get("perceive", ""),
            "reason": perceive_data.get("reason", ""),
        }

        trace.info("Feature Engineer", f"Parsing LLM response — {perceive_response.usage.total_tokens} tokens used")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        trace.success(
            "Feature Engineer",
            f"PERCEIVE complete — category: {indicator.get('category', 'unknown')}, "
            f"{len(parameters)} parameters extracted",
        )
        yield {"event": "trace", "data": trace.events[-1].to_dict()}
        yield {
            "event": "perceive",
            "data": {
                "pra": perceive_pra,
                "indicator": indicator,
                "parameters": parameters,
                "computation_plan": computation_plan,
            },
        }

    # ── SCHEMA ADAPT ───────────────────────────────────────────────────────────
    from config import CHANNELS, CHANNEL_COMMON_COLUMNS

    if cached_adaptation:
        # Rethink shortcut: reuse previous Adapter results (skip LLM call)
        channel_adaptations = cached_adaptation["channel_adaptations"]
        schema_adapt_pra = cached_adaptation.get("adapt_pra", {"perceive": "", "reason": ""})

        direct = [k for k, v in channel_adaptations.items() if v.get("status") == "direct_match"]
        proxy = [k for k, v in channel_adaptations.items() if v.get("status") == "proxy_required"]
        infeasible = [k for k, v in channel_adaptations.items() if v.get("status") == "not_feasible"]

        trace.info("Schema Adapter", f"SCHEMA ADAPT skipped — reusing cached: {len(direct)} direct, {len(proxy)} proxy")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}
        yield {
            "event": "schema_adapt",
            "data": {
                "pra": schema_adapt_pra,
                "channel_adaptations": channel_adaptations,
                "summary": {
                    "direct_match": direct,
                    "proxy_required": proxy,
                    "not_feasible": infeasible,
                },
                "cached": True,
            },
        }
    else:
        trace.agent("Schema Adapter", "Starting SCHEMA ADAPT phase — analyzing channel compatibility")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        # Build per-channel/table schema descriptions for the LLM
        channel_schema_lines = []
        if schema_key == "ibm_aml":
            trans_cols = schema_info.get("columns", [])
            channel_schema_lines.append(
                f"  ibm_aml (merged): {schema_info.get('row_count', 'unknown'):,} rows | columns: {trans_cols}"
            )
            n_schemas = 1
        else:
            for ch_key, ch_def in CHANNELS.items():
                cols = CHANNEL_COMMON_COLUMNS + ch_def["extra_columns"]
                channel_schema_lines.append(
                    f"  {ch_key} ({ch_def['name']}): {ch_def['row_count']:,} rows | columns: {cols}"
                )
            n_schemas = len(CHANNELS)
        channel_schemas_str = "\n".join(channel_schema_lines)

        required_cols = computation_plan.get("required_columns", [])

        adapt_prompt_text = SCHEMA_ADAPT_PROMPT.format(
            indicator=json.dumps(indicator),
            required_columns=json.dumps(required_cols),
            channel_schemas=channel_schemas_str,
        )
        # Adapter is not a rethink target — no feedback injection

        trace.info("Schema Adapter", f"Analyzing {n_schemas} {'table(s)' if schema_key == 'ibm_aml' else 'channel(s)'} for indicator: {indicator.get('category', 'unknown')}")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        schema_adapt_response = await client.chat.completions.create(
            model=FAST_LLM,
            temperature=temperature,
            max_tokens=MAX_ADAPT_TOKENS,
            messages=[
                {"role": "system", "content": "You are a Schema Adapter Agent for AML detection. Your role is to analyze database schemas and determine how regulatory indicators can be computed on different data channels."},
                {"role": "user", "content": adapt_prompt_text},
            ],
        )
        schema_adapt_raw = schema_adapt_response.choices[0].message.content
        schema_adapt_data = _extract_json(schema_adapt_raw)
        # Handle PRA format
        adapt_act = schema_adapt_data.get("act", schema_adapt_data)
        channel_adaptations = adapt_act.get("channel_adaptations", {})
        schema_adapt_pra = {
            "perceive": schema_adapt_data.get("perceive", ""),
            "reason": schema_adapt_data.get("reason", ""),
        }

        # Summarize results
        direct = [k for k, v in channel_adaptations.items() if v.get("status") == "direct_match"]
        proxy = [k for k, v in channel_adaptations.items() if v.get("status") == "proxy_required"]
        infeasible = [k for k, v in channel_adaptations.items() if v.get("status") == "not_feasible"]

        trace.success(
            "Schema Adapter",
            f"SCHEMA ADAPT complete — {len(direct)} direct, {len(proxy)} proxy, {len(infeasible)} not feasible"
        )
        yield {"event": "trace", "data": trace.events[-1].to_dict()}
        yield {
            "event": "schema_adapt",
            "data": {
                "pra": schema_adapt_pra,
                "channel_adaptations": channel_adaptations,
                "summary": {
                    "direct_match": direct,
                    "proxy_required": proxy,
                    "not_feasible": infeasible,
                },
            },
        }

    # ── REASON ────────────────────────────────────────────────────────────────
    trace.agent("Feature Engineer", "Starting REASON phase — generating Python code")
    yield {"event": "trace", "data": trace.events[-1].to_dict()}

    # Include schema adaptation context in the Reason prompt
    adapt_context = ""
    if channel_adaptations:
        adapt_lines = []
        for ch_key, adapt in channel_adaptations.items():
            status = adapt.get("status", "unknown")
            # not_feasible channels are irrelevant for code generation — skip them
            # to reduce prompt tokens (saves ~30 tokens per skipped channel).
            if status == "not_feasible":
                continue
            strategy = adapt.get("strategy", "")[:60]  # tighter cap (was 100)
            adapt_lines.append(f"  {ch_key}: {status} — {strategy}")
        if adapt_lines:
            adapt_context = "\n\nCOMPATIBLE CHANNELS:\n" + "\n".join(adapt_lines)

    reason_prompt = REASON_PROMPT.format(
        indicator=json.dumps(indicator, indent=2),
        parameters=json.dumps(parameters, indent=2),
        computation_plan=json.dumps(computation_plan, indent=2),
        columns=columns_str,
    ) + adapt_context + _kernel_prompt_section(schema_key, computation_plan)
    # Only inject feedback into Engineer when it's the rethink target (rethink_code)
    if feedback_context and cached_perceive and cached_adaptation:
        reason_prompt += f"\n\nFEEDBACK FROM PREVIOUS ATTEMPT:\n{feedback_context}"

    trace.info(
        "Feature Engineer",
        f"Building computation plan: {computation_plan.get('operation', 'aggregate')} "
        f"over {computation_plan.get('aggregation_level', 'customer_id')}",
    )
    yield {"event": "trace", "data": trace.events[-1].to_dict()}

    trace.info("Feature Engineer", f"Calling {model} — generating compute_feature() code...")
    yield {"event": "trace", "data": trace.events[-1].to_dict()}

    # Engineer gets system + reason_prompt only (reason_prompt already contains
    # indicator, parameters, computation_plan, columns, adapt_context — all structured data).
    # No perceive exchange needed — avoids 3x context bloat that caused 20-60s hangs.
    try:
        reason_response = await client.chat.completions.create(
            model=model,
            temperature=temperature,
            max_tokens=MAX_REASON_TOKENS,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": reason_prompt},
            ],
        )
    except Exception as e:
        err_msg = f"{type(e).__name__}: {str(e)[:800]}"
        trace.error("Feature Engineer", f"REASON LLM call failed — {err_msg}")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}
        # Send error event to frontend
        yield {
            "event": "error",
            "data": {
                "message": f"LLM Error in Engineer phase: {err_msg}. This may be due to token limits or API errors. Try 'Rethink code' or rephrase the regulatory text.",
                "phase": "engineer",
                "timestamp": trace.events[-1].timestamp,
                "recovery_suggestion": "Try shortening the regulatory text or use 'Rethink code' option",
            },
        }
        raise RuntimeError(f"REASON failed: {err_msg}") from e
    
    code = _enforce_return_line(
        _clean_code(reason_response.choices[0].message.content),
        schema_key,
    )

    # ── Detect output truncation ─────────────────────────────────────────────
    # finish_reason == "length" means the engineer hit the MAX_REASON_TOKENS cap
    # before completing the function body.  _enforce_return_line appends a return
    # statement so the code *looks* valid, but the logic is incomplete → the
    # feature produces a near-constant output → IV = KS = 0.
    #
    # Recovery: ask FAST_LLM to *complete* (not fix) the truncated function,
    # supplying the original indicator + computation_plan as context so the
    # completion is semantically grounded, not a random stub.
    _finish_reason = (reason_response.choices[0].finish_reason or "").lower()
    if _finish_reason == "length":
        trace.error(
            "Feature Engineer",
            f"REASON output truncated at {MAX_REASON_TOKENS} tokens "
            f"(finish_reason=length) — issuing completion call via {FAST_LLM}.",
        )
        yield {"event": "trace", "data": trace.events[-1].to_dict()}
        yield {
            "event": "error",
            "data": {
                "message": (
                    f"Feature Engineer hit the {MAX_REASON_TOKENS}-token output budget "
                    "— code was cut off mid-function. "
                    "Auto-completing via fast model..."
                ),
                "phase": "engineer",
                "timestamp": trace.events[-1].timestamp,
            },
        }
        _sv = _schema_template(schema_key)
        _completion_prompt = (
            "The feature function below was cut off before finishing.\n"
            "Complete it so it runs end-to-end — keep all existing lines "
            "and only append what is missing.\n\n"
            f"TRUNCATED CODE:\n```python\n{code}\n```\n\n"
            "ORIGINAL TASK:\n"
            f"Indicator: {json.dumps(indicator)}\n"
            f"Computation Plan: {json.dumps(computation_plan)}\n"
            f"Available columns: {columns_str}\n\n"
            "Rules:\n"
            "1. df['feature'] must be assigned a numeric (float/int) Series.\n"
            f"2. End with exactly: "
            f"return df.groupby('{_sv['id_col']}')['feature'].last().reset_index()\n"
            "3. Use only pandas and numpy — no extra imports.\n"
            "4. Return ONLY the complete Python function. No markdown fences."
        )
        try:
            _completion_resp = await client.chat.completions.create(
                model=FAST_LLM,
                temperature=temperature,
                max_tokens=MAX_CORRECT_TOKENS,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": _completion_prompt},
                ],
            )
            code = _enforce_return_line(
                _clean_code(_completion_resp.choices[0].message.content),
                schema_key,
            )
            trace.success(
                "Feature Engineer",
                f"Truncation recovery complete — {len(code.splitlines())} lines.",
            )
            yield {"event": "trace", "data": trace.events[-1].to_dict()}
        except Exception as _ce:
            trace.error(
                "Feature Engineer",
                f"Completion call failed: {str(_ce)[:200]} — "
                "truncated code will enter the normal correction loop.",
            )
            yield {"event": "trace", "data": trace.events[-1].to_dict()}
            # Fall through — truncated code enters the standard AST/sandbox
            # correction loop below; FAST_LLM will still attempt a fix there.

    # Extract PRA from code comments
    engineer_pra = _extract_code_pra(code)

    trace.success("Feature Engineer", f"REASON complete — generated {len(code.splitlines())} lines of code")
    yield {"event": "trace", "data": trace.events[-1].to_dict()}
    yield {"event": "code", "data": {"code": code, "iteration": 0, "pra": engineer_pra}}

    # ── ACT / VALIDATE ────────────────────────────────────────────────────────
    trace.agent("Deterministic Validator", "Starting ACT phase — validation loop")
    yield {"event": "trace", "data": trace.events[-1].to_dict()}

    from validators.ast_analyzer import analyze_code, extract_column_refs, validate_columns
    from config import CHANNELS, CHANNEL_COMMON_COLUMNS

    # --- Step 1: AST safety analysis ---
    trace.tool("Deterministic Validator", "Running syntax check (tokenize + compile)")
    yield {"event": "trace", "data": trace.events[-1].to_dict()}

    trace.tool("Deterministic Validator", "Running AST analysis — checking structure and safety")
    yield {"event": "trace", "data": trace.events[-1].to_dict()}

    ast_result = analyze_code(code)

    # --- Step 2: Column alignment — check if at least one channel has all referenced columns ---
    # Build per-channel column sets (schema-aware)
    acct_cols = schema_info.get("accounts_columns", [])
    channel_col_sets: dict[str, set[str]] = {}

    if schema_key == "ibm_aml":
        # IBM AML: single "channel" with all merged table columns
        ibm_cols = set(schema_info.get("columns", []))
        channel_col_sets["ibm_aml"] = ibm_cols
    else:
        # FINTRAC: 7 channels with different column sets
        for ch_key, ch_def in CHANNELS.items():
            ch_cols = set(CHANNEL_COMMON_COLUMNS) | set(ch_def["extra_columns"]) | {"channel"} | set(acct_cols)
            channel_col_sets[ch_key] = ch_cols
    all_valid_cols = sorted(set().union(*channel_col_sets.values()))

    referenced_cols = extract_column_refs(code)

    # Find which channels can run this code
    compatible_channels = []
    for ch_key, ch_cols in channel_col_sets.items():
        if referenced_cols <= ch_cols:
            compatible_channels.append(ch_key)

    # Column validation: pass if at least one channel has all columns
    if referenced_cols and not compatible_channels:
        # No channel has all referenced columns — find which columns are problematic
        # (columns not present in ANY channel)
        all_available = set().union(*channel_col_sets.values())
        unknown_cols = sorted(referenced_cols - all_available)
        col_result = validate_columns(code, list(all_available))
        trace.tool("Deterministic Validator", f"Column check FAILED — no channel has all required columns. Unknown: {unknown_cols}")
    else:
        col_result = validate_columns(code, all_valid_cols)
        if compatible_channels:
            trace.tool("Deterministic Validator", f"Column check OK — compatible with {len(compatible_channels)} channel(s): {', '.join(sorted(compatible_channels))}")
        else:
            trace.tool("Deterministic Validator", "Column check OK — no column references found")

    yield {"event": "trace", "data": trace.events[-1].to_dict()}

    # Merge column findings into AST result
    combined_findings = ast_result.findings + col_result.findings
    all_passed = ast_result.passed and col_result.passed

    # --- Stage 2.5: Runtime sandbox ---
    # Static AST/column checks cannot catch runtime errors such as the
    # rolling(on='Timestamp') + set_index('Timestamp') conflict.
    # Execute against a tiny data sample so failures feed into the
    # self-correction loop instead of surfacing later in statistical
    # evaluation (which has no auto-fix path).
    if all_passed:
        _sandbox_err = _sandbox_exec(code, schema_key)
        if _sandbox_err is None:
            trace.tool("Deterministic Validator", "Sandbox execution OK")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}
        else:
            from validators.ast_analyzer import ASTFinding, Severity
            combined_findings.append(ASTFinding(
                severity=Severity.ERROR,
                category="runtime_error",
                rule="sandbox_exec",
                message=f"Sandbox execution failed: {_sandbox_err}",
            ))
            all_passed = False
            trace.error("Deterministic Validator", f"Sandbox execution failed: {_sandbox_err[:200]}")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}

    # Build Validator PRA (deterministic — no LLM)
    n_errors = sum(1 for f in combined_findings if f.severity.value == "error")
    n_warnings = sum(1 for f in combined_findings if f.severity.value == "warning")
    validator_pra = {
        "perceive": f"Received {len(code.splitlines())} lines of Python code for validation. Checking AST safety and column alignment across {len(channel_col_sets)} channels.",
        "reason": (
            f"AST analysis: {'PASS' if ast_result.passed else 'FAIL'} ({n_errors} errors, {n_warnings} warnings). "
            f"Column alignment: code references {len(referenced_cols)} columns ({', '.join(sorted(referenced_cols)[:5])}{'...' if len(referenced_cols) > 5 else ''}). "
            f"{'Compatible with ' + str(len(compatible_channels)) + ' channel(s): ' + ', '.join(sorted(compatible_channels)) if compatible_channels else 'No compatible channels found.'}"
        ),
    }

    # Emit validation event with details
    yield {
        "event": "validation",
        "data": {
            "pra": validator_pra,
            "passed": all_passed,
            "ast_passed": ast_result.passed,
            "columns_passed": col_result.passed,
            "ast_findings": ast_result.to_dict(),
            "column_findings": col_result.to_dict(),
            "schema_columns": all_valid_cols,
            "compatible_channels": sorted(compatible_channels),
            "required_columns": sorted(referenced_cols),
        },
    }

    corrections_exhausted = False  # set True if all correction slots used without success
    if all_passed:
        trace.success("Deterministic Validator", "All checks passed — AST safe, columns aligned")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}
    else:
        errors = "; ".join(f.message for f in combined_findings if f.severity.value == "error")
        trace.error("Deterministic Validator", f"Validation failed: {errors}")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        # ── CORRECT (self-correction loop) ────────────────────────────────────
        _prev_errors: str = ""
        for iteration in range(1, max_corrections + 1):
            # Early exit: if the same error repeats, the LLM cannot fix it by retrying.
            # Break now rather than burning all correction slots on an unfixable pattern.
            if errors == _prev_errors:
                trace.error(
                    "Deterministic Validator",
                    f"Same error repeated — stopping correction loop early (saved {max_corrections - iteration + 1} LLM call(s))",
                )
                yield {"event": "trace", "data": trace.events[-1].to_dict()}
                corrections_exhausted = True
                break
            _prev_errors = errors

            trace.agent("Feature Engineer", f"Self-correction attempt {iteration}/{max_corrections}")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}

            # Inject a targeted hint for categorical-rolling errors (no column substitution can fix these)
            _extra_hint = ""
            if "no numeric types to aggregate" in errors.lower() or "no numeric" in errors.lower():
                sv = _schema_template(schema_key)
                _extra_hint = (
                    "\n\nCATEGORICAL ROLLING FIX — the rolling window failed because the signal column is non-numeric. "
                    "Encode the column to float codes BEFORE rolling:\n"
                    f"  df['_enc'] = pd.factorize(df[signal_col])[0].astype(float)\n"
                    f"  df['feature'] = df.groupby('{sv['id_col']}', group_keys=False).apply(\n"
                    f"      lambda g: g.rolling(window, on='{sv['datetime_col']}')['_enc'].apply(lambda x: float(len(set(x))), raw=True)\n"
                    f"  )\n"
                    "Replace `signal_col` with the actual column name and `window` with the time window string (e.g. '7D')."
                )

            correct_prompt = CORRECT_PROMPT.format(
                error=errors,
                code=code,
                columns=columns_str,
                accounts_columns=accounts_columns_str,
                schema_column_hints=_schema_column_hints(schema_key) + _extra_hint,
            )

            trace.info("Feature Engineer", f"Calling {FAST_LLM} — rewriting code to fix: {errors[:80]}...")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}

            correct_response = await client.chat.completions.create(
                model=FAST_LLM,
                temperature=temperature,
                max_tokens=MAX_CORRECT_TOKENS,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": correct_prompt},
                ],
            )
            code = _enforce_return_line(
                _clean_code(correct_response.choices[0].message.content),
                schema_key,
            )

            trace.tool("Deterministic Validator", f"Re-validating corrected code (attempt {iteration})")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}

            ast_result = analyze_code(code)
            referenced_cols = extract_column_refs(code)
            compatible_channels = [
                ch_key for ch_key, ch_cols in channel_col_sets.items()
                if referenced_cols <= ch_cols
            ]
            if referenced_cols and not compatible_channels:
                all_available = set().union(*channel_col_sets.values())
                col_result = validate_columns(code, list(all_available))
            else:
                col_result = validate_columns(code, all_valid_cols)
            combined_findings = ast_result.findings + col_result.findings
            all_passed = ast_result.passed and col_result.passed

            # Re-run sandbox on the corrected code
            if all_passed:
                _sandbox_err = _sandbox_exec(code, schema_key)
                if _sandbox_err is not None:
                    from validators.ast_analyzer import ASTFinding, Severity
                    combined_findings.append(ASTFinding(
                        severity=Severity.ERROR,
                        category="runtime_error",
                        rule="sandbox_exec",
                        message=f"Sandbox execution failed: {_sandbox_err}",
                    ))
                    all_passed = False
                    trace.error("Deterministic Validator", f"Corrected code still fails sandbox: {_sandbox_err[:200]}")
                    yield {"event": "trace", "data": trace.events[-1].to_dict()}

            yield {
                "event": "validation",
                "data": {
                    "passed": all_passed,
                    "ast_passed": ast_result.passed,
                    "columns_passed": col_result.passed,
                    "ast_findings": ast_result.to_dict(),
                    "column_findings": col_result.to_dict(),
                    "schema_columns": all_valid_cols,
                    "compatible_channels": sorted(compatible_channels),
                    "required_columns": sorted(referenced_cols),
                    "iteration": iteration,
                },
            }

            if all_passed:
                trace.success("Deterministic Validator", f"All checks passed after {iteration} correction(s)")
                yield {"event": "trace", "data": trace.events[-1].to_dict()}
                yield {"event": "code", "data": {"code": code, "iteration": iteration}}
                break
            else:
                errors = "; ".join(f.message for f in combined_findings if f.severity.value == "error")
                trace.error("Deterministic Validator", f"Still failing: {errors}")
                yield {"event": "trace", "data": trace.events[-1].to_dict()}
        else:
            # for-else: loop ran all max_corrections iterations without a break → exhausted
            corrections_exhausted = True
            trace.error("Deterministic Validator",
                f"All {max_corrections} correction attempts exhausted — benchmark fallback will be used")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}

    # ── DECISION LOOP (if correction failed + pipeline_id exists) ────────────
    all_options = [
        {
            "key": "find_similar",
            "label": "Find Similar Columns",
            "description": "Let the Engineer try using the closest available columns as proxies.",
        },
        {
            "key": "rethink",
            "label": "Rethink Approach",
            "description": "Ask the Engineer to redesign the feature using a completely different strategy with only available columns.",
        },
        {
            "key": "skip",
            "label": "Skip This Feature",
            "description": "Abandon this feature and stop the pipeline.",
        },
    ]
    tried_options: set[str] = set()
    decision_iteration = 0

    while not all_passed and pipeline_id:
        # If the sandbox/AST correction loop exhausted all attempts, skip user interaction
        # entirely — the orchestrator will activate the benchmark fallback automatically.
        if corrections_exhausted:
            trace.info("Feature Engineer",
                "Corrections exhausted — skipping user decision prompt; orchestrator will use benchmarks")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}
            break

        # Compute missing columns
        all_available = set().union(*channel_col_sets.values())
        missing_cols = sorted(referenced_cols - all_available)
        errors_list = [f.message for f in combined_findings if f.severity.value == "error"]

        # Filter out already-tried options (keep skip always)
        remaining_options = [
            opt for opt in all_options
            if opt["key"] not in tried_options or opt["key"] == "skip"
        ]
        if len(remaining_options) <= 1:
            # Only skip left — auto-skip
            trace.info("Feature Engineer", "All repair options exhausted. Skipping feature.")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}
            break

        yield {
            "event": "decision_required",
            "data": {
                "pipeline_id": pipeline_id,
                "context": "validation_failed",
                "errors": errors_list,
                "missing_columns": missing_cols,
                "available_columns": all_valid_cols,
                "options": remaining_options,
            },
        }

        trace.agent("Feature Engineer", "Waiting for user decision...")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        decision = await _wait_for_decision(pipeline_id)
        tried_options.add(decision)
        decision_iteration += 1

        if decision == "skip":
            trace.info("Feature Engineer", "User chose to skip this feature.")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}
            break

        # Emit phase events for tab loopback visualization
        yield {"event": "phase_change", "data": {"phase": "engineer", "status": "active", "message": f"Feature Engineer regenerating code ({decision})..."}}
        yield {"event": "phase_change", "data": {"phase": "validator", "status": "active", "message": "Validator will re-check..."}}

        if decision == "find_similar":
            repair_prompt = (
                f"COLUMN SUBSTITUTION TASK:\n\n"
                f"Your previous code referenced columns that don't exist:\n"
                f"Missing: {missing_cols}\n\n"
                f"Available columns: {all_valid_cols}\n\n"
                f"Find the closest available columns that can serve as proxies and rewrite "
                f"compute_feature() using ONLY available columns.\n"
                f"Add # PERCEIVE and # REASON comment blocks explaining your substitution.\n"
                f"Return ONLY the Python code, no markdown fences."
            )
        else:  # rethink
            repair_prompt = (
                f"COMPLETE REDESIGN TASK:\n\n"
                f"The original approach failed because these columns don't exist: {missing_cols}\n\n"
                f"Original indicator: {json.dumps(indicator)}\n"
                f"Available columns: {all_valid_cols}\n\n"
                f"Design a COMPLETELY DIFFERENT detection approach for this indicator "
                f"using only available columns. Do NOT try to approximate the missing columns. "
                f"Think about what OTHER behavioral patterns could indicate the same risk.\n\n"
                f"Add # PERCEIVE and # REASON comment blocks.\n"
                f"Return ONLY the Python code, no markdown fences."
            )

        trace.agent("Feature Engineer", f"User chose '{decision}' — regenerating code...")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        repair_response = await client.chat.completions.create(
            model=model,
            temperature=temperature,
            max_tokens=MAX_REASON_TOKENS,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": repair_prompt},
            ],
        )
        code = _enforce_return_line(
            _clean_code(repair_response.choices[0].message.content),
            schema_key,
        )
        engineer_pra = _extract_code_pra(code)

        iter_num = max_corrections + decision_iteration
        yield {"event": "code", "data": {"code": code, "iteration": iter_num, "pra": engineer_pra}}

        # Re-validate
        ast_result = analyze_code(code)
        referenced_cols = extract_column_refs(code)
        compatible_channels = [
            ch_key for ch_key, ch_cols in channel_col_sets.items()
            if referenced_cols <= ch_cols
        ]
        if referenced_cols and not compatible_channels:
            col_result = validate_columns(code, list(set().union(*channel_col_sets.values())))
        else:
            col_result = validate_columns(code, all_valid_cols)
        combined_findings = ast_result.findings + col_result.findings
        all_passed = ast_result.passed and col_result.passed

        status_msg = "PASS" if all_passed else "FAIL"
        trace.info("Deterministic Validator", f"Re-validation after '{decision}': {status_msg}")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        yield {
            "event": "validation",
            "data": {
                "passed": all_passed,
                "ast_passed": ast_result.passed,
                "columns_passed": col_result.passed,
                "ast_findings": ast_result.to_dict(),
                "column_findings": col_result.to_dict(),
                "schema_columns": all_valid_cols,
                "compatible_channels": sorted(compatible_channels),
                "required_columns": sorted(referenced_cols),
                "iteration": iter_num,
            },
        }

        if all_passed:
            yield {"event": "phase_change", "data": {"phase": "validator", "status": "done", "message": "Validator passed after user decision"}}
        # else: loop continues, will show remaining options

    # ── DONE ──────────────────────────────────────────────────────────────────
    trace.success("Feature Engineer", "Compilation complete")
    yield {"event": "trace", "data": trace.events[-1].to_dict()}

    yield {
        "event": "complete",
        "data": {
            "code": code,
            "indicator": indicator,
            "parameters": parameters,
            "computation_plan": computation_plan,
            "channel_adaptations": channel_adaptations,
            "validation_passed": all_passed,
            "exhausted_corrections": corrections_exhausted,  # True → orchestrator activates benchmark fallback
            "ast_findings": ast_result.to_dict(),
            "column_findings": col_result.to_dict(),
            "required_columns": sorted(referenced_cols),
            "compatible_channels": sorted(compatible_channels),
            "trace": trace.to_list(),
            "perceive_raw": perceive_raw,  # For rethink caching
        },
    }


def compile_feature_sync(
    regulatory_text: str,
    schema_info: dict,
    schema_key: str = "ibm_aml",
    model: str = DEFAULT_LLM,
) -> dict:
    """Synchronous wrapper — collects all events and returns the final result."""
    import asyncio

    async def _collect():
        result = None
        async for event in compile_feature(regulatory_text, schema_info, schema_key, model):
            if event["event"] == "complete":
                result = event["data"]
        return result

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, _collect())
                return future.result()
        return loop.run_until_complete(_collect())
    except RuntimeError:
        return asyncio.run(_collect())


def _extract_json(text: str) -> dict:
    """Extract JSON from LLM response (handles markdown fences)."""
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code block
    match = re.search(r"```(?:json)?\s*\n(.*?)\n```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding first { to last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    return {"raw": text, "parse_error": True}


def _clean_code(text: str) -> str:
    """Strip markdown fences and leading/trailing whitespace from generated code."""
    # Remove ```python ... ``` wrapping
    match = re.search(r"```(?:python)?\s*\n(.*?)\n```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    # If no fences, return as-is (trimmed)
    return text.strip()


async def extract_feature_candidates(
    regulatory_text: str,
    schema_info: dict,
    model: str = DEFAULT_LLM,
    temperature: float = LLM_TEMPERATURE,
    max_candidates: int = MAX_FEATURE_CANDIDATES,
    schema_key: str = "fintrac",
) -> list[dict]:
    """Use an LLM to extract multiple candidate feature specifications from text.

    schema_key is used to inject the exact column names into the prompt so the LLM
    uses the right id / amount / datetime columns (e.g. 'Sender_Account' for IBM AML,
    'customer_id' for FINTRAC).  The same column names are then enforced on every
    candidate returned — belt-and-suspenders so downstream code generation never
    receives a wrong aggregation_level.
    """
    client = _get_client()
    schema_str = json.dumps(_slim_schema(schema_info), indent=2, default=str)[:3000]

    # Inject schema-specific column names so the LLM uses the exact right names
    sv = _schema_template(schema_key)
    prompt = MULTI_FEATURE_PROMPT.format(
        max_candidates=max_candidates,
        schema_info=schema_str,
        regulatory_text=regulatory_text[:4000],
        id_col=sv["id_col"],
        amt_col=sv["amount_col"],
        dt_col=sv["datetime_col"],
        secondary_col=sv["secondary_col"],
    )

    response = await client.chat.completions.create(
        model=model,
        temperature=temperature,
        max_tokens=MAX_MULTI_FEATURE_TOKENS,
        messages=[
            {"role": "system", "content": MULTI_FEATURE_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    )
    raw = response.choices[0].message.content
    data = _extract_json(raw)
    candidates = data.get("feature_candidates") if isinstance(data, dict) else None
    if not isinstance(candidates, list):
        return []

    correct_id_col = sv["id_col"]
    normalized: list[dict] = []
    for idx, cand in enumerate(candidates[:max_candidates], start=1):
        if not isinstance(cand, dict):
            continue
        cp = cand.get("computation_plan", {})
        if isinstance(cp, dict):
            # Deterministically enforce the correct id column — LLMs sometimes
            # substitute 'customer_id' even when 'Sender_Account' was specified.
            # A wrong aggregation_level propagates to the REASON_PROMPT and causes
            # the generated code to reference a column that doesn't exist in the data,
            # making the sandbox fail and the candidate be silently skipped.
            cp["aggregation_level"] = correct_id_col
        normalized.append({
            "name": cand.get("name", ""),
            "description": cand.get("description", ""),
            "indicator": cand.get("indicator", {}),
            "parameters": cand.get("parameters", []),
            "computation_plan": cp,
            "perceive": cand.get("perceive", ""),
            "reason": cand.get("reason", ""),
        })
    return normalized


def _extract_code_pra(code: str) -> dict:
    """Extract PERCEIVE and REASON comments from generated feature code."""
    perceive = ""
    reason = ""
    for line in code.splitlines():
        stripped = line.strip()
        if stripped.startswith("# PERCEIVE:"):
            perceive = stripped[len("# PERCEIVE:"):].strip()
        elif stripped.startswith("# REASON:"):
            reason = stripped[len("# REASON:"):].strip()
    return {"perceive": perceive, "reason": reason}
