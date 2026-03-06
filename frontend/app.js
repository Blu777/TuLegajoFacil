/**
 * app.js — Legajo Hours Automator frontend logic
 *
 * Responsibilities:
 *  - Dynamic entry rows (add / remove / clear)
 *  - Summary calculation (count + total hours)
 *  - Credential section management + env-var detection
 *  - Test-login flow
 *  - Submit flow with async job polling
 *  - Live log rendering
 *  - Toast notifications
 */

"use strict";

// ─── DOM refs ────────────────────────────────────────────────────────────────
const entriesBody   = document.getElementById("entries-body");
const emptyState    = document.getElementById("empty-state");
const btnAddRow     = document.getElementById("btn-add-row");
const btnClearAll   = document.getElementById("btn-clear-all");
const btnSubmit     = document.getElementById("btn-submit");
const btnTestLogin  = document.getElementById("btn-test-login");
const btnTogglePass = document.getElementById("btn-toggle-pass");
const btnDismissLog = document.getElementById("btn-dismiss-log");
const inputUser     = document.getElementById("input-user");
const inputPass     = document.getElementById("input-pass");
const eyeOpen       = document.getElementById("eye-open");
const eyeClosed     = document.getElementById("eye-closed");
const summaryCount  = document.getElementById("summary-count");
const summaryHours  = document.getElementById("summary-hours");
const statusBadge   = document.getElementById("status-badge");
const statusText    = document.getElementById("status-text");
const submitLabel   = document.getElementById("submit-label");
const submitSpinner = document.getElementById("submit-spinner");
const logCard       = document.getElementById("log-card");
const logOutput     = document.getElementById("log-output");
const envNotice     = document.getElementById("env-notice");
const credsFields   = document.getElementById("creds-fields");

// Settings
const inputTemplate = document.getElementById("input-template");
const inputTasks    = document.getElementById("input-tasks");
const inputSchedule = document.getElementById("input-schedule");

// History / Tabs
const tabSubmit = document.getElementById("tab-submit");
const tabHistory = document.getElementById("tab-history");
const viewSubmit = document.getElementById("view-submit");
const viewHistory = document.getElementById("view-history");
const periodSelect = document.getElementById("period-select");
const historyList = document.getElementById("history-list");
const historyTotalHours = document.getElementById("history-total-hours");
const historyTable = document.getElementById("history-table");
const historyEmpty = document.getElementById("history-empty");

// Toast container (injected once)
const toastContainer = document.createElement("div");
toastContainer.id = "toast-container";
document.body.appendChild(toastContainer);

// JWT Login Overlay
const loginOverlay    = document.getElementById("login-overlay");
const mainAppContainer= document.getElementById("main-app-container");
const btnAppLogin     = document.getElementById("btn-app-login");
const inputAppUser    = document.getElementById("app-user");
const inputAppPass    = document.getElementById("app-pass");
const btnLogout       = document.getElementById("btn-logout");

// ─── State ───────────────────────────────────────────────────────────────────
let rowCounter  = 0;
let pollingId   = null;
let isRunning   = false;
let envCredsLoaded = false;

// ─── Init ────────────────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    const res = await fetch("/api/auth/check");
    if (res.ok) {
        loginOverlay.style.display = "none";
        mainAppContainer.style.display = "block";
        // Check if server has env-var credentials (optional, fallback to health)
        fetch("/api/health").then(r => r.json()).then(data => {
            if (data.env_creds) {
                envNotice.style.display  = "flex";
                credsFields.style.display = "none";
                envCredsLoaded = true;
            }
        }).catch(()=>{});
        return true;
    } else {
        loginOverlay.style.display = "flex";
        mainAppContainer.style.display = "none";
        return false;
    }
  } catch (err) {
    console.error("Auth check failed", err);
    loginOverlay.style.display = "flex";
    return false;
  }
}

(async function init() {
  // Intentar auto-login silencioso (solo funciona si APP_AUTO_LOGIN=true en el servidor)
  try {
    await fetch("/api/auth/auto-login");
  } catch(_) {}

  const isAuth = await checkAuth();
  if (isAuth) {
    // Add one default row to get the user started
    addRow();
    updateSummary();
  }
})();

