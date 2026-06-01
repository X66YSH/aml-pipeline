"""Dashboard Builder Agent — project-agnostic run summary, cache, and LLM layout planning.

Collects structured artifacts from a pipeline run (metrics + chart-ready series keyed by id),
persists them per project, asks an LLM only for *layout and emphasis* (widget types and which
catalog keys to bind — not numeric fabrication), then returns a dashboard spec for the UI.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from sqlalchemy.orm import Session

from config import DASHBOARD_CACHE_DIR, DEFAULT_LLM, OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_TIMEOUT_CONNECT, OPENAI_TIMEOUT_READ


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _subsample_series(points: list[dict], max_points: int = 48) -> list[dict]:
    if not points or len(points) <= max_points:
        return points
    step = max(1, len(points) // max_points)
    return points[::step][:max_points]


def _fmt_bin_range(s: str) -> str:
    """Round numbers in a pandas qcut range string for readable chart labels.

    e.g. '(789.706, 1752.86]' → '(790, 1753]'
         '(-0.000999, 24.712)' → '(0, 25)'
    """
    import re

    def _r(m: re.Match) -> str:
        v = float(m.group())
        if abs(v) >= 100:
            return str(int(round(v)))
        if abs(v) >= 1:
            return f"{round(v, 1):g}"
        return f"{round(v, 3):g}"

    return re.sub(r"-?\d+\.?\d*", _r, s)


def _safe_float(x: Any) -> float | None:
    try:
        if x is None:
            return None
        return float(x)
    except (TypeError, ValueError):
        return None


def collect_pipeline_snapshot(
    *,
    project_id: str,
    schema_key: str,
    regulatory_text: str,
    indicator: dict | None,
    feature_name: str | None,
    compatible_channels: list[str],
    channel_results: dict[str, Any],
    detect_result: dict[str, Any] | None,
    best_model: dict[str, Any] | None,
    best_channel: str | None,
    best_auc: float,
    max_iv: float,
    best_eval_channel: str | None,
    alert_count: int,
    verified_count: int,
    run_id: int | None,
    db: Session | None,
    all_feature_stats: list[dict] | None = None,
) -> dict[str, Any]:
    """Build a domain-agnostic material bundle: metrics + series + small tables (no LLM)."""
    metrics: list[dict[str, Any]] = []

    def add_metric(mid: str, label: str, value: Any, fmt: str | None = None) -> None:
        metrics.append({"id": mid, "label": label, "value": value, "format": fmt})

    add_metric("feature_name", "Feature", feature_name or "—", "text")
    add_metric("schema", "Schema", schema_key, "text")
    add_metric("best_auc", "Best AUC-ROC", round(best_auc, 4) if best_auc else None, "float")
    add_metric("best_channel", "Best channel", best_channel or "—", "text")
    add_metric("best_iv", "Best IV", round(max_iv, 4) if max_iv is not None else None, "float")
    add_metric("best_eval_channel", "IV channel", best_eval_channel or "—", "text")
    add_metric("alert_count", "Alerts generated", alert_count, "int")
    add_metric("verified_count", "RCC verified", verified_count, "int")
    add_metric("compatible_channels_n", "Compatible channels", len(compatible_channels or []), "int")

    # ── Feature-level gate stats ──────────────────────────────────────────
    feature_stats_list: list[dict] = list(all_feature_stats or [])
    if not feature_stats_list and feature_name:
        feature_stats_list = [{
            "name": feature_name,
            "best_iv": round(float(max_iv or 0.0), 4),
            "best_ks": 0.0,
            "best_channel": best_eval_channel or best_channel or "—",
            "included": (max_iv or 0.0) >= 0.02,
        }]
    n_passing = sum(1 for f in feature_stats_list if f.get("included", False))
    n_total = len(feature_stats_list)
    add_metric("features_passing_gate", "Features Passing Gate", f"{n_passing} / {n_total}", "text")

    ind = indicator or {}
    narrative = {
        "indicator_category": ind.get("category"),
        "indicator_description": (ind.get("description") or "")[:800],
        "regulatory_preview": (regulatory_text or "")[:600],
    }

    series_catalog: dict[str, Any] = {}
    tables: dict[str, Any] = {}

    # Feature IV ranking bar (per-feature, not per-channel)
    feat_sorted = sorted(feature_stats_list, key=lambda f: f.get("best_iv", 0.0), reverse=True)
    if feat_sorted:
        series_catalog["feature_iv_bar"] = {
            "kind": "bar",
            "label": "Feature IV ranking",
            "points": [
                {
                    "name": f["name"],
                    "value": round(f.get("best_iv", 0.0), 4),
                    "included": f.get("included", False),
                    "source": f.get("source", "compiled"),
                }
                for f in feat_sorted
            ],
        }

    # Per-channel IV / KS (generic table + bar source)
    iv_rows = []
    for ch, data in (channel_results or {}).items():
        if not isinstance(data, dict):
            continue
        iv = _safe_float(data.get("iv"))
        ks = _safe_float(data.get("ks"))
        if iv is not None:
            iv_rows.append({"channel": ch, "iv": round(iv, 5), "ks": ks})
    iv_rows.sort(key=lambda r: r.get("iv") or 0, reverse=True)
    if iv_rows:
        series_catalog["channel_iv_bar"] = {
            "kind": "bar",
            "label": "Information Value by channel",
            "points": [{"name": r["channel"], "value": r["iv"]} for r in iv_rows],
        }
        tables["channel_eval"] = {
            "columns": ["channel", "iv", "ks"],
            "rows": iv_rows,
        }

    # Model comparison for best detection channel (if any)
    if detect_result and isinstance(detect_result.get("channels"), dict):
        ch_key = best_channel
        ch_data = detect_result["channels"].get(ch_key) if ch_key else None
        if not isinstance(ch_data, dict):
            # fallback: first channel with models
            for k, v in detect_result["channels"].items():
                if isinstance(v, dict) and v.get("models"):
                    ch_key, ch_data = k, v
                    break
        models = (ch_data or {}).get("models") if isinstance(ch_data, dict) else None
        if isinstance(models, list) and models:
            bar_points = []
            for m in models:
                if not isinstance(m, dict) or m.get("error"):
                    continue
                auc = _safe_float(m.get("auc_roc"))
                if auc is None:
                    continue
                bar_points.append({
                    "name": m.get("name") or m.get("key") or "model",
                    "auc": round(auc, 4),
                    "flagged": m.get("flagged_accounts"),
                })
            if bar_points:
                series_catalog["model_auc_bar"] = {
                    "kind": "bar",
                    "label": f"AUC-ROC by model ({ch_key})",
                    "points": bar_points,
                }

    if best_model and isinstance(best_model, dict):
        roc = best_model.get("roc_curve")
        if isinstance(roc, list) and roc:
            series_catalog["roc_best"] = {
                "kind": "line",
                "label": "ROC (best model)",
                "points": _subsample_series(
                    [{"fpr": _safe_float(p.get("fpr")), "tpr": _safe_float(p.get("tpr"))} for p in roc if isinstance(p, dict)],
                ),
            }

    # WoE bins — one series per passing feature (multi-feature) or fallback to channel_results
    _passing_with_eval = [
        f for f in feature_stats_list
        if f.get("included", False)
        and isinstance(f.get("eval_result"), dict)
        and isinstance(f["eval_result"].get("channel_results"), dict)
    ]
    if _passing_with_eval:
        for _fi, _fstat in enumerate(_passing_with_eval):
            _fev = _fstat["eval_result"]
            _fbest_ch = _fstat.get("best_channel")
            _fch_res = _fev.get("channel_results", {})
            _fch_data = _fch_res.get(_fbest_ch) if _fbest_ch else None
            if not _fch_data:
                for _v in _fch_res.values():
                    if isinstance(_v, dict) and _v.get("iv_bins"):
                        _fch_data = _v
                        break
            _fiv_bins = (_fch_data or {}).get("iv_bins") or []
            if len(_fiv_bins) >= 2:
                _sid = "woe_bins_bar" if _fi == 0 else f"woe_bins_bar_{_fi + 1}"
                series_catalog[_sid] = {
                    "kind": "bar",
                    "label": f"WoE by value range — {_fstat['name']}",
                    "points": [
                        {
                            "range": _fmt_bin_range(str(b.get("range", "")))[:20],
                            "woe": round(float(b.get("woe", 0)), 4),
                            "iv": round(float(b.get("iv", 0)), 4),
                            "count": int(b.get("count", 0)),
                        }
                        for b in _fiv_bins
                    ],
                }
    else:
        # Single-feature fallback: use channel_results directly
        _best_ch_result = None
        if best_eval_channel and isinstance((channel_results or {}).get(best_eval_channel), dict):
            _best_ch_result = channel_results[best_eval_channel]
        elif channel_results:
            for _v in channel_results.values():
                if isinstance(_v, dict) and _v.get("iv_bins"):
                    _best_ch_result = _v
                    break
        if _best_ch_result:
            _iv_bins = _best_ch_result.get("iv_bins") or []
            if len(_iv_bins) >= 2:
                series_catalog["woe_bins_bar"] = {
                    "kind": "bar",
                    "label": f"WoE by value range — {feature_name or 'feature'}",
                    "points": [
                        {
                            "range": _fmt_bin_range(str(b.get("range", "")))[:20],
                            "woe": round(float(b.get("woe", 0)), 4),
                            "iv": round(float(b.get("iv", 0)), 4),
                            "count": int(b.get("count", 0)),
                        }
                        for b in _iv_bins
                    ],
                }

    # Alert preview (optional)
    preview_rows: list[dict[str, Any]] = []
    if db is not None and run_id is not None:
        try:
            from models.feature import Alert

            rows = (
                db.query(Alert)
                .filter(Alert.run_id == run_id)
                .order_by(Alert.anomaly_score.desc())
                .limit(8)
                .all()
            )
            for a in rows:
                preview_rows.append({
                    "customer_id": str(a.customer_id),
                    "anomaly_score": float(a.anomaly_score) if a.anomaly_score is not None else None,
                })
        except Exception:
            pass
    if preview_rows:
        tables["alerts_preview"] = {
            "columns": ["customer_id", "anomaly_score"],
            "rows": preview_rows,
        }

    # Confusion matrix from best detection model
    cm_data: dict[str, Any] | None = None
    if best_model and isinstance(best_model, dict):
        _cm = best_model.get("confusion_matrix")
        if isinstance(_cm, dict) and any(k in _cm for k in ("tp", "fp", "fn", "tn")):
            cm_data = {
                "tp": int(_cm.get("tp", 0)),
                "fp": int(_cm.get("fp", 0)),
                "fn": int(_cm.get("fn", 0)),
                "tn": int(_cm.get("tn", 0)),
                "model_name": str(best_model.get("name") or best_model.get("key") or "best model"),
            }

    # Feature gate pass/fail table
    if feat_sorted:
        tables["feature_gate"] = {
            "columns": ["feature", "iv", "ks", "channel", "pass"],
            "rows": [
                {
                    "feature": f["name"],
                    "iv": round(f.get("best_iv", 0.0), 4),
                    "ks": round(f.get("best_ks", 0.0), 4),
                    "channel": str(f.get("best_channel") or "—"),
                    "pass": "✓" if f.get("included", False) else "✗",
                }
                for f in feat_sorted
            ],
        }

    return {
        "run_meta": {
            "project_id": project_id,
            "schema_key": schema_key,
            "captured_at": _iso_now(),
            "detection_run_id": run_id,
        },
        "narrative": narrative,
        "metrics": metrics,
        "series_catalog": series_catalog,
        "tables": tables,
        "confusion_matrix": cm_data,
    }


def _catalog_summary_for_llm(material: dict[str, Any], max_chars: int = 12000) -> str:
    """Compact description of bindable ids for the LLM (no giant embeddings)."""
    snap = {
        "metrics": [{"id": m["id"], "label": m["label"], "value": m["value"]} for m in material.get("metrics", [])],
        "series": {k: v.get("label", k) for k, v in (material.get("series_catalog") or {}).items()},
        "table_ids": list((material.get("tables") or {}).keys()),
        "has_confusion_matrix": material.get("confusion_matrix") is not None,
        "has_regulatory_narrative": bool(
            isinstance(material.get("narrative"), dict) and
            (material["narrative"].get("indicator_description") or material["narrative"].get("regulatory_preview"))
        ),
        "narrative": material.get("narrative"),
    }
    text = json.dumps(snap, indent=2, default=str)
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 20] + "\n…(truncated)"


_DASHBOARD_JSON_BLOCK = re.compile(r"\{[\s\S]*\}")


def _parse_json_object(raw: str) -> dict[str, Any]:
    raw = (raw or "").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = _DASHBOARD_JSON_BLOCK.search(raw)
        if m:
            return json.loads(m.group())
        raise


def _validate_widgets(spec: dict[str, Any], material: dict[str, Any]) -> dict[str, Any]:
    """Drop widgets that reference unknown series/table ids; keep layout stable."""
    series_keys = set((material.get("series_catalog") or {}).keys())
    table_keys = set((material.get("tables") or {}).keys())
    metric_ids = {m["id"] for m in material.get("metrics", []) if isinstance(m, dict) and m.get("id")}

    widgets = spec.get("widgets")
    if not isinstance(widgets, list):
        return {**spec, "widgets": []}

    cleaned = []
    for w in widgets:
        if not isinstance(w, dict):
            continue
        wtype = w.get("type")
        ok = True
        if wtype in ("bar", "line"):
            sid = w.get("series_id")
            if not sid or sid not in series_keys:
                ok = False
        elif wtype == "table":
            tid = w.get("table_id")
            if not tid or tid not in table_keys:
                ok = False
        elif wtype == "kpi_row":
            mids = w.get("metric_ids") or []
            if not isinstance(mids, list):
                ok = False
            else:
                valid = [mid for mid in mids if mid in metric_ids]
                if not valid:
                    ok = False
                else:
                    w = {**w, "metric_ids": valid}
        elif wtype == "markdown":
            if not isinstance(w.get("body"), str):
                ok = False
        elif wtype == "confusion_matrix":
            if not isinstance(material.get("confusion_matrix"), dict):
                ok = False
        elif wtype == "regulatory_basis":
            _narr = material.get("narrative") or {}
            if not (isinstance(_narr, dict) and (_narr.get("indicator_description") or _narr.get("regulatory_preview"))):
                ok = False
        else:
            ok = False
        if ok:
            cleaned.append(w)

    return {**spec, "widgets": cleaned}


async def plan_dashboard_with_llm(
    material: dict[str, Any],
    *,
    model: str = DEFAULT_LLM,
    temperature: float = 0.25,
) -> tuple[dict[str, Any], dict[str, str]]:
    """LLM chooses arrangement; numbers stay in `material` only."""
    from openai import AsyncOpenAI

    summary = _catalog_summary_for_llm(material)

    # Build dynamic WoE widget examples (one per passing feature series)
    _sc = material.get("series_catalog") or {}
    _woe_sids = sorted(k for k in _sc if k.startswith("woe_bins_bar"))
    _woe_examples = "".join(
        f'\n    {{"type": "bar", "span": 6, "title": "{_sc[s].get("label", "WoE by value range")}", "series_id": "{s}"}},'
        for s in _woe_sids
    ) if _woe_sids else '\n    {"type": "bar", "span": 6, "title": "WoE by value range", "series_id": "woe_bins_bar"},'

    sys_prompt = (
        "You are a Dashboard Builder agent. You receive a JSON summary of a completed analytics "
        "pipeline run (metric ids, optional series_ids for charts, optional table_ids). "
        "Design a compact executive dashboard: title, subtitle, layout rationale, and 6–9 widgets. "
        "Rules: "
        "(1) NEVER invent numeric results — only reference provided metric ids, series_id, or table_id. "
        "(2) Use widget types: kpi_row, bar, line, table, markdown, confusion_matrix, regulatory_basis. "
        "(3) KPI rows always span=12. Prefer span=6 for charts so two appear side-by-side. "
        "(4) Prefer feature_iv_bar over channel_iv_bar. Pair it (span=6) with model_auc_bar (span=6). "
        "(5) For bar widgets with many labels, set \"horizontal\": true. "
        "(6) Pair feature_gate table (span=6) with roc_best line (span=6). "
        "(7) If woe_bins_bar or woe_bins_bar_N series exist (one per passing feature), add each at span=6; "
        "pair them together in a row, then add confusion_matrix (span=6) after — "
        "these together show HOW discriminative each feature is and HOW reliable the model is. "
        "(8) If has_regulatory_narrative is true, always add a regulatory_basis widget (span=12) as the final row. "
        "(9) For markdown, write exactly 2–3 crisp sentences: overall verdict, feature note, model note. No lists. "
        "(10) Return JSON only with keys: dashboard_title, dashboard_subtitle, layout_rationale, widgets."
    )
    user_prompt = f"""Available data (bind only to these ids):\n{summary}

