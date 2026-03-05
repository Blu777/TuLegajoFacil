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
    <td class="row-num">${rowCounter}</td>
    <td>
      <input type="date" value="${todayISO}" max="2099-12-31"
             id="date-${rowCounter}" aria-label="Fecha entrada ${rowCounter}" />
    </td>
    <td>
      <input type="number" value="8" min="0.5" max="24" step="0.5"
             style="width:80px" id="hours-${rowCounter}"
             aria-label="Horas entrada ${rowCounter}" />
    </td>
    <td class="col-actions">
      <button class="btn-del" title="Eliminar fila" aria-label="Eliminar entrada ${rowCounter}" onclick="removeRow(this)">✕</button>
    </td>`;

  // Listen to changes for live summary update
  tr.querySelectorAll("input").forEach(inp => inp.addEventListener("input", updateSummary));

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
    const hoursVal = tr.querySelector("input[type=number]")?.value;
    if (!dateVal) {
      showToast("⚠ Hay una fila sin fecha.", "warning");
      return null;
    }
    const hours = parseFloat(hoursVal);
    if (isNaN(hours) || hours < 0.5 || hours > 24) {
      showToast(`⚠ Horas inválidas en la fila con fecha ${dateVal}.`, "warning");
      return null;
    }
    entries.push({ date: dateVal, hours });
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
