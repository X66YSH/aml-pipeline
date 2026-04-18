"""Detection runner service.

Runs ML models (supervised + unsupervised) on compiled features
and returns per-channel, per-model evaluation metrics.
"""

import gc
import traceback

import numpy as np
import pandas as pd
from sklearn.ensemble import (
    AdaBoostClassifier,
    GradientBoostingClassifier,
    IsolationForest,
    RandomForestClassifier,
)
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC, OneClassSVM

from config import CHANNEL_DATA_DIR, KYC_TABLES
from core.data_loader import load_channel_data

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MODEL_MAP = {
    "isolation_forest": ("Isolation Forest", "unsupervised"),
    "local_outlier_factor": ("Local Outlier Factor", "unsupervised"),
    "one_class_svm": ("One-Class SVM", "unsupervised"),
    "logistic_regression": ("Logistic Regression", "supervised"),
    "random_forest": ("Random Forest", "supervised"),
    "gradient_boosting": ("Gradient Boosting", "supervised"),
    "adaboost": ("AdaBoost", "supervised"),
    "svm": ("Support Vector Machine", "supervised"),
}

# Maximum training samples for slow models (SVM is O(n**2 ~ n**3))
SVM_SAMPLE_LIMIT = 5000


# ---------------------------------------------------------------------------
# _build_feature_matrix
# ---------------------------------------------------------------------------

def _build_feature_matrix(
    df: pd.DataFrame,
    accounts_df: pd.DataFrame | None,
    features: list[dict],
) -> tuple[pd.DataFrame | None, list[dict]]:
    """Build a feature matrix by executing each feature's ``compute_feature`` on *df*.

    Parameters
    ----------
    df : pd.DataFrame
        Channel transaction data.
    accounts_df : pd.DataFrame | None
        Optional accounts/KYC data.
    features : list[dict]
        Each dict must have ``name`` (str) and ``code`` (str).

    Returns
    -------
    (feature_matrix, feature_errors)
        *feature_matrix* is a DataFrame with ``customer_id`` + one column per
        successfully computed feature, or ``None`` if nothing succeeded.
        *feature_errors* is a list of ``{name, error[, trace]}`` dicts.
    """
    feature_matrix = None
    feature_errors: list[dict] = []

    for spec in features:
        try:
            local_ns: dict = {}
            exec(spec["code"], {"pd": pd, "np": np}, local_ns)
            fn = local_ns.get("compute_feature")
            if fn is None:
                feature_errors.append({"name": spec["name"], "error": "No compute_feature function found"})
                continue
            result = fn(df.copy(), accounts_df.copy() if accounts_df is not None else None)
            if result is None or not isinstance(result, pd.DataFrame):
                feature_errors.append({"name": spec["name"], "error": "Function did not return a DataFrame"})
                continue
            result = result.reset_index()
            # Identify ID column: look for customer, account, or id in column name
            id_cols = [c for c in result.columns
                       if "customer" in c.lower() or "account" in c.lower() or c.lower() in ("id",)]
            # Exclude known label/non-ID columns that might match
            id_cols = [c for c in id_cols if c not in ("Is Laundering", "Is_Laundering", "label")]
            # Numeric feature columns: exclude ID cols and label cols
            exclude_cols = set(id_cols) | {"Is Laundering", "Is_Laundering", "label", "index"}
            num_cols = [c for c in result.select_dtypes(include=[np.number]).columns
                        if c not in exclude_cols]
            if not id_cols or not num_cols:
                feature_errors.append({"name": spec["name"], "error": "Could not identify id/feature columns"})
                continue
            id_col = id_cols[0]
            feat_col = num_cols[0]
            feat_df = result[[id_col, feat_col]].rename(
                columns={id_col: "customer_id", feat_col: spec["name"]}
            )
            feat_df["customer_id"] = feat_df["customer_id"].astype(str)
            if feature_matrix is None:
                feature_matrix = feat_df
            else:
                feature_matrix = feature_matrix.merge(feat_df, on="customer_id", how="outer")
        except Exception as e:
            feature_errors.append({
                "name": spec["name"],
                "error": str(e),
                "trace": traceback.format_exc()[-300:],
            })

    return feature_matrix, feature_errors


