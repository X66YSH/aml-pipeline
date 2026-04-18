"""RCC (Regulatory Consistency Checker) Verifier.

Implements the "Regulation Out" half of the closed loop:
For each flagged customer, verifies whether their feature values
satisfy the regulatory criteria that generated the detection feature.

Outputs: verdict (supported/contradicted/ambiguous) + evidence with
regulatory citations + confidence assessment.
"""

import json

from openai import AsyncOpenAI

from config import DEFAULT_LLM, OPENAI_API_KEY, OPENAI_BASE_URL


def _get_client() -> AsyncOpenAI:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured")
    kwargs = {"api_key": OPENAI_API_KEY, "timeout": 120.0}
    if OPENAI_BASE_URL:
        kwargs["base_url"] = OPENAI_BASE_URL
    return AsyncOpenAI(**kwargs)


RCC_SYSTEM = """You are an RCC (Regulatory Consistency Checker) Verifier for AML detection.

Your role: Given a flagged customer's feature values, the detection model's reasoning,
and the original regulatory text, assess whether this alert is CONSISTENT with the
regulatory criteria that generated the detection feature.

Return a JSON object with this exact structure:

{
  "verdict": "supported" | "contradicted" | "ambiguous",
  "confidence": "high" | "medium" | "low",
  "evidence": [
    {
      "feature": "feature name",
      "customer_value": 15,
      "population_mean": 2.3,
      "feature_importance": 0.738,
      "regulatory_criterion": "What the regulation says to look for",
      "regulatory_source": "Document name and section",
      "quoted_text": "Direct quote from the regulatory text",
      "assessment": "Specific analysis: state the customer's value, compare to population, explain why this supports/contradicts the regulatory criterion"
    }
  ],
  "overall_reasoning": "2-3 sentence summary connecting the evidence to the verdict",
  "review_focus": "One specific thing the analyst should investigate next"
}

RULES:
- "verdict" = "supported" if the customer's behavior matches what the regulation describes as suspicious
- "verdict" = "contradicted" if the customer's values are NORMAL and don't match the regulatory criteria
- "verdict" = "ambiguous" if the evidence is mixed or the regulatory text is too vague to determine
- One entry in "evidence" per feature. Order by importance (highest first).
- "customer_value" must be the EXACT value provided — do not round or change it.
- "quoted_text" must be a direct quote from the provided regulatory text. If none provided, write "No source text available".
- "assessment" must reference the SPECIFIC value AND compare to population statistics.
- Return ONLY valid JSON, no markdown, no code fences. Write in English."""

RCC_USER = """## Alert Under Review
- Customer ID: {customer_id}
- Anomaly Score: {score}
- Detection Model: {model_name} ({model_type})
- Model AUC-ROC: {auc_roc}

## Customer Feature Values
{feature_values_section}

## Population Statistics (for comparison)
{population_stats_section}

## Feature Importance (from model)
{feature_importance_section}

## Feature Code (what the feature computes)
```python
{feature_code}
```
{compilation_context}
{regulatory_text_section}
Assess whether this customer's behavior is consistent with the regulatory criteria.
Return a structured JSON verdict."""


async def verify_alert(
    customer_id: str,
    anomaly_score: float,
    model_name: str,
    auc_roc: float | None,
    feature_name: str,
    feature_description: str,
    feature_code: str,
    result_json: str = "{}",
    indicator: dict | None = None,
    parameters: list | None = None,
    computation_plan: dict | None = None,
    source_text: str = "",
    feature_values: dict | None = None,
    population_stats: dict | None = None,
) -> str:
    """RCC verification: assess whether a flagged customer's alert is supported by regulatory criteria."""
    try:
        result = json.loads(result_json)
    except Exception:
        result = {}

    mode = result.get("mode", "unknown")
    feature_importances = result.get("feature_importances")
    feat_names = result.get("feature_names", [])

    # Feature values section
    if feature_values:
        fv_lines = [f"- {k}: {v}" for k, v in feature_values.items()]
        feature_values_section = "\n".join(fv_lines)
    else:
        feature_values_section = "Not available"

    # Population stats section
    if population_stats:
        ps_lines = [f"- {k}: mean={v.get('mean', 'N/A')}, median={v.get('median', 'N/A')}, std={v.get('std', 'N/A')}" for k, v in population_stats.items()]
        population_stats_section = "\n".join(ps_lines)
    else:
        population_stats_section = "Not available"

    # Feature importance section
    if feature_importances and feat_names:
        fi_pairs = sorted(zip(feat_names, feature_importances), key=lambda x: x[1], reverse=True)
        fi_lines = [f"- {name}: {imp}" for name, imp in fi_pairs]
        feature_importance_section = "\n".join(fi_lines)
    elif feature_importances:
        fi_lines = [f"- Feature {i}: {v}" for i, v in enumerate(feature_importances)]
        feature_importance_section = "\n".join(fi_lines)
    else:
        feature_importance_section = "Not available (unsupervised model)"

    # Compilation context
    ctx_parts = []
    if indicator:
        ctx_parts.append(f"- AML Category: {indicator.get('category', 'N/A')}")
        ctx_parts.append(f"- Risk Rationale: {indicator.get('risk_rationale', 'N/A')}")
        ctx_parts.append(f"- Description: {indicator.get('description', 'N/A')}")
    if parameters:
        for p in parameters:
            name = p.get("name", "?")
            default = p.get("default", "?")
            basis = p.get("regulatory_basis", "")
            ctx_parts.append(f"- Parameter {name} = {default} (basis: {basis})")
    if computation_plan:
        op = computation_plan.get("operation", "")
        tw = computation_plan.get("time_window", "")
        if op:
            ctx_parts.append(f"- Detection Logic: {op}, time window: {tw}")

    compilation_context = ""
    if ctx_parts:
        compilation_context = "\n## Compilation Context (from Regulatory Analyst Agent)\n" + "\n".join(ctx_parts) + "\n"

    # Regulatory text
    regulatory_text_section = ""
    if source_text:
        regulatory_text_section = f"\n## Original Regulatory Text (source for this feature)\n```\n{source_text[:3000]}\n```\n"

    prompt = RCC_USER.format(
        customer_id=customer_id,
        score=round(anomaly_score, 6),
        model_name=model_name,
        model_type=mode,
        auc_roc=round(auc_roc, 4) if auc_roc else "N/A",
        feature_values_section=feature_values_section,
        population_stats_section=population_stats_section,
        feature_importance_section=feature_importance_section,
        feature_code=feature_code,
        compilation_context=compilation_context,
        regulatory_text_section=regulatory_text_section,
    )

    client = _get_client()
    resp = await client.chat.completions.create(
        model=DEFAULT_LLM,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": RCC_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
        max_tokens=2000,
    )
    raw = resp.choices[0].message.content.strip()

    try:
        json.loads(raw)
    except json.JSONDecodeError:
        raw = json.dumps({
            "verdict": "ambiguous",
            "confidence": "low",
            "evidence": [],
            "overall_reasoning": raw[:300],
            "review_focus": "Manual review required — RCC parse error",
        })

    return raw


# Backward-compatible alias
async def explain_alert(**kwargs) -> str:
    """Legacy alias — routes to verify_alert."""
    return await verify_alert(**kwargs)
