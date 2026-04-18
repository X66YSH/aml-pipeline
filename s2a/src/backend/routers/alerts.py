"""Alert CRUD + explanation endpoints — /api/v1/alerts"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from models.feature import Alert, DetectionRun, Feature, FeatureContext

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])


# ── Request / Response schemas ────────────────────────────────────────────────


class AlertFeedbackUpdate(BaseModel):
    analyst_feedback: str  # "true_positive" | "false_positive"


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/stats")
def alert_stats(
    project_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Summary counts for the alerts dashboard."""
    q = db.query(Alert).join(DetectionRun).join(Feature)
    if project_id:
        q = q.filter(Feature.project_id == project_id)

    total = q.count()
    pending = q.filter(Alert.analyst_feedback == "pending").count()
    true_pos = q.filter(Alert.analyst_feedback == "true_positive").count()
    false_pos = q.filter(Alert.analyst_feedback == "false_positive").count()
    avg_score = db.query(func.avg(Alert.anomaly_score)).scalar() or 0.0

    return {
        "total": total,
        "pending": pending,
        "truePositive": true_pos,
        "falsePositive": false_pos,
        "avgScore": round(float(avg_score), 4),
    }


@router.get("")
def list_alerts(
    project_id: str | None = None,
    feedback: str | None = None,
    sort: str = "anomaly_score",
    order: str = "desc",
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """List alerts with filtering, sorting, and pagination."""
    q = db.query(Alert).join(DetectionRun).join(Feature)

    if project_id:
        q = q.filter(Feature.project_id == project_id)
    if feedback and feedback != "all":
        q = q.filter(Alert.analyst_feedback == feedback)

    # Sorting
    sort_col = Alert.anomaly_score if sort == "anomaly_score" else Alert.created_at
    q = q.order_by(sort_col.desc() if order == "desc" else sort_col.asc())

    alerts = q.offset(offset).limit(limit).all()

    result = []
    for a in alerts:
        run = a.run
        feature = run.feature if run else None
        d = a.to_dict()
        d["modelName"] = run.model_name if run else None
        d["featureName"] = feature.name if feature else None
        d["featureId"] = feature.id if feature else None
        d["aucRoc"] = run.auc_roc if run else None
        result.append(d)

    return result


@router.get("/{alert_id}")
def get_alert(alert_id: str, db: Session = Depends(get_db)):
    """Single alert with full detail."""
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    run = alert.run
    feature = run.feature if run else None
    d = alert.to_dict()
    d["modelName"] = run.model_name if run else None
    d["featureName"] = feature.name if feature else None
    d["featureId"] = feature.id if feature else None
    d["featureCode"] = feature.code if feature else None
    d["featureDescription"] = feature.description if feature else None
    d["aucRoc"] = run.auc_roc if run else None
    return d


@router.patch("/{alert_id}")
def update_alert_feedback(
    alert_id: str,
    body: AlertFeedbackUpdate,
    db: Session = Depends(get_db),
):
    """Update analyst feedback on an alert."""
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    if body.analyst_feedback not in ("true_positive", "false_positive"):
        raise HTTPException(status_code=400, detail="feedback must be 'true_positive' or 'false_positive'")

    alert.analyst_feedback = body.analyst_feedback
    alert.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(alert)

    d = alert.to_dict()
    run = alert.run
    feature = run.feature if run else None
    d["modelName"] = run.model_name if run else None
    d["featureName"] = feature.name if feature else None
    d["featureId"] = feature.id if feature else None
    d["aucRoc"] = run.auc_roc if run else None
    return d


@router.post("/{alert_id}/explain")
async def explain_alert_endpoint(alert_id: str, db: Session = Depends(get_db)):
    """RCC Verify: assess regulatory consistency of an alert."""
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # Return cached explanation if available
    if alert.explanation:
        return {"explanation": alert.explanation}

    run = alert.run
    if not run:
        raise HTTPException(status_code=404, detail="Detection run not found")
    feature = run.feature
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")

    from services.alert_explainer import verify_alert

    # Load compilation context if available
    ctx = db.query(FeatureContext).filter(FeatureContext.feature_id == feature.id).first()

    explanation = await verify_alert(
        customer_id=alert.customer_id,
        anomaly_score=alert.anomaly_score,
        model_name=run.model_name,
        auc_roc=run.auc_roc,
        feature_name=feature.name,
        feature_description=feature.description,
        feature_code=feature.code,
        result_json=run.result_json,
        indicator=ctx.indicator if ctx else None,
        parameters=ctx.parameters if ctx else None,
        computation_plan=ctx.computation_plan if ctx else None,
        source_text=feature.source_text or "",
        feature_values=json.loads(alert.feature_values_json) if alert.feature_values_json else None,
    )

    # Cache the explanation
    alert.explanation = explanation
    db.commit()

    return {"explanation": explanation}


# Keep /verify as an alias pointing to the same logic
@router.post("/{alert_id}/verify")
async def verify_alert_endpoint(alert_id: str, db: Session = Depends(get_db)):
    """RCC Verify endpoint (alias for /explain)."""
    return await explain_alert_endpoint(alert_id, db)
