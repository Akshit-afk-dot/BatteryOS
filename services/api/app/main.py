from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import API_ROOT, get_settings
from .routers import (
    assistant,
    auth,
    batteries,
    customers,
    dashboard,
    organizations,
    quotations,
    reports,
    technical,
    uploads,
)

log = logging.getLogger("batteryos")

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CLIENT_HEADER = "x-batteryos-client"


def run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.attributes["skip_logging"] = True  # keep uvicorn's logging configuration
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url)
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    if settings.auto_migrate:
        run_migrations()
    if settings.is_production and not settings.cookie_secure:
        log.warning("COOKIE_SECURE is false in production; session cookies will be sent over plain HTTP.")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="BatteryOS API",
        version="0.1.0",
        description="Battery intake, test-data, diagnostic report and quotation workflows.",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/api/docs",
        openapi_url=None if settings.is_production else "/api/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["content-type", CLIENT_HEADER],
    )

    @app.middleware("http")
    async def csrf_and_headers(request: Request, call_next):
        # Browsers cannot attach a custom header cross-site without a CORS
        # preflight, which we only allow for configured origins. Combined with
        # SameSite=Lax cookies this blocks cross-site request forgery.
        if request.method in UNSAFE_METHODS and request.url.path.startswith("/api/"):
            if request.headers.get(CLIENT_HEADER) != "web":
                return JSONResponse({"detail": "Missing client header."}, status_code=403)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        if response.headers.get("content-type", "").startswith("application/json"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    for r in (auth, organizations, customers, batteries, uploads, technical, reports, quotations, dashboard, assistant):
        app.include_router(r.router)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
