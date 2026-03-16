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
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from playwright.async_api import async_playwright, Page, Browser, BrowserContext

from config import Credentials

logger = logging.getLogger(__name__)

# ─── Debug screenshots ────────────────────────────────────────────────────────
DEBUG_SCREENSHOTS = os.getenv("DEBUG_SCREENSHOTS", "false").lower() == "true"
SCREENSHOT_DIR = Path("/tmp/debug_screenshots")

async def _screenshot(page: Page, name: str) -> None:
    """Save a screenshot if DEBUG_SCREENSHOTS is enabled."""
    if not DEBUG_SCREENSHOTS:
        return
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = SCREENSHOT_DIR / f"{name}.png"
    await page.screenshot(path=str(path), full_page=False)
    logger.info(f"[DEBUG] Screenshot saved: {path}")


# ─── Data model ──────────────────────────────────────────────────────────────

@dataclass
class HoursEntry:
    date: str        # ISO format: "YYYY-MM-DD"
    start_time: str
    end_time: str
    hours: float
    template_name: str = ""   # e.g. "Autorización de horas extras TV Universal"
    tasks_desc: str = ""      # e.g. "Opero sonido para PGM Nuestro Tiempo"
    habitual_schedule: str = ""  # e.g. "No aplica"

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
    try:
        async with page.expect_navigation(wait_until="networkidle", timeout=15000):
            await page.click('#button_sing_in')
    except Exception as e:
        logger.warning(f"No clear navigation after login click (might be normal): {e}")
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(2)

    # Navegar directamente a la lista de comunicaciones (bypass home.htm)
    target_url = creds.url.replace("login.htm", "employeeCommunicationsList.htm")
    await page.goto(target_url, wait_until="networkidle")
    logger.info("Login successful, navigated to communications list.")


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
    try:
        await page.wait_for_selector("a.new-communication", timeout=15000)
        logger.info("Communications list loaded.")
    except Exception as e:
        logger.error(f"Timeout waiting for a.new-communication. Current URL: {page.url}")
        try:
            # Guardar screenshot forzoso en la carpeta del proyecto para analizar qué cargó la página
            screenshot_path = os.path.join(os.getcwd(), "error_timeout.png")
            await page.screenshot(path=screenshot_path, full_page=True)
            logger.error(f"Screenshot guardado en: {screenshot_path}")
        except Exception as screenshot_exc:
            logger.error(f"No se pudo guardar la captura de pantalla: {screenshot_exc}")
        raise e


