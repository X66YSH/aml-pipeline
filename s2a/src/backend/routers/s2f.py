"""S2F API router -- V1 endpoints for schema detection, initiatives, upload, compile, validate, execute."""

import json
import uuid
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from models.feature import Alert, DetectionRun, Feature

from config import (
    CHANNEL_COMMON_COLUMNS,
    CHANNEL_DATA_DIR,
    CHANNELS,
    CHUNK_SIZE,
    FEATURE_TIMEOUT_SECONDS,
    FINTRAC_INITIATIVES,
    IBM_AML_TRANS_PATH,
    KYC_TABLES,
    PRELOADED_SCHEMAS,
    SCHEMA_SAMPLE_ROWS,
    UPLOADS_DIR,
    VALIDATION_SAMPLE_SIZE,
)
from core.data_loader import (
    detect_schema,
    get_schema_info,
    load_channel_data,
    load_ibm_aml_sample,
)
from utils.fintrac_fetcher import fetch_fintrac_document

router = APIRouter(prefix="/api/v1", tags=["s2f"])

# In-memory cache for uploaded file metadata
_upload_registry: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# GET /api/v1/schemas -- list pre-loaded schemas
# ---------------------------------------------------------------------------
@router.get("/schemas")
async def list_schemas():
    """List all pre-loaded dataset schemas."""
    schemas = []
    for key, schema in PRELOADED_SCHEMAS.items():
        schemas.append({
            "key": key,
            "name": schema["name"],
            "description": schema["description"],
            "tables": {
                name: {
                    "columns": table["columns"],
                    "row_count": table["row_count"],
                }
                for name, table in schema["tables"].items()
            },
        })
    return {"schemas": schemas}


# ---------------------------------------------------------------------------
# GET /api/v1/channels -- list available FINTRAC channels
# ---------------------------------------------------------------------------
@router.get("/channels")
async def list_channels():
    """List all available FINTRAC transaction channels."""
    channels = []
    for key, ch in CHANNELS.items():
        channels.append({
            "key": key,
            "name": ch["name"],
            "columns": CHANNEL_COMMON_COLUMNS + ch["extra_columns"],
            "row_count": ch["row_count"],
        })
    # Also include KYC info
    kyc_info = {
        "kyc_individual": KYC_TABLES["kyc_individual"],
        "labels": KYC_TABLES["labels"],
    }
    return {"channels": channels, "kyc": kyc_info}


# ---------------------------------------------------------------------------
# GET /api/v1/channels/{key}/sample -- get sample data for a channel
# ---------------------------------------------------------------------------
@router.get("/channels/{key}/sample")
async def get_channel_sample(key: str):
    """Get sample rows from a channel."""
    if key not in CHANNELS:
        raise HTTPException(status_code=404, detail=f"Channel '{key}' not found")

    ch = CHANNELS[key]
    path = CHANNEL_DATA_DIR / ch["file"]
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Data file not found: {ch['file']}")

    df = pd.read_csv(path, nrows=SCHEMA_SAMPLE_ROWS)
    return {
        "key": key,
        "name": ch["name"],
        "info": get_schema_info(df, key),
    }


# ---------------------------------------------------------------------------
# GET /api/v1/schemas/{key}/sample -- get sample data for a pre-loaded schema
# ---------------------------------------------------------------------------
@router.get("/schemas/{key}/sample")
async def get_schema_sample(key: str):
    """Get sample rows from a pre-loaded schema."""
    if key not in PRELOADED_SCHEMAS:
        raise HTTPException(status_code=404, detail=f"Schema '{key}' not found")

    if key == "ibm_aml":
        try:
            df_trans = pd.read_csv(IBM_AML_TRANS_PATH, nrows=SCHEMA_SAMPLE_ROWS)
            return {
                "key": key,
                "tables": {
                    "transactions": get_schema_info(df_trans, "transactions"),
                },
            }
        except FileNotFoundError:
            raise HTTPException(
                status_code=404,
                detail="IBM AML data file not found. Check IBM_AML_TRANS_PATH config.",
            )

    raise HTTPException(status_code=404, detail=f"Schema '{key}' sample not implemented")