// ─── App Login Flow ──────────────────────────────────────────────────────────
btnAppLogin.addEventListener("click", async () => {
  const username = inputAppUser.value.trim();
  const password = inputAppPass.value;
  if(!username || !password) {
      showToast("Ingresá tus credenciales", "warning");
      return;
  }
  
  btnAppLogin.disabled = true;
  btnAppLogin.textContent = "Verificando...";
  
  try {
      const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({username, password})
      });
      
      const data = await res.json();
      if(res.ok) {
          showToast("¡Bienvenido!", "success");
          inputAppPass.value = "";
          await checkAuth();
          if (entriesBody.querySelectorAll("tr").length === 0) {
              addRow();
              updateSummary();
          }
      } else {
          showToast(`Error: ${data.detail || 'Denegado'}`, "error");
      }
  } catch(err) {
      showToast("Error de conexión", "error");
  } finally {
      btnAppLogin.disabled = false;
      btnAppLogin.textContent = "Iniciar Sesión";
  }
});

// Enter en cualquier campo del login overlay dispara el login
[inputAppUser, inputAppPass].forEach(el => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnAppLogin.click();
  });
});

btnLogout.addEventListener("click", async () => {
    try {
        await fetch("/api/auth/logout", { method: "POST" });
        loginOverlay.style.display = "flex";
        mainAppContainer.style.display = "none";
        showToast("Sesión cerrada", "info");
    } catch(err) {
        console.error("Error logging out", err);
    }
});

// ─── Row management ──────────────────────────────────────────────────────────
function addRow() {
  rowCounter++;
  const tr = document.createElement("tr");
  tr.dataset.id = rowCounter;

  // Default date = today in local time
  const today = new Date();
  const yyyy  = today.getFullYear();
  const mm    = String(today.getMonth() + 1).padStart(2, "0");
  const dd    = String(today.getDate()).padStart(2, "0");
  const todayISO = `${yyyy}-${mm}-${dd}`;

  tr.innerHTML = `
    <td class="row-num text-[0.78rem] md:text-[0.72rem] font-medium text-textMuted text-center md:text-left">${rowCounter}</td>
    <td class="p-1 md:p-2">
      <input type="date" value="${todayISO}" max="2099-12-31"
             id="date-${rowCounter}" aria-label="Fecha entrada ${rowCounter}" 
             class="bg-white/5 border border-borderColor rounded-md text-textPrimary font-sans text-[0.82rem] px-2 py-1 outline-none transition-all duration-200 focus:border-borderFocus focus:bg-accent/5 focus:ring-[2px] focus:ring-accentGlow w-[105px] md:w-full"
             style="color-scheme: dark;" />
    </td>
    <td class="p-1 md:p-2">
      <input type="time" value="09:00" id="start-${rowCounter}" aria-label="Inicio ${rowCounter}" 
             class="bg-white/5 border border-borderColor rounded-md text-textPrimary font-sans text-[0.82rem] px-2 py-1 outline-none transition-all duration-200 focus:border-borderFocus focus:bg-accent/5 focus:ring-[2px] focus:ring-accentGlow w-[85px] md:w-full"
             style="color-scheme: dark;" />
    </td>
    <td class="p-1 md:p-2">
      <input type="time" value="18:00" id="end-${rowCounter}" aria-label="Fin ${rowCounter}" 
             class="bg-white/5 border border-borderColor rounded-md text-textPrimary font-sans text-[0.82rem] px-2 py-1 outline-none transition-all duration-200 focus:border-borderFocus focus:bg-accent/5 focus:ring-[2px] focus:ring-accentGlow w-[85px] md:w-full"
             style="color-scheme: dark;" />
    </td>
    <td class="p-1 md:p-2">
      <input type="number" value="9" min="0.5" max="24" step="0.5"
             id="hours-${rowCounter}"
             class="bg-white/5 border border-borderColor rounded-md text-textPrimary font-sans text-[0.82rem] px-2 py-1 outline-none transition-all duration-200 focus:border-borderFocus focus:bg-accent/5 focus:ring-[2px] focus:ring-accentGlow w-[60px] md:w-full opacity-80 cursor-default"
             aria-label="Horas entrada ${rowCounter}" readonly tabindex="-1" style="color-scheme: dark;" />
    </td>
    <td class="col-actions text-center border-none p-1 md:p-2">
      <button class="bg-transparent border-none cursor-pointer text-textMuted text-[1.1rem] rounded-md px-2 py-1.5 transition-colors duration-200 hover:text-error hover:bg-error/10" title="Eliminar fila" aria-label="Eliminar entrada ${rowCounter}" onclick="removeRow(this)">✕</button>
    </td>`;

  const calcHours = () => {
    const s = tr.querySelector(`input[id^="start-"]`).value;
    const e = tr.querySelector(`input[id^="end-"]`).value;
    let diff = 0;
    if (s && e) {
      const d1 = new Date(`2000-01-01T${s}`);
      const d2 = new Date(`2000-01-01T${e}`);
      diff = (d2 - d1) / 3600000;
      if (diff < 0) diff += 24;
      tr.querySelector(`input[id^="hours-"]`).value = parseFloat(diff.toFixed(1));
    }
    
    // Evaluate Sunday Shift Condition → auto-selects Feriados TV template
    const dVal = tr.querySelector(`input[id^="date-"]`).value;
    if (dVal && s === "07:00" && e === "12:00" && diff === 5) {
      const [yy, mm, dd] = dVal.split('-');
      const dateObj = new Date(yy, mm - 1, dd);
      if (dateObj.getDay() === 0) {
        document.getElementById("input-template").value = "Autorización de horas extras TV Universal";
        document.getElementById("input-tasks").value = "Opero sonido para PGM Nuestro Tiempo y Reunion Univer";
        document.getElementById("input-schedule").value = "No aplica";
      }
    }

    updateSummary();
  };

  // Listen to changes for live summary update
  tr.querySelectorAll("input").forEach(inp => {
    if (inp.type === "time" || inp.type === "date") inp.addEventListener("input", calcHours);
    else inp.addEventListener("input", updateSummary);
  });

  entriesBody.appendChild(tr);
  updateUI();
}

