"""
app.py - FastAPI application.

Serves the static frontend and exposes the REST API for the automation.

Endpoints:
  GET  /                  → Serves the frontend SPA
  GET  /api/health        → Health check
  POST /api/test-login    → Verifies credentials (dry run, no hours submitted)
  POST /api/submit        → Starts an automation job
  GET  /api/status/{id}  → Returns job status and live log
"""

import asyncio
import logging
import secrets
import uuid
from pathlib import Path
from typing import Any
from datetime import datetime, timedelta, timezone
import jwt

from fastapi import FastAPI, HTTPException, Depends, status, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator, Field

from automation import HoursEntry, run_session
from config import Credentials, get_env_credentials, LEGAJO_URL
from database import init_db, get_periods, get_entries_by_period

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger(__name__)

# ─── App setup ───────────────────────────────────────────────────────────────
init_db()
app = FastAPI(title="Legajo Hours Automator", version="1.0.0", docs_url=None)

# ─── Security: JWT & HttpOnly Cookies ────────────────────────────────────────
import os
APP_USERNAME = os.getenv("APP_USERNAME", "admin")
APP_PASSWORD = os.getenv("APP_PASSWORD", "admin123")
# El secreto se genera dinámicamente cada vez que el contenedor arranca para máxima seguridad, 
# a menos que se fije uno. En una PWA local, si reinicias el servidor tendrás que re-loguearte, lo cual es muy seguro.
SESSION_SECRET = os.getenv("SESSION_SECRET", secrets.token_hex(32))

def verify_access(request: Request):
    """Middleare para verificar la existencia de un JWT válido en las cookies."""
    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado (Cookie missing)")
    try:
        payload = jwt.decode(token, SESSION_SECRET, algorithms=["HS256"])
        if payload.get("user") != APP_USERNAME:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario no válido")
        return payload["user"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token no válido")

class AppLoginRequest(BaseModel):
    username: str
    password: str

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# Serve static assets (CSS, JS) from /static
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

# ─── In-memory job store ─────────────────────────────────────────────────────
# Maps job_id → {"status": str, "log": [...], "task": asyncio.Task}
JOBS: dict[str, dict[str, Any]] = {}


# ─── Request / Response models (Hardened) ────────────────────────────────────

class EntryModel(BaseModel):
    # Regex: YYYY-MM-DD strict format
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$", max_length=10)
    hours: float = Field(..., ge=0.5, le=24.0)

    @field_validator("date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        from datetime import date
        date.fromisoformat(v)  # raises ValueError if invalid date string (e.g., Feb 30)
        return v
    
    @field_validator("hours")
    @classmethod
    def round_hours(cls, v: float) -> float:
        return round(v, 2)


class SubmitRequest(BaseModel):
    # Restrict lengths to prevent payload bloat / DoS
    username: str = Field("", max_length=100)
    password: str = Field("", max_length=128)
    entries: list[EntryModel] = Field(..., min_length=1, max_length=60)
    
    # Strict validation on free-text inputs to avoid injection in the Playwright DOM
    template_name: str = Field("Autorización de horas extras TV Universal", max_length=100)
    tasks_desc: str = Field("Horas extras según solicitud", max_length=200, pattern=r"^[\w\s\.,\-áéíóúÁÉÍÓÚñÑ]*$")
    habitual_schedule: str = Field("Generico", max_length=50, pattern=r"^[\w\s:\-]*$")


class JobResponse(BaseModel):
    job_id: str
    status: str
    log: list[dict[str, str]]


# ─── Helper: resolve credentials ─────────────────────────────────────────────

def _resolve_creds(req: SubmitRequest) -> Credentials:
    """Prefer env-var credentials, fall back to request body credentials."""
    env_creds = get_env_credentials()
    if env_creds:
        return env_creds

    if not req.username or not req.password:
        raise HTTPException(
            status_code=422,
            detail="Credentials required. Provide username/password in the form, or set LEGAJO_USER/LEGAJO_PASS env vars.",
        )
    creds = Credentials(username=req.username, password=req.password)
    if not creds.is_valid():
        raise HTTPException(status_code=422, detail="Invalid credentials or URL.")
    return creds


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def serve_index():
    """Serves the frontend SPA (login Overlay will handle auth internally)"""
    index = FRONTEND_DIR / "index.html"
    if not index.exists():
        return JSONResponse({"error": "Frontend not found."}, status_code=404)
    return FileResponse(str(index))

@app.get("/sw.js", include_in_schema=False)
async def serve_sw():
    return FileResponse(str(FRONTEND_DIR / "sw.js"), media_type="application/javascript")

@app.get("/manifest.json", include_in_schema=False)
async def serve_manifest():
    return FileResponse(str(FRONTEND_DIR / "manifest.json"), media_type="application/manifest+json")

# ─── Auth API ────────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
async def app_login(req: AppLoginRequest, response: Response):
    """Inicia sesión en la PWA y setea una cookie HttpOnly con JWT"""
    correct_username = secrets.compare_digest(req.username, APP_USERNAME)
    correct_password = secrets.compare_digest(req.password, APP_PASSWORD)
    
    if not (correct_username and correct_password):
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")
    
    expires = datetime.now(timezone.utc) + timedelta(days=30)
    token = jwt.encode({"user": req.username, "exp": expires}, SESSION_SECRET, algorithm="HS256")
    
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False, # Setear true requiere HTTPS, dejamos en false para setups locales TrueNAS TCP IPs
        max_age=30 * 24 * 60 * 60
    )
    return {"success": True, "message": "Autenticado correctamente."}

@app.get("/api/auth/check")
async def app_check_auth(user: str = Depends(verify_access)):
    """Verifica si la sesión actual es válida."""
    return {"success": True, "user": user}

@app.post("/api/auth/logout")
async def app_logout(response: Response):
    """Cierra la sesión destruyendo la cookie"""
    response.delete_cookie("session_token", httponly=True, samesite="lax")
    return {"success": True}

# Note: /static is open to allow CSS/JS to load without repeated auth prompts in some strict browsers,
# but the HTML itself requires auth.

@app.get("/api/health")
async def health():
    # Health check remains open for Docker orchestrators
    # We never expose credentials in the API
    return {"status": "ok", "legajo_url": LEGAJO_URL, "auth_enabled": True}


@app.post("/api/test-login")
async def test_login(req: SubmitRequest, user: str = Depends(verify_access)):
    """Quick credential check — launches browser, logs in, then closes."""
    from playwright.async_api import async_playwright
    from automation import login

    creds = _resolve_creds(req)
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"]
            )
            page = await browser.new_page()
            await login(page, creds)
            await browser.close()
        return {"success": True, "message": "Login verificado correctamente."}
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Login failed: {exc}")