# ---------------------------------------------------------------------------
# POST /api/v1/schemas/detect -- upload CSV -> detect schema
# ---------------------------------------------------------------------------
class DetectSchemaRequest(BaseModel):
    upload_id: str


@router.post("/schemas/detect")
async def detect_schema_endpoint(req: DetectSchemaRequest):
    """Detect the schema type of an uploaded CSV."""
    if req.upload_id not in _upload_registry:
        raise HTTPException(status_code=404, detail="Upload not found")

    meta = _upload_registry[req.upload_id]
    file_path = Path(meta["path"])

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Uploaded file no longer exists")

    df = pd.read_csv(file_path, nrows=1000)
    result = detect_schema(df)
    result["upload_id"] = req.upload_id
    result["filename"] = meta["filename"]
    return result


# ---------------------------------------------------------------------------
# GET /api/v1/initiatives -- list 12 FINTRAC initiatives
# ---------------------------------------------------------------------------
@router.get("/initiatives")
async def list_initiatives():
    """List all 12 FINTRAC operational alert initiatives."""
    initiatives = []
    for key, info in FINTRAC_INITIATIVES.items():
        initiatives.append({
            "key": key,
            "name": info["name"],
            "crime_type": info["crime_type"],
            "url": info["url"],
        })
    return {"initiatives": initiatives, "count": len(initiatives)}


# ---------------------------------------------------------------------------
# GET /api/v1/initiatives/{key} -- fetch initiative document text
# ---------------------------------------------------------------------------
@router.get("/initiatives/{key}")
async def get_initiative(key: str):
    """Fetch and parse a specific FINTRAC initiative document."""
    if key not in FINTRAC_INITIATIVES:
        raise HTTPException(status_code=404, detail=f"Initiative '{key}' not found")

    info = FINTRAC_INITIATIVES[key]
    try:
        document = fetch_fintrac_document(info["url"])
        return {
            "key": key,
            "name": info["name"],
            "crime_type": info["crime_type"],
            "title": document["title"],
            "full_text": document["full_text"][:10000],  # Cap at 10K chars for API
            "sections": document["sections"][:20],  # Cap sections
            "candidate_indicators": document["candidate_indicators"],
            "n_candidates": len(document["candidate_indicators"]),
        }
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch FINTRAC document: {str(e)}",
        )


# ---------------------------------------------------------------------------
# POST /api/v1/upload -- upload CSV file
# ---------------------------------------------------------------------------
@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a CSV file for processing."""
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")

    upload_id = str(uuid.uuid4())
    file_path = UPLOADS_DIR / f"{upload_id}.csv"

    content = await file.read()
    file_path.write_bytes(content)

    # Read a small sample to get schema info
    df_sample = pd.read_csv(file_path, nrows=100)
    schema_info = get_schema_info(df_sample, file.filename)

    # Count total rows without loading full file
    total_rows = sum(1 for _ in open(file_path, encoding="utf-8")) - 1  # subtract header

    _upload_registry[upload_id] = {
        "filename": file.filename,
        "path": str(file_path),
        "size_bytes": len(content),
        "total_rows": total_rows,
    }

    return {
        "upload_id": upload_id,
        "filename": file.filename,
        "size_bytes": len(content),
        "total_rows": total_rows,
        "schema_info": schema_info,
    }


# ---------------------------------------------------------------------------
# GET /api/v1/upload/{upload_id} -- get upload info
# ---------------------------------------------------------------------------
@router.get("/upload/{upload_id}")
async def get_upload_info(upload_id: str):
    """Get metadata about an uploaded file."""
    if upload_id not in _upload_registry:
        raise HTTPException(status_code=404, detail="Upload not found")

    meta = _upload_registry[upload_id]
    return {
        "upload_id": upload_id,
        "filename": meta["filename"],
        "size_bytes": meta["size_bytes"],
        "total_rows": meta["total_rows"],
    }


# ---------------------------------------------------------------------------
# POST /api/v1/upload/pdf -- upload PDF and extract text
# ---------------------------------------------------------------------------
@router.post("/upload/pdf")
async def upload_pdf(file: UploadFile = File(...)):
    """Upload a PDF file and extract text using pdfplumber."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    import pdfplumber

    upload_id = str(uuid.uuid4())
    file_path = UPLOADS_DIR / f"{upload_id}.pdf"

    content = await file.read()
    file_path.write_bytes(content)

    try:
        text_parts: list[str] = []
        page_count = 0
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)

        full_text = "\n\n".join(text_parts)

        _upload_registry[upload_id] = {
            "filename": file.filename,
            "path": str(file_path),
            "size_bytes": len(content),
            "pages": page_count,
            "type": "pdf",
        }

        return {
            "upload_id": upload_id,
            "filename": file.filename,
            "pages": page_count,
            "text": full_text[:50000],  # cap at 50K chars
            "size_bytes": len(content),
        }
    except Exception as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"Failed to extract text from PDF: {str(e)}")


