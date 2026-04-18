"""Feature CRUD endpoints — /api/v1/features"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import CHANNELS, CHANNEL_COMMON_COLUMNS
from core.database import get_db
from models.feature import Feature, FeatureContext

router = APIRouter(prefix="/api/v1/features", tags=["features"])


# ── Request / Response schemas ────────────────────────────────────────────────

class FeatureCreate(BaseModel):
    name: str
    code: str
    project_id: str | None = None
    description: str = ""
    category: str = "unknown"
    channels: list[str] = []
    required_columns: list[str] = []
    status: str = "draft"
    source_text: str = ""
    # Compilation context (optional — saved to FeatureContext table)
    indicator: dict | None = None
    parameters: list | None = None
    computation_plan: dict | None = None
    channel_adaptations: dict | None = None
    provenance: dict | None = None


class FeatureUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    description: str | None = None
    category: str | None = None
    channels: list[str] | None = None
    required_columns: list[str] | None = None
    status: str | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_features(db: Session = Depends(get_db)):
    """Return all features ordered newest-first."""
    features = db.query(Feature).order_by(Feature.created_at.desc()).all()
    return [f.to_dict() for f in features]


@router.get("/by-project/{project_id}")
def list_features_by_project(project_id: str, db: Session = Depends(get_db)):
    """Return all features for a specific project."""
    features = (
        db.query(Feature)
        .filter(Feature.project_id == project_id)
        .order_by(Feature.created_at.desc())
        .all()
    )
    return [f.to_dict() for f in features]


@router.get("/{feature_id}")
def get_feature(feature_id: str, db: Session = Depends(get_db)):
    """Return a single feature by ID."""
    feature = db.get(Feature, feature_id)
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")
    return feature.to_dict()


@router.post("", status_code=201)
def create_feature(body: FeatureCreate, db: Session = Depends(get_db)):
    """Save a new compiled feature."""
    feature = Feature(
        name=body.name,
        code=body.code,
        project_id=body.project_id,
        description=body.description,
        category=body.category,
        status=body.status,
        source_text=body.source_text,
    )
    feature.channels = body.channels
    feature.required_columns = body.required_columns
    db.add(feature)
    db.flush()  # get feature.id before creating context

    # Save compilation context if provided
    if body.indicator or body.parameters or body.computation_plan:
        import json
        ctx = FeatureContext(
            feature_id=feature.id,
            indicator_json=json.dumps(body.indicator) if body.indicator else None,
            parameters_json=json.dumps(body.parameters) if body.parameters else None,
            computation_plan_json=json.dumps(body.computation_plan) if body.computation_plan else None,
            schema_adaptation_json=json.dumps(body.channel_adaptations) if body.channel_adaptations else None,
            provenance_json=json.dumps(body.provenance) if body.provenance else None,
        )
        db.add(ctx)

    db.commit()
    db.refresh(feature)
    return feature.to_dict()


@router.patch("/{feature_id}")
def update_feature(feature_id: str, body: FeatureUpdate, db: Session = Depends(get_db)):
    """Partial update — e.g. mark as validated after passing validation."""
    feature = db.get(Feature, feature_id)
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")

    if body.name is not None:
        feature.name = body.name
    if body.code is not None:
        feature.code = body.code
    if body.description is not None:
        feature.description = body.description
    if body.category is not None:
        feature.category = body.category
    if body.channels is not None:
        feature.channels = body.channels
    if body.required_columns is not None:
        feature.required_columns = body.required_columns
    if body.status is not None:
        feature.status = body.status

    feature.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(feature)
    return feature.to_dict()


@router.patch("/{feature_id}/promote")
def promote_feature(feature_id: str, db: Session = Depends(get_db)):
    """Toggle feature between compiled and benchmark."""
    feature = db.get(Feature, feature_id)
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")
    feature.source = "benchmark" if feature.source == "compiled" else "compiled"
    feature.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(feature)
    return feature.to_dict()


@router.delete("/{feature_id}", status_code=204)
def delete_feature(feature_id: str, db: Session = Depends(get_db)):
    """Delete a feature and its associated detection runs."""
    feature = db.get(Feature, feature_id)
    if not feature:
        raise HTTPException(status_code=404, detail="Feature not found")
    db.delete(feature)
    db.commit()


@router.get("/channel-compatibility")
def channel_compatibility(
    feature_ids: list[str] = Query(...),
    db: Session = Depends(get_db),
):
    """Check which channels are compatible with the given features.

    A channel is compatible if it has ALL columns required by ALL selected features.
    Returns: { "card": true, "eft": false, ... }
    """
    features = db.query(Feature).filter(Feature.id.in_(feature_ids)).all()
    # Union of all required columns across selected features
    all_required: set[str] = set()
    for f in features:
        all_required |= set(f.required_columns)

    # Build per-channel column sets
    result = {}
    for ch_key, ch_def in CHANNELS.items():
        ch_cols = set(CHANNEL_COMMON_COLUMNS) | set(ch_def["extra_columns"]) | {"channel"}
        result[ch_key] = all_required <= ch_cols

    return result
