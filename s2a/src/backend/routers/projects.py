"""Project CRUD endpoints — /api/v1/projects"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from models.feature import Project

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    schema_key: str = "fintrac"  # "fintrac" or "ibm_aml"


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    llm_model: str | None = None
    temperature: float | None = None
    max_corrections: int | None = None


@router.get("")
def list_projects(db: Session = Depends(get_db)):
    projects = (
        db.query(Project)
        .options(joinedload(Project.features))
        .order_by(Project.updated_at.desc())
        .all()
    )
    # deduplicate due to joinedload
    seen = set()
    unique = []
    for p in projects:
        if p.id not in seen:
            seen.add(p.id)
            unique.append(p)
    return [p.to_dict() for p in unique]


@router.get("/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).options(joinedload(Project.features)).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project.to_dict()


@router.post("", status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(name=body.name, description=body.description, schema_key=body.schema_key)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project.to_dict()


@router.patch("/{project_id}")
def update_project(project_id: str, body: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    if body.llm_model is not None:
        project.llm_model = body.llm_model
    if body.temperature is not None:
        project.temperature = body.temperature
    if body.max_corrections is not None:
        project.max_corrections = body.max_corrections
    project.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return project.to_dict()


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