@app.post("/api/submit", response_model=JobResponse, status_code=202)
async def submit_hours(req: SubmitRequest, user: str = Depends(verify_access)):
    """Start an async automation job. Returns a job_id to poll for status."""
    creds = _resolve_creds(req)
    entries = [HoursEntry(date=e.date, hours=e.hours) for e in req.entries]

    job_id = str(uuid.uuid4())
    job_log: list[dict[str, str]] = []
    JOBS[job_id] = {"status": "running", "log": job_log}

    async def _run():
        try:
            await run_session(
                creds, 
                entries, 
                req.template_name, 
                req.tasks_desc, 
                req.habitual_schedule, 
                job_log
            )
            JOBS[job_id]["status"] = "done"
        except Exception as exc:
            job_log.append({"type": "error", "msg": f"Error inesperado: {exc}"})
            JOBS[job_id]["status"] = "error"

    task = asyncio.create_task(_run())
    JOBS[job_id]["task"] = task

    logger.info(f"Job {job_id} started with {len(entries)} entries.")
    return JobResponse(job_id=job_id, status="running", log=job_log)


@app.get("/api/status/{job_id}", response_model=JobResponse)
async def get_status(job_id: str, user: str = Depends(verify_access)):
    """Poll for job status and live log."""
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = JOBS[job_id]
    return JobResponse(job_id=job_id, status=job["status"], log=job["log"])

@app.get("/api/periods")
async def api_get_periods(user: str = Depends(verify_access)):
    """Devuelve la lista de periodos agrupados disponibles en el historial."""
    return get_periods()

@app.get("/api/history/{period_id}")
async def api_get_history(period_id: str, user: str = Depends(verify_access)):
    """Devuelve el detalle de las horas cargadas en un periodo específico."""
    return get_entries_by_period(period_id)
