"""Statistical feature evaluation service.

Computes KS statistic, Information Value, and distribution stats
to assess a feature's discriminatory power against labeled data.
Returns per-channel results for the pipeline orchestrator.
"""

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

from config import CHANNEL_DATA_DIR, CHANNELS, KYC_TABLES
from core.data_loader import load_channel_data


def _normalize_datetime_columns(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.columns:
        col_lower = col.lower()
        is_dt_col = (
            col_lower.endswith("datetime")
            or col_lower.endswith("date")
            or col_lower == "timestamp"
            or col_lower.endswith("_timestamp")
            or col_lower.endswith("_time")
        )
        if is_dt_col and df[col].dtype == object:
            try:
                df[col] = pd.to_datetime(df[col], errors="coerce")
            except Exception:
                pass
    return df


def _compute_iv(merged: pd.DataFrame, pos: pd.Series, neg: pd.Series) -> tuple[float, list[dict]]:
    """Compute Information Value from merged label + feature data."""
    all_vals = merged["feature_value"].dropna()
    n_bins = min(10, len(all_vals.unique()))
    if n_bins < 2:
        return 0.0, []
    try:
        bins = pd.qcut(all_vals, q=n_bins, duplicates="drop")
        iv = 0.0
        iv_bins = []
        total_pos = len(pos)
        total_neg = len(neg)
        for bin_label in bins.cat.categories:
            mask = bins == bin_label
            n_pos_bin = int(merged.loc[mask, "label"].sum())
            n_neg_bin = int((~merged.loc[mask, "label"].astype(bool)).sum())
            dist_pos = max((n_pos_bin / total_pos) if total_pos > 0 else 0.001, 0.0001)
            dist_neg = max((n_neg_bin / total_neg) if total_neg > 0 else 0.001, 0.0001)
            woe = np.log(dist_pos / dist_neg)
            bin_iv = (dist_pos - dist_neg) * woe
            iv += bin_iv
            iv_bins.append({
                "range": str(bin_label),
                "count": int(mask.sum()),
                "positive": n_pos_bin,
                "negative": n_neg_bin,
                "woe": round(float(woe), 4),
                "iv": round(float(bin_iv), 4),
            })
        return float(iv), iv_bins
    except Exception:
        return 0.0, []


def _evaluate_single_channel(
    code: str, name: str, channel_key: str, labels_df: pd.DataFrame,
    nrows: int | None = 50_000,
) -> dict | None:
    """Evaluate a feature on a single channel. Returns stats dict or error dict.

    ``nrows`` caps the channel data loaded for evaluation — 50 k rows gives
    accurate KS/IV results while preventing multi-feature OOM when multiple
    candidates are evaluated back-to-back.  Pass ``None`` for full dataset.
    """
    try:
        df, accounts_df = load_channel_data([channel_key], nrows=nrows, random_state=42)
    except Exception as e:
        return {"error": f"Failed to load {channel_key}: {e}", "channel": channel_key}

    try:
        local_ns = {}
        exec(code, {"pd": pd, "np": np}, local_ns)
        fn = local_ns.get("compute_feature")
        if fn is None:
            return None

        df = _normalize_datetime_columns(df)
        if accounts_df is not None:
            accounts_df = _normalize_datetime_columns(accounts_df)
        result = fn(df.copy(), accounts_df.copy() if accounts_df is not None else None)
        if result is None or not isinstance(result, pd.DataFrame):
            return {"error": f"Feature function returned None or non-DataFrame for {channel_key}", "channel": channel_key}

        result = result.reset_index(drop=True)
        id_cols = [c for c in result.columns if "customer" in c.lower() or "id" in c.lower()]
        num_cols = result.select_dtypes(include=[np.number]).columns.tolist()
        # Prefer the canonical 'feature' column; fall back to first non-id numeric column.
        # Do NOT use num_cols[0] blindly — Sender_Account / customer_id are also numeric.
        id_col_set = set(id_cols)
        feat_col = ('feature' if 'feature' in result.columns
                    else next((c for c in num_cols if c not in id_col_set), None))
        if not id_cols or feat_col is None:
            return {"error": f"No ID columns found: {result.columns.tolist()} or no numeric columns: {num_cols}", "channel": channel_key}

        feat_df = result[[id_cols[0], feat_col]].rename(
            columns={id_cols[0]: "customer_id", feat_col: "feature_value"}
        )
        feat_df["customer_id"] = feat_df["customer_id"].astype(str)

        # Join with labels
        merged = labels_df.merge(feat_df, on="customer_id", how="left")
        merged["feature_value"] = merged["feature_value"].fillna(0)
        if merged.empty:
            return {"error": f"Merged result is empty after joining with labels", "channel": channel_key}

        pos = merged[merged["label"] == 1]["feature_value"].dropna()
        neg = merged[merged["label"] == 0]["feature_value"].dropna()
        if len(pos) == 0 or len(neg) == 0:
            return {"error": f"No positive (n={len(pos)}) or negative (n={len(neg)}) samples after joining labels", "channel": channel_key}

        # Check if feature values are constant (all same value)
        if pos.nunique() == 1 and neg.nunique() == 1 and pos.iloc[0] == neg.iloc[0]:
            return {
                "feature_name": name,
                "channel": channel_key,
                "n_customers": len(merged),
                "n_positive": int(len(pos)),
                "n_negative": int(len(neg)),
                "ks": 0.0,
                "ks_pvalue": 1.0,
                "iv": 0.0,
                "iv_interpretation": "Not predictive (constant feature value)",
                "debug": {
                    "constant_value": float(pos.iloc[0]),
                    "pos_variance": 0.0,
                    "neg_variance": 0.0,
                },
                "stats": {
                    "positive": {
                        "mean": round(float(pos.mean()), 4),
                        "median": round(float(pos.median()), 4),
                        "std": 0.0,
                    },
                    "negative": {
                        "mean": round(float(neg.mean()), 4),
                        "median": round(float(neg.median()), 4),
                        "std": 0.0,
                    },
                },
            }

        # KS Test
        ks_stat, ks_pvalue = scipy_stats.ks_2samp(pos.values, neg.values)

        # Information Value
        iv, iv_bins = _compute_iv(merged, pos, neg)

        # IV interpretation
        if iv < 0.02:
            iv_interpretation = "Not predictive"
        elif iv < 0.1:
            iv_interpretation = "Weak"
        elif iv < 0.3:
            iv_interpretation = "Medium"
        elif iv < 0.5:
            iv_interpretation = "Strong"
        else:
            iv_interpretation = "Very strong (check for overfitting)"

        return {
            "feature_name": name,
            "channel": channel_key,
            "n_customers": len(merged),
            "n_positive": int(len(pos)),
            "n_negative": int(len(neg)),
            "ks": round(float(ks_stat), 4),
            "ks_pvalue": round(float(ks_pvalue), 6),
            "iv": round(float(iv), 4),
            "iv_interpretation": iv_interpretation,
            "iv_bins": iv_bins,
            "stats": {
                "positive": {
                    "mean": round(float(pos.mean()), 4),
                    "median": round(float(pos.median()), 4),
                    "std": round(float(pos.std()), 4),
                },
                "negative": {
                    "mean": round(float(neg.mean()), 4),
                    "median": round(float(neg.median()), 4),
                    "std": round(float(neg.std()), 4),
                },
            },
        }
    except Exception as e:
        return {"error": f"Evaluation failed on {channel_key}: {e}", "channel": channel_key}


async def evaluate_feature(
    code: str,
    name: str,
    channels: list[str],
    schema_key: str = "fintrac",
) -> dict:
    """Evaluate a single feature's statistical power across channels.

    Returns dict with:
    - channel_results: per-channel KS, IV, distribution, group stats
    - best_channel: channel with highest IV
    - best_iv: highest IV across channels
    """

    if schema_key == "ibm_aml":
        return _evaluate_ibm_aml(code, name)

    channels = channels or list(CHANNELS.keys())[:3]

    # Load labels once
    labels_path = CHANNEL_DATA_DIR / KYC_TABLES["labels"]["file"]
    if not labels_path.exists():
        raise FileNotFoundError("Labels file not found")
    labels_df = pd.read_csv(labels_path)
    labels_df["customer_id"] = labels_df["customer_id"].astype(str)

    # Evaluate per channel
    channel_results = {}
    channel_errors = {}
    best_iv = 0.0
    best_channel = None

    for ch in channels:
        result = _evaluate_single_channel(code, name, ch, labels_df, nrows=50_000)
        if result is not None and "error" not in result:
            channel_results[ch] = result
            if result.get("iv", 0) > best_iv:
                best_iv = result["iv"]
                best_channel = ch
        elif result and "error" in result:
            channel_errors[ch] = result["error"]

    return {
        "channel_results": channel_results,
        "channel_errors": channel_errors,
        "best_channel": best_channel,
        "best_iv": round(best_iv, 4),
    }


def _evaluate_ibm_aml(code: str, name: str) -> dict:
    """Evaluate a feature on IBM AML dataset (single-channel evaluation).

    Uses a chunk-based early-stop read (same strategy as detection_runner):
    reads 50 k rows at a time and stops when ≥ 50 laundering rows are found
    or 500 k rows are consumed.  This keeps evaluation fast for both simple
    aggregations and rolling-window features while guaranteeing enough
    positive labels for meaningful KS/IV computation.
    """
    from config import IBM_AML_TRANS_PATH

    try:
        EVAL_CHUNK  = 50_000
        EVAL_MIN_POS = 50
        EVAL_MAX_ROWS = 500_000
        _chunks: list[pd.DataFrame] = []
        _n_pos = 0
        _rows_read = 0
        for _c in pd.read_csv(IBM_AML_TRANS_PATH, chunksize=EVAL_CHUNK):
            _chunks.append(_c)
            _n_pos += int((_c["Is Laundering"] == 1).sum())
            _rows_read += len(_c)
            if _n_pos >= EVAL_MIN_POS or _rows_read >= EVAL_MAX_ROWS:
                break
        df = pd.concat(_chunks, ignore_index=True)
    except Exception as e:
        return {
            "channel_results": {},
            "channel_errors": {"ibm_aml": f"Failed to load IBM AML data: {e}"},
            "best_channel": None,
            "best_iv": 0.0,
        }

    try:
        # Execute feature code
        local_ns = {}
        exec(code, {"pd": pd, "np": np}, local_ns)
        fn = local_ns.get("compute_feature")
        if fn is None:
            return {
                "channel_results": {},
                "channel_errors": {"ibm_aml": "No compute_feature function found"},
                "best_channel": None,
                "best_iv": 0.0,
            }

        df = _normalize_datetime_columns(df)
        result = fn(df.copy(), None)
        if result is None or not isinstance(result, pd.DataFrame):
            return {
                "channel_results": {},
                "channel_errors": {"ibm_aml": "Function did not return a DataFrame"},
                "best_channel": None,
                "best_iv": 0.0,
            }

        result = result.reset_index(drop=True)
        id_cols = [c for c in result.columns if "account" in c.lower() or "customer" in c.lower() or "id" in c.lower()]
        num_cols = result.select_dtypes(include=[np.number]).columns.tolist()
        # Prefer the canonical 'feature' column; fall back to first non-id numeric column.
        # Do NOT use num_cols[0] blindly — Sender_Account is also numeric (int64).
        id_col_set = set(id_cols)
        feat_col = ('feature' if 'feature' in result.columns
                    else next((c for c in num_cols if c not in id_col_set), None))
        if not id_cols or feat_col is None:
            return {
                "channel_results": {},
                "channel_errors": {"ibm_aml": "Could not identify id/feature columns"},
                "best_channel": None,
                "best_iv": 0.0,
            }

        feat_df = result[[id_cols[0], feat_col]].rename(
            columns={id_cols[0]: "customer_id", feat_col: "feature_value"}
        )
        feat_df["customer_id"] = feat_df["customer_id"].astype(str)

        # Labels: aggregate Is Laundering to Sender_Account level
        labels = df.groupby("Sender_Account")["Is Laundering"].max().reset_index()
        labels.columns = ["customer_id", "label"]
        labels["customer_id"] = labels["customer_id"].astype(str)

        # Join with labels
        merged = labels.merge(feat_df, on="customer_id", how="left")
        merged["feature_value"] = merged["feature_value"].fillna(0)
        if merged.empty:
            return {
                "channel_results": {},
                "channel_errors": {"ibm_aml": "No data after merge"},
                "best_channel": None,
                "best_iv": 0.0,
            }

        pos = merged[merged["label"] == 1]["feature_value"].dropna()
        neg = merged[merged["label"] == 0]["feature_value"].dropna()
        if len(pos) == 0 or len(neg) == 0:
            return {
                "channel_results": {},
                "channel_errors": {"ibm_aml": "No positive or negative labels found"},
                "best_channel": None,
                "best_iv": 0.0,
            }

        # KS Test
        ks_stat, ks_pvalue = scipy_stats.ks_2samp(pos.values, neg.values)

        # Information Value
        iv, iv_bins = _compute_iv(merged, pos, neg)

        # IV interpretation
        if iv < 0.02:
            iv_interpretation = "Not predictive"
        elif iv < 0.1:
            iv_interpretation = "Weak"
        elif iv < 0.3:
            iv_interpretation = "Medium"
        elif iv < 0.5:
            iv_interpretation = "Strong"
        else:
            iv_interpretation = "Very strong (check for overfitting)"

        channel_result = {
            "feature_name": name,
            "channel": "ibm_aml",
            "n_customers": len(merged),
            "n_positive": int(len(pos)),
            "n_negative": int(len(neg)),
            "ks": round(float(ks_stat), 4),
            "ks_pvalue": round(float(ks_pvalue), 6),
            "iv": round(float(iv), 4),
            "iv_interpretation": iv_interpretation,
            "iv_bins": iv_bins,
            "stats": {
                "positive": {
                    "mean": round(float(pos.mean()), 4),
                    "median": round(float(pos.median()), 4),
                    "std": round(float(pos.std()), 4),
                    "count": int(len(pos)),
                },
                "negative": {
                    "mean": round(float(neg.mean()), 4),
                    "median": round(float(neg.median()), 4),
                    "std": round(float(neg.std()), 4),
                    "count": int(len(neg)),
                },
            },
        }

        return {
            "channel_results": {"ibm_aml": channel_result},
            "channel_errors": {},
            "best_channel": "ibm_aml",
            "best_iv": round(float(iv), 4),
        }
    except Exception as e:
        err_str = str(e)
        # Provide a targeted hint for the common rolling-window / set_index conflict
        if "invalid on specified" in err_str and "Timestamp" in err_str:
            err_str = (
                f"{err_str} — "
                "Hint: the generated code likely called df.set_index('Timestamp') and then "
                "rolling(on='Timestamp'). Use one pattern: either "
                "(A) df.set_index('Timestamp') → .rolling('Nd') with NO on=, or "
                "(B) keep Timestamp as a column → .rolling('Nd', on='Timestamp'). Never mix both."
            )
        return {
            "channel_results": {},
            "channel_errors": {"ibm_aml": f"Evaluation failed: {err_str}"},
            "best_channel": None,
            "best_iv": 0.0,
        }
