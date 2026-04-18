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
    LLM_TEMPERATURE,
    MAX_CORRECTION_ITERATIONS,
    MAX_OUTPUT_TOKENS,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
)
from core.ontology import ALLOWED_OPERATIONS, CATEGORY_DESCRIPTIONS, IndicatorCategory
from utils.trace_logger import TraceLogger


def _get_client() -> AsyncOpenAI:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured")
    kwargs = {"api_key": OPENAI_API_KEY, "timeout": 120.0}
    if OPENAI_BASE_URL:
        kwargs["base_url"] = OPENAI_BASE_URL
    return AsyncOpenAI(**kwargs)


def _build_ontology_reference() -> str:
    """Format the ontology categories for the LLM prompt."""
    lines = []
    for cat in IndicatorCategory:
        desc = CATEGORY_DESCRIPTIONS.get(cat, "")
        lines.append(f"  - {cat.value}: {desc}")
    return "\n".join(lines)


SYSTEM_PROMPT = """You are an expert AML (Anti-Money Laundering) Feature Engineer.

Your job: Given regulatory text and a dataset schema, generate a Python function
`compute_feature(df, accounts_df=None)` that computes a single detection feature.

RULES:
1. The function MUST be named `compute_feature`
2. It receives `df` (transactions DataFrame) and optionally `accounts_df` (accounts DataFrame)
3. It MUST return a pandas DataFrame with at least one numeric column
4. Use only pandas and numpy (imported as pd and np -- already available)
5. Do NOT import any modules (pd and np are pre-injected)
6. Do NOT perform file I/O, network calls, or use eval/exec
7. Aggregate to account level (one row per account)
8. The output DataFrame MUST have exactly TWO columns: an ID column (e.g. customer_id or Sender_Account)
   and ONE numeric feature column. Do NOT use pivot(), unstack(), or create multiple feature columns.
   If you need to aggregate over time, SUM or COUNT across all time periods into a single value.
9. Extract any ambiguous parameters (thresholds, counts, time windows) as variables
   at the top of the function with sensible defaults
10. Add a brief comment explaining each parameter's regulatory basis
11. CRITICAL — COLUMN NAMES: You MUST ONLY use column names that exist in the provided
    dataset schema. Do NOT guess or invent column names. The transaction amount column
    is typically 'amount_cad', NOT 'Amount', 'Amount Received', 'amount', etc.
    Always check the schema before referencing any column.

INDICATOR ONTOLOGY (you must classify into one of these):
{ontology}

ALLOWED OPERATIONS: {operations}
"""

PERCEIVE_PROMPT = """STEP 1 — REGULATORY ANALYST (Perceive-Reason-Act)

You are the Regulatory Analyst Agent. Analyze this regulatory text and dataset schema.

Your response must follow the Perceive-Reason-Act framework:

1. **perceive**: Describe what you received. What regulatory source is this? What key concepts, behaviors, or red flags does the text mention? (2-3 sentences)

2. **reason**: Explain your analysis. Why did you classify this as a particular indicator category? What alternative categories did you consider and reject? Why did you choose specific thresholds and operations? (3-5 sentences)

3. **act**: Your structured output:
   - **indicator**: category (from ontology), description (one sentence), risk_rationale
   - **parameters**: List of ambiguous terms needing thresholds (name, ambiguous_term, dtype, default, valid_range, unit, rationale, regulatory_basis)
   - **computation_plan**: operation (from allowed list), aggregation_level, time_window, required_columns, join_strategy

REGULATORY TEXT:
{regulatory_text}

DATASET SCHEMA:
{schema_info}

Respond in JSON format with keys: perceive, reason, act (where act contains: indicator, parameters, computation_plan)"""

REASON_PROMPT = """STEP 2 — FEATURE ENGINEER (Perceive-Reason-Act)

You are the Feature Engineer Agent. Generate Python code for the detection feature.

Before the code, output TWO comment blocks at the top:

# PERCEIVE: [1-2 sentences: what indicator, what columns available, what the Schema Adapter recommended]
# REASON: [2-3 sentences: why you chose this implementation approach, what alternatives you considered, why this is better]

Then generate the `compute_feature(df, accounts_df=None)` function.

INDICATOR: {indicator}
PARAMETERS: {parameters}
COMPUTATION PLAN: {computation_plan}
SCHEMA COLUMNS (you MUST ONLY use these column names): {columns}

IMPORTANT: Only reference column names from the SCHEMA COLUMNS list above.
Return the Python code with the PERCEIVE and REASON comment blocks at the top, no markdown fences."""