# ---------------------------------------------------------------------------
# _run_models
# ---------------------------------------------------------------------------

def _run_models(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    n_pos: int,
    model_keys: list[str],
    customer_ids_test: np.ndarray | None = None,
    threshold_pct: float = 95.0,
    feature_names: list[str] | None = None,
) -> list[dict]:
    """Train each requested model on the train set and evaluate on the test set.

    Returns a list of per-model result dicts (metrics, flagged customers,
    confusion matrix, ROC curve, feature importances).
    """
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # Pre-compute subsampled training set for slow models
    slow_models = {"one_class_svm", "svm"}
    if len(X_train_scaled) > SVM_SAMPLE_LIMIT:
        rng = np.random.RandomState(42)
        idx = rng.choice(len(X_train_scaled), SVM_SAMPLE_LIMIT, replace=False)
        X_train_slow = X_train_scaled[idx]
        y_train_slow = y_train[idx]
    else:
        X_train_slow = X_train_scaled
        y_train_slow = y_train

    n_total_test = len(y_test)
    n_pos_test = int(y_test.sum())
    contamination = max(0.01, n_pos / max(len(y_train), 1))

    results: list[dict] = []
    for model_key in model_keys:
        if model_key not in MODEL_MAP:
            continue
        model_name, mode = MODEL_MAP[model_key]
        try:
            # --- Train ---
            if model_key == "isolation_forest":
                clf = IsolationForest(contamination=contamination, random_state=42, n_estimators=100)
                clf.fit(X_train_scaled)
                scores = -clf.score_samples(X_test_scaled)
            elif model_key == "local_outlier_factor":
                clf = LocalOutlierFactor(contamination=contamination, novelty=True, n_neighbors=20)
                clf.fit(X_train_scaled)
                scores = -clf.decision_function(X_test_scaled)
            elif model_key == "one_class_svm":
                clf = OneClassSVM(kernel="rbf", gamma="auto", nu=max(0.01, min(0.5, contamination)))
                clf.fit(X_train_slow)
                scores = -clf.decision_function(X_test_scaled)
            elif model_key == "logistic_regression":
                clf = LogisticRegression(class_weight="balanced", max_iter=1000, random_state=42)
                clf.fit(X_train_scaled, y_train)
                scores = clf.predict_proba(X_test_scaled)[:, 1]
            elif model_key == "random_forest":
                clf = RandomForestClassifier(n_estimators=100, class_weight="balanced", random_state=42)
                clf.fit(X_train_scaled, y_train)
                scores = clf.predict_proba(X_test_scaled)[:, 1]
            elif model_key == "gradient_boosting":
                clf = GradientBoostingClassifier(n_estimators=100, random_state=42)
                clf.fit(X_train_scaled, y_train)
                scores = clf.predict_proba(X_test_scaled)[:, 1]
            elif model_key == "adaboost":
                clf = AdaBoostClassifier(n_estimators=100, random_state=42)
                clf.fit(X_train_scaled, y_train)
                scores = clf.predict_proba(X_test_scaled)[:, 1]
            elif model_key == "svm":
                clf = SVC(kernel="rbf", class_weight="balanced", probability=True, random_state=42)
                clf.fit(X_train_slow, y_train_slow)
                scores = clf.predict_proba(X_test_scaled)[:, 1]
            else:
                continue

            # --- Evaluate on test set ---
            auc = round(float(roc_auc_score(y_test, scores)), 4)
            k = min(max(n_pos_test * 2, 5), n_total_test)
            top_k_idx = np.argsort(scores)[::-1][:k]
            precision_at_k = round(float(y_test[top_k_idx].sum() / k), 4) if k > 0 else 0.0
            recall_at_k = round(float(y_test[top_k_idx].sum() / n_pos_test), 4) if n_pos_test > 0 else 0.0

            # Flag top N accounts by score (fixed count, not percentile)
            # threshold_pct is reinterpreted: values > 90 → use as percentile, values <= 90 → use as fixed count
            if threshold_pct <= 500:
                # Fixed count mode (e.g. top 100)
                top_n = min(int(threshold_pct), len(scores))
            else:
                # Percentile mode (legacy)
                top_n = max(1, int(len(scores) * (100 - threshold_pct) / 100))
            y_pred = np.zeros(len(scores), dtype=int)
            top_idx = np.argsort(scores)[::-1][:top_n]
            y_pred[top_idx] = 1
            thresh = float(scores[top_idx[-1]]) if len(top_idx) > 0 else 0.0
            tp_m = int(((y_pred == 1) & (y_test == 1)).sum())
            fp_m = int(((y_pred == 1) & (y_test == 0)).sum())
            fn_m = int(((y_pred == 0) & (y_test == 1)).sum())
            tn_m = int(((y_pred == 0) & (y_test == 0)).sum())
            accuracy = round((tp_m + tn_m) / n_total_test, 4) if n_total_test > 0 else 0.0
            f1 = round(2 * tp_m / (2 * tp_m + fp_m + fn_m), 4) if (2 * tp_m + fp_m + fn_m) > 0 else 0.0
            flagged = int(y_pred.sum())

            thresholds = np.percentile(scores, np.linspace(0, 100, 20))
            roc_points: list[dict] = []
            for t in thresholds:
                preds = (scores >= t).astype(int)
                tp = int(((preds == 1) & (y_test == 1)).sum())
                fp = int(((preds == 1) & (y_test == 0)).sum())
                fn_count = int(((preds == 0) & (y_test == 1)).sum())
                tn = int(((preds == 0) & (y_test == 0)).sum())
                fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
                tpr = tp / (tp + fn_count) if (tp + fn_count) > 0 else 0.0
                roc_points.append({"fpr": round(fpr, 4), "tpr": round(tpr, 4)})

            # Collect per-customer flagged list (test set only)
            flagged_customers: list[dict] = []
            if customer_ids_test is not None:
                flagged_idx = np.where(y_pred == 1)[0]
                for fi in flagged_idx:
                    fv: dict = {}
                    if feature_names:
                        for j, fn in enumerate(feature_names):
                            fv[fn] = round(float(X_test[fi][j]), 4)
                    flagged_customers.append({
                        "customer_id": str(customer_ids_test[fi]),
                        "anomaly_score": round(float(scores[fi]), 6),
                        "feature_values": fv,
                    })
                flagged_customers.sort(key=lambda x: x["anomaly_score"], reverse=True)

            # Feature importances (if available)
            feature_importances = None
            if hasattr(clf, "feature_importances_"):
                feature_importances = [round(float(v), 4) for v in clf.feature_importances_]
            elif hasattr(clf, "coef_"):
                feature_importances = [round(float(abs(v)), 4) for v in clf.coef_[0]]

            results.append({
                "key": model_key,
                "name": model_name,
                "mode": mode,
                "auc_roc": auc,
                "precision_at_k": precision_at_k,
                "recall_at_k": recall_at_k,
                "k": k,
                "f1_score": f1,
                "accuracy": accuracy,
                "flagged_accounts": flagged,
                "flagged_customers": flagged_customers,
                "feature_importances": feature_importances,
                "threshold": round(thresh, 6),
                "threshold_percentile": threshold_pct,
                "confusion_matrix": {"tp": tp_m, "fp": fp_m, "fn": fn_m, "tn": tn_m},
                "roc_curve": roc_points,
            })
        except Exception as e:
            results.append({
                "key": model_key,
                "name": model_name,
                "mode": mode,
                "error": str(e),
            })

    return results