def get_upload_registry() -> dict[str, dict]:
    """Expose upload registry for other modules (e.g., s2f_service)."""
    return _upload_registry


# ---------------------------------------------------------------------------
# POST /api/v1/compile -- compile regulatory text -> feature code (SSE stream)
# ---------------------------------------------------------------------------
class CompileRequest(BaseModel):
    regulatory_text: str
    schema_key: str = "ibm_aml"
    channels: list[str] | None = None
    upload_id: Optional[str] = None
    model: str = "gpt-4o"
    temperature: float = 0.0
    max_corrections: int = 5


@router.post("/compile")
async def compile_feature_endpoint(req: CompileRequest):
    """Compile regulatory text into feature code via LLM.

    Returns an SSE stream with trace events, perceive output, code, and final result.
    """
    from services.s2f_service import compile_feature

    text = req.regulatory_text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Regulatory text is empty.")

    # Resolve schema info
    if req.upload_id and req.upload_id in _upload_registry:
        meta = _upload_registry[req.upload_id]
        df_sample = pd.read_csv(meta["path"], nrows=100)
        schema_info_data = get_schema_info(df_sample, meta["filename"])
        schema_key = "uploaded"
    else:
        # Default: use FINTRAC channels (union of all columns so LLM sees everything;
        # the validation step in s2f_service checks per-channel compatibility).
        target_channels = req.channels or list(CHANNELS.keys())
        all_columns = list(CHANNEL_COMMON_COLUMNS) + ["channel"]
        total_rows = 0
        sample_rows = []
        for ch_key in target_channels:
            if ch_key in CHANNELS:
                ch = CHANNELS[ch_key]
                for col in ch["extra_columns"]:
                    if col not in all_columns:
                        all_columns.append(col)
                total_rows += ch["row_count"]
                ch_path = CHANNEL_DATA_DIR / ch["file"]
                if ch_path.exists():
                    ch_sample = pd.read_csv(ch_path, nrows=3).fillna("")
                    ch_sample["channel"] = ch_key
                    sample_rows.extend(ch_sample.to_dict(orient="records"))

        # Load KYC sample
        kyc_path = CHANNEL_DATA_DIR / KYC_TABLES["kyc_individual"]["file"]
        kyc_sample = []
        if kyc_path.exists():
            kyc_df = pd.read_csv(kyc_path, nrows=3).fillna("")
            kyc_sample = kyc_df.to_dict(orient="records")

        schema_info_data = {
            "table_name": "transactions",
            "columns": all_columns,
            "row_count": total_rows,
            "selected_channels": target_channels,
            "sample_rows": sample_rows[:9],
        }
        schema_info_data["accounts_columns"] = KYC_TABLES["kyc_individual"]["columns"]
        schema_info_data["accounts_sample"] = kyc_sample
        schema_key = "fintrac_channels"

    async def event_stream():
        async for event in compile_feature(
            regulatory_text=req.regulatory_text,
            schema_info=schema_info_data,
            schema_key=schema_key,
            model=req.model,
            temperature=req.temperature,
            max_corrections=req.max_corrections,
        ):
            yield f"data: {json.dumps(event)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# POST /api/v1/validate -- run 5-stage deterministic validator
# ---------------------------------------------------------------------------
class ValidateRequest(BaseModel):
    code: str
    schema_key: str = "ibm_aml"
    channels: list[str] | None = None
    upload_id: Optional[str] = None
    sample_rows: int = 50000