SCHEMA_ADAPT_PROMPT = """STEP 1.5 — SCHEMA ADAPTER (Perceive-Reason-Act)

You are the Schema Adapter Agent. Given a regulatory indicator and available data channels,
determine how each channel can support computing this indicator.

Your response must follow the Perceive-Reason-Act framework:

1. **perceive**: What indicator are you adapting? What columns does it need? How many channels are you evaluating? (2-3 sentences)

2. **reason**: For each channel, explain your analysis step by step. What columns are available? What's missing? Can proxies work? Why or why not? (one paragraph per channel)

3. **act**: Your structured channel_adaptations output.

REGULATORY INDICATOR:
{indicator}

COMPUTATION PLAN:
{computation_plan}

REQUIRED COLUMNS (from computation plan):
{required_columns}

AVAILABLE CHANNELS AND THEIR SCHEMAS:
{channel_schemas}

For EACH channel in the act section, determine one of three statuses:
1. "direct_match" — the channel has all required columns.
2. "proxy_required" — the channel lacks some columns but proxies can work.
3. "not_feasible" — the indicator truly cannot be computed on this channel.

Respond in JSON format:
{{
  "perceive": "...",
  "reason": "...",
  "act": {{
    "channel_adaptations": {{
      "<channel_key>": {{
        "status": "direct_match" | "proxy_required" | "not_feasible",
        "strategy": "brief explanation",
        "proxy_reasoning": "only if proxy_required",
        "columns_used": ["list", "of", "columns"],
        "reason": "only if not_feasible"
      }}
    }}
  }}
}}"""

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
3. The main transaction amount column is 'amount_cad' (NOT 'Amount', 'Amount Received', 'amount', 'transaction_amount', etc.)
4. The main ID column is 'customer_id'
5. The main timestamp column is 'transaction_datetime'

Fix the code and return ONLY the corrected Python code, no markdown fences."""


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

    # Format schema for prompts
    columns_str = json.dumps(schema_info.get("columns", []), indent=2)
    accounts_columns_str = json.dumps(schema_info.get("accounts_columns", []), indent=2)
    schema_str = json.dumps(schema_info, indent=2, default=str)[:3000]

    system = SYSTEM_PROMPT.format(
        ontology=_build_ontology_reference(),
        operations=", ".join(ALLOWED_OPERATIONS),
    )

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

        perceive_text = regulatory_text[:5000]
        if feedback_context:
            perceive_text += f"\n\n{feedback_context}"

        perceive_prompt = PERCEIVE_PROMPT.format(
            regulatory_text=perceive_text,
            schema_info=schema_str,
        )

        trace.info("Feature Engineer", f"Calling {model} — extracting indicators and parameters...")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        perceive_response = await client.chat.completions.create(
            model=model,
            temperature=temperature,
            max_tokens=MAX_OUTPUT_TOKENS,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": perceive_prompt},
            ],
        )
        perceive_raw = perceive_response.choices[0].message.content

        perceive_data = _extract_json(perceive_raw)
        # Handle PRA format: act contains the structured output
        act_data = perceive_data.get("act", perceive_data)  # fallback to flat format
        indicator = act_data.get("indicator", {})
        parameters = act_data.get("parameters", [])
        computation_plan = act_data.get("computation_plan", {})
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
            indicator=json.dumps(indicator, indent=2),
            computation_plan=json.dumps(computation_plan, indent=2),
            required_columns=json.dumps(required_cols),
            channel_schemas=channel_schemas_str,
        )
        # Adapter is not a rethink target — no feedback injection

        trace.info("Schema Adapter", f"Analyzing {n_schemas} {'table(s)' if schema_key == 'ibm_aml' else 'channel(s)'} for indicator: {indicator.get('category', 'unknown')}")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        schema_adapt_response = await client.chat.completions.create(
            model=model,
            temperature=temperature,
            max_tokens=MAX_OUTPUT_TOKENS,
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
            strategy = adapt.get("strategy", "")
            adapt_lines.append(f"  {ch_key}: {status} — {strategy}")
        adapt_context = f"\n\nSCHEMA ADAPTATION (from Schema Adapter agent):\n" + "\n".join(adapt_lines)

    reason_prompt = REASON_PROMPT.format(
        indicator=json.dumps(indicator, indent=2),
        parameters=json.dumps(parameters, indent=2),
        computation_plan=json.dumps(computation_plan, indent=2),
        columns=columns_str,
    ) + adapt_context
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
    reason_response = await client.chat.completions.create(
        model=model,
        temperature=temperature,
        max_tokens=MAX_OUTPUT_TOKENS,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": reason_prompt},
        ],
    )
    code = _clean_code(reason_response.choices[0].message.content)

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

    if all_passed:
        trace.success("Deterministic Validator", "All checks passed — AST safe, columns aligned")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}
    else:
        errors = "; ".join(f.message for f in combined_findings if f.severity.value == "error")
        trace.error("Deterministic Validator", f"Validation failed: {errors}")
        yield {"event": "trace", "data": trace.events[-1].to_dict()}

        # ── CORRECT (self-correction loop) ────────────────────────────────────
        for iteration in range(1, max_corrections + 1):
            trace.agent("Feature Engineer", f"Self-correction attempt {iteration}/{max_corrections}")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}

            correct_prompt = CORRECT_PROMPT.format(
                error=errors,
                code=code,
                columns=columns_str,
                accounts_columns=accounts_columns_str,
            )

            trace.info("Feature Engineer", f"Calling {model} — rewriting code to fix: {errors[:80]}...")
            yield {"event": "trace", "data": trace.events[-1].to_dict()}

            correct_response = await client.chat.completions.create(
                model=model,
                temperature=temperature,
                max_tokens=MAX_OUTPUT_TOKENS,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": correct_prompt},
                ],
            )
            code = _clean_code(correct_response.choices[0].message.content)

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
            max_tokens=MAX_OUTPUT_TOKENS,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": repair_prompt},
            ],
        )
        code = _clean_code(repair_response.choices[0].message.content)
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