window.removeRow = function(btn) {
  btn.closest("tr").remove();
  renumberRows();
  updateSummary();
  updateUI();
};

function clearAll() {
  entriesBody.innerHTML = "";
  rowCounter = 0;
  updateSummary();
  updateUI();
}

function renumberRows() {
  entriesBody.querySelectorAll("tr").forEach((tr, i) => {
    tr.querySelector(".row-num").textContent = i + 1;
  });
}

function updateUI() {
  const count = entriesBody.querySelectorAll("tr").length;
  const hasRows = count > 0;

  emptyState.classList.toggle("visible", !hasRows);
  btnClearAll.style.display = hasRows ? "inline-flex" : "none";
  btnSubmit.disabled = !hasRows || isRunning;
  if (btnPreview) btnPreview.disabled = !hasRows || isRunning;
}

function updateSummary() {
  const rows  = entriesBody.querySelectorAll("tr");
  const total = Array.from(rows).reduce((sum, tr) => {
    const v = parseFloat(tr.querySelector("input[type=number]")?.value || 0);
    return sum + (isNaN(v) ? 0 : v);
  }, 0);
  summaryCount.textContent = rows.length;
  summaryHours.textContent = `${total.toFixed(1)} h`;
}

// ─── Credentials ─────────────────────────────────────────────────────────────
btnTogglePass.addEventListener("click", () => {
  const isHidden = inputPass.type === "password";
  inputPass.type  = isHidden ? "text" : "password";
  eyeOpen.style.display   = isHidden ? "none" : "";
  eyeClosed.style.display = isHidden ? "" : "none";
});

function getCredentials() {
  return {
    username: inputUser.value.trim(),
    password: inputPass.value,
  };
}

// ─── Test login ───────────────────────────────────────────────────────────────
btnTestLogin.addEventListener("click", async () => {
  btnTestLogin.disabled = true;
  btnTestLogin.textContent = "🔄 Probando...";
  try {
    const res  = await fetch("/api/test-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...getCredentials(), entries: [{ date: "2026-01-01", hours: 1 }] }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast("✅ " + data.message, "success");
    } else {
      showToast("❌ " + (data.detail || "Login fallido"), "error");
    }
  } catch (err) {
    showToast("❌ Error de conexión: " + err.message, "error");
  } finally {
    btnTestLogin.disabled = false;
    btnTestLogin.innerHTML = '<span class="btn-icon-left">🔗</span> Probar conexión';
  }
});