async def submit_entry(
    page: Page, 
    entry: HoursEntry, 
    password: str = ""
) -> SubmitResult:
    """
    Fill and submit a single overtime hours entry through the modal workflow.
    template_name, tasks_desc and habitual_schedule are read from the entry object.
    """
    try:
        logger.info(f"Submitting entry: {entry.date} — {entry.hours}h")

        # 1. Hacer click en "Enviar" para abrir modal
        await page.click("a.new-communication")
        
        # Esperar a que el modal esté completamente visible (animación terminada)
        await page.wait_for_selector("#communicationModalModal", state="visible", timeout=10000)
        await asyncio.sleep(0.8)
        await _screenshot(page, f"{entry.date}_1_modal_open")

        # 2. Seleccionar el template
        # Hay dos <select name="model"> en el modal:
        #   - .model-choice-plantilla (display:none) → ignorar
        #   - .model-choice (visible) → el correcto
        # El select2-drop se renderiza en el <body>, fuera del modal.
        # Usamos jQuery para definir el valor y disparar change (API oficial de select2).
        select_el = page.locator(".model-choice select[name='model']")
        await select_el.wait_for(state="attached", timeout=8000)
        await _screenshot(page, f"{entry.date}_2_select_visible")
        
        selected = await page.evaluate(f"""
            (function() {{
                var sel = document.querySelector(".model-choice select[name='model']");
                if (!sel) return 'ERROR: select not found';
                var opts = Array.from(sel.options);
                var target = opts.find(o => o.text.trim() === {repr(entry.template_name)});
                if (!target) {{
                    // fallback: partial match
                    target = opts.find(o => o.text.trim().includes({repr(entry.template_name.split(' ')[0])}));
                }}
                if (!target) return 'ERROR: option not found. Available: ' + opts.map(o=>o.text.trim()).filter(t=>t).join(' | ');
                // Forma oficial para actualizar select2 programáticamente
                $(sel).val(target.value).trigger('change');
                return 'OK: ' + target.text.trim() + ' (value=' + target.value + ')';
            }})()
        """)
        logger.info(f"  Template selection: {selected}")
        if "ERROR" in str(selected):
            raise Exception(f"No se pudo seleccionar la plantilla: {selected}")
        
        await asyncio.sleep(0.6)
        await _screenshot(page, f"{entry.date}_3_template_selected")
        
        # 3. Esperar a que el HTML dinámico renderice los campos
        await page.wait_for_selector("input[data-name='CANTIDAD_HORAS']", timeout=12000)
        await asyncio.sleep(0.3)
        await _screenshot(page, f"{entry.date}_4_fields_loaded")

        # 4. Llenar los campos usando data-name (selectores estables del HTML real)
        
        # CANTIDAD_HORAS → número de horas (ej: 5, 9)
        hours_str = str(int(entry.hours)) if entry.hours == int(entry.hours) else str(entry.hours)
        await page.fill("input[data-name='CANTIDAD_HORAS']", hours_str)
        
        # horario1 → hora de inicio, solo número (ej: "07:00" → "7")
        start_hour = str(int(entry.start_time.split(":")[0]))
        await page.fill("input[data-name='horario1']", start_hour)
        
        # horario2 → hora de fin, solo número (ej: "18:00" → "18")
        end_hour = str(int(entry.end_time.split(":")[0]))
        await page.fill("input[data-name='horario2']", end_hour)
        
        # fecha → datepicker (readonly, usar JS para setear el valor)
        date_val = entry.formatted_date()
        await page.evaluate(f"""
            var inp = document.querySelector("input[data-name='fecha']");
            if (inp) {{
                inp.removeAttribute('readonly');
                inp.value = '{date_val}';
                inp.dispatchEvent(new Event('change', {{bubbles: true}}));
                inp.dispatchEvent(new Event('input', {{bubbles: true}}));
            }}
        """)
        
        # tareas → descripción de tareas
        await page.fill("input[data-name='tareas']", entry.tasks_desc)
        
        # horario → horario laboral habitual
        await page.fill("input[data-name='horario']", entry.habitual_schedule)
        
        # fuera_domicilio y noche_fuera ya tienen "NO" por defecto → no tocar
        await _screenshot(page, f"{entry.date}_5_fields_filled")

        # 5. Enviar el formulario (abre el diálogo de firma con contraseña)
        await page.click("button.sign-send")
        
        # 6. Manejar el prompt de contraseña que aparece al firmar
        #    TuLegajo pide reautenticación antes de confirmar el envío
        try:
            sign_pass_input = page.locator("input[type='password']").last
            await sign_pass_input.wait_for(state="visible", timeout=5000)
            await sign_pass_input.fill(password)
            # Buscar el botón de confirmar firma (puede ser "Aceptar", "Confirmar", "Firmar", etc.)
            confirm_btn = page.locator("button:has-text('Aceptar'), button:has-text('Confirmar'), button:has-text('Firmar'), button[type='submit']").last
            await confirm_btn.wait_for(state="visible", timeout=4000)
            await confirm_btn.click()
            logger.info("  ✓ Firma confirmada con contraseña.")
        except Exception as sign_exc:
            logger.warning(f"  No se encontró prompt de contraseña (puede ser normal): {sign_exc}")

        # 7. Esperar a que el modal se cierre o haya un mensaje de éxito
        await page.wait_for_selector("#communicationModalModal", state="hidden", timeout=20000)

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
    job_log: list[dict[str, Any]],
    username: str = "",
) -> bool:
    """
    Run a full Playwright session: login → navigate → submit all entries.
    Each HoursEntry carries its own template_name, tasks_desc and habitual_schedule.

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
                result = await submit_entry(
                    page, entry,
                    password=creds.password  # ← pass password for signing step
                )
                status = "success" if result.success else "error"
                job_log.append({"type": status, "msg": result.message})
                if result.success:
                    try:
                        from database import add_entry
                        add_entry(username, entry.date, entry.hours, entry.template_name, entry.tasks_desc, entry.habitual_schedule)
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