@router.post("/validate")
async def validate_feature_endpoint(req: ValidateRequest):
    """Run the 6-stage deterministic validator on generated code."""
    from validators.deterministic import validate_feature

    # Load data sample
    df, accounts_df = _load_data_for_validation(
        req.schema_key, req.upload_id, req.sample_rows, req.channels
    )

    result = validate_feature(
        code_str=req.code,
        df=df,
        accounts_df=accounts_df,
        timeout_seconds=FEATURE_TIMEOUT_SECONDS,
    )

    response = result.to_dict()

    # Add stage-by-stage breakdown for UI
    response["stages"] = _build_stage_breakdown(req.code, result)

    return response


# ---------------------------------------------------------------------------
# POST /api/v1/execute -- run compiled code on data -> stats + histogram
# ---------------------------------------------------------------------------
class ExecuteRequest(BaseModel):
    code: str
    schema_key: str = "ibm_aml"
    channels: list[str] | None = None
    upload_id: Optional[str] = None
    max_rows: int = 100000


@router.post("/execute")
async def execute_feature_endpoint(req: ExecuteRequest):
    """Execute compiled feature code on data and return statistics."""
    from validators.deterministic import validate_feature

    df, accounts_df = _load_data_for_validation(
        req.schema_key, req.upload_id, req.max_rows, req.channels
    )

    result = validate_feature(
        code_str=req.code,
        df=df,
        accounts_df=accounts_df,
        timeout_seconds=FEATURE_TIMEOUT_SECONDS,
    )

    if not result.success:
        return {
            "success": False,
            "error": result.error.to_dict() if result.error else None,
            "runtime_seconds": result.runtime_seconds,
        }

    # Compute detailed stats + histogram data
    result_df = result.result_df
    numeric_cols = result_df.select_dtypes(include=[np.number])
    feature_col = numeric_cols.columns[0]
    vals = result_df[feature_col].dropna()

    # Histogram (20 bins)
    hist_counts, hist_edges = np.histogram(vals, bins=20)
    histogram = {
        "counts": hist_counts.tolist(),
        "edges": [round(float(e), 4) for e in hist_edges.tolist()],
        "bin_labels": [
            f"{round(float(hist_edges[i]), 2)}-{round(float(hist_edges[i+1]), 2)}"
            for i in range(len(hist_counts))
        ],
    }

    # Percentiles
    percentiles = {}
    for p in [1, 5, 10, 25, 50, 75, 90, 95, 99]:
        percentiles[f"p{p}"] = round(float(np.percentile(vals, p)), 4)

    return {
        "success": True,
        "runtime_seconds": round(result.runtime_seconds, 3),
        "stats": result.stats,
        "feature_column": feature_col,
        "data_rows_used": len(df),
        "result_rows": len(result_df),
        "histogram": histogram,
        "percentiles": percentiles,
        "sample_output": result_df.head(10).to_dict(orient="records"),
    }


# ---------------------------------------------------------------------------
# Helper: load data for validation/execution
# ---------------------------------------------------------------------------
def _load_data_for_validation(
    schema_key: str,
    upload_id: str | None,
    nrows: int,
    channels: list[str] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame | None]:
    """Load transaction data + optional accounts data."""
    accounts_df = None

    if upload_id and upload_id in _upload_registry:
        meta = _upload_registry[upload_id]
        file_path = Path(meta["path"])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Uploaded file no longer exists")
        df = pd.read_csv(file_path, nrows=nrows)
    elif channels:
        df, accounts_df = load_channel_data(channels, nrows=nrows)
    elif schema_key == "ibm_aml":
        df, accounts_df = load_ibm_aml_sample(nrows=nrows)
    else:
        raise HTTPException(status_code=400, detail="No valid data source specified")

    return df, accounts_df


# ---------------------------------------------------------------------------
# POST /api/v1/feature-validate -- validate a single feature's discriminative power
# ---------------------------------------------------------------------------
class FeatureValidateRequest(BaseModel):
    code: str
    name: str = "feature"
    channels: list[str] | None = None