// ─── Submit flow ─────────────────────────────────────────────────────────────
btnSubmit.addEventListener("click", async () => {
  if (isRunning) return;

  const entries = collectEntries();
  if (!entries) return; // validation failed, toast already shown

  if (!envCredsLoaded && (!inputUser.value.trim() || !inputPass.value)) {
    showToast("⚠ Ingresá usuario y contraseña primero.", "warning");
    return;
  }

  setRunning(true);
  openLogCard();
  logOutput.innerHTML = "";
  appendLog("info", "⏳ Enviando solicitud al servidor...");

  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        ...getCredentials(), 
        entries,
        template_name: inputTemplate.value,
        tasks_desc: inputTasks.value.trim(),
        habitual_schedule: inputSchedule.value.trim()
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      appendLog("error", "❌ Error: " + (data.detail || "Error al iniciar job."));
      setRunning(false);
      setBadge("error", "Error");
      return;
    }

    appendLog("success", `✅ Job iniciado. ID: ${data.job_id}`);
    setBadge("running", "Ejecutando...");
    pollStatus(data.job_id);

  } catch (err) {
    appendLog("error", "❌ Error de red: " + err.message);
    setRunning(false);
    setBadge("error", "Error");
  }
});

function collectEntries() {
  const rows = entriesBody.querySelectorAll("tr");
  const entries = [];
  for (const tr of rows) {
    const dateVal  = tr.querySelector("input[type=date]")?.value;
    const startVal = tr.querySelector(`input[id^="start-"]`)?.value;
    const endVal   = tr.querySelector(`input[id^="end-"]`)?.value;
    const hoursVal = tr.querySelector(`input[type="number"][id^="hours-"]`)?.value;
    
    if (!dateVal || !startVal || !endVal) {
      showToast("⚠ Hay campos incompletos en una fila.", "warning");
      return null;
    }
    const hours = parseFloat(hoursVal);
    if (isNaN(hours) || hours < 0.5 || hours > 24) {
      showToast(`⚠ Horas inválidas en la fila con fecha ${dateVal}.`, "warning");
      return null;
    }
    entries.push({ date: dateVal, start_time: startVal, end_time: endVal, hours });
  }
  return entries;
}

// ─── Polling ─────────────────────────────────────────────────────────────────
let lastLogLength = 0;
let pollErrorCount = 0;