# ---------------------------------------------------------------------------
# run_detection  (main orchestration)
# ---------------------------------------------------------------------------

def run_detection(
    features: list[dict],
    feature_ids: list[str],
    channels: list[str],
    models: list[str],
    test_size: float = 0.3,
    threshold_pct: float = 95.0,
    random_state: int = 42,
    feature_compatible_channels: dict[str, set[str]] | None = None,
    db=None,
    schema_key: str = "fintrac",
) -> dict:
    """Run the detection pipeline across channels and models.

    Parameters
    ----------
    features : list[dict]
        Each dict must have ``name`` (str) and ``code`` (str).
    feature_ids : list[str]
        Database IDs corresponding to *features* (used for DB lookups only).
    channels : list[str]
        Channel keys to run detection on.
    models : list[str]
        Model keys (must exist in ``MODEL_MAP``).
    test_size : float
        Fraction held out for testing (0.1 -- 0.5).
    threshold_pct : float
        Percentile threshold for flagging (80 -- 99).
    random_state : int
        Seed for reproducibility.
    feature_compatible_channels : dict[str, set[str]] | None
        Mapping from feature name to the set of channels it supports.
        If ``None``, all features are assumed compatible with all channels.
    db
        Optional SQLAlchemy session (unused in computation, reserved for
        future use).

    Returns
    -------
    dict
        ``{"success": True, "channels": {...}, "feature_errors": [...]}``
    """
    # ── IBM AML branch: single dataset, no channel loop ──────────────────
    if schema_key == "ibm_aml":
        return _run_detection_ibm_aml(
            features=features,
            feature_ids=feature_ids,
            models=models,
            test_size=test_size,
            threshold_pct=threshold_pct,
            random_state=random_state,
            db=db,
        )

    labels_path = CHANNEL_DATA_DIR / KYC_TABLES["labels"]["file"]
    if not labels_path.exists():
        return {"success": False, "error": "Labels file not found", "channels": {}, "feature_errors": []}

    labels_df = pd.read_csv(labels_path)
    labels_df["customer_id"] = labels_df["customer_id"].astype(str)

    if feature_compatible_channels is None:
        feature_compatible_channels = {}

    all_feature_errors: list[dict] = []
    channel_results: dict = {}

    def _split_and_run(merged, feat_cols, model_keys):
        """Split data, train, evaluate. Returns channel result dict."""
        X = merged[feat_cols].fillna(0).values
        y = merged["label"].values
        cids = merged["customer_id"].values
        n_pos = int(y.sum())
        n_total = len(y)

        if n_pos == 0:
            return {"error": "No positive labels", "n_accounts": n_total, "models": []}
        if n_pos < 2:
            return {"error": "Need at least 2 positive samples for stratified split", "n_accounts": n_total, "models": []}

        X_train, X_test, y_train, y_test, cids_train, cids_test = train_test_split(
            X, y, cids,
            test_size=test_size,
            random_state=random_state,
            stratify=y,
        )

        model_results = _run_models(
            X_train, y_train, X_test, y_test,
            n_pos, model_keys,
            customer_ids_test=cids_test,
            threshold_pct=threshold_pct,
            feature_names=feat_cols,
        )
        return {
            "n_accounts": n_total,
            "n_positive": n_pos,
            "n_features": len(feat_cols),
            "n_train": len(y_train),
            "n_test": len(y_test),
            "n_pos_train": int(y_train.sum()),
            "n_pos_test": int(y_test.sum()),
            "test_size": test_size,
            "threshold_percentile": threshold_pct,
            "feature_names": feat_cols,
            "models": model_results,
        }

    # --- Per-channel runs ---
    for ch in channels:
        try:
            df_ch, accounts_df_ch = load_channel_data([ch], nrows=50_000)
            available_cols = set(df_ch.columns)
            if accounts_df_ch is not None:
                available_cols |= set(accounts_df_ch.columns)
            available_cols.add("channel")

            # ALL selected features must be compatible with this channel
            incompatible_features = []
            for spec in features:
                allowed_chs = feature_compatible_channels.get(spec["name"])
                if allowed_chs is not None and ch not in allowed_chs:
                    incompatible_features.append(spec["name"])

            if incompatible_features:
                channel_results[ch] = {
                    "error": f"Channel skipped: features {incompatible_features} not compatible",
                    "skipped": True,
                    "models": [],
                }
                continue

            fm, fe = _build_feature_matrix(df_ch, accounts_df_ch, features)
            all_feature_errors.extend(fe)
            if fm is None or fm.empty:
                channel_results[ch] = {"error": "No features produced data", "models": []}
                continue

            # Use channel customers as base -- only customers with actual transactions
            merged = fm.merge(labels_df, on="customer_id", how="left")
            merged["label"] = merged["label"].fillna(0).astype(int)
            feat_cols = [c for c in merged.columns if c not in ("customer_id", "label")]
            if not feat_cols:
                channel_results[ch] = {"error": "No feature columns", "models": []}
                continue
            merged[feat_cols] = merged[feat_cols].fillna(0)
            channel_results[ch] = _split_and_run(merged, feat_cols, models)
        except Exception as e:
            channel_results[ch] = {"error": str(e), "models": []}
        finally:
            df_ch = accounts_df_ch = fm = merged = None
            gc.collect()

    # Deduplicate feature errors
    seen_errors: set[tuple[str, str]] = set()
    unique_errors: list[dict] = []
    for fe in all_feature_errors:
        key = (fe["name"], fe["error"])
        if key not in seen_errors:
            seen_errors.add(key)
            unique_errors.append(fe)

    return {
        "success": True,
        "channels": channel_results,
        "feature_errors": unique_errors,
    }


