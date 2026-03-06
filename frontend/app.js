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
const entriesListContainer= document.getElementById("entries-list-container");
const emptyState    = document.getElementById("empty-state");
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
const summary50     = document.getElementById("summary-50");
const summary100    = document.getElementById("summary-100");
const statusBadge   = document.getElementById("status-badge");
const statusText    = document.getElementById("status-text");
const submitLabel   = document.getElementById("submit-label");
const submitSpinner = document.getElementById("submit-spinner");
const logCard       = document.getElementById("log-card");
const logOutput     = document.getElementById("log-output");
const envNotice     = document.getElementById("env-notice");
const credsFields   = document.getElementById("creds-fields");

// Form Settings
const btnAddEntry    = document.getElementById("btn-add-entry");
const entryDate      = document.getElementById("entry-date");
const entryStart     = document.getElementById("entry-start");
const entryEnd       = document.getElementById("entry-end");
const entryHoursLbl  = document.getElementById("entry-hours");
const entryBadge50   = document.getElementById("entry-badge-50");
const entryBadge100  = document.getElementById("entry-badge-100");
const entryTemplate  = document.getElementById("entry-template");
const entryTasks     = document.getElementById("entry-tasks");
const entrySchedule  = document.getElementById("entry-schedule");

// Feriado Fields
const groupStandardTime    = document.getElementById("group-standard-time");
const groupStandardDetails = document.getElementById("group-standard-details");
const groupFeriadoFields   = document.getElementById("group-feriado-fields");
const entrySector          = document.getElementById("entry-sector");
const entryLocation        = document.getElementById("entry-location");
const entryFeriadoHours    = document.getElementById("entry-feriado-hours");
const entryReason          = document.getElementById("entry-reason");

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
let entriesList = [];
let entryIdCounter = 0;
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

  // Set default date for form
  const today = new Date();
  const yyyy  = today.getFullYear();
  const mm    = String(today.getMonth() + 1).padStart(2, "0");
  const dd    = String(today.getDate()).padStart(2, "0");
  if(entryDate) entryDate.value = `${yyyy}-${mm}-${dd}`;

  // Evaluate initial hours
  calcFormHours();
  
  const isAuth = await checkAuth();
  if (isAuth) {
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
          if (entriesList.length === 0) {
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

// ─── Entry Form & List management ───────────────────────────────────────────

function calculateCategoryHours(dateStr, startStr, endStr, templateName) {
  if (!dateStr || !startStr || !endStr) return { h50: 0, h100: 0, total: 0 };
  
  // 1. Forzar fecha local (evita que el Lunes se vuelva Domingo)
  const partesFecha = dateStr.split('-'); // ["2026", "03", "09"]
  const fechaLocal = new Date(partesFecha[0], partesFecha[1] - 1, partesFecha[2]);
  const diaSemana = fechaLocal.getDay(); // 0=Dom, 1=Lun ... 6=Sáb

  // 2. Convertir "09:00" a número decimal (9.0) para poder calcular
  const convertirADecimal = (horaStr) => {
      if (!horaStr) return 0;
      const [horas, minutos] = horaStr.split(':').map(Number);
      return horas + (minutos / 60);
  };

  const inicio = convertirADecimal(startStr);
  const fin = convertirADecimal(endStr);
  
  // Calcular total de horas del turno (soporta cruce de medianoche)
  let totalHoras = fin - inicio;
  if (totalHoras < 0) totalHoras += 24;

  let horas50 = 0;
  let horas100 = 0;

  // Detectar si seleccionaste un Feriado en el desplegable
  const esFeriado = templateName && templateName.toLowerCase().includes("feriado");

  // 3. Motor de Reglas (Ley Argentina)
  if (esFeriado || diaSemana === 0) {
      // Feriados y Domingos: Todo al 100%
      horas100 = totalHoras;
  } 
  else if (diaSemana >= 1 && diaSemana <= 5) {
      // Lunes a Viernes: Todo al 50%
      horas50 = totalHoras;
  } 
  else if (diaSemana === 6) {
      // Sábados: Barrera de las 13:00 hs
      const barrera = 13;

      if (fin <= barrera) {
          // Entró y salió antes de las 13:00 -> Todo 50%
          horas50 = totalHoras;
      } else if (inicio >= barrera) {
          // Entró a las 13:00 o después -> Todo 100%
          horas100 = totalHoras;
      } else {
          // Cruzó la barrera de las 13:00 (ej: 09:00 a 18:00) -> Se divide
          horas50 = barrera - inicio;
          horas100 = fin - barrera;
      }
  }

  return {
      h50: Number(horas50.toFixed(2)),
      h100: Number(horas100.toFixed(2)),
      total: Number(totalHoras.toFixed(2))
  };
}

function calcFormHours() {
  if (!entryDate || !entryHoursLbl) return { h50: 0, h100: 0, total: 0 };
  
  const templateVal = entryTemplate ? entryTemplate.value : "";
  
  if (!templateVal) {
    entryHoursLbl.textContent = "0.0";
    if (entryBadge50) entryBadge50.style.display = "none";
    if (entryBadge100) entryBadge100.style.display = "none";
    return { h50: 0, h100: 0, total: 0 };
  }

  const isFeriado = templateVal.toLowerCase().includes("feriado");
  let cat;
  let s = entryStart ? entryStart.value : "";
  let e = entryEnd ? entryEnd.value : "";
  
  if (isFeriado) {
    const fh = parseFloat(entryFeriadoHours.value) || 0;
    cat = { h50: 0, h100: fh, total: fh };
  } else {
    if (!entryStart || !entryEnd) return { h50: 0, h100: 0, total: 0 };
    cat = calculateCategoryHours(entryDate.value, s, e, templateVal);
  }

  entryHoursLbl.textContent = cat.total.toFixed(1);
  
  if (entryBadge50) {
    if (cat.h50 > 0) {
      entryBadge50.style.display = "inline-block";
      entryBadge50.textContent = `${cat.h50}h (50%)`;
    } else {
      entryBadge50.style.display = "none";
    }
  }
  
  if (entryBadge100) {
    if (cat.h100 > 0) {
      entryBadge100.style.display = "inline-block";
      entryBadge100.textContent = `${cat.h100}h (100%)`;
    } else {
      entryBadge100.style.display = "none";
    }
  }

  // Evaluate Sunday Shift Condition → auto-selects Feriados TV template
  if (!isFeriado && entryDate.value && s === "07:00" && e === "12:00" && cat.total === 5) {
    const [yy, mm, dd] = entryDate.value.split('-');
    const dateObj = new Date(yy, mm - 1, dd);
    if (dateObj.getDay() === 0) {
      if (entryTemplate.value !== "Autorización de horas extras TV Universal") {
         entryTemplate.value = "Autorización de horas extras TV Universal";
         entryTasks.value = "Opero sonido para PGM Nuestro Tiempo y Reunion Univer";
         entrySchedule.value = "No aplica";
         return calcFormHours(); // Re-trigger calculation
      }
    }
  }
  return cat;
}

function handleTemplateChange() {
  const templateVal = entryTemplate.value;
  
  if (!templateVal) {
    groupStandardTime.classList.add("hidden");
    groupStandardTime.classList.remove("grid");
    groupStandardDetails.classList.add("hidden");
    groupStandardDetails.classList.remove("flex");
    groupFeriadoFields.classList.add("hidden");
    groupFeriadoFields.classList.remove("flex");
  } else if (templateVal.toLowerCase().includes("feriado")) {
    groupStandardTime.classList.add("hidden");
    groupStandardTime.classList.remove("grid");
    groupStandardDetails.classList.add("hidden");
    groupStandardDetails.classList.remove("flex");
    groupFeriadoFields.classList.remove("hidden");
    groupFeriadoFields.classList.add("flex");
  } else {
    groupStandardTime.classList.remove("hidden");
    groupStandardTime.classList.add("grid");
    groupStandardDetails.classList.remove("hidden");
    groupStandardDetails.classList.add("flex");
    groupFeriadoFields.classList.add("hidden");
    groupFeriadoFields.classList.remove("flex");
  }
  
  calcFormHours();
}

if(entryStart) entryStart.addEventListener("input", calcFormHours);
if(entryEnd) entryEnd.addEventListener("input", calcFormHours);
if(entryDate) entryDate.addEventListener("input", calcFormHours);
if(entryTemplate) entryTemplate.addEventListener("change", handleTemplateChange);
if(entryFeriadoHours) entryFeriadoHours.addEventListener("input", calcFormHours);

// ─── Quick Presets ────────────────────────────────────────────────────────────
const presetDomingo = document.getElementById("preset-domingo");
if (presetDomingo) {
  presetDomingo.addEventListener("click", () => {
    // 1. Autocomplete all fields with the Sunday shift data
    entryTemplate.value = "Autorización de horas extras TV Universal";
    entryStart.value = "07:00";
    entryEnd.value = "12:00";
    entryTasks.value = "Opero sonido para PGM Nuestro Tiempo y reunión Univer";
    entrySchedule.value = "No aplica";

    // 2. Fire events so the UI (field toggling and live hour calc) reacts
    entryTemplate.dispatchEvent(new Event("change")); // triggers handleTemplateChange → shows standard fields
    entryStart.dispatchEvent(new Event("input"));     // triggers calcFormHours
  });
}

if(btnAddEntry) {
  btnAddEntry.addEventListener("click", () => {
    const dVal = entryDate.value;
    const templateVal = entryTemplate.value;
    const isFeriado = templateVal.toLowerCase().includes("feriado");
    
    let cat;
    let sVal, eVal, tasksDesc, habitualSchedule;
    
    // Validar siempre la fecha y tipo de carga primero
    if (!dVal) {
      alert("⚠ Por favor, completá la fecha de trabajo.");
      return;
    }
    if (!templateVal) {
      alert("⚠ Por favor, selecciona un Tipo de Carga válido antes de agregar a la lista.");
      return;
    }

    if (isFeriado) {
      // Flujo Feriado
      const horasInput = entryFeriadoHours.value;
      const sectorVal = entrySector.value.trim();
      const locationVal = entryLocation.value.trim();
      const reasonVal = entryReason.value.trim();

      if (!horasInput || !sectorVal || !locationVal || !reasonVal) {
        alert("⚠ Completá las Horas a realizar, Sector, Lugar de trabajo y Motivo formales para el feriado.");
        return;
      }
      
      const fh = parseFloat(horasInput) || 0;
      if (fh < 0.5 || fh > 24) {
        alert("⚠ La cantidad de horas ingresada para el feriado es inválida (debe ser entre 0.5 y 24).");
        return;
      }

      // Para Feriado, pasamos todo al 100% de manera estricta ignorando la hora
      cat = { h50: 0, h100: fh, total: fh };
      
      // Valores por defecto para rellenar la estructura de la base de datos
      sVal = "00:00"; 
      eVal = "00:00"; 
      tasksDesc = `Motivo: ${reasonVal}`;
      habitualSchedule = `Sector: ${sectorVal} - Lugar: ${locationVal}`;
      
    } else {
      // Flujo Normal (Lunes a Viernes o Sábado/Domingo normal)
      sVal = entryStart.value;
      eVal = entryEnd.value;
      const tVal = entryTasks.value.trim();
      const hsVal = entrySchedule.value.trim();
      
      if (!sVal || !eVal) {
        alert("⚠ Completá el horario de Inicio y Fin del turno.");
        return;
      }
      if (!tVal || !hsVal) {
        alert("⚠ Completá las Tareas a realizar y el Horario habitual del turno.");
        return;
      }

      // Calcular divisiones mediante la lógica robusta aprobada
      cat = calculateCategoryHours(dVal, sVal, eVal, templateVal);
      
      if (cat.total < 0.5 || cat.total > 24) {
        alert("⚠ Las horas calculadas entre Inicio y Fin son inválidas. Revisa los horarios.");
        return;
      }
      
      tasksDesc = tVal;
      habitualSchedule = hsVal;
    }

    entryIdCounter++;
    const [yy, mm, dd] = dVal.split('-');
    
    entriesList.push({
      _id: entryIdCounter,
      date: dVal,
      dateFormatted: `${dd}/${mm}/${yy}`,
      start_time: sVal,
      end_time: eVal,
      hours: cat.total,
      hours50: cat.h50,
      hours100: cat.h100,
      template_name: templateVal,
      tasks_desc: tasksDesc,
      habitual_schedule: habitualSchedule
    });

    // Reset Form for convenience
    const [ryy, rmm, rdd] = dVal.split('-');
    const nextDay = new Date(ryy, rmm - 1, parseInt(rdd, 10));
    nextDay.setDate(nextDay.getDate() + 1);
    const nyyyy  = nextDay.getFullYear();
    const nmm    = String(nextDay.getMonth() + 1).padStart(2, "0");
    const ndd    = String(nextDay.getDate()).padStart(2, "0");
    entryDate.value = `${nyyyy}-${nmm}-${ndd}`;
    
    // Clear fields
    entryTemplate.value = "";
    handleTemplateChange(); // trigger UI toggle back to normal state if needed

    if (isFeriado) {
      entryFeriadoHours.value = "";
      entrySector.value = "";
      entryLocation.value = "";
      entryReason.value = "";
    } else {
      entryTasks.value = ""; 
    }
    
    showToast("✅ Registro añadido exitosamente.", "success");

    renderEntries();
  });
}

function renderEntries() {
  entriesListContainer.innerHTML = "";
  
  if (entriesList.length === 0) {
    emptyState.style.display = "block";
    entriesListContainer.style.display = "none";
  } else {
    emptyState.style.display = "none";
    entriesListContainer.style.display = "flex";
    
    entriesList.forEach((entry, idx) => {
      // BACKWARD COMPATIBILITY: If an old entry lacks hours50/hours100, calculate and backfill it.
      if (typeof entry.hours50 === 'undefined' || typeof entry.hours100 === 'undefined') {
        const cat = calculateCategoryHours(entry.date, entry.start_time, entry.end_time, entry.template_name);
        entry.hours50 = cat.h50;
        entry.hours100 = cat.h100;
        if (!entry.hours) entry.hours = cat.total;
      }

      const templateBadge = entry.template_name.includes("Unife") ? "bg-[#8b5cf6]/20 text-[#c4b5fd] border-[#8b5cf6]/30" :
                            entry.template_name.includes("Feriados") ? "bg-[#f59e0b]/20 text-[#fcd34d] border-[#f59e0b]/30" :
                            "bg-info/20 text-[#93c5fd] border-info/30";

      const badge50 = entry.hours50 > 0 ? `<span class="text-[0.7rem] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded font-bold ml-1">${entry.hours50}h (50%)</span>` : '';
      const badge100 = entry.hours100 > 0 ? `<span class="text-[0.7rem] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded font-bold ml-1">${entry.hours100}h (100%)</span>` : '';

      const card = document.createElement("div");
      card.className = "bg-white/5 border border-borderColor rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-row-in relative overflow-hidden group";
      card.innerHTML = `
        <div class="flex-1 flex flex-col gap-1.5 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[0.95rem] font-bold text-textPrimary">${entry.dateFormatted}</span>
            <span class="text-[0.75rem] font-medium text-textSecondary bg-black/20 rounded px-1.5 py-0.5">${entry.start_time} - ${entry.end_time}</span>
            <span class="text-[0.7rem] px-2 py-0.5 rounded-full border ${templateBadge} truncate max-w-[150px]" title="${entry.template_name}">${entry.template_name.split(" ").slice(0, 3).join(" ")}...</span>
            ${badge50}
            ${badge100}
          </div>
          <p class="text-[0.8rem] text-textMuted truncate" title="${entry.tasks_desc}">${entry.tasks_desc}</p>
        </div>
        <div class="flex items-center justify-between sm:justify-end gap-4 sm:border-l sm:border-borderColor sm:pl-4">
          <div class="flex flex-col text-right">
            <span class="text-[1.2rem] font-bold text-textPrimary leading-none">${entry.hours}h</span>
          </div>
          <button class="bg-error/10 text-error border border-error/20 hover:bg-error hover:text-white rounded-md p-2 transition-all duration-200 cursor-pointer grid place-items-center" onclick="removeEntry(${entry._id})" title="Eliminar este registro">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
      `;
      entriesListContainer.appendChild(card);
    });
  }
  
  updateSummary();
  updateUI();
}

window.removeEntry = function(id) {
  entriesList = entriesList.filter(e => e._id !== id);
  renderEntries();
};

function clearAll() {
  entriesList = [];
  renderEntries();
}

function updateUI() {
  const hasRows = entriesList.length > 0;
  btnClearAll.style.display = hasRows ? "inline-flex" : "none";
  btnSubmit.disabled = !hasRows || isRunning;
  if (btnPreview) btnPreview.disabled = !hasRows || isRunning;
}

function updateSummary() {
  const total = entriesList.reduce((sum, e) => sum + e.hours, 0);
  const total50 = entriesList.reduce((sum, e) => sum + (e.hours50 || 0), 0);
  const total100 = entriesList.reduce((sum, e) => sum + (e.hours100 || 0), 0);
  
  summaryCount.textContent = entriesList.length;
  summaryHours.textContent = `${total.toFixed(1)} h`;
  
  if (summary50) {
    if (total50 > 0) {
      summary50.style.display = "inline-block";
      summary50.textContent = `${total50.toFixed(1)}h al 50%`;
    } else {
      summary50.style.display = "none";
    }
  }
  
  if (summary100) {
    if (total100 > 0) {
      summary100.style.display = "inline-block";
      summary100.textContent = `${total100.toFixed(1)}h al 100%`;
    } else {
      summary100.style.display = "none";
    }
  }
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
      body: JSON.stringify({ ...getCredentials(), entries: [{ date: "2026-01-01", hours: 1, hours50: 1, hours100: 0 }] }),
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
        entries: entriesList 
        // template_name, tasks_desc and habitual_schedule are now inside each entry object
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
  if (entriesList.length === 0) return null;
  // Deep clone to avoid mutating state during request construction
  return JSON.parse(JSON.stringify(entriesList));
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
btnClearAll.addEventListener("click", () => {
  if (confirm("¿Borrar todos los registros listados?")) clearAll();
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
        
        historyList.innerHTML = entries.map(e => {
            // Verificar si el backend nos devolvió hours50 y hours100.
            // Si el backend aún no está enviando esto para registros viejos, lo estimamos con start_time="09:00"
            let h50 = e.hours50;
            let h100 = e.hours100;
            const totalHoursInt = parseFloat(e.hours);

            if (h50 === undefined || h100 === undefined) {
                // Cálculo de respaldo para historial viejo
                const cat = calculateCategoryHours(e.work_date, "09:00", "18:00", e.template);
                // Ajustamos el resultado para que sume exactamente las e.hours usando un ratio:
                if (cat.total > 0) {
                  const ratio50 = cat.h50 / cat.total;
                  h50 = parseFloat((totalHoursInt * ratio50).toFixed(1));
                  h100 = parseFloat((totalHoursInt - h50).toFixed(1));
                } else {
                  h50 = totalHoursInt;
                  h100 = 0;
                }
            }

            const badge50 = h50 > 0 ? `<div class="mt-1"><span class="text-[0.65rem] bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1.5 py-0.5 rounded font-bold whitespace-nowrap">${h50}h (50%)</span></div>` : '';
            const badge100 = h100 > 0 ? `<div class="mt-1"><span class="text-[0.65rem] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold whitespace-nowrap">${h100}h (100%)</span></div>` : '';

            return `
            <tr>
              <td><strong>${e.work_date}</strong></td>
              <td>
                <div class="font-bold text-[0.95rem] text-textPrimary">${totalHoursInt} h</div>
                ${badge50}
                ${badge100}
              </td>
              <td>
                <div style="font-size:0.85rem; font-weight: 500">${e.template}</div>
                <div style="font-size:0.75rem; color: var(--text-muted)">${e.tasks} • ${e.schedule}</div>
              </td>
              <td style="font-size:0.8rem; color:var(--text-muted)">${new Date(e.submitted_at).toLocaleString('es-AR', {dateStyle: 'short', timeStyle: 'short'})}</td>
            </tr>
            `;
        }).join('');
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
  // ── Asunto = "Vista Previa de Múltiples Solicitudes" (Ya no es uno global)
  document.getElementById("pv-asunto").textContent = "Múltiples plantillas (ver desglose)";

  // ── Nombre: use username field or env-creds label
  const nombreEl = document.getElementById("pv-nombre");
  const userVal  = (document.getElementById("input-user")?.value || "").trim();
  nombreEl.textContent = userVal || "— (credenciales desde entorno) —";

  // Ocultar sección estática de Tareas y Horario, ya que ahora son por registro
  document.getElementById("pv-tasks").parentElement.style.display = "none";
  document.getElementById("pv-schedule").parentElement.style.display = "none";

  // ── Entry rows
  const container = document.getElementById("pv-entries-container");
  container.innerHTML = "";

  if (entriesList.length === 0) {
    container.innerHTML = "<p style='color:#999; font-size:13px;'>Sin registros cargados.</p>";
  } else {
    entriesList.forEach((entry, idx) => {
      // Solo el número de hora, sin minutos (igual que envía el bot: "07:00" → "7")
      const startVal = entry.start_time ? String(parseInt(entry.start_time.split(":")[0], 10)) : "";
      const endVal   = entry.end_time   ? String(parseInt(entry.end_time.split(":")[0],   10)) : "";

      const block = document.createElement("div");
      block.style.cssText = "border:1px solid #e0e0e0; border-radius:5px; padding:12px 14px; margin-bottom:10px; background:#fafafa;";
      block.innerHTML = `
        <div style="font-size:11px; font-weight:700; color:#4a7c59; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Entrada ${idx + 1} — ${entry.template_name}</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div>
            <div style="font-size:11px; color:#c0392b; margin-bottom:3px;">Cantidad de horas extras:</div>
            <div style="border:1px solid #ccc; border-radius:3px; padding:5px 9px; font-size:13px; background:#fff; display:inline-block; min-width:50px;">${entry.hours}</div>
          </div>
          <div>
            <div style="font-size:11px; color:#c0392b; margin-bottom:3px;">el día:</div>
            <div style="border:1px solid #ccc; border-radius:3px; padding:5px 9px; font-size:13px; background:#fff; display:inline-block;">${entry.dateFormatted}</div>
          </div>
          <div>
            <div style="font-size:11px; color:#c0392b; margin-bottom:3px;">Comprendidas entre las:</div>
            <div style="border:1px solid #ccc; border-radius:3px; padding:5px 9px; font-size:13px; background:#fff; display:inline-block;">${startVal}</div>
          </div>
          <div>
            <div style="font-size:11px; color:#c0392b; margin-bottom:3px;">y las:</div>
            <div style="border:1px solid #ccc; border-radius:3px; padding:5px 9px; font-size:13px; background:#fff; display:inline-block;">${endVal}</div>
          </div>
        </div>
        <div style="margin-top:10px;">
           <div style="font-size:11px; color:#c0392b; margin-bottom:3px;">Tareas:</div>
           <div style="border:1px solid #ccc; border-radius:3px; padding:5px 9px; font-size:12px; background:#fff;">${entry.tasks_desc}</div>
        </div>
        <div style="margin-top:6px;">
           <div style="font-size:11px; color:#c0392b; margin-bottom:3px;">Horario habitual:</div>
           <div style="border:1px solid #ccc; border-radius:3px; padding:5px 9px; font-size:12px; background:#fff;">${entry.habitual_schedule}</div>
        </div>
        `;
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