@router.post("/feature-validate")
async def feature_validate_endpoint(req: FeatureValidateRequest):
    """Validate a single feature's discriminative power using statistical tests."""
    from services.stats_evaluator import evaluate_feature

    try:
        return await evaluate_feature(
            code=req.code,
            name=req.name,
            channels=req.channels,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Feature validation failed: {e}")


# ---------------------------------------------------------------------------
# POST /api/v1/detect -- run feature(s) through multiple ML models, compare results
# ---------------------------------------------------------------------------
class FeatureSpec(BaseModel):
    name: str
    code: str


class DetectRequest(BaseModel):
    features: list[FeatureSpec]
    feature_ids: list[str] = []
    channels: list[str] | None = None
    models: list[str] = [
        "isolation_forest", "local_outlier_factor", "one_class_svm",
        "logistic_regression", "random_forest", "gradient_boosting",
        "adaboost", "svm",
    ]
    test_size: float = 0.3
    random_state: int = 42
    threshold_percentile: float = 95.0
    max_rows: int = 100000


@router.post("/detect")
async def detect_endpoint(req: DetectRequest, db: Session = Depends(get_db)):
    """Run compiled feature(s) through multiple ML models per channel and return comparison metrics."""
    from services.detection_runner import run_detection

    if not req.features:
        raise HTTPException(status_code=400, detail="No features provided")

    channels = req.channels or list(CHANNELS.keys())[:3]
    test_size = max(0.1, min(0.5, req.test_size))
    threshold_pct = max(80.0, min(99.0, req.threshold_percentile))

    # Pre-check: load compatible channels per feature from DB
    feature_compatible_channels: dict[str, set[str]] = {}
    for fid in req.feature_ids:
        feat = db.get(Feature, fid)
        if feat and feat.channels:
            for spec in req.features:
                if spec.name == feat.name:
                    feature_compatible_channels[spec.name] = set(feat.channels)
                    break

    # Convert Pydantic FeatureSpec objects to plain dicts for the service
    features_dicts = [{"name": f.name, "code": f.code} for f in req.features]

    result = run_detection(
        features=features_dicts,
        feature_ids=req.feature_ids,
        channels=channels,
        models=req.models,
        test_size=test_size,
        threshold_pct=threshold_pct,
        random_state=req.random_state,
        feature_compatible_channels=feature_compatible_channels,
        db=db,
    )

    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "Detection failed"))

    return result


# ---------------------------------------------------------------------------
# POST /api/v1/generate-alerts -- manually persist detection results as alerts
# ---------------------------------------------------------------------------
class GenerateAlertsRequest(BaseModel):
    feature_ids: list[str]
    model_key: str
    model_metrics: dict = {}
    flagged_customers: list[dict]  # [{customer_id, anomaly_score}]


@router.post("/generate-alerts")
async def generate_alerts_endpoint(req: GenerateAlertsRequest, db: Session = Depends(get_db)):
    """Persist detection results as DetectionRun + Alert records."""
    if not req.feature_ids:
        raise HTTPException(status_code=400, detail="No feature_ids provided")
    if not req.flagged_customers:
        raise HTTPException(status_code=400, detail="No flagged customers provided")

    # Delete old alerts + runs for the same features (overwrite, not append)
    for fid in req.feature_ids:
        old_runs = db.query(DetectionRun).filter(DetectionRun.feature_id == fid).all()
        for run in old_runs:
            db.query(Alert).filter(Alert.run_id == run.id).delete()
            db.delete(run)
    db.flush()

    first_run_id = None
    for fid in req.feature_ids:
        feat = db.get(Feature, fid)
        if not feat:
            continue
        dr = DetectionRun(
            feature_id=fid,
            model_name=req.model_key,
            auc_roc=req.model_metrics.get("auc_roc"),
            precision_at_k=req.model_metrics.get("precision_at_k"),
            recall_at_k=req.model_metrics.get("recall_at_k"),
            result_json=json.dumps(req.model_metrics),
        )
        db.add(dr)
        db.flush()
        if first_run_id is None:
            first_run_id = dr.id

    alert_count = 0
    if first_run_id:
        for fc in req.flagged_customers:
            alert = Alert(
                run_id=first_run_id,
                customer_id=fc["customer_id"],
                anomaly_score=fc["anomaly_score"],
                feature_values_json=json.dumps(fc.get("feature_values", {})),
            )
            db.add(alert)
            alert_count += 1
        db.commit()

    return {
        "run_id": first_run_id,
        "alert_count": alert_count,
    }


