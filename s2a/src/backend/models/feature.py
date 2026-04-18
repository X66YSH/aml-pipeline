"""ORM models for the AML pipeline database."""

import json
import uuid
from datetime import datetime, timezone

from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    # Schema: "fintrac" (7-channel Canadian banking) or "ibm_aml" (dual-table synthetic benchmark)
    schema_key: Mapped[str] = mapped_column(String, default="fintrac")
    # Per-project LLM settings
    llm_model: Mapped[str] = mapped_column(String, default="gpt-4o")
    temperature: Mapped[float] = mapped_column(Float, default=0.0)
    max_corrections: Mapped[int] = mapped_column(Integer, default=5)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    features: Mapped[list["Feature"]] = relationship(
        "Feature", back_populates="project", cascade="all, delete-orphan"
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "schemaKey": self.schema_key,
            "llmModel": self.llm_model,
            "temperature": self.temperature,
            "maxCorrections": self.max_corrections,
            "featureCount": len(self.features) if self.features else 0,
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
        }


class Feature(Base):
    __tablename__ = "features"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    project_id: Mapped[str | None] = mapped_column(String, ForeignKey("projects.id"), nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String, default="unknown")
    # channels stored as JSON array string, e.g. '["eft","card"]'
    channels_json: Mapped[str] = mapped_column(Text, default="[]")
    # columns referenced by this feature's code, e.g. '["amount_cad","customer_id"]'
    required_columns_json: Mapped[str] = mapped_column(Text, default="[]")
    # status: draft | validated | failed
    status: Mapped[str] = mapped_column(String, default="draft")
    # source: compiled | benchmark | library
    source: Mapped[str] = mapped_column(String, default="compiled")
    # Original regulatory text used to compile this feature
    source_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    detection_runs: Mapped[list["DetectionRun"]] = relationship(
        "DetectionRun", back_populates="feature", cascade="all, delete-orphan"
    )
    context: Mapped[Optional["FeatureContext"]] = relationship(
        "FeatureContext", back_populates="feature", uselist=False, cascade="all, delete-orphan"
    )
    project: Mapped["Project | None"] = relationship("Project", back_populates="features")

    @property
    def channels(self) -> list[str]:
        try:
            return json.loads(self.channels_json)
        except Exception:
            return []

    @channels.setter
    def channels(self, value: list[str]) -> None:
        self.channels_json = json.dumps(value)

    @property
    def required_columns(self) -> list[str]:
        try:
            return json.loads(self.required_columns_json)
        except Exception:
            return []

    @required_columns.setter
    def required_columns(self, value: list[str]) -> None:
        self.required_columns_json = json.dumps(sorted(value))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "projectId": self.project_id,
            "name": self.name,
            "code": self.code,
            "description": self.description,
            "category": self.category,
            "channels": self.channels,
            "requiredColumns": self.required_columns,
            "status": self.status,
            "source": self.source,
            "sourceText": self.source_text,
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
        }


class FeatureContext(Base):
    """Compilation context for a feature — persists the LLM reasoning from compile time."""

    __tablename__ = "feature_contexts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    feature_id: Mapped[str] = mapped_column(
        String, ForeignKey("features.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    # AML indicator extracted during Perceive phase
    indicator_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Parameters with regulatory basis
    parameters_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Computation plan (operation, aggregation, time window)
    computation_plan_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Schema adaptation results per channel (direct_match/proxy_required/not_feasible)
    schema_adaptation_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Provenance: source document references and quoted text spans
    provenance_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    feature: Mapped["Feature"] = relationship("Feature", back_populates="context")

    @property
    def indicator(self) -> dict:
        try:
            return json.loads(self.indicator_json) if self.indicator_json else {}
        except Exception:
            return {}

    @property
    def parameters(self) -> list:
        try:
            return json.loads(self.parameters_json) if self.parameters_json else []
        except Exception:
            return []

    @property
    def computation_plan(self) -> dict:
        try:
            return json.loads(self.computation_plan_json) if self.computation_plan_json else {}
        except Exception:
            return {}

    @property
    def schema_adaptation(self) -> dict:
        try:
            return json.loads(self.schema_adaptation_json) if self.schema_adaptation_json else {}
        except Exception:
            return {}

    @property
    def provenance(self) -> dict:
        try:
            return json.loads(self.provenance_json) if self.provenance_json else {}
        except Exception:
            return {}

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "featureId": self.feature_id,
            "indicator": self.indicator,
            "parameters": self.parameters,
            "computationPlan": self.computation_plan,
            "schemaAdaptation": self.schema_adaptation,
            "provenance": self.provenance,
            "createdAt": self.created_at.isoformat(),
        }


class DetectionRun(Base):
    __tablename__ = "detection_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    feature_id: Mapped[str] = mapped_column(String, ForeignKey("features.id"), nullable=False)
    model_name: Mapped[str] = mapped_column(String, nullable=False)
    auc_roc: Mapped[float | None] = mapped_column(Float, nullable=True)
    precision_at_k: Mapped[float | None] = mapped_column(Float, nullable=True)
    recall_at_k: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Full result payload as JSON string
    result_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    feature: Mapped["Feature"] = relationship("Feature", back_populates="detection_runs")
    alerts: Mapped[list["Alert"]] = relationship(
        "Alert", back_populates="run", cascade="all, delete-orphan"
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "featureId": self.feature_id,
            "modelName": self.model_name,
            "aucRoc": self.auc_roc,
            "precisionAtK": self.precision_at_k,
            "recallAtK": self.recall_at_k,
            "createdAt": self.created_at.isoformat(),
        }


class Alert(Base):
    """Analyst-reviewed detection alert — used as RL reward signal."""

    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String, ForeignKey("detection_runs.id"), nullable=False)
    customer_id: Mapped[str] = mapped_column(String, nullable=False)
    anomaly_score: Mapped[float] = mapped_column(Float, nullable=False)
    # analyst_feedback: true_positive | false_positive | pending
    analyst_feedback: Mapped[str] = mapped_column(String, default="pending")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Per-feature values for this customer at flag time
    feature_values_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # LLM-generated explanation (cached)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    run: Mapped["DetectionRun"] = relationship("DetectionRun", back_populates="alerts")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "runId": self.run_id,
            "customerId": self.customer_id,
            "anomalyScore": self.anomaly_score,
            "featureValues": json.loads(self.feature_values_json) if self.feature_values_json else None,
            "analystFeedback": self.analyst_feedback,
            "reviewedAt": self.reviewed_at.isoformat() if self.reviewed_at else None,
            "explanation": self.explanation,
            "createdAt": self.created_at.isoformat(),
        }


class RLEpisode(Base):
    """Reinforcement learning episode — state/action/reward tuple for future RL agent."""

    __tablename__ = "rl_episodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    state_json: Mapped[str] = mapped_column(Text, default="{}")
    action_json: Mapped[str] = mapped_column(Text, default="{}")
    reward: Mapped[float] = mapped_column(Float, nullable=False)
    next_state_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "state": json.loads(self.state_json),
            "action": json.loads(self.action_json),
            "reward": self.reward,
            "nextState": json.loads(self.next_state_json),
            "createdAt": self.created_at.isoformat(),
        }
