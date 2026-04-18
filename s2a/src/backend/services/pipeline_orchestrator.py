"""Pipeline Orchestrator — end-to-end multi-agent AML pipeline.

Coordinates 6 agents across 4 phases:
  Phase 1 (Feature Studio): Regulatory Analyst → Schema Adapter → Feature Engineer → Validator
  Phase 2 (Feature Validation): Statistical Evaluator (feedback loop to Phase 1 if IV too low)
  Phase 3 (Detection Lab): Detection Strategist
  Phase 4 (Alerts): RCC Verifier (Alert Analyst)

Yields SSE events for real-time visualization of the pipeline.
"""

import asyncio
import json
from typing import AsyncGenerator

from sqlalchemy.orm import Session

from config import DEFAULT_LLM, LLM_TEMPERATURE, MAX_CORRECTION_ITERATIONS
from models.feature import Alert, DetectionRun, Feature, FeatureContext


async def run_pipeline(
    regulatory_text: str,
    project_id: str,
    channels: list[str] | None = None,
    model: str = DEFAULT_LLM,
    temperature: float = LLM_TEMPERATURE,
    max_corrections: int = MAX_CORRECTION_ITERATIONS,
    max_feature_retries: int = 4,
    test_size: float = 0.3,
    threshold_pct: float = 15,  # Fixed top-15 accounts
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
    from services.s2f_service import compile_feature, register_pipeline, cleanup_pipeline

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
    tried_rethinks: set[str] = set()  # Track which rethink options have been used
    last_decision: str | None = None  # Track which agent to loop back to
    perceive_pra: dict = {}
    adapt_pra: dict = {}
    perceive_raw: str = ""
    feedback_ctx: str | None = None  # Feedback for LLM without bloating regulatory_text

    attempt = 0
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
        feature_name = indicator.get("category", "unnamed") if indicator else "unnamed"
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
        from openai import AsyncOpenAI
        from config import OPENAI_API_KEY

        diagnostic = {"root_cause": "engineer", "reasoning": "Unable to determine root cause.", "recommendation": "Try a different computation approach."}
        try:
            diag_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
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
3. ENGINEER — The code logic is wrong (right indicator + right columns, but wrong computation)

Respond in JSON:
{{"root_cause": "analyst" | "adapter" | "engineer", "reasoning": "2-3 sentences explaining why", "recommendation": "What the agent should do differently"}}"""

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
            feedback_ctx = f"{feedback_msg}\nPlease use a COMPLETELY DIFFERENT computation approach."

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

    # Add compiled feature if available
    if feature_code is not None:
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

    n_benchmark = len(benchmark_features)
    n_compiled = 1 if feature_code else 0
    yield _agent_message(
        "Detection Strategist", "Pipeline",
        f"Using {n_benchmark} benchmark + {n_compiled} compiled feature(s) = {len(features_for_detect)} total. "
        f"Selected {len(detect_channels)} channel(s): {', '.join(detect_channels)}. "
            f"Running Isolation Forest (paper standard) with test_size={test_size}, threshold=P{threshold_pct}."
        )

    try:
        detect_result = run_detection(
            features=features_for_detect,
            feature_ids=feature_ids,
            channels=detect_channels,
            models=["isolation_forest"],
            test_size=test_size,
            threshold_pct=threshold_pct,
            db=db,
            schema_key=schema_key,
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
        "reason": f"Using Isolation Forest (paper standard unsupervised method). Train/Test split: {int((1-test_size)*100)}/{int(test_size*100)} stratified. Selected channels: {', '.join(detect_channels)} (IV > 0.02). Threshold: P{threshold_pct} (top {100-threshold_pct}%).",
    }

    yield {
        "event": "detection_result",
        "data": {**detect_result, "pra": detection_pra},
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