function pollStatus(jobId) {
  lastLogLength = 0;
  pollErrorCount = 0;
  
  pollingId = setInterval(async () => {
    try {
      const res  = await fetch(`/api/status/${jobId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Reset errors on success
      pollErrorCount = 0;

      // Render new log lines
      const newLines = data.log.slice(lastLogLength);
      newLines.forEach(entry => appendLog(entry.type, entry.msg));
      lastLogLength = data.log.length;

      if (data.status !== "running") {
        clearInterval(pollingId);
        setRunning(false);
        if (data.status === "done") {
          setBadge("done", "Completado");
          showToast("✅ Proceso completado.", "success");
        } else {
          setBadge("error", "Error");
          showToast("❌ El proceso terminó con errores.", "error");
        }
      }
    } catch (err) {
      pollErrorCount++;
      console.warn(`Polling network error (${pollErrorCount}/5):`, err);
      
      if (pollErrorCount >= 5) {
          clearInterval(pollingId);
          appendLog("error", "❌ Conexión perdida repetidamente. El proceso puede seguir corriendo en el servidor.");
          showToast("Conexión perdida con el servidor", "error");
          setRunning(false);
          setBadge("error", "Desconectado");
      }
    }
  }, 1500);
}

// ─── Log helpers ─────────────────────────────────────────────────────────────
function appendLog(type, msg) {
  const now = new Date().toLocaleTimeString("es-AR", { hour12: false });
  const div = document.createElement("div");
  div.className = `log-line ${type}`;
  div.innerHTML = `<span class="log-ts">${now}</span><span class="log-msg">${escapeHtml(msg)}</span>`;
  logOutput.appendChild(div);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function openLogCard() {
  logCard.style.display = "block";
  logCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

btnDismissLog.addEventListener("click", () => {
  logCard.style.display = "none";
  setBadge("idle", "Listo");
});

// ─── Status badge ─────────────────────────────────────────────────────────────
function setBadge(mode, label) {
  statusBadge.className = `status-badge badge-${mode}`;
  statusText.textContent = label;
}

// ─── Running state ────────────────────────────────────────────────────────────
function setRunning(running) {
  isRunning = running;
  btnSubmit.disabled = running;
  submitSpinner.style.display = running ? "inline-block" : "none";
  submitLabel.textContent = running ? "Enviando..." : "⚡ Enviar todo al Legajo";
  btnTestLogin.disabled = running;
  if (!running) updateUI();
}

// ─── Toasts ──────────────────────────────────────────────────────────────────
function showToast(msg, type = "info", duration = 4000) {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "toast-out 0.3s ease forwards";
    toast.addEventListener("animationend", () => toast.remove());
  }, duration);
}

// ─── Utils ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ─── Event listeners ─────────────────────────────────────────────────────────
btnAddRow.addEventListener("click", () => { addRow(); updateSummary(); });
btnClearAll.addEventListener("click", () => {
  if (confirm("¿Borrar todos los registros?")) clearAll();
});

// ─── TABS AND HISTORY LOGIC ──────────────────────────────────────────────────
tabSubmit.addEventListener("click", () => {
    tabSubmit.classList.add("active");
    tabHistory.classList.remove("active");
    viewSubmit.style.display = "grid"; 
    viewHistory.style.display = "none";
});

tabHistory.addEventListener("click", () => {
    tabHistory.classList.add("active");
    tabSubmit.classList.remove("active");
    viewSubmit.style.display = "none";
    viewHistory.style.display = "block";
    loadPeriods();
});

async function loadPeriods() {
    try {
        periodSelect.innerHTML = '<option value="">Cargando...</option>';
        
        const res = await fetch("/api/periods");
        if(res.status === 401) { showToast("Acceso denegado (Auth)", "error"); return; }
        const periods = await res.json();
        
        periodSelect.innerHTML = '<option value="">Selecciona un periodo</option>';
        if(periods.length === 0) {
            periodSelect.innerHTML = '<option value="">Aún no hay historial de envíos</option>';
            return;
        }
        periods.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = `${p.label} (${p.total_hours} hs)`;
            opt.dataset.total = p.total_hours;
            periodSelect.appendChild(opt);
        });
    } catch(err) {
        showToast("Error cargando periodos", "error");
        console.error(err);
    }
}

periodSelect.addEventListener("change", async (e) => {
    const periodId = e.target.value;
    if(!periodId) {
        historyTable.style.display = "none";
        historyEmpty.style.display = "block";
        historyTotalHours.textContent = "0";
        return;
    }
    const selectedOpt = periodSelect.options[periodSelect.selectedIndex];
    historyTotalHours.textContent = selectedOpt.dataset.total;
    
    try {
        historyList.innerHTML = "<tr><td colspan='4' style='text-align:center;'>Cargando...</td></tr>";
        historyTable.style.display = "table";
        historyEmpty.style.display = "none";
        
        const res = await fetch(`/api/history/${periodId}`);
        const entries = await res.json();
        
        if(entries.length === 0) {
            historyTable.style.display = "none";
            historyEmpty.style.display = "block";
            return;
        }
        
        historyList.innerHTML = entries.map(e => `
            <tr>
              <td><strong>${e.work_date}</strong></td>
              <td>${e.hours} h</td>
              <td>
                <div style="font-size:0.85rem; font-weight: 500">${e.template}</div>
                <div style="font-size:0.75rem; color: var(--text-muted)">${e.tasks} • ${e.schedule}</div>
              </td>
              <td style="font-size:0.8rem; color:var(--text-muted)">${new Date(e.submitted_at).toLocaleString('es-AR', {dateStyle: 'short', timeStyle: 'short'})}</td>
            </tr>
        `).join('');
    } catch(err) {
        showToast("Error cargando detalle", "error");
        console.error(err);
    }
});

// ─── PREVIEW MODAL ────────────────────────────────────────────────────────────
const btnPreview     = document.getElementById("btn-preview");
const previewOverlay = document.getElementById("preview-overlay");

btnPreview.addEventListener("click", openPreview);

function openPreview() {
  // ── Asunto = template name (selected option text)
  const templateSel = document.getElementById("input-template");
  const templateVal = templateSel.value;
  document.getElementById("pv-asunto").textContent = templateVal;

  // ── Nombre: use username field or env-creds label
  const nombreEl = document.getElementById("pv-nombre");
  const userVal  = (document.getElementById("input-user")?.value || "").trim();
  nombreEl.textContent = userVal || "— (credenciales desde entorno) —";

  // ── Tareas y Horario
  document.getElementById("pv-tasks").textContent    = document.getElementById("input-tasks").value.trim()    || "—";
  document.getElementById("pv-schedule").textContent = document.getElementById("input-schedule").value.trim() || "—";

  // ── Entry rows
  const container = document.getElementById("pv-entries-container");
  container.innerHTML = "";

  const rows = entriesBody.querySelectorAll("tr");
  if (rows.length === 0) {
    container.innerHTML = "<p style='color:#999; font-size:13px;'>Sin registros cargados.</p>";
  } else {
    rows.forEach((tr, idx) => {
      const dateVal  = tr.querySelector("input[type=date]")?.value  || "";
      const startRaw = tr.querySelector(`input[id^="start-"]`)?.value || "";
      const endRaw   = tr.querySelector(`input[id^="end-"]`)?.value   || "";
      // Solo el número de hora, sin minutos (igual que envía el bot: "07:00" → "7")
      const startVal = startRaw ? String(parseInt(startRaw.split(":")[0], 10)) : "";
      const endVal   = endRaw   ? String(parseInt(endRaw.split(":")[0],   10)) : "";
      const hoursVal = parseFloat(tr.querySelector(`input[type="number"]`)?.value || "0") || "";

      // Format date as DD/MM/YYYY
      let dateFormatted = dateVal;
      if (dateVal) {
        const [yy, mm, dd] = dateVal.split("-");
        dateFormatted = `${dd}/${mm}/${yy}`;
      }

      const block = document.createElement("div");
      block.style.cssText = "border:1px solid #e0e0e0; border-radius:5px; padding:12px 14px; margin-bottom:10px; background:#fafafa;";
      block.innerHTML = `
        <div style="font-size:11px; font-weight:700; color:#4a7c59; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Entrada ${idx + 1}</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div>
            <div style="font-size:11px; color:#c0392b; margin-bottom:3px;">Cantidad de horas extras:</div>
            <div style="border:1px solid #ccc; border-radius:3px; padding:5px 9px; font-size:13px; background:#fff; display:inline-block; min-width:50px;">${hoursVal}</div>
          </div>
          <div>
            <div style="font-size:11px; color:#c0392b; margin-bottom:3px;">el día:</div>
            <div style="border:1px solid #ccc; border-radius:3px; padding:5px 9px; font-size:13px; background:#fff; display:inline-block;">${dateFormatted}</div>
          </div>
          <div>
            <div style="font-size:11px; color:#c0392b; margin-bottom:3px;">Comprendidas entre las:</div>
            <div style="border:1px solid #ccc; border-radius:3px; padding:5px 9px; font-size:13px; background:#fff; display:inline-block;">${startVal}</div>
          </div>
          <div>
            <div style="font-size:11px; color:#c0392b; margin-bottom:3px;">y las:</div>
            <div style="border:1px solid #ccc; border-radius:3px; padding:5px 9px; font-size:13px; background:#fff; display:inline-block;">${endVal}</div>
          </div>
        </div>`;
      container.appendChild(block);
    });
  }

  // Show modal
  previewOverlay.style.display = "flex";
  document.body.style.overflow = "hidden";
}

window.closePreview = function() {
  previewOverlay.style.display = "none";
  document.body.style.overflow = "";
};

// Close on outside click
previewOverlay.addEventListener("click", (e) => {
  if (e.target === previewOverlay) closePreview();
});

// Close on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && previewOverlay.style.display === "flex") closePreview();
});

