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
) -> dict | None:
    """Evaluate a feature on a single channel. Returns stats dict or error dict."""
    try:
        df, accounts_df = load_channel_data([channel_key], nrows=None)
    except Exception as e:
        return {"error": f"Failed to load {channel_key}: {e}", "channel": channel_key}

    try:
        local_ns = {}
        exec(code, {"pd": pd, "np": np}, local_ns)
        fn = local_ns.get("compute_feature")
        if fn is None:
            return None

        result = fn(df.copy(), accounts_df.copy() if accounts_df is not None else None)
        if result is None or not isinstance(result, pd.DataFrame):
            return None

        result = result.reset_index()
        id_cols = [c for c in result.columns if "customer" in c.lower() or "id" in c.lower()]
        num_cols = result.select_dtypes(include=[np.number]).columns.tolist()
        if not id_cols or not num_cols:
            return None

        feat_df = result[[id_cols[0], num_cols[0]]].rename(
            columns={id_cols[0]: "customer_id", num_cols[0]: "feature_value"}
        )
        feat_df["customer_id"] = feat_df["customer_id"].astype(str)

        # Join with labels
        merged = labels_df.merge(feat_df, on="customer_id", how="left")
        merged["feature_value"] = merged["feature_value"].fillna(0)
        if merged.empty:
            return None

        pos = merged[merged["label"] == 1]["feature_value"].dropna()
        neg = merged[merged["label"] == 0]["feature_value"].dropna()
        if len(pos) == 0 or len(neg) == 0:
            return None

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
        result = _evaluate_single_channel(code, name, ch, labels_df)
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
    """Evaluate a feature on IBM AML dataset (single-channel evaluation)."""
    from config import IBM_AML_TRANS_PATH

    try:
        df = pd.read_csv(IBM_AML_TRANS_PATH, nrows=1_000_000)
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

        result = fn(df.copy(), None)
        if result is None or not isinstance(result, pd.DataFrame):
            return {
                "channel_results": {},
                "channel_errors": {"ibm_aml": "Function did not return a DataFrame"},
                "best_channel": None,
                "best_iv": 0.0,
            }

        result = result.reset_index()
        id_cols = [c for c in result.columns if "account" in c.lower() or "customer" in c.lower() or "id" in c.lower()]
        num_cols = result.select_dtypes(include=[np.number]).columns.tolist()
        if not id_cols or not num_cols:
            return {
                "channel_results": {},
                "channel_errors": {"ibm_aml": "Could not identify id/feature columns"},
                "best_channel": None,
                "best_iv": 0.0,
            }

        feat_df = result[[id_cols[0], num_cols[0]]].rename(
            columns={id_cols[0]: "customer_id", num_cols[0]: "feature_value"}
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
        return {
            "channel_results": {},
            "channel_errors": {"ibm_aml": f"Evaluation failed: {e}"},
            "best_channel": None,
            "best_iv": 0.0,
        }
