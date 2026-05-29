"""Pipeline Orchestrator — end-to-end multi-agent AML pipeline.

Coordinates 6 pipeline agents plus an optional Dashboard Builder across phases:
  Phase 1 (Feature Studio): Regulatory Analyst → Schema Adapter → Feature Engineer → Validator
  Phase 2 (Feature Validation): Statistical Evaluator (feedback loop to Phase 1 if IV too low)
  Phase 3 (Detection Lab): Detection Strategist
  Phase 4 (Alerts): RCC Verifier (Alert Analyst)
  Phase 5 (Dashboard): Dashboard Builder — caches run artifacts and plans a visualization layout

Yields SSE events for real-time visualization of the pipeline.
"""

import asyncio
import json
import re
from typing import AsyncGenerator

from sqlalchemy.orm import Session

from config import DEFAULT_LLM, LLM_TEMPERATURE, MAX_CORRECTION_ITERATIONS
from models.feature import Alert, DetectionRun, Feature, FeatureContext


# ── Feature naming ────────────────────────────────────────────────────────────

_KNOWN_CATEGORIES = {
    "structuring", "velocity", "geographic", "behavioral",
    "threshold", "temporal", "network",
}


def _derive_feature_name(indicator: dict, computation_plan: dict) -> str:
    """Generate a descriptive snake_case feature name from structured pipeline data.

    Format:  {category_slug}_{operation}_{window}
    Examples:
      velocity_count_30d   (count-based velocity check over 30 days)
      structuring_sum_7d   (amount sum structuring check over 7 days)
      behavioral_std_90d   (std-dev behaviour deviation over 90 days)
      geographic_entropy_hist  (geographic entropy over full history)

    Mirrors the benchmark naming convention (total_amount, txn_count, amount_std)
    — names describe *what is computed*, not the abstract AML risk concept.
    """
    # ── Category slug ─────────────────────────────────────────────────────────
    cat_raw = (indicator.get("category") or "unknown").strip().lower()
    # Prefer a known ontology category when one appears in the string
    cat_slug = next((k for k in _KNOWN_CATEGORIES if k in cat_raw), None)
    if not cat_slug:
        # Fallback: sanitize raw string (e.g. "money laundering" → "money_laundering")
        cat_slug = re.sub(r"[^a-z0-9]+", "_", cat_raw).strip("_")[:20]

    # ── Operation ─────────────────────────────────────────────────────────────
    op = re.sub(
        r"[^a-z0-9]+", "_",
        (computation_plan.get("operation") or "agg").strip().lower(),
    ).strip("_")

    # ── Time-window → compact suffix ──────────────────────────────────────────
    # "30 days" / "30d" → "30d";  "full_history" / "full history" → "hist"
    w_raw = (computation_plan.get("time_window") or "").strip().lower()
    w = re.sub(r"\s*(days?)\b", "d", w_raw)   # "30 days" → "30d"
    w = re.sub(r"[^a-z0-9]", "", w)           # drop punctuation / spaces
    if "full" in w or "hist" in w:
        w = "hist"

    parts = [p for p in [cat_slug, op, w] if p]
    return "_".join(parts) if parts else "compiled_feature"