def _build_stage_breakdown(code: str, result) -> list[dict]:
    """Build a stage-by-stage validation breakdown for the UI."""
    from validators.ast_analyzer import analyze_code

    stages = []

    # Stage 1: Syntax
    try:
        compile(code, "<feature>", "exec")
        stages.append({"stage": "syntax", "label": "Syntax Check", "passed": True})
    except SyntaxError as e:
        stages.append({"stage": "syntax", "label": "Syntax Check", "passed": False, "error": str(e)})
        return stages

    # Stage 2: AST Analysis
    ast_result = analyze_code(code)
    stages.append({
        "stage": "ast_analysis",
        "label": "AST Analysis",
        "passed": ast_result.passed,
        "warnings": len(ast_result.warnings),
        "errors": len(ast_result.errors),
    })
    if not ast_result.passed:
        return stages

    # Stage 3: Function exists
    has_fn = "def compute_feature" in code
    stages.append({"stage": "function_check", "label": "Function Exists", "passed": has_fn})
    if not has_fn:
        return stages

    # Stages 4-6 come from the validation result
    if result.success:
        stages.append({"stage": "execution", "label": "Execution", "passed": True})
        stages.append({"stage": "type_check", "label": "Output Type", "passed": True})
        stages.append({"stage": "quality", "label": "Output Quality", "passed": True})
    elif result.error:
        err_stage = result.error.stage
        # All stages before the failing one passed
        stage_order = ["execution", "type_check", "quality"]
        stage_labels = ["Execution", "Output Type", "Output Quality"]
        for s, label in zip(stage_order, stage_labels):
            if s == err_stage:
                stages.append({"stage": s, "label": label, "passed": False, "error": result.error.message})
                break
            stages.append({"stage": s, "label": label, "passed": True})

    return stages


# ── Pipeline (end-to-end multi-agent) ─────────────────────────────────────────


class PipelineRequest(BaseModel):
    regulatory_text: str
    project_id: str
    schema_key: str = "fintrac"
    channels: list[str] | None = None
    model: str = "gpt-4o"
    temperature: float = 0.0
    max_corrections: int = 5
    max_feature_retries: int = 2
    test_size: float = 0.3
    threshold_pct: float = 15.0


@router.post("/pipeline/run")
async def pipeline_run_endpoint(req: PipelineRequest, db: Session = Depends(get_db)):
    """Run the full multi-agent pipeline. Returns SSE stream."""
    if not req.regulatory_text.strip():
        raise HTTPException(status_code=400, detail="Regulatory text is empty.")

    from services.pipeline_orchestrator import run_pipeline

    async def event_stream():
        try:
            async for event in run_pipeline(
                regulatory_text=req.regulatory_text,
                project_id=req.project_id,
                schema_key=req.schema_key,
                channels=req.channels,
                model=req.model,
                temperature=req.temperature,
                max_corrections=req.max_corrections,
                max_feature_retries=req.max_feature_retries,
                test_size=req.test_size,
                threshold_pct=req.threshold_pct,
                db=db,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'event': 'error', 'data': {'message': str(e)}})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class PipelineDecision(BaseModel):
    pipeline_id: str
    decision: str  # "find_similar" | "rethink" | "skip"


@router.post("/pipeline/decide")
async def pipeline_decide_endpoint(body: PipelineDecision):
    """Submit a user decision for a paused pipeline."""
    from services.s2f_service import submit_decision
    ok = submit_decision(body.pipeline_id, body.decision)
    if not ok:
        raise HTTPException(status_code=404, detail="Pipeline session not found or already completed")
    return {"ok": True, "decision": body.decision}


# ── Benchmark Features ───────────────────────────────────────────────────────

