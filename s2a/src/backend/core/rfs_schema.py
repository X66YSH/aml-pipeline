"""Regulatory Feature Specification (RFS) schema.

The RFS is the central artifact. Every compiled feature produces one of these.
It captures everything needed to understand, reproduce, and audit a feature.

Imported from s2f_signal_to_features and adapted for the web app.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class IndicatorSpec(BaseModel):
    """The regulatory indicator that motivated this feature."""

    category: str = Field(description="Ontology category (e.g., 'structuring')")
    description: str = Field(description="Human-readable description of the indicator")
    risk_rationale: str = Field(description="Why this pattern is suspicious")


class ComputationSpec(BaseModel):
    """How the feature is computed."""

    operation: str = Field(description="Primary operation (e.g., 'ratio', 'count')")
    description: str = Field(description="Plain-English description of the computation")
    aggregation_level: str = Field(default="account", description="Aggregation level")
    time_window: Optional[str] = Field(default=None, description="Time window if applicable")


class DataRequirements(BaseModel):
    """What data the feature needs."""

    tables: list[str] = Field(description="Required tables")
    columns: list[str] = Field(description="Required columns")
    joins: list[str] = Field(default_factory=list, description="JOIN descriptions if needed")
    filters: list[str] = Field(default_factory=list, description="Filter conditions")


class OutputSpec(BaseModel):
    """What the feature outputs."""

    dtype: str = Field(default="float", description="Output data type")
    range: list[float] = Field(default=[0.0, 1.0], description="Expected value range")
    interpretation: str = Field(description="What higher/lower values mean")


class FeatureSpec(BaseModel):
    """The compiled feature specification."""

    feature_name: str = Field(description="Snake_case feature name")
    computation: ComputationSpec
    data_requirements: DataRequirements
    output_spec: OutputSpec
    code: str = Field(description="The actual Python code (compute_feature function)")


class ProvenanceRecord(BaseModel):
    """Where this feature came from."""

    source_document: str = Field(description="Document title/ID")
    quoted_text: str = Field(description="Exact quoted text from the source")
    jurisdiction: str = Field(default="Canada", description="Regulatory jurisdiction")
    document_url: Optional[str] = Field(default=None, description="URL of source document")


class ParameterSpec(BaseModel):
    """An ambiguous parameter surfaced from regulatory text."""

    name: str = Field(description="Parameter name (snake_case)")
    ambiguous_term: str = Field(description="The ambiguous term from regulatory text")
    dtype: str = Field(description="Parameter type: float, int, str, list")
    default: float | int | str | list = Field(description="Default value")
    valid_range: Optional[list] = Field(default=None, description="[min, max] or list of valid values")
    unit: Optional[str] = Field(default=None, description="Unit (USD, days, count, etc.)")
    rationale: str = Field(description="Why this default was chosen")
    regulatory_basis: str = Field(description="Quoted regulatory text supporting this")
    sensitivity: Optional[str] = Field(default=None, description="How changing affects detection")


class ValidationResult(BaseModel):
    """Results of the validation pipeline."""

    schema_check: str = Field(default="PENDING", description="PASS/FAIL")
    type_check: str = Field(default="PENDING", description="PASS/FAIL")
    output_quality: str = Field(default="PENDING", description="PASS/FAIL + details")
    semantic_check: Optional[str] = Field(default=None, description="consistent/divergent/unclear")
    tdd_check: Optional[str] = Field(default=None, description="N/M test cases passed")
    sample_stats: Optional[dict] = Field(default=None, description="Output statistics")
    iterations_to_success: int = Field(default=0)
    runtime_seconds: Optional[float] = Field(default=None)


class RegulatoryFeatureSpec(BaseModel):
    """The complete Regulatory Feature Specification (RFS)."""

    rfs_id: str = Field(description="Unique ID (e.g., RFS-STR-0001)")
    indicator: IndicatorSpec
    feature: FeatureSpec
    provenance: ProvenanceRecord
    parameters: list[ParameterSpec] = Field(default_factory=list)
    validation: ValidationResult = Field(default_factory=ValidationResult)
    compilation_model: str = Field(default="gpt-4o", description="LLM used for compilation")
    compilation_timestamp: datetime = Field(default_factory=datetime.utcnow)
    target_schema: str = Field(description="Dataset schema (e.g., 'saml_d', 'ibm_aml')")

    def to_json_path(self, output_dir: str = "results") -> str:
        """Generate a standard file path for this RFS."""
        return f"{output_dir}/{self.rfs_id}_{self.target_schema}.json"
