"""
automation.py - Playwright headless browser automation.

This module drives a Chromium browser to log into the company's HR portal
and submit overtime hour entries one by one.

╔══════════════════════════════════════════════════════════════════════════════╗
║  ⚠  INSTRUCCIONES PARA COMPLETAR LOS STUBS                                 ║
║                                                                              ║
║  Busca todos los comentarios marcados con  # ← COMPLETAR                   ║
║  y reemplaza los selectores/URLs de ejemplo por los reales de tu empresa.   ║
║  Lee el README.md para saber cómo obtenerlos con DevTools.                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import date
from typing import Any

from playwright.async_api import async_playwright, Page, Browser, BrowserContext

from config import Credentials

logger = logging.getLogger(__name__)


# ─── Data model ──────────────────────────────────────────────────────────────

@dataclass
class HoursEntry:
    date: str        # ISO format: "YYYY-MM-DD"
    hours: float

    def formatted_date(self) -> str:
        """Return date in the format expected by the company portal."""
        # ← COMPLETAR: ajustar el formato de fecha si la empresa usa DD/MM/YYYY, etc.
        d = date.fromisoformat(self.date)
        return d.strftime("%d/%m/%Y")  # Ejemplo: "05/03/2026"


# ─── Result model ────────────────────────────────────────────────────────────

@dataclass
class SubmitResult:
    entry: HoursEntry
    success: bool
    message: str


# ─── Core automation functions ───────────────────────────────────────────────

async def login(page: Page, creds: Credentials) -> None:
    """
    Navigate to the login page and authenticate.

    ← COMPLETAR: Reemplazar las URLs y selectores por los reales de tu empresa.
    Pasos típicos:
      1. Ir a la URL de login.
      2. Completar usuario y contraseña.
      3. Hacer click en el botón de ingresar.
      4. Esperar a que cargue la página de inicio.
    """
    logger.info(f"Navigating to login page: {creds.url}")
    await page.goto(creds.url, wait_until="networkidle")

    # ← COMPLETAR: selector del campo de usuario
    # Ejemplos: "#username", "input[name='user']", "input[type='text']"
    await page.fill('input[name="username"]', creds.username)

    # ← COMPLETAR: selector del campo de contraseña
    # Ejemplos: "#password", "input[name='pass']", "input[type='password']"
    await page.fill('input[name="password"]', creds.password)

    # ← COMPLETAR: selector del botón de login
    # Ejemplos: "button[type='submit']", "#btn-login", ".login-btn"
    await page.click('#button_sing_in')

    # ← COMPLETAR: selector de algún elemento que aparezca DESPUÉS del login exitoso
    # para confirmar que nos logueamos (ej: el menú principal, el nombre del usuario)
    await page.wait_for_selector("#main-menu", timeout=15000)
    logger.info("Login successful.")


async def navigate_to_hours_form(page: Page) -> None:
    """
    Navigate from the home page to the communications/overtime list page.
    """
    url = page.url
    if "employeeCommunicationsList.htm" not in url:
        # If not there, try direct navigation
        target = url.replace("home.htm", "employeeCommunicationsList.htm").replace("login.htm", "employeeCommunicationsList.htm")
        await page.goto(target, wait_until="networkidle")

    # Esperar a que cargue la lista y esté el botón de Enviar
    await page.wait_for_selector("a.new-communication", timeout=10000)
    logger.info("Communications list loaded.")


async def submit_entry(
    page: Page, 
    entry: HoursEntry, 
    template_name: str,
    tasks_desc: str,
    habitual_schedule: str
) -> SubmitResult:
    """
    Fill and submit a single overtime hours entry through the modal workflow.
    """
    try:
        logger.info(f"Submitting entry: {entry.date} — {entry.hours}h")

        # 1. Hacer click en "Enviar" para abrir modal
        await page.click("a.new-communication")
        await page.wait_for_selector("#communicationModalModal", timeout=5000)

        # 2. Seleccionar el template dinámico
        await page.click("#communicationModalModal a.select2-choice")
        
        # Escribir para filtrar y dar enter
        await page.fill(".select2-search input", template_name)
        await page.keyboard.press("Enter")
        
        # 3. Esperar a que el HTML dinámico rinda los campos
        await page.wait_for_selector("#communicationModalContainer .source-html input", timeout=10000)

        # 4. Llenar los campos dinámicos de la lista .source-html

        # Campo 1: Cantidad de horas
        await page.fill("#communicationModalContainer .source-html input.form-control:nth-of-type(1)", str(entry.hours))
        
        # Campo 2: Desde (asumimos fijo por falta de campo en frontend, ej: 18:00)
        await page.fill("#communicationModalContainer .source-html input.form-control:nth-of-type(2)", "18:00")
        
        # Campo 3: Hasta (calculado simple base 18:00)
        end_time = 18 + int(entry.hours)
        await page.fill("#communicationModalContainer .source-html input.form-control:nth-of-type(3)", f"{end_time}:00" if end_time < 24 else "23:59")
        
        # Campo 4 (input date especializado)
        await page.fill("input.relec-datepicker", entry.formatted_date())

        # Campo 5: Tareas
        await page.fill("#communicationModalContainer .source-html input.form-control:nth-of-type(4)", tasks_desc)
        
        # Campo 6: Horario Habitual
        await page.fill("#communicationModalContainer .source-html input.form-control:nth-of-type(5)", habitual_schedule)

        # 5. Enviar el formulario
        await page.click("button.sign-send")

        # 6. Esperar a que el modal se cierre o haya un mensaje de éxito
        await page.wait_for_selector("#communicationModalModal", state="hidden", timeout=15000)

        logger.info(f"  ✓ Entry {entry.date} submitted successfully.")
        return SubmitResult(entry=entry, success=True, message="Enviado correctamente.")

    except Exception as exc:
        msg = f"Error en entrada {entry.date}: {exc}"
        logger.error(msg)
        # Intentar cerrar el modal si falló para no trabar el próximo registro
        try:
            await page.click("button[data-dismiss='modal']")
        except:
            pass
        return SubmitResult(entry=entry, success=False, message=msg)


# ─── Main session orchestrator ───────────────────────────────────────────────

async def run_session(
    creds: Credentials,
    entries: list[HoursEntry],
    template_name: str,
    tasks_desc: str,
    habitual_schedule: str,
    job_log: list[dict[str, Any]],
) -> bool:
    """
    Run a full Playwright session: login → navigate → submit all entries.

    Results are appended to `job_log` (shared mutable list used for live status).
    Returns True if all entries succeeded, False otherwise.
    """
    all_ok = True

    import os
    async with async_playwright() as pw:
        browser: Browser = await pw.chromium.launch(
            headless=True,
            executable_path=os.getenv("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"),
            args=["--no-sandbox", "--disable-dev-shm-usage"],  # Required in Docker
        )
        context: BrowserContext = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            locale="es-AR",
        )
        page = await context.new_page()

        try:
            # 1. Login
            job_log.append({"type": "info", "msg": "🔐 Iniciando sesión..."})
            await login(page, creds)
            job_log.append({"type": "success", "msg": "✅ Sesión iniciada."})

            # 2. Navigate to form
            job_log.append({"type": "info", "msg": "🔎 Navegando al formulario..."})
            await navigate_to_hours_form(page)
            job_log.append({"type": "success", "msg": "✅ Formulario encontrado."})

            # 3. Submit each entry
            for entry in entries:
                result = await submit_entry(page, entry, template_name, tasks_desc, habitual_schedule)
                status = "success" if result.success else "error"
                job_log.append({"type": status, "msg": result.message})
                if result.success:
                    try:
                        from database import add_entry
                        add_entry(entry.date, entry.hours, template_name, tasks_desc, habitual_schedule)
                    except Exception as db_exc:
                        logger.error(f"Database save error for {entry.date}: {db_exc}")
                else:
                    all_ok = False
                
                # Small delay between submissions to avoid overwhelming the server
                await asyncio.sleep(1.5)

        except Exception as exc:
            job_log.append({"type": "error", "msg": f"❌ Error fatal: {exc}"})
            logger.exception("Fatal error during session")
            all_ok = False

        finally:
            await context.close()
            await browser.close()

    job_log.append({
        "type": "done",
        "msg": "🏁 Proceso finalizado." + (" Todos los registros enviados." if all_ok else " Algunos registros fallaron."),
    })
    return all_ok
