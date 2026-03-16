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
# El secreto se genera dinámicamente cada vez que el contenedor arranca para máxima seguridad, 
# a menos que se fije uno. En una PWA local, si reinicias el servidor tendrás que re-loguearte, lo cual es muy seguro.
SESSION_SECRET = os.getenv("SESSION_SECRET", secrets.token_hex(32))

def verify_access(request: Request):
    """Verifica la existencia de un JWT válido en las cookies."""
    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado (Cookie missing)")
    try:
        payload = jwt.decode(token, SESSION_SECRET, algorithms=["HS256"])
        if not payload.get("user"):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")
        return payload["user"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token no válido")

def get_session_credentials(request: Request) -> Credentials:
    """Extrae las credenciales del legajo almacenadas en el JWT de sesión."""
    token = request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No autenticado")
    try:
        payload = jwt.decode(token, SESSION_SECRET, algorithms=["HS256"])
        return Credentials(
            username=payload.get("legajo_user", ""),
            password=payload.get("legajo_pass", "")
        )
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión inválida")

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
    start_time: str = Field(..., pattern=r"^\d{2}:\d{2}$", max_length=5)
    end_time: str = Field(..., pattern=r"^\d{2}:\d{2}$", max_length=5)
    hours: float = Field(..., ge=0.5, le=24.0)
    # Per-entry fields (sent by the frontend since multi-template support)
    template_name: str = Field("", max_length=100)
    tasks_desc: str = Field("", max_length=200)
    habitual_schedule: str = Field("", max_length=50)

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
    
    # Global fallback fields (used only when entry-level fields are empty)
    template_name: str = Field("Autorización de horas extras TV Universal", max_length=100)
    tasks_desc: str = Field("", max_length=200)
    habitual_schedule: str = Field("", max_length=50)


class JobResponse(BaseModel):
    job_id: str
    status: str
    log: list[dict[str, str]]


# ─── Helper: resolve credentials ─────────────────────────────────────────────

def _resolve_creds(request: Request) -> Credentials:
    """Prefer env-var credentials, fall back to JWT session credentials."""
    env_creds = get_env_credentials()
    if env_creds:
        return env_creds
    return get_session_credentials(request)


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
    """Inicia sesión validando las credenciales contra el sistema Mi Legajo."""
    creds = Credentials(username=req.username, password=req.password)
    if not creds.is_valid():
        raise HTTPException(status_code=422, detail="Credenciales inválidas.")

    try:
        from playwright.async_api import async_playwright
        from automation import login
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                executable_path=os.getenv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
                args=["--no-sandbox", "--disable-dev-shm-usage"]
            )
            page = await browser.new_page()
            await login(page, creds)
            await browser.close()
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Credenciales incorrectas o sistema no disponible: {exc}")

    expires = datetime.now(timezone.utc) + timedelta(days=30)
    token = jwt.encode({
        "user": req.username,
        "legajo_user": req.username,
        "legajo_pass": req.password,
        "exp": expires
    }, SESSION_SECRET, algorithm="HS256")

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
    env_creds = get_env_credentials()
    return {
        "status": "ok",
        "legajo_url": LEGAJO_URL,
        "auth_enabled": True,
        "env_creds": env_creds is not None,  # frontend uses this to hide cred fields
    }


@app.get("/api/auth/auto-login")
async def auto_login(response: Response):
    """
    Auto-login endpoint: if APP_AUTO_LOGIN=true is set in env vars,
    sets a session cookie automatically so the GUI overlay is skipped.
    Useful when running on a trusted private network (e.g. TrueNAS).
    """
    auto = os.getenv("APP_AUTO_LOGIN", "false").lower() == "true"
    if not auto:
        raise HTTPException(status_code=403, detail="Auto-login not enabled (set APP_AUTO_LOGIN=true)")
    env_creds = get_env_credentials()
    if not env_creds:
        raise HTTPException(status_code=400, detail="Auto-login requiere LEGAJO_USER y LEGAJO_PASS configuradas en el entorno.")
    expires = datetime.now(timezone.utc) + timedelta(days=30)
    token = jwt.encode({
        "user": env_creds.username,
        "legajo_user": env_creds.username,
        "legajo_pass": env_creds.password,
        "exp": expires
    }, SESSION_SECRET, algorithm="HS256")
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=30 * 24 * 60 * 60
    )
    return {"success": True, "message": "Auto-login OK"}


@app.post("/api/test-login")
async def test_login(request: Request, user: str = Depends(verify_access)):
    """Quick credential check — launches browser, logs in, then closes."""
    from playwright.async_api import async_playwright
    from automation import login

    creds = _resolve_creds(request)
    try:
        import os
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                executable_path=os.getenv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
                args=["--no-sandbox", "--disable-dev-shm-usage"]
            )
            page = await browser.new_page()
            await login(page, creds)
            await browser.close()
        return {"success": True, "message": "Login verificado correctamente."}
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Login failed: {exc}")


@app.post("/api/submit", response_model=JobResponse, status_code=202)
async def submit_hours(req: SubmitRequest, request: Request, user: str = Depends(verify_access)):
    """Start an async automation job. Returns a job_id to poll for status."""
    creds = _resolve_creds(request)
    # Build HoursEntry objects with per-entry template/tasks/schedule.
    # Fall back to global req fields for backwards compat if entry-level fields are empty.
    entries = [
        HoursEntry(
            date=e.date,
            start_time=e.start_time,
            end_time=e.end_time,
            hours=e.hours,
            template_name=e.template_name or req.template_name,
            tasks_desc=e.tasks_desc or req.tasks_desc,
            habitual_schedule=e.habitual_schedule or req.habitual_schedule,
        )
        for e in req.entries
    ]

    job_id = str(uuid.uuid4())
    job_log: list[dict[str, str]] = []
    JOBS[job_id] = {"status": "running", "log": job_log}

    async def _run():
        try:
            await run_session(creds, entries, job_log, username=user)
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
    return get_periods(username=user)

@app.get("/api/history/{period_id}")
async def api_get_history(period_id: str, user: str = Depends(verify_access)):
    """Devuelve el detalle de las horas cargadas en un periodo específico."""
    return get_entries_by_period(period_id, username=user)


# ─── Debug Screenshots ────────────────────────────────────────────────────────

@app.get("/api/debug/screenshots")
async def list_screenshots(user: str = Depends(verify_access)):
    """Lista las screenshots de debug disponibles (requiere DEBUG_SCREENSHOTS=true)."""
    from pathlib import Path
    screenshot_dir = Path("/tmp/debug_screenshots")
    if not screenshot_dir.exists():
        return {"screenshots": [], "note": "No hay screenshots. Activá DEBUG_SCREENSHOTS=true y corré el bot."}
    files = sorted(screenshot_dir.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)
    return {
        "screenshots": [f.name for f in files],
        "count": len(files),
        "view_url": "/api/debug/screenshots/{name}"
    }

@app.get("/api/debug/screenshots/{name}")
async def get_screenshot(name: str, user: str = Depends(verify_access)):
    """Devuelve una screenshot de debug como imagen PNG."""
    from pathlib import Path
    import re
    # Sanitize filename
    if not re.match(r'^[\w\-\.]+\.png$', name):
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido")
    path = Path("/tmp/debug_screenshots") / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Screenshot no encontrada")
    return FileResponse(str(path), media_type="image/png")