BENCHMARK_FEATURES = [
    {
        "name": "total_amount",
        "description": "Total transaction amount per customer — high total volume indicates potential layering or structuring",
        "category": "amount_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    # Total transaction volume per customer
    totals = df.groupby('customer_id')['amount_cad'].sum().reset_index()
    totals.columns = ['customer_id', 'total_amount']
    return totals
''',
    },
    {
        "name": "txn_count",
        "description": "Total number of transactions per customer — unusually high frequency may indicate velocity anomaly",
        "category": "velocity_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    # Transaction count per customer
    counts = df.groupby('customer_id').size().reset_index(name='txn_count')
    return counts
''',
    },
    {
        "name": "max_single_txn",
        "description": "Largest single transaction per customer — outlier large transactions are a key AML red flag",
        "category": "amount_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    # Maximum single transaction amount per customer
    maxes = df.groupby('customer_id')['amount_cad'].max().reset_index()
    maxes.columns = ['customer_id', 'max_single_txn']
    return maxes
''',
    },
    {
        "name": "amount_std",
        "description": "Standard deviation of transaction amounts — high variability suggests inconsistent patterns (trade-based ML indicator)",
        "category": "amount_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    # Amount variability per customer
    stds = df.groupby('customer_id')['amount_cad'].std().fillna(0).reset_index()
    stds.columns = ['customer_id', 'amount_std']
    return stds
''',
    },
    {
        "name": "amount_cv",
        "description": "Coefficient of variation (std/mean) of transaction amounts — captures pricing variability independent of scale",
        "category": "amount_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    # Amount coefficient of variation: std/mean
    stats = df.groupby('customer_id')['amount_cad'].agg(['mean', 'std']).reset_index()
    stats['amount_cv'] = stats['std'] / stats['mean']
    stats['amount_cv'] = stats['amount_cv'].fillna(0)
    return stats[['customer_id', 'amount_cv']]
''',
    },
]

ALL_CHANNEL_KEYS = ["card", "eft", "emt", "cheque", "abm", "wire", "westernunion"]
COMMON_COLUMN_NAMES = ["amount_cad", "customer_id", "transaction_id", "debit_credit", "transaction_datetime"]

# IBM AML benchmark features — domain-agnostic statistical features (merged table)
IBM_AML_BENCHMARK_FEATURES = [
    {
        "name": "total_amount",
        "description": "Total transaction amount per sender account — domain-agnostic volume measure",
        "category": "amount_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    totals = df.groupby('Sender_Account')['Amount Paid'].sum().reset_index()
    totals.columns = ['Sender_Account', 'total_amount']
    return totals
''',
    },
    {
        "name": "txn_count",
        "description": "Transaction count per sender account — domain-agnostic frequency measure",
        "category": "velocity_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    counts = df.groupby('Sender_Account').size().reset_index(name='txn_count')
    return counts
''',
    },
    {
        "name": "amount_std",
        "description": "Standard deviation of transaction amounts per sender account",
        "category": "amount_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    stds = df.groupby('Sender_Account')['Amount Paid'].std().fillna(0).reset_index()
    stds.columns = ['Sender_Account', 'amount_std']
    return stds
''',
    },
    {
        "name": "unique_counterparties",
        "description": "Number of unique receiving accounts per sender — domain-agnostic network measure",
        "category": "network_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    counts = df.groupby('Sender_Account')['Receiver_Account'].nunique().reset_index()
    counts.columns = ['Sender_Account', 'unique_counterparties']
    return counts
''',
    },
    {
        "name": "temporal_spread",
        "description": "Time span (days) between first and last transaction per sender account — domain-agnostic temporal measure",
        "category": "temporal_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    import pandas as pd
    df['_ts'] = pd.to_datetime(df['Timestamp'])
    spread = df.groupby('Sender_Account')['_ts'].agg(lambda x: (x.max() - x.min()).days).reset_index()
    spread.columns = ['Sender_Account', 'temporal_spread']
    return spread
''',
    },
    {
        "name": "non_self_transfer_ratio",
        "description": "Ratio of non-self-transfer transactions — laundering accounts rarely self-transfer (0.5% vs 59.5% normal)",
        "category": "behavioral_change",
        "code": '''def compute_feature(df, accounts_df=None):
    df['is_self'] = (df['Sender_Account'] == df['Receiver_Account']).astype(int)
    stats = df.groupby('Sender_Account').agg(
        total=('is_self', 'count'),
        self_count=('is_self', 'sum')
    ).reset_index()
    stats['non_self_ratio'] = 1 - (stats['self_count'] / stats['total'])
    return stats[['Sender_Account', 'non_self_ratio']]
''',
    },
    {
        "name": "ach_ratio",
        "description": "Ratio of ACH transactions — laundering accounts use ACH 85% of the time vs normal patterns",
        "category": "layering",
        "code": '''def compute_feature(df, accounts_df=None):
    df['is_ach'] = (df['Payment Format'] == 'ACH').astype(int)
    stats = df.groupby('Sender_Account').agg(
        total=('is_ach', 'count'),
        ach_count=('is_ach', 'sum')
    ).reset_index()
    stats['ach_ratio'] = stats['ach_count'] / stats['total']
    return stats[['Sender_Account', 'ach_ratio']]
''',
    },
    {
        "name": "foreign_txn_ratio",
        "description": "Ratio of cross-border transactions — laundering has higher foreign transaction rates",
        "category": "geographic_risk",
        "code": '''def compute_feature(df, accounts_df=None):
    df['is_foreign'] = (df['Sender_Country'] != df['Receiver_Country']).astype(int)
    stats = df.groupby('Sender_Account').agg(
        total=('is_foreign', 'count'),
        foreign_count=('is_foreign', 'sum')
    ).reset_index()
    stats['foreign_ratio'] = stats['foreign_count'] / stats['total']
    return stats[['Sender_Account', 'foreign_ratio']]
''',
    },
    {
        "name": "median_amount",
        "description": "Median transaction amount per account — laundering median ($10K) is 5x higher than normal ($2K)",
        "category": "amount_anomaly",
        "code": '''def compute_feature(df, accounts_df=None):
    medians = df.groupby('Sender_Account')['Amount Paid'].median().reset_index()
    medians.columns = ['Sender_Account', 'median_amount']
    return medians
''',
    },
    {
        "name": "payment_diversity",
        "description": "Shannon entropy of payment formats — diverse payment methods may indicate laundering",
        "category": "behavioral_change",
        "code": '''def compute_feature(df, accounts_df=None):
    import numpy as np
    def entropy(x):
        counts = x.value_counts(normalize=True)
        return -np.sum(counts * np.log2(counts + 1e-10))
    div = df.groupby('Sender_Account')['Payment Format'].apply(entropy).reset_index()
    div.columns = ['Sender_Account', 'payment_diversity']
    return div
''',
    },
]