# ---------------------------------------------------------------------------
# IBM AML detection (single dataset, no channel loop)
# ---------------------------------------------------------------------------

def _run_detection_ibm_aml(
    features: list[dict],
    feature_ids: list[str],
    models: list[str],
    test_size: float = 0.3,
    threshold_pct: float = 95.0,
    random_state: int = 42,
    db=None,
) -> dict:
    """Run detection on IBM AML dataset — single 'ibm_aml' channel."""
    from config import IBM_AML_TRANS_PATH

    try:
        df = pd.read_csv(IBM_AML_TRANS_PATH, nrows=50_000)
    except Exception as e:
        return {"success": False, "error": f"Failed to load IBM AML data: {e}", "channels": {}, "feature_errors": []}

    # Build feature matrix (no accounts_df needed — merged table)
    fm, feature_errors = _build_feature_matrix(df, None, features)
    if fm is None or fm.empty:
        return {
            "success": False,
            "error": "No features produced data",
            "channels": {"ibm_aml": {"error": "No features produced data", "models": []}},
            "feature_errors": feature_errors,
        }

    # Labels: aggregate Is Laundering to Sender_Account level
    labels = df.groupby("Sender_Account")["Is Laundering"].max().reset_index()
    labels.columns = ["customer_id", "label"]
    labels["customer_id"] = labels["customer_id"].astype(str)

    # Merge features with labels
    merged = fm.merge(labels, on="customer_id", how="left")
    merged["label"] = merged["label"].fillna(0).astype(int)
    feat_cols = [c for c in merged.columns if c not in ("customer_id", "label")]
    if not feat_cols:
        return {
            "success": False,
            "error": "No feature columns",
            "channels": {"ibm_aml": {"error": "No feature columns", "models": []}},
            "feature_errors": feature_errors,
        }
    merged[feat_cols] = merged[feat_cols].fillna(0)

    # Split and run models
    X = merged[feat_cols].fillna(0).values
    y = merged["label"].values
    cids = merged["customer_id"].values
    n_pos = int(y.sum())
    n_total = len(y)

    if n_pos == 0:
        channel_result = {"error": "No positive labels", "n_accounts": n_total, "models": []}
    elif n_pos < 2:
        channel_result = {"error": "Need at least 2 positive samples for stratified split", "n_accounts": n_total, "models": []}
    else:
        X_train, X_test, y_train, y_test, cids_train, cids_test = train_test_split(
            X, y, cids,
            test_size=test_size,
            random_state=random_state,
            stratify=y,
        )

        model_results = _run_models(
            X_train, y_train, X_test, y_test,
            n_pos, models,
            customer_ids_test=cids_test,
            threshold_pct=threshold_pct,
            feature_names=feat_cols,
        )
        channel_result = {
            "n_accounts": n_total,
            "n_positive": n_pos,
            "n_features": len(feat_cols),
            "n_train": len(y_train),
            "n_test": len(y_test),
            "n_pos_train": int(y_train.sum()),
            "n_pos_test": int(y_test.sum()),
            "test_size": test_size,
            "threshold_percentile": threshold_pct,
            "feature_names": feat_cols,
            "models": model_results,
        }

    return {
        "success": True,
        "channels": {"ibm_aml": channel_result},
        "feature_errors": feature_errors,
    }