async def run_pipeline(
    regulatory_text: str,
    project_id: str,
    channels: list[str] | None = None,
    model: str = DEFAULT_LLM,
    temperature: float = LLM_TEMPERATURE,
    max_corrections: int = MAX_CORRECTION_ITERATIONS,
    max_feature_retries: int = 4,
    multi_feature: bool = False,
    test_size: float = 0.3,
    threshold_pct: float = 100,  # Fixed top-100 accounts
    db: Session | None = None,
    schema_key: str = "fintrac",
) -> AsyncGenerator[dict, None]:
    """Run the full multi-agent pipeline. Yields SSE events."""

    # ── Cleanup: delete ALL old runs + alerts + compiled features ──
    if db:
        # Nuclear cleanup: delete ALL DetectionRuns and their Alerts (any project)
        # This is safe because pipeline always regenerates them
        all_runs = db.query(DetectionRun).all()
        for run in all_runs:
            db.query(Alert).filter(Alert.run_id == run.id).delete()
            db.delete(run)

        # Delete compiled features for this project (keep benchmarks)
        old_compiled = db.query(Feature).filter(
            Feature.project_id == project_id,
            Feature.source == "compiled",
        ).all()
        for f in old_compiled:
            db.delete(f)

        db.flush()

    # ════════════════════════════════════════════════════════════════════════
    # PHASE 1: Feature Studio (Agents 1-4: Analyst → Adapter → Engineer → Validator)
    # ════════════════════════════════════════════════════════════════════════
    yield _phase_event("analyst", "starting", "Regulatory Analyst reading regulatory text...")

    import uuid as _uuid
    from services.s2f_service import (
        compile_feature,
        extract_feature_candidates,
        register_pipeline,
        cleanup_pipeline,
    )

    pipeline_id = str(_uuid.uuid4())
    register_pipeline(pipeline_id)

    # Build schema info (same as /compile endpoint)
    from config import CHANNELS, CHANNEL_COMMON_COLUMNS, KYC_TABLES, CHANNEL_DATA_DIR
    from core.data_loader import load_channel_data

    if schema_key == "ibm_aml":
        from config import IBM_AML_TRANS_PATH, PRELOADED_SCHEMAS

        ibm_schema = PRELOADED_SCHEMAS["ibm_aml"]
        trans_cols = ibm_schema["tables"]["transactions"]["columns"]

        # Load sample rows
        sample_rows = []
        try:
            import pandas as pd
            df_sample = pd.read_csv(IBM_AML_TRANS_PATH, nrows=5)
            sample_rows = df_sample.to_dict("records")
        except Exception:
            pass

        schema_info = {
            "table_name": "transactions",
            "columns": trans_cols,
            "row_count": ibm_schema["tables"]["transactions"]["row_count"],
            "selected_channels": ["ibm_aml"],  # Single "channel" for IBM AML
            "sample_rows": sample_rows,
            "accounts_columns": [],
            "accounts_sample": [],
        }
        target_channels = ["ibm_aml"]
        all_columns = trans_cols
    else:
        # existing FINTRAC logic
        target_channels = channels or list(CHANNELS.keys())
        all_columns = list(CHANNEL_COMMON_COLUMNS)
        for ch_key in target_channels:
            ch_def = CHANNELS.get(ch_key)
            if ch_def:
                for col in ch_def["extra_columns"]:
                    if col not in all_columns:
                        all_columns.append(col)
        all_columns.append("channel")

        # Load samples
        sample_rows = []
        total_rows = 0
        for ch_key in target_channels:
            ch_def = CHANNELS.get(ch_key)
            if not ch_def:
                continue
            total_rows += ch_def["row_count"]
            try:
                df_sample = load_channel_data(ch_key, nrows=3)
                df_sample["channel"] = ch_key
                sample_rows.extend(df_sample.head(3).to_dict("records"))
            except Exception:
                pass

        # KYC columns
        acct_cols = KYC_TABLES.get("kyc_individual", {}).get("columns", [])

        schema_info = {
            "table_name": "transactions",
            "columns": all_columns,
            "row_count": total_rows,
            "selected_channels": target_channels,
            "sample_rows": sample_rows[:9],
            "accounts_columns": acct_cols,
            "accounts_sample": [],
        }

    compile_result = None
    feature_code = None
    indicator = None
    parameters = None
    computation_plan = None
    channel_adaptations = None
    compatible_channels = []
    channel_results: dict = {}  # Init before loop to prevent UnboundLocalError
    max_iv: float = 0.0          # Init here so benchmark-fallback break doesn't leave it unbound
    best_eval_channel: str | None = None
    feature = None
    compiled_features: list[dict] = []
    all_compiled_for_dashboard: list[dict] = []  # full snapshot (pass+filtered) for dashboard
    best_compiled_feature: dict | None = None
    best_compiled_iv: float = 0.0
    best_compiled_channel: str | None = None
    tried_rethinks: set[str] = set()  # Track which rethink options have been used
    last_decision: str | None = None  # Track which agent to loop back to
    perceive_pra: dict = {}
    adapt_pra: dict = {}
    perceive_raw: str = ""
    feedback_ctx: str | None = None  # Feedback for LLM without bloating regulatory_text

    skip_single_feature = False
    if multi_feature:
        yield _phase_event("analyst", "active", "Discovering multiple feature candidates...")
        from services.stats_evaluator import evaluate_feature

        # Multi-feature extraction always uses DEFAULT_LLM — small models (8b) cannot
        # reliably produce the structured JSON with 3 full candidate objects.
        # PERCEIVE / REASON phases (single-feature) can run on the lighter model fine.
        try:
            candidates = await extract_feature_candidates(
                regulatory_text=regulatory_text,
                schema_info=schema_info,
                model=DEFAULT_LLM,
                temperature=temperature,
                schema_key=schema_key,
            )
        except Exception as e:
            yield _phase_event("analyst", "error", f"Feature discovery failed: {str(e)[:180]}")
            candidates = []

        if candidates:
            yield _phase_event("analyst", "done", f"Discovered {len(candidates)} feature candidate(s)")
        else:
            yield {
                "event": "fallback_notice",
                "data": {
                    "message": f"Multi-feature extraction failed — {DEFAULT_LLM} may have hit its rate limit. Running in single-feature mode instead."
                },
            }
            yield _phase_event("analyst", "error",
                f"No feature candidates discovered (multi-feature requires {DEFAULT_LLM} — check rate limits). "
                "Falling back to single-feature generation.")
            multi_feature = False

        if multi_feature and candidates:
            for idx, candidate in enumerate(candidates, start=1):
                # Prefer the LLM-provided name if it is already valid snake_case,
                # otherwise derive a structured name from computation metadata.
                _llm_name = candidate.get("name", "").strip()
                if _llm_name and re.match(r'^[a-z][a-z0-9_]*$', _llm_name) and "_" in _llm_name:
                    feature_name = _llm_name
                else:
                    feature_name = _derive_feature_name(
                        candidate.get("indicator", {}),
                        candidate.get("computation_plan", {}),
                    ) or f"candidate_{idx}"
                feature_desc = candidate.get("description", "")
                yield _phase_event("analyst", "starting", f"Compiling candidate {idx}/{len(candidates)}: {feature_name}")

                cached_perceive = {
                    "indicator": candidate.get("indicator", {}),
                    "parameters": candidate.get("parameters", []),
                    "computation_plan": candidate.get("computation_plan", {}),
                    "perceive_pra": {
                        "perceive": candidate.get("perceive", ""),
                        "reason": candidate.get("reason", ""),
                    },
                }

                candidate_compile_result = None
                async for event in compile_feature(
                    regulatory_text, schema_info, schema_key,
                    model=model, temperature=temperature, max_corrections=max_corrections,
                    pipeline_id=pipeline_id,
                    cached_perceive=cached_perceive,
                    feedback_context=feedback_ctx,
                ):
                    # Emit phase_change events so the tab bar tracks multi-feature
                    # compilation progress (mirrors the single-feature while-loop).
                    evt_type = event.get("event", "")
                    if evt_type == "perceive":
                        yield _phase_event("analyst", "done",
                            f"Analyst done — candidate {idx}/{len(candidates)}")
                        yield _phase_event("adapter", "starting",
                            f"Schema Adapter (candidate {idx}/{len(candidates)})…")
                    elif evt_type == "schema_adapt":
                        yield _phase_event("adapter", "done",
                            f"Adapter done — candidate {idx}")
                        yield _phase_event("engineer", "starting",
                            f"Feature Engineer generating code (candidate {idx}/{len(candidates)})…")
                    elif evt_type == "code":
                        if event.get("data", {}).get("iteration", 0) == 0:
                            yield _phase_event("engineer", "done",
                                f"Engineer done — candidate {idx}")
                            yield _phase_event("validator", "starting",
                                f"Validator (candidate {idx}/{len(candidates)})…")
                    elif evt_type == "validation":
                        if event.get("data", {}).get("passed", False):
                            yield _phase_event("validator", "done",
                                f"Candidate {idx} validated ✓")

                    yield event
                    if event.get("event") == "complete":
                        candidate_compile_result = event.get("data")

                if not candidate_compile_result:
                    yield _phase_event("validator", "error", f"Candidate '{feature_name}' compilation failed.")
                    continue

                if not candidate_compile_result.get("validation_passed"):
                    yield _phase_event("validator", "error", f"Candidate '{feature_name}' failed validation and was skipped.")
                    continue

                # Save compiled candidate feature and evaluate its statistical power
                if db:
                    existing_count = db.query(Feature).filter(
                        Feature.project_id == project_id,
                        Feature.name == feature_name,
                    ).count()
                    if existing_count > 0:
                        feature_name = f"{feature_name}_{existing_count + 1}"

                    feature = Feature(
                        name=feature_name,
                        code=candidate_compile_result.get("code", ""),
                        project_id=project_id,
                        description=feature_desc or candidate_compile_result.get("indicator", {}).get("description", ""),
                        category=candidate_compile_result.get("indicator", {}).get("category", "unknown"),
                        status="validated" if candidate_compile_result.get("validation_passed") else "failed",
                        source_text=regulatory_text[:5000],
                    )
                    feature.channels = candidate_compile_result.get("compatible_channels", [])
                    feature.required_columns = candidate_compile_result.get("required_columns", [])
                    db.add(feature)
                    db.flush()

                    ctx = FeatureContext(
                        feature_id=feature.id,
                        indicator_json=json.dumps(candidate_compile_result.get("indicator", {})) if candidate_compile_result.get("indicator") else None,
                        parameters_json=json.dumps(candidate_compile_result.get("parameters", [])) if candidate_compile_result.get("parameters") else None,
                        computation_plan_json=json.dumps(candidate_compile_result.get("computation_plan", {})) if candidate_compile_result.get("computation_plan") else None,
                        schema_adaptation_json=json.dumps(candidate_compile_result.get("channel_adaptations", {})) if candidate_compile_result.get("channel_adaptations") else None,
                        provenance_json=json.dumps({
                            "source_text_length": len(regulatory_text),
                            "source_text_preview": regulatory_text[:500],
                            "candidate_description": feature_desc,
                            "candidate_name": feature_name,
                        }),
                    )
                    db.add(ctx)
                    db.commit()
                else:
                    feature = None

                eval_channels = candidate_compile_result.get("compatible_channels") or target_channels
                try:
                    eval_result = await evaluate_feature(
                        candidate_compile_result.get("code", ""),
                        feature_name,
                        eval_channels,
                        schema_key=schema_key,
                    )
                except Exception as e:
                    eval_result = {"channel_results": {}, "channel_errors": {"error": str(e)}}
                finally:
                    # Release evaluation data immediately to avoid OOM across candidates
                    import gc as _gc
                    _gc.collect()

                yield {
                    "event": "feature_eval",
                    "data": {
                        "candidate_index": idx,
                        "feature_name": feature_name,
                        "eval_result": eval_result,
                    },
                }

                best_channel = eval_result.get("best_channel")
                best_iv = eval_result.get("best_iv", 0.0)
                # KS for this candidate's best channel
                cand_best_ks = 0.0
                if best_channel and isinstance(
                    eval_result.get("channel_results", {}).get(best_channel), dict
                ):
                    cand_best_ks = eval_result["channel_results"][best_channel].get("ks", 0.0)

                if best_iv >= best_compiled_iv:
                    best_compiled_iv = best_iv
                    best_compiled_feature = {
                        "name": feature_name,
                        "code": candidate_compile_result.get("code", ""),
                        "indicator": candidate_compile_result.get("indicator", {}),
                        "parameters": candidate_compile_result.get("parameters", []),
                        "computation_plan": candidate_compile_result.get("computation_plan", {}),
                        "compatible_channels": candidate_compile_result.get("compatible_channels", []),
                        "feature_obj": feature,
                    }
                    best_compiled_channel = best_channel

                for ch, ch_data in (eval_result.get("channel_results", {}) or {}).items():
                    if not isinstance(ch_data, dict):
                        continue
                    prev = channel_results.get(ch, {})
                    if ch_data.get("iv", 0.0) > prev.get("iv", 0.0):
                        channel_results[ch] = ch_data

                compiled_features.append({
                    "name": feature_name,
                    "code": candidate_compile_result.get("code", ""),
                    "eval_result": eval_result,
                    "feature_obj": feature,
                    "indicator": candidate_compile_result.get("indicator", {}),
                    "parameters": candidate_compile_result.get("parameters", []),
                    "computation_plan": candidate_compile_result.get("computation_plan", {}),
                    "compatible_channels": candidate_compile_result.get("compatible_channels", []),
                    "best_iv": best_iv,
                    "best_ks": cand_best_ks,
                    "best_channel": best_channel,
                })

            if compiled_features:
                skip_single_feature = True
                IV_THRESHOLD = 0.02

                # ── Per-feature IV gate (Option A: silent filter) ─────────────────
                # Each compiled feature is individually checked. Those with IV ≥
                # IV_THRESHOLD proceed to detection; the rest are silently dropped.
                # This avoids zero-signal features polluting the detection feature
                # matrix without the cost of per-feature diagnostic LLM calls.
                # HITL is only triggered when *all* features fail the gate.
                passing_features = [f for f in compiled_features if f.get("best_iv", 0.0) >= IV_THRESHOLD]
                filtered_features = [f for f in compiled_features if f.get("best_iv", 0.0) < IV_THRESHOLD]

                # Snapshot all features with included status BEFORE compiled_features is overwritten
                all_compiled_for_dashboard = [
                    {
                        "name": f["name"],
                        "best_iv": f.get("best_iv", 0.0),
                        "best_ks": f.get("best_ks", 0.0),
                        "best_channel": f.get("best_channel"),
                        "included": f.get("best_iv", 0.0) >= IV_THRESHOLD,
                        "eval_result": f.get("eval_result", {}),
                    }
                    for f in compiled_features
                ]

                # Always emit the gate summary so the frontend can display per-feature results
                yield {
                    "event": "feature_gate_summary",
                    "data": {
                        "features": [
                            {
                                "name": f["name"],
                                "best_iv": round(f.get("best_iv", 0.0), 4),
                                "best_ks": round(f.get("best_ks", 0.0), 4),
                                "best_channel": f.get("best_channel"),
                                "included": f.get("best_iv", 0.0) >= IV_THRESHOLD,
                            }
                            for f in compiled_features
                        ],
                        "n_included": len(passing_features),
                        "n_filtered": len(filtered_features),
                        "iv_threshold": IV_THRESHOLD,
                    },
                }

                if passing_features:
                    # Use only passing features for detection; pick highest-IV as representative
                    best_passing = max(passing_features, key=lambda f: f.get("best_iv", 0.0))
                    feature_code = best_passing["code"]
                    feature_name = best_passing["name"]
                    indicator = best_passing["indicator"]
                    parameters = best_passing["parameters"]
                    computation_plan = best_passing["computation_plan"]
                    compatible_channels = best_passing["compatible_channels"]
                    feature = best_passing["feature_obj"]
                    compiled_features = passing_features  # only passing go to detection
                    # Sync dashboard vars to the winning feature so WoE bins and IV KPI are correct
                    channel_results = best_passing.get("eval_result", {}).get("channel_results", {})
                    max_iv = best_passing.get("best_iv", 0.0)
                    best_eval_channel = best_passing.get("best_channel")

                    if filtered_features:
                        yield _agent_message(
                            "Statistical Evaluator", "Detection Strategist",
                            f"{len(filtered_features)} feature(s) filtered (IV < {IV_THRESHOLD}): "
                            f"{', '.join(f['name'] for f in filtered_features)}. "
                            f"Using {len(passing_features)} feature(s) for detection: "
                            f"{', '.join(f['name'] for f in passing_features)}."
                        )
                    yield _phase_event(
                        "validation", "done",
                        f"{len(passing_features)}/{len(passing_features) + len(filtered_features)} "
                        f"compiled feature(s) passed IV gate (≥ {IV_THRESHOLD})"
                    )
                else:
                    # All features below threshold — HITL as last resort
                    _n_compiled = len(compiled_features)
                    _best_ch = best_compiled_channel
                    _dist_summary = "No distribution data available."
                    if _best_ch and isinstance(channel_results.get(_best_ch), dict):
                        _ch_stats = channel_results[_best_ch].get("stats", {})
                        if _ch_stats:
                            _pos = _ch_stats.get("positive", {})
                            _neg = _ch_stats.get("negative", {})
                            _dist_summary = (
                                f"Positive: mean={_pos.get('mean', 'N/A')}, "
                                f"n={_pos.get('count', _pos.get('n', 'N/A'))}. "
                                f"Negative: mean={_neg.get('mean', 'N/A')}, "
                                f"n={_neg.get('count', _neg.get('n', 'N/A'))}."
                            )
                    yield _phase_event(
                        "validation", "feedback",
                        f"All {_n_compiled} compiled feature(s) returned "
                        f"IV < {IV_THRESHOLD} — not predictive. Awaiting decision...",
                    )
                    yield _agent_message(
                        "Statistical Evaluator", "Detection Strategist",
                        f"{_n_compiled} candidate(s) evaluated; best IV={best_compiled_iv:.4f} "
                        f"(threshold: {IV_THRESHOLD}). Distribution: {_dist_summary}",
                    )
                    _best_name = best_compiled_feature["name"] if best_compiled_feature else "best candidate"
                    yield {
                        "event": "decision_required",
                        "data": {
                            "pipeline_id": pipeline_id,
                            "context": "multi_feature_not_predictive",
                            "best_iv": best_compiled_iv,
                            "best_channel": _best_ch,
                            "n_features": _n_compiled,
                            "options": [
                                {
                                    "key": "use_best_anyway",
                                    "label": "Use Best Feature",
                                    "description": (
                                        f"Proceed with '{_best_name}' "
                                        f"(IV={best_compiled_iv:.4f}). "
                                        "Detection models may perform near-random."
                                    ),
                                },
                                {
                                    "key": "continue_benchmarks",
                                    "label": "Continue with Benchmarks",
                                    "description": (
                                        "Skip all compiled features. "
                                        "Use benchmark features for Detection instead."
                                    ),
                                },
                                {
                                    "key": "stop",
                                    "label": "Stop Pipeline",
                                    "description": "End the pipeline here.",
                                },
                            ],
                        },
                    }
                    from services.s2f_service import _wait_for_decision
                    _iv_decision = await _wait_for_decision(pipeline_id)
                    if _iv_decision == "stop":
                        yield _pipeline_complete(
                            success=False,
                            reason=f"Pipeline stopped — all compiled features below IV {IV_THRESHOLD}.",
                        )
                        return
                    elif _iv_decision == "continue_benchmarks":
                        yield _phase_event(
                            "validation", "done",
                            "Compiled features skipped — using benchmark features for detection.",
                        )
                        feature_code = None
                        feature_name = None
                        feature = None
                        compiled_features = []  # prevent compiled features reaching detection
                    else:  # "use_best_anyway"
                        feature_code = best_compiled_feature["code"] if best_compiled_feature else None
                        feature_name = best_compiled_feature["name"] if best_compiled_feature else None
                        indicator = best_compiled_feature["indicator"] if best_compiled_feature else None
                        parameters = best_compiled_feature["parameters"] if best_compiled_feature else None
                        computation_plan = best_compiled_feature["computation_plan"] if best_compiled_feature else None
                        compatible_channels = best_compiled_feature["compatible_channels"] if best_compiled_feature else []
                        feature = best_compiled_feature["feature_obj"] if best_compiled_feature else None
            else:
                yield {
                    "event": "fallback_notice",
                    "data": {
                        "message": "All multi-feature candidates failed validation. Running in single-feature mode instead."
                    },
                }
                yield _phase_event("validator", "error", "No validated candidate features were produced. Falling back to single-feature pipeline.")
                multi_feature = False

    attempt = 0
    if not multi_feature:
        while True:
            attempt += 1
            if attempt > 1:
                # Delete previous compiled feature from this attempt
                if feature and db:
                    db.delete(feature)
                    db.flush()
                    feature = None
                yield _agent_message(
                    "Statistical Evaluator", "Feature Engineer",
                    f"Feature not predictive (IV < 0.02). Retrying with different approach..."
                )

            # Build cached phase data for rethink shortcuts (skip unnecessary LLM calls)
            # rethink_indicator: re-run all 3 phases (new indicator → new adaptation → new code)
            # rethink_code: skip Analyst + Adapter, only re-run Engineer (1 LLM call)
            cached_perceive = None
            cached_adaptation = None
            if last_decision == "rethink_code" and indicator and channel_adaptations:
                cached_perceive = {
                    "indicator": indicator, "parameters": parameters,
                    "computation_plan": computation_plan,
                    "perceive_pra": perceive_pra, "perceive_raw": perceive_raw,
                }
                cached_adaptation = {
                    "channel_adaptations": channel_adaptations,
                    "adapt_pra": adapt_pra,
                }
            skip_analyst = cached_perceive is not None
            skip_adapter = cached_adaptation is not None

            # Forward all compile SSE events with fine-grained phase tracking
            async for event in compile_feature(
                regulatory_text, schema_info, schema_key,
                model=model, temperature=temperature, max_corrections=max_corrections,
                pipeline_id=pipeline_id,
                cached_perceive=cached_perceive,
                cached_adaptation=cached_adaptation,
                feedback_context=feedback_ctx,
            ):
                # Emit phase changes based on event types
                evt_type = event.get("event", "")
                if evt_type == "perceive":
                    # Cache perceive data for potential rethink shortcuts
                    pdata = event.get("data", {})
                    perceive_pra = pdata.get("pra", {})
                    if not skip_analyst:
                        yield _phase_event("analyst", "done", "Regulatory Analyst complete")
                    if not skip_adapter:
                        yield _phase_event("adapter", "starting", "Schema Adapter analyzing channel compatibility...")
                elif evt_type == "schema_adapt":
                    # Cache adaptation data for potential rethink shortcuts
                    adata = event.get("data", {})
                    adapt_pra = adata.get("pra", {})
                    if not skip_adapter:
                        yield _phase_event("adapter", "done", "Schema Adapter complete")
                    yield _phase_event("engineer", "starting", "Feature Engineer generating code...")
                elif evt_type == "code":
                    iteration = event.get("data", {}).get("iteration", 0)
                    if iteration == 0:
                        yield _phase_event("engineer", "done", "Feature Engineer code generated")
                        yield _phase_event("validator", "starting", "Validator checking code...")
                elif evt_type == "validation":
                    passed = event.get("data", {}).get("passed", False)
                    iteration = event.get("data", {}).get("iteration")
                    if passed:
                        yield _phase_event("validator", "done", "Validator passed all checks")

                # Forward the original event
                yield event

                if evt_type == "complete":
                    compile_result = event["data"]
                    feature_code = compile_result.get("code", "")
                    indicator = compile_result.get("indicator", {})
                    parameters = compile_result.get("parameters", [])
                    computation_plan = compile_result.get("computation_plan", {})
                    channel_adaptations = compile_result.get("channel_adaptations", {})
                    compatible_channels = compile_result.get("compatible_channels", [])
                    perceive_raw = compile_result.get("perceive_raw", "")

            if not compile_result or not compile_result.get("validation_passed"):
                # ── Benchmark fallback ────────────────────────────────────────
                # When the sandbox/AST correction loop exhausted all N attempts,
                # skip user interaction and proceed with benchmark features.
                # This prevents pipeline stalls from persistent schema-mismatch
                # errors (e.g. LLM generating wrong return pattern for the dataset).
                if compile_result and compile_result.get("exhausted_corrections"):
                    yield _phase_event(
                        "validator", "feedback",
                        f"Generated code could not be auto-corrected after {max_corrections} attempt(s) "
                        "— pipeline will continue using benchmark features for detection."
                    )
                    yield _agent_message(
                        "Deterministic Validator", "Detection Strategist",
                        "Benchmark fallback: compiled feature exhausted all correction slots. "
                        "Benchmark features will be the sole input to anomaly detection."
                    )
                    feature_code = None
                    feature_name = None
                    break

                if not tried_rethinks:
                    # First attempt failed validation — no recovery possible
                    yield _phase_event("validator", "error", "Compilation failed — validation did not pass")
                    yield _pipeline_complete(success=False, reason="Compilation failed")
                    return
                # Retry attempt failed validation — offer benchmarks/stop
                yield _phase_event("validator", "error", "Compilation failed on retry — code did not pass validation")
                from services.s2f_service import _wait_for_decision
                yield {
                    "event": "decision_required",
                    "data": {
                        "pipeline_id": pipeline_id,
                        "context": "validation_failed_on_retry",
                        "options": [
                            {"key": "continue_benchmarks", "label": "Continue with Benchmarks",
                             "description": "Use benchmark features for Detection."},
                            {"key": "stop", "label": "Stop Pipeline",
                             "description": "End the pipeline here."},
                        ],
                    },
                }
                fallback_decision = await _wait_for_decision(pipeline_id)
                if fallback_decision == "stop":
                    yield _pipeline_complete(success=False, reason="User stopped after validation failure")
                    return
                # Continue with benchmarks
                feature_code = None
                feature_name = None
                break

            # Save feature to DB (with dedup naming)
            # Use structured naming: {category_slug}_{operation}_{window}
            # so compiled features read like benchmarks (e.g. velocity_count_30d, not "money laundering")
            feature_name = (
                _derive_feature_name(indicator, computation_plan)
                if indicator else "unnamed_feature"
            )
            feature = None
            if db:
                # Avoid duplicate names
                existing_count = db.query(Feature).filter(
                    Feature.project_id == project_id,
                    Feature.name == feature_name,
                ).count()
                if existing_count > 0:
                    feature_name = f"{feature_name}_{existing_count + 1}"

                feature = Feature(
                    name=feature_name,
                    code=feature_code,
                    project_id=project_id,
                    description=indicator.get("description", "") if indicator else "",
                    category=indicator.get("category", "unknown") if indicator else "unknown",
                    status="validated" if compile_result.get("validation_passed") else "failed",
                    source_text=regulatory_text[:5000],
                )
                feature.channels = compatible_channels
                feature.required_columns = compile_result.get("required_columns", [])
                db.add(feature)
                db.flush()

                # Save FeatureContext
                ctx = FeatureContext(
                    feature_id=feature.id,
                    indicator_json=json.dumps(indicator) if indicator else None,
                    parameters_json=json.dumps(parameters) if parameters else None,
                    computation_plan_json=json.dumps(computation_plan) if computation_plan else None,
                    schema_adaptation_json=json.dumps(channel_adaptations) if channel_adaptations else None,
                    provenance_json=json.dumps({
                        "source_text_length": len(regulatory_text),
                        "source_text_preview": regulatory_text[:500],
                    }),
                )
                db.add(ctx)
                db.commit()

            yield _phase_event("validator", "done", f"Feature '{feature_name}' validated — {len(compatible_channels)} compatible channels")

            # ════════════════════════════════════════════════════════════════════
            # PHASE 2: Feature Validation (Agent 5: Statistical Evaluator)
            # ════════════════════════════════════════════════════════════════════
            yield _phase_event("validation", "starting", "Running statistical validation...")
        
            from services.stats_evaluator import evaluate_feature
        
            eval_channels = compatible_channels or target_channels
            try:
                eval_result = await evaluate_feature(feature_code, feature_name, eval_channels, schema_key=schema_key)
            except Exception as e:
                yield _phase_event("validation", "error", f"Validation failed: {str(e)[:200]}")
                eval_result = {"channel_results": {}}
        
            yield {
                "event": "feature_eval",
                "data": eval_result,
            }
        
            # Check IV across channels — if all below threshold, trigger feedback loop
            channel_results = eval_result.get("channel_results", {})
            max_iv = 0.0
            best_eval_channel = None
            for ch, ch_data in channel_results.items():
                iv = ch_data.get("iv", 0.0) if isinstance(ch_data, dict) else 0.0
                if iv > max_iv:
                    max_iv = iv
                    best_eval_channel = ch
        
            if max_iv >= 0.02:
                yield {
                    "event": "iteration_trace",
                    "data": {
                        "iteration": attempt,
                        "indicator": indicator.get("category", "unknown") if indicator else "unknown",
                        "iv": max_iv,
                        "ks": channel_results.get(best_eval_channel, {}).get("ks", 0) if best_eval_channel and isinstance(channel_results.get(best_eval_channel), dict) else 0,
                        "status": "passed",
                        "perceive_summary": indicator.get("description", "") if indicator else "",
                        "code_preview": (feature_code or "")[:200],
                    },
                }
                yield _phase_event("validation", "done",
                    f"Feature validated — best IV={max_iv:.4f} on {best_eval_channel}")
                break  # Move to detection
        
            # ── IV too low — run Diagnostic Agent + ask user ──────────────
            yield _phase_event("validation", "feedback",
                f"IV={max_iv:.4f} — feature not predictive. Running diagnostic analysis...")
        
            # Build distribution summary for diagnostic
            dist_summary = "No distribution data available"
            if best_eval_channel and channel_results.get(best_eval_channel):
                ch_stats = channel_results[best_eval_channel].get("stats", {})
                if ch_stats:
                    pos = ch_stats.get("positive", {})
                    neg = ch_stats.get("negative", {})
                    dist_summary = (
                        f"Positive group: mean={pos.get('mean', 'N/A')}, median={pos.get('median', 'N/A')}, n={pos.get('count', 'N/A')}. "
                        f"Negative group: mean={neg.get('mean', 'N/A')}, median={neg.get('median', 'N/A')}, n={neg.get('count', 'N/A')}."
                    )
        
            # Diagnostic Agent LLM call
            import httpx
            from openai import AsyncOpenAI
            from config import OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_TIMEOUT_CONNECT, OPENAI_TIMEOUT_READ
        
            diagnostic = {"root_cause": "engineer", "reasoning": "Unable to determine root cause.", "recommendation": "Try a different computation approach."}
            try:
                _to = httpx.Timeout(
                    connect=OPENAI_TIMEOUT_CONNECT,
                    read=OPENAI_TIMEOUT_READ,
                    write=OPENAI_TIMEOUT_READ,
                    pool=OPENAI_TIMEOUT_CONNECT,
                )
                _diag_kwargs: dict = {"api_key": OPENAI_API_KEY, "timeout": _to, "max_retries": 1}
                if OPENAI_BASE_URL:
                    _diag_kwargs["base_url"] = OPENAI_BASE_URL
                diag_client = AsyncOpenAI(**_diag_kwargs)
                diag_prompt = f"""You are a Diagnostic Agent for an AML detection pipeline.
        
        A compiled feature has LOW predictive power (IV < 0.02). Analyze the root cause.
        
        ## Indicator (from Regulatory Analyst)
        {json.dumps(indicator, indent=2)}
        
        ## Schema Adaptation (from Schema Adapter)
        {json.dumps(channel_adaptations, indent=2) if channel_adaptations else 'No adaptation data'}
        
        ## Feature Code (from Feature Engineer)
        ```python
        {feature_code}
        ```
        
        ## Statistical Results
        - Best IV: {max_iv:.4f} on channel: {best_eval_channel}
        - Feature value distribution: {dist_summary}
        
        ## Possible Root Causes
        1. ANALYST — The indicator was interpreted too vaguely or the wrong category was chosen
        2. ADAPTER — The proxy column strategy is invalid (proxy doesn't correlate with the regulatory concept)
        3. ENGINEER — The code logic is wrong. Common issues:
           a. Simple aggregation (sum/count) without time window — captures no temporal signal
           b. Threshold-based feature (amount > X) — too simplistic, no discrimination
           c. Binary output instead of continuous — less discriminatory power
           d. Missing behavioral dimensions — should capture velocity/frequency/patterns, not just amounts
        
        For ENGINEER root cause, recommend:
        - Use time windows (7-30 days) to capture VELOCITY (transactions per period)
        - Calculate ANOMALIES (deviation from baseline)
        - Look for BEHAVIORAL PATTERNS (sudden inflows, rapid outflows, multiple recipients)
        - Use CONTINUOUS scores, not binary flags
        
        Respond in JSON:
        {{"root_cause": "analyst" | "adapter" | "engineer", "reasoning": "2-3 sentences explaining why", "recommendation": "Specific, actionable guidance for the next attempt"}}"""
        
                diag_resp = await diag_client.chat.completions.create(
                    model=model,
                    temperature=0.3,
                    max_tokens=500,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": "You are a diagnostic agent. Analyze root causes and respond in JSON only."},
                        {"role": "user", "content": diag_prompt},
                    ],
                )
                import json as _json
                diagnostic = _json.loads(diag_resp.choices[0].message.content)
            except Exception:
                pass  # Use default diagnostic
        
            root_cause = diagnostic.get("root_cause", "engineer")
            yield _agent_message(
                "Diagnostic Agent", "Pipeline",
                f"Root cause: {root_cause.upper()}. {diagnostic.get('reasoning', '')}"
            )
        
            # Build decision options — only 2 rethink paths (Analyst or Engineer)
            all_rethink_options = [
                {
                    "key": "rethink_indicator",
                    "label": "Rethink Indicator",
                    "description": "Send back to Regulatory Analyst to reinterpret the regulatory text (re-runs all 3 agents).",
                    "agent": "analyst",
                    "recommended": root_cause in ("analyst", "adapter"),
                },
                {
                    "key": "rethink_code",
                    "label": "Rethink Code",
                    "description": "Send back to Feature Engineer to try a completely different computation (fast — 1 LLM call).",
                    "agent": "engineer",
                    "recommended": root_cause == "engineer",
                },
            ]
            # Remove already-tried options
            remaining_rethinks = [o for o in all_rethink_options if o["key"] not in tried_rethinks]
            # Always include Continue with Benchmarks + Stop
            iv_options = remaining_rethinks + [
                {
                    "key": "continue_benchmarks",
                    "label": "Continue with Benchmarks",
                    "description": "Skip this feature. Use benchmark features for Detection.",
                },
                {
                    "key": "stop",
                    "label": "Stop Pipeline",
                    "description": "End the pipeline here.",
                },
            ]
        
            yield {
                "event": "decision_required",
                "data": {
                    "pipeline_id": pipeline_id,
                    "context": "feature_not_predictive",
                    "diagnostic": diagnostic,
                    "best_iv": max_iv,
                    "best_channel": best_eval_channel,
                    "options": iv_options,
                },
            }
        
            from services.s2f_service import _wait_for_decision
            decision = await _wait_for_decision(pipeline_id)
        
            # Emit iteration trace for the Validator timeline
            yield {
                "event": "iteration_trace",
                "data": {
                    "iteration": attempt,
                    "indicator": indicator.get("category", "unknown") if indicator else "unknown",
                    "iv": max_iv,
                    "ks": channel_results.get(best_eval_channel, {}).get("ks", 0) if best_eval_channel and isinstance(channel_results.get(best_eval_channel), dict) else 0,
                    "status": "failed",
                    "diagnostic": diagnostic,
                    "user_decision": decision,
                    "perceive_summary": indicator.get("description", "") if indicator else "",
                    "code_preview": (feature_code or "")[:200],
                    "target_agent": {
                        "rethink_indicator": "analyst",
                        "rethink_code": "engineer",
                        "continue_benchmarks": None,
                        "stop": None,
                    }.get(decision),
                },
            }
        
            if decision == "stop":
                yield _phase_event("validation", "done", "User stopped the pipeline.")
                yield _pipeline_complete(success=False, reason="User stopped pipeline after low IV")
                return
        
            if decision in ("continue_benchmarks", "skip"):
                yield _phase_event("validation", "done", "User chose to continue with benchmark features.")
                # Skip compiled feature, use benchmarks for detection
                feature_code = None
                feature_name = None
                break
        
            # Track this rethink choice so it's removed from future options
            tried_rethinks.add(decision)
            last_decision = decision
        
            # Rethink paths — build feedback context (injected into LLM prompts, NOT appended to regulatory_text)
            feedback_msg = (
                f"FEEDBACK FROM DIAGNOSTIC AGENT:\n"
                f"The previous feature had IV={max_iv:.4f} (not predictive).\n"
                f"Root cause analysis: {diagnostic.get('reasoning', '')}\n"
                f"Recommendation: {diagnostic.get('recommendation', '')}\n"
                f"Distribution: {dist_summary}"
            )
        
            if decision == "rethink_indicator":
                # Reset tabs → go back to Analyst (re-run all 3 agents)
                yield _phase_event("analyst", "active", "Regulatory Analyst rethinking indicator...")
                yield _phase_event("adapter", "idle", "")
                yield _phase_event("engineer", "idle", "")
                yield _phase_event("validator", "idle", "")
                feedback_ctx = f"{feedback_msg}\nPlease extract a MORE SPECIFIC and DIFFERENT indicator."
        
            elif decision == "rethink_code":
                # Reset tabs → go back to Engineer only (skip Analyst + Adapter = 1 LLM call)
                yield _phase_event("engineer", "active", "Feature Engineer rethinking computation...")
                yield _phase_event("validator", "idle", "")
                feedback_ctx = f"""{feedback_msg}

CRITICAL GUIDANCE FOR IMPROVING FEATURE QUALITY:

The current feature has IV=0, indicating it has no discriminatory power. This typically means:
1. The computation is too simple (e.g., just summing amounts)
2. The feature lacks temporal/velocity dimensions
3. It's not capturing behavioral anomalies

Please redesign the computation to:
- Use a TIME WINDOW (7-30 days recommended) to capture velocity trends
- Calculate RELATIVE CHANGES (e.g., recent velocity vs baseline)
- Look for BEHAVIORAL PATTERNS (sudden spikes, rapid turnover, pattern anomalies)
- Return CONTINUOUS VALUES (scores/counts), not binary flags
- Focus on what distinguishes AML from non-AML behavior, not just amounts

Example better approaches:
- Transaction count in last 30 days (velocity)
- Count of transactions to unique recipients (network diversity)
- Recent average transaction size vs historical average (anomaly)
- Frequency of round-figure transactions (pattern)
- Flow-through activity (inflow rate vs outflow rate in same period)"""
        
            # Go back to top of while loop, re-compile
        
        # ════════════════════════════════════════════════════════════════════════
    # PHASE 3: Detection Lab (Agent 6: Detection Strategist)
    # ════════════════════════════════════════════════════════════════════════
    yield _phase_event("detection", "starting", "Running anomaly detection models...")
    await asyncio.sleep(0)  # Flush SSE so frontend sees the breathing animation

    from services.detection_runner import run_detection

    # Auto-select channels with IV > 0.02, fallback to compatible, then any available
    good_channels = [ch for ch, data in channel_results.items()
                     if isinstance(data, dict) and data.get("iv", 0) > 0.02]
    detect_channels = good_channels or compatible_channels or target_channels[:3]
    # Ensure at least one channel
    if not detect_channels:
        detect_channels = list(CHANNELS.keys())[:3]

    # Always load benchmark features + add compiled feature on top
    benchmark_features = []
    if db:
        benchmark_features = db.query(Feature).filter(
            Feature.project_id == project_id,
            Feature.source == "benchmark",
            Feature.status == "validated",
        ).all()

    features_for_detect = [{"name": f.name, "code": f.code} for f in benchmark_features]
    feature_ids = [f.id for f in benchmark_features]

    if compiled_features:
        for candidate in compiled_features:
            features_for_detect.append({"name": candidate["name"], "code": candidate["code"]})
            if candidate.get("feature_obj"):
                feature_ids.append(candidate["feature_obj"].id)

    # Add compiled feature if available and still not already included
    if feature_code is not None and not compiled_features:
        features_for_detect.append({"name": feature_name, "code": feature_code})
        if feature:
            feature_ids.append(feature.id)

    if not features_for_detect:
        yield _phase_event("detection", "error", "No features available. Load benchmarks first.")
        yield _pipeline_complete(success=False, reason="No features for detection")
        return

    # Use compiled feature for alert creation if available, otherwise first benchmark
    if feature is None and benchmark_features:
        feature = benchmark_features[0]
        feature_name = feature.name

    detection_models = ["isolation_forest", "local_outlier_factor", "logistic_regression", "random_forest", "xgboost"]
    n_benchmark = len(benchmark_features)
    n_compiled = len(compiled_features) if compiled_features else (1 if feature_code else 0)
    yield _agent_message(
        "Detection Strategist", "Pipeline",
        f"Using {n_benchmark} benchmark + {n_compiled} compiled feature(s) = {len(features_for_detect)} total. "
        f"Selected {len(detect_channels)} channel(s): {', '.join(detect_channels)}. "
        f"Running {len(detection_models)} models: {', '.join(detection_models)}. "
        f"test_size={test_size}, top-{int(threshold_pct)} flag threshold."
    )

    try:
        # run_detection is CPU-bound/synchronous — run it in a thread pool so the
        # asyncio event loop is not blocked (keeps SSE connection alive during training).
        import functools
        detect_result = await asyncio.to_thread(
            functools.partial(
                run_detection,
                features=features_for_detect,
                feature_ids=feature_ids,
                channels=detect_channels,
                models=detection_models,
                test_size=test_size,
                threshold_pct=threshold_pct,
                db=db,
                schema_key=schema_key,
            )
        )
    except Exception as e:
        yield _phase_event("detection", "error", f"Detection failed: {str(e)[:200]}")
        yield _pipeline_complete(success=False, reason=f"Detection error: {str(e)[:200]}")
        return

    # Build Detection PRA
    total_accounts = sum(
        ch_data.get("n_accounts", 0)
        for ch_data in detect_result.get("channels", {}).values()
        if isinstance(ch_data, dict) and "n_accounts" in ch_data
    )
    total_pos = sum(
        ch_data.get("n_positive", 0)
        for ch_data in detect_result.get("channels", {}).values()
        if isinstance(ch_data, dict) and "n_positive" in ch_data
    )
    detection_pra = {
        "perceive": f"Received {len(features_for_detect)} feature(s) across {len(detect_channels)} channel(s). Total accounts: {total_accounts}. Labels: {total_pos} positive.",
        "reason": f"Running {len(detection_models)} models: 2 unsupervised (Isolation Forest, LOF) + 3 supervised with class-imbalance handling (Logistic Regression, Random Forest, XGBoost with scale_pos_weight). Train/Test split: {int((1-test_size)*100)}/{int(test_size*100)} stratified. Top-{int(threshold_pct)} flag threshold.",
    }

    # Find best model across all channels
    best_model = None
    best_auc = 0.0
    best_channel = None
    for ch, ch_data in detect_result.get("channels", {}).items():
        for m in ch_data.get("models", []):
            auc = m.get("auc_roc")
            if auc is not None and auc > best_auc:
                best_auc = auc
                best_model = m
                best_channel = ch

    predicted_customers = best_model.get("flagged_customers", []) if best_model else []
    predicted_customer_ids = [fc.get("customer_id") for fc in predicted_customers if fc.get("customer_id") is not None]

    yield {
        "event": "detection_result",
        "data": {
            **detect_result,
            "pra": detection_pra,
            "predicted_customers": predicted_customers,
            "predicted_customer_ids": predicted_customer_ids,
        },
    }

    # Debug: log what we got from detection
    channels_data = detect_result.get("channels", {})
    for ch, ch_data in channels_data.items():
        if isinstance(ch_data, dict):
            models_list = ch_data.get("models", [])
            yield _agent_message("Detection Strategist", "Pipeline",
                f"Channel {ch}: {ch_data.get('n_accounts', 0)} accounts, {len(models_list)} models, errors: {ch_data.get('error', 'none')}")
            for m in models_list:
                yield _agent_message("Detection Strategist", "Pipeline",
                    f"  Model {m.get('key', '?')}: AUC={m.get('auc_roc', 'N/A')}, flagged={m.get('flagged_accounts', 'N/A')}")

    if best_model:
        yield _agent_message(
            "Detection Strategist", "Pipeline",
            f"Best model: {best_model.get('name', '?')} on {best_channel} "
            f"(AUC-ROC: {best_auc:.3f}, flagged: {best_model.get('flagged_accounts', '?')} accounts)"
        )

    yield _phase_event("detection", "done",
        f"Detection complete — best AUC: {best_auc:.3f} ({best_model.get('name', 'N/A') if best_model else 'N/A'})")

    # ════════════════════════════════════════════════════════════════════════
    # PHASE 4: Alerts (Agent 7: RCC Verifier)
    # ════════════════════════════════════════════════════════════════════════
    yield _phase_event("rcc", "starting", "RCC Verifier: generating alerts and verifying regulatory consistency...")

    alert_count = 0
    run_id = None
    if db and best_model and feature:
        # Create new detection run + alerts
        dr = DetectionRun(
            feature_id=feature.id,
            model_name=best_model.get("key", "unknown"),
            auc_roc=best_model.get("auc_roc"),
            precision_at_k=best_model.get("precision_at_k"),
            recall_at_k=best_model.get("recall_at_k"),
            result_json=json.dumps(best_model),
        )
        db.add(dr)
        db.flush()
        run_id = dr.id

        flagged = best_model.get("flagged_customers", [])
        for fc in flagged:
            alert = Alert(
                run_id=dr.id,
                customer_id=fc.get("customer_id", "unknown"),
                anomaly_score=fc.get("anomaly_score", 0.0),
                feature_values_json=json.dumps(fc.get("feature_values")) if fc.get("feature_values") else None,
            )
            db.add(alert)
            alert_count += 1
        db.commit()

    yield _agent_message(
        "RCC Verifier", "Pipeline",
        f"Generated {alert_count} alerts. Running regulatory consistency check on top alerts..."
    )

    # RCC verify top 5 alerts
    verified_count = 0
    if db and run_id:
        from services.alert_explainer import verify_alert

        top_alerts = (
            db.query(Alert)
            .filter(Alert.run_id == run_id)
            .order_by(Alert.anomaly_score.desc())
            .limit(5)
            .all()
        )

        for alert_obj in top_alerts:
            try:
                explanation = await verify_alert(
                    customer_id=alert_obj.customer_id,
                    anomaly_score=alert_obj.anomaly_score,
                    model_name=best_model.get("key", "unknown"),
                    auc_roc=best_model.get("auc_roc"),
                    feature_name=feature_name,
                    feature_description=indicator.get("description", "") if indicator else "",
                    feature_code=feature_code,
                    result_json=json.dumps(best_model),
                    indicator=indicator,
                    parameters=parameters,
                    computation_plan=computation_plan,
                    source_text=regulatory_text[:5000],
                    feature_values=json.loads(alert_obj.feature_values_json) if alert_obj.feature_values_json else None,
                )
                alert_obj.explanation = explanation
                verified_count += 1

                yield {
                    "event": "alert_verified",
                    "data": {
                        "customer_id": alert_obj.customer_id,
                        "anomaly_score": alert_obj.anomaly_score,
                        "explanation": explanation,
                    },
                }
            except Exception as e:
                yield {
                    "event": "trace",
                    "data": {
                        "timestamp": "",
                        "level": "error",
                        "agent": "RCC Verifier",
                        "message": f"Failed to verify alert for {alert_obj.customer_id}: {str(e)[:100]}",
                    },
                }

        db.commit()

    yield _phase_event("rcc", "done",
        f"Generated {alert_count} alerts, {verified_count} verified by RCC")

    # ════════════════════════════════════════════════════════════════════════
    # PHASE 5: Dashboard Builder (cache + LLM layout, isolated from core pipeline)
    # ════════════════════════════════════════════════════════════════════════
    yield _phase_event("dashboard", "starting", "Dashboard Builder: caching run artifacts and planning layout…")
    try:
        from services.dashboard_agent import run_dashboard_phase

        async for _dbe in run_dashboard_phase(
            project_id=project_id,
            schema_key=schema_key,
            regulatory_text=regulatory_text,
            indicator=indicator,
            feature_name=feature_name,
            compatible_channels=compatible_channels,
            channel_results=channel_results,
            detect_result=detect_result,
            best_model=best_model,
            best_channel=best_channel,
            best_auc=best_auc,
            max_iv=max_iv,
            best_eval_channel=best_eval_channel,
            alert_count=alert_count,
            verified_count=verified_count,
            run_id=run_id,
            db=db,
            model=model,
            temperature=temperature,
            all_feature_stats=all_compiled_for_dashboard or (
                [
                    {
                        "name": f["name"],
                        "best_iv": f.get("best_iv", 0.0),
                        "best_ks": f.get("best_ks", 0.0),
                        "best_channel": f.get("best_channel"),
                        "included": True,
                        "eval_result": f.get("eval_result", {}),
                    }
                    for f in compiled_features
                ] if compiled_features else None
            ),
        ):
            yield _dbe
        yield _phase_event("dashboard", "done", "Dashboard Builder: layout saved for this project")
    except Exception as _dash_err:
        yield _phase_event("dashboard", "error", f"Dashboard Builder skipped: {str(_dash_err)[:160]}")

    # ════════════════════════════════════════════════════════════════════════
    # PIPELINE COMPLETE
    # ════════════════════════════════════════════════════════════════════════
    cleanup_pipeline(pipeline_id)

    import gc
    gc.collect()

    yield _pipeline_complete(
        success=True,
        reason="Pipeline completed successfully",
        summary={
            "feature_name": feature_name,
            "feature_id": feature.id if feature else None,
            "indicator_category": indicator.get("category") if indicator else None,
            "compatible_channels": compatible_channels,
            "best_eval_iv": max_iv,
            "best_model": best_model.get("name") if best_model else None,
            "best_model_auc": best_auc,
            "best_channel": best_channel,
            "alert_count": alert_count,
            "verified_count": verified_count,
            "predicted_customer_ids": predicted_customer_ids,
            "predicted_customer_count": len(predicted_customer_ids),
            "run_id": run_id,
        },
    )


# ── Helper functions ──────────────────────────────────────────────────────────

def _phase_event(phase: str, status: str, message: str) -> dict:
    return {
        "event": "phase_change",
        "data": {
            "phase": phase,
            "status": status,
            "message": message,
        },
    }


def _agent_message(from_agent: str, to_agent: str, message: str) -> dict:
    return {
        "event": "agent_message",
        "data": {
            "from": from_agent,
            "to": to_agent,
            "message": message,
        },
    }


def _pipeline_complete(success: bool, reason: str, summary: dict | None = None) -> dict:
    return {
        "event": "pipeline_complete",
        "data": {
            "success": success,
            "reason": reason,
            "summary": summary or {},
        },
    }
