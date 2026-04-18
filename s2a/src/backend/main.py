"""AML Multi-Agent App -- FastAPI entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS
from core.database import engine, init_db
from routers.alerts import router as alerts_router
from routers.features import router as features_router
from routers.projects import router as projects_router
from routers.s2f import router as s2f_router

app = FastAPI(
    title="AML Multi-Agent App",
    description="Multi-agent AML detection pipeline -- research tool & paper demo",
    version="1.0.0",
)

# CORS for frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# V1 routers
app.include_router(s2f_router)
app.include_router(features_router)
app.include_router(projects_router)
app.include_router(alerts_router)


@app.on_event("startup")
def on_startup():
    """Create DB tables on first run."""
    init_db()


@app.on_event("shutdown")
def on_shutdown():
    engine.dispose()


@app.get("/")
async def root():
    return {
        "app": "AML Multi-Agent App",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