Respond with JSON:
{{
  "dashboard_title": "string",
  "dashboard_subtitle": "string",
  "layout_rationale": "2-3 sentences on why this layout fits THIS run",
  "widgets": [
    {{"type": "kpi_row", "span": 12, "metric_ids": ["best_auc", "best_iv", "features_passing_gate", "alert_count"]}},
    {{"type": "bar", "span": 6, "title": "Feature IV ranking", "series_id": "feature_iv_bar", "horizontal": true}},
    {{"type": "bar", "span": 6, "title": "Model AUC comparison", "series_id": "model_auc_bar", "horizontal": true}},
    {{"type": "table", "span": 6, "title": "Feature gate", "table_id": "feature_gate"}},
    {{"type": "line", "span": 6, "title": "ROC curve", "series_id": "roc_best"}},{_woe_examples}
    {{"type": "confusion_matrix", "span": 6, "title": "Confusion matrix"}},
    {{"type": "regulatory_basis", "span": 12, "title": "Regulatory basis"}}
  ]
}}
Span is 1-12 grid columns. Omit any widget whose series_id or table_id is not available, or whose type requires data marked false in the summary."""

    kwargs: dict[str, Any] = {
        "api_key": OPENAI_API_KEY,
        "max_retries": 1,
        "timeout": httpx.Timeout(
            connect=OPENAI_TIMEOUT_CONNECT,
            read=OPENAI_TIMEOUT_READ,
            write=OPENAI_TIMEOUT_READ,
            pool=OPENAI_TIMEOUT_CONNECT,
        ),
    }
    if OPENAI_BASE_URL:
        kwargs["base_url"] = OPENAI_BASE_URL
    client = AsyncOpenAI(**kwargs)

    resp = await client.chat.completions.create(
        model=model,
        temperature=temperature,
        max_tokens=1800,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    raw = resp.choices[0].message.content or "{}"
    spec = _parse_json_object(raw)
    spec = _validate_widgets(spec, material)

    pra = {
        "perceive": "Catalogued run metrics, optional chart series, and tabular slices from the pipeline output.",
        "reason": spec.get("layout_rationale") or "Structured the dashboard to highlight model quality, feature validity, and operational alerts.",
        "act": f"Planned {len(spec.get('widgets') or [])} widgets bound to catalog ids (no fabricated metrics).",
    }
    return spec, pra


def persist_dashboard_bundle(project_id: str, material: dict[str, Any], spec: dict[str, Any], pra: dict[str, str]) -> Path:
    """Write latest dashboard artifact for a project (overwrites)."""
    DASHBOARD_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = DASHBOARD_CACHE_DIR / f"{project_id}.json"
    payload = {
        "updated_at": _iso_now(),
        "material": material,
        "spec": spec,
        "pra": pra,
    }
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return path


def load_dashboard_bundle(project_id: str) -> dict[str, Any] | None:
    path = DASHBOARD_CACHE_DIR / f"{project_id}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


async def run_dashboard_phase(
    *,
    project_id: str,
    schema_key: str,
    regulatory_text: str,
    indicator: dict | None,
    feature_name: str | None,
    compatible_channels: list[str],
    channel_results: dict[str, Any],
    detect_result: dict[str, Any] | None,
    best_model: dict[str, Any] | None,
    best_channel: str | None,
    best_auc: float,
    max_iv: float,
    best_eval_channel: str | None,
    alert_count: int,
    verified_count: int,
    run_id: int | None,
    db: Session | None,
    model: str,
    temperature: float = 0.25,
    all_feature_stats: list[dict] | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Yields SSE-shaped events for the dashboard builder."""
    yield {
        "event": "agent_message",
        "data": {
            "from": "Dashboard Builder",
            "to": "Audience",
            "message": "Collecting run metrics, charts, and tables into a structured cache…",
        },
    }

    material = collect_pipeline_snapshot(
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
        all_feature_stats=all_feature_stats,
    )

    yield {
        "event": "dashboard_cache",
        "data": {"project_id": project_id, "keys": list(material.get("series_catalog", {}).keys())},
    }

    yield {
        "event": "agent_message",
        "data": {
            "from": "Dashboard Builder",
            "to": "Audience",
            "message": "Analyzing which visual layout best communicates this run's evidence…",
        },
    }

    try:
        spec, pra = await plan_dashboard_with_llm(material, model=model, temperature=temperature)
    except Exception as e:
        yield {
            "event": "trace",
            "data": {
                "timestamp": 0,
                "level": "error",
                "agent": "Dashboard Builder",
                "message": f"LLM layout fallback: {str(e)[:200]}",
            },
        }
        spec, pra = _fallback_spec(material), {
            "perceive": material["run_meta"],
            "reason": "LLM unavailable or failed; using deterministic layout.",
            "act": "Rendered default widget stack from cached metrics and series.",
        }

    path = persist_dashboard_bundle(project_id, material, spec, pra)

    yield {
        "event": "dashboard_spec",
        "data": {
            "updated_at": material.get("run_meta", {}).get("captured_at") or _iso_now(),
            "material": material,
            "spec": spec,
            "pra": pra,
            "cache_path": str(path),
        },
    }