IBM_AML_COLUMN_NAMES = [
    "Timestamp", "Sender_Bank_ID", "Sender_Account", "Receiver_Bank_ID", "Receiver_Account",
    "Amount Received", "Receiving Currency", "Amount Paid", "Payment Currency",
    "Payment Format", "Is Laundering", "Sender_Bank_Name", "Sender_Country",
    "Sender_Entity", "Receiver_Bank_Name", "Receiver_Country", "Receiver_Entity",
]


@router.post("/benchmark-features/{project_id}")
def create_benchmark_features(project_id: str, db: Session = Depends(get_db)):
    """Create 5 pre-built benchmark features for demo/testing. Schema-aware."""
    from models.feature import Feature, Project

    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Select features based on project schema
    if project.schema_key == "ibm_aml":
        features_list = IBM_AML_BENCHMARK_FEATURES
        channel_keys = ["ibm_aml"]
        col_names = IBM_AML_COLUMN_NAMES
    else:
        features_list = BENCHMARK_FEATURES
        channel_keys = ALL_CHANNEL_KEYS
        col_names = COMMON_COLUMN_NAMES

    created = []
    for bf in features_list:
        # Check if already exists — update if so (覆盖旧代码)
        existing = db.query(Feature).filter(
            Feature.project_id == project_id,
            Feature.name == bf["name"],
            Feature.source == "benchmark",
        ).first()
        if existing:
            existing.code = bf["code"]
            existing.description = bf["description"]
            existing.category = bf["category"]
            existing.channels = channel_keys
            existing.required_columns = col_names
            created.append(existing.to_dict())
            continue

        feature = Feature(
            name=bf["name"],
            code=bf["code"],
            project_id=project_id,
            description=bf["description"],
            category=bf["category"],
            status="validated",
            source="benchmark",
        )
        feature.channels = channel_keys
        feature.required_columns = col_names
        db.add(feature)
        db.flush()
        created.append(feature.to_dict())

    db.commit()
    return {"created": len(created), "features": created}
