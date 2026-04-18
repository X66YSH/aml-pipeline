"""SQLite database setup via SQLAlchemy.

Swap DATABASE_URL to postgresql+psycopg2://... for production.
"""

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# Store DB next to the backend source so it's easy to find / git-ignore
_DB_PATH = Path(__file__).parent.parent / "aml_pipeline.db"
DATABASE_URL = f"sqlite:///{_DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # needed for SQLite + FastAPI
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency — yields a DB session and closes it after the request."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables if they don't exist (called at app startup)."""
    # Import models so Base.metadata is populated before create_all
    import models.feature  # noqa: F401

    Base.metadata.create_all(bind=engine)

    # Lightweight migration: add columns that may not exist in older DBs
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if "features" in inspector.get_table_names():
        existing = {col["name"] for col in inspector.get_columns("features")}
        if "required_columns_json" not in existing:
            with engine.begin() as conn:
                conn.execute(text('ALTER TABLE features ADD COLUMN required_columns_json TEXT DEFAULT "[]"'))

    if "features" in inspector.get_table_names():
        if "source_text" not in existing:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE features ADD COLUMN source_text TEXT DEFAULT ''"))
        if "source" not in existing:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE features ADD COLUMN source TEXT DEFAULT 'compiled'"))

    if "projects" in inspector.get_table_names():
        existing_proj_cols = {col["name"] for col in inspector.get_columns("projects")}
        if "schema_key" not in existing_proj_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE projects ADD COLUMN schema_key TEXT DEFAULT 'fintrac'"))

    if "feature_contexts" in inspector.get_table_names():
        existing_ctx_cols = {col["name"] for col in inspector.get_columns("feature_contexts")}
        if "schema_adaptation_json" not in existing_ctx_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE feature_contexts ADD COLUMN schema_adaptation_json TEXT"))
        if "provenance_json" not in existing_ctx_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE feature_contexts ADD COLUMN provenance_json TEXT"))

    if "alerts" in inspector.get_table_names():
        existing_alert_cols = {col["name"] for col in inspector.get_columns("alerts")}
        if "explanation" not in existing_alert_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE alerts ADD COLUMN explanation TEXT"))
        if "feature_values_json" not in existing_alert_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE alerts ADD COLUMN feature_values_json TEXT"))