def _fallback_spec(material: dict[str, Any]) -> dict[str, Any]:
    """Deterministic compact dashboard if LLM fails."""
    sc = material.get("series_catalog") or {}
    tabs = material.get("tables") or {}
    widgets: list[dict[str, Any]] = [
        {"type": "kpi_row", "span": 12, "metric_ids": [
            "best_auc", "best_iv", "features_passing_gate", "alert_count",
        ]},
    ]
    # Row 2: Feature IV + model AUC side-by-side
    iv_sid = "feature_iv_bar" if "feature_iv_bar" in sc else ("channel_iv_bar" if "channel_iv_bar" in sc else None)
    has_model = "model_auc_bar" in sc
    if iv_sid and has_model:
        widgets.append({"type": "bar", "span": 6, "title": "Feature IV ranking", "series_id": iv_sid, "horizontal": True})
        widgets.append({"type": "bar", "span": 6, "title": "Model AUC comparison", "series_id": "model_auc_bar", "horizontal": True})
    elif iv_sid:
        widgets.append({"type": "bar", "span": 12, "title": "Feature IV ranking", "series_id": iv_sid, "horizontal": True})
    elif has_model:
        widgets.append({"type": "bar", "span": 12, "title": "Model AUC comparison", "series_id": "model_auc_bar", "horizontal": True})
    # Row 3: Feature gate table + ROC curve
    if "feature_gate" in tabs:
        widgets.append({"type": "table", "span": 6, "title": "Feature gate", "table_id": "feature_gate"})
    if "roc_best" in sc:
        widgets.append({"type": "line", "span": 6, "title": "ROC curve (best model)", "series_id": "roc_best"})
    elif "alerts_preview" in tabs:
        widgets.append({"type": "table", "span": 6, "title": "Top alerts", "table_id": "alerts_preview"})
    # Row 4+: WoE bins (one per passing feature) + confusion matrix
    woe_sids = sorted(k for k in sc if k.startswith("woe_bins_bar"))
    for _wk in woe_sids:
        widgets.append({"type": "bar", "span": 6,
                        "title": sc[_wk].get("label", "WoE by value range"), "series_id": _wk})
    if isinstance(material.get("confusion_matrix"), dict):
        cm = material["confusion_matrix"]
        widgets.append({"type": "confusion_matrix", "span": 6,
                        "title": f"Confusion matrix — {cm.get('model_name', 'best model')}"})
    # Row 5: Regulatory basis (full width)
    _narr = material.get("narrative") or {}
    if isinstance(_narr, dict) and (_narr.get("indicator_description") or _narr.get("regulatory_preview")):
        widgets.append({"type": "regulatory_basis", "span": 12, "title": "Regulatory basis"})
    return {
        "dashboard_title": "Run dashboard",
        "dashboard_subtitle": material.get("run_meta", {}).get("schema_key", "project"),
        "layout_rationale": "Compact layout: KPIs → IV/model bars → gate/ROC → WoE/confusion matrix → regulatory basis.",
        "widgets": widgets,
    }
