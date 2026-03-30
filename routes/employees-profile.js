// ============================================================================
// /public/js/employees-profile.js
// Lógica del buscador y perfil de empleados
// ============================================================================

'use strict';

// ============================================================================
// CONFIG (inyectada desde el EJS)
// ============================================================================
const EMP_CFG = window.EMP_PAGE_CONFIG || { apiBase: '/api', canEdit: false };

// ============================================================================
// ESTADO
// ============================================================================
let empCurrent      = null;   // empleado actualmente mostrado
let empConfirmAction = null;  // 'deactivate' | 'activate'
let empSearchTimer  = null;

// ============================================================================
// COLORES POR CATEGORÍA (mismo mapa que el dashboard)
// ============================================================================
const CAT_COLORS = {
  'Especialista': '#10b981',
  'Analista':     '#f59e0b',
  'Coordinador':  '#3b82f6',
  'Gerente':      '#8b5cf6',
  'Asistente':    '#06b6d4',
  'Técnico':      '#6b7280',
};

const CAT_BADGE = {
  'Especialista': 'badge-especialista',
  'Analista':     'badge-analista',
  'Coordinador':  'badge-coordinador',
  'Gerente':      'badge-gerente',
  'Asistente':    'badge-asistente',
  'Técnico':      'badge-tecnico',
};

// ============================================================================
// UTILIDADES
// ============================================================================

/** Iniciales del nombre (máx 2 letras) */
function empInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

/** Color del avatar según categoría */
function empAvatarColor(emp) {
  return CAT_COLORS[emp.category] || '#64748b';
}

/** Resalta coincidencias del término de búsqueda */
function empHighlight(text, term) {
  if (!term || !text) return text || '';
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).replace(new RegExp(`(${esc})`, 'gi'), '<mark class="emp-hl">$1</mark>');
}

/** Valor de campo o placeholder vacío */
function empFieldVal(el, value, opts = {}) {
  if (!value) {
    el.innerHTML = '<span class="empty">—</span>';
    return;
  }
  el.className = 'emp-field-value' + (opts.mono ? ' mono' : '');
  if (opts.raw) el.innerHTML = value;
  else          el.textContent = value;
}

// ============================================================================
// TOAST
// ============================================================================
function empToast(msg, type = 'info') {
  const icons = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', info: 'bi-info-circle-fill' };
  const el = document.createElement('div');
  el.className = `emp-toast ${type}`;
  el.innerHTML = `<i class="bi ${icons[type] || icons.info}"></i> ${msg}`;
  document.getElementById('empToastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ============================================================================
// BÚSQUEDA CON AUTOCOMPLETE
// ============================================================================

const empInput     = document.getElementById('empSearchInput');
const empDropdown  = document.getElementById('empDropdown');
const empStatsBar  = document.getElementById('empSearchStats');

empInput.addEventListener('input', function () {
  const term = this.value.trim();
  clearTimeout(empSearchTimer);

  if (term.length < 2) {
    empCloseDropdown();
    empStatsBar.textContent = '';
    return;
  }

  // Loading
  empDropdown.innerHTML = `
    <div class="emp-dd-loading">
      <span class="emp-spin"></span>&nbsp; Buscando...
    </div>`;
  empDropdown.classList.add('show');

  empSearchTimer = setTimeout(() => empFetch(term), 380);
});

empInput.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { empCloseDropdown(); this.blur(); }
});

document.addEventListener('click', function (e) {
  if (!e.target.closest('.search-wrapper')) empCloseDropdown();
});

function empCloseDropdown() {
  empDropdown.classList.remove('show');
}

/** Llama a la API de búsqueda */
async function empFetch(term) {
  try {
    const res  = await fetch(`${EMP_CFG.apiBase}/employees/search?q=${encodeURIComponent(term)}`, {
      credentials: 'include'
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const list = json.data || [];

    empRenderDropdown(list, term);
    empStatsBar.textContent = list.length
      ? `${list.length} empleado${list.length !== 1 ? 's' : ''} encontrado${list.length !== 1 ? 's' : ''} para "${term}"`
      : '';

  } catch (err) {
    console.error('Error buscando empleados:', err);
    empDropdown.innerHTML = `<div class="emp-dd-empty"><i class="bi bi-exclamation-circle" style="display:block;font-size:22px;margin-bottom:6px;opacity:.4"></i>Error al buscar. Intenta de nuevo.</div>`;
    empDropdown.classList.add('show');
  }
}

/** Renderiza el dropdown con los resultados */
function empRenderDropdown(list, term) {
  if (!list.length) {
    empDropdown.innerHTML = `
      <div class="emp-dd-empty">
        <i class="bi bi-search" style="display:block;font-size:24px;margin-bottom:6px;opacity:.3"></i>
        No se encontraron empleados
      </div>`;
    empDropdown.classList.add('show');
    return;
  }

  empDropdown.innerHTML = list.slice(0, 10).map(emp => {
    const color   = empAvatarColor(emp);
    const init    = empInitials(emp.full_name);
    const active  = emp.is_active !== false && emp.is_active !== 0;
    const hiName  = empHighlight(emp.full_name, term);

    return `
      <div class="emp-dd-item" onclick="empSelect(${emp.id}, this)" data-id="${emp.id}">
        <div class="emp-dd-avatar" style="background:${color}">${init}</div>
        <div class="emp-dd-info">
          <div class="emp-dd-name">${hiName}</div>
          <div class="emp-dd-meta">${emp.cip || '—'} &middot; ${emp.position_name || 'Sin cargo'}</div>
        </div>
        <div class="emp-dd-status ${active ? 'active' : 'inactive'}">${active ? 'Activo' : 'De baja'}</div>
      </div>`;
  }).join('');

  empDropdown.classList.add('show');
}

// ============================================================================
// SELECCIONAR EMPLEADO
// ============================================================================

/** Llamado al hacer click en un item del dropdown */
async function empSelect(id) {
  empCloseDropdown();
  empInput.value = '';
  empStatsBar.textContent = '';

  try {
    const res  = await fetch(`${EMP_CFG.apiBase}/employees/${id}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    empCurrent = json.data;
    empRenderCard(empCurrent);
  } catch (err) {
    console.error('Error cargando empleado:', err);
    empToast('Error al cargar el empleado', 'error');
  }
}

// ============================================================================
// RENDERIZAR TARJETA
// ============================================================================
function empRenderCard(emp) {
  const active = emp.is_active !== false && emp.is_active !== 0;
  const color  = empAvatarColor(emp);
  const init   = empInitials(emp.full_name);

  // --- Band de color ---
  const band = document.getElementById('empBand');
  band.className = 'emp-band' + (active ? '' : ' baja');

  // --- Avatar ---
  const av = document.getElementById('empBigAvatar');
  av.style.background = color;
  document.getElementById('empAvatarInitials').textContent = init;
  const dot = document.getElementById('empAvatarDot');
  dot.className = `emp-dot ${active ? 'active' : 'inactive'}`;

  // --- Nombre / posición / CIP ---
  document.getElementById('empCardName').textContent     = emp.full_name || '—';
  document.getElementById('empCardPosition').textContent = emp.position_name || 'Sin cargo';
  document.getElementById('empCardCip').textContent      = emp.cip ? `CIP: ${emp.cip}` : 'Sin CIP';

  // --- Badge de estado ---
  const badge = document.getElementById('empStatusBadge');
  badge.className = `emp-status-badge ${active ? 'active' : 'inactive'}`;
  document.getElementById('empStatusIcon').className = `bi ${active ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}`;
  document.getElementById('empStatusText').textContent  = active ? 'Activo' : 'De baja';

  // --- Campos ---
  empFieldVal(document.getElementById('fDni'),        emp.national_id, { mono: true });
  empFieldVal(document.getElementById('fEmail'),      emp.email
    ? `<a href="mailto:${emp.email}">${emp.email}</a>` : null,
    { raw: true });

  // Categoría con badge de color (igual que en el dashboard)
  const catEl = document.getElementById('fCategory');
  if (emp.category) {
    const cls = CAT_BADGE[emp.category] || 'bg-secondary';
    catEl.innerHTML = `<span class="badge ${cls}" style="font-size:11px;padding:5px 10px;border-radius:6px;">${emp.category}</span>`;
  } else {
    catEl.innerHTML = '<span class="empty">—</span>';
  }

  empFieldVal(document.getElementById('fPosition'),   emp.position_name);
  empFieldVal(document.getElementById('fSupervisor'), emp.supervisor_name);
  empFieldVal(document.getElementById('fOffice'),     emp.branch_office_id, { mono: true });

  // --- Footer meta ---
  document.getElementById('empFooterMeta').textContent = `ID interno: ${emp.id}`;

  // --- Botón de baja/reactivar ---
  empRefreshToggleBtn(active);

  // --- Ocultar empty state, mostrar card ---
  document.getElementById('empEmptyState').style.display = 'none';
  const card = document.getElementById('empCard');
  card.classList.remove('show');
  void card.offsetWidth; // fuerza reflow para relanzar animación
  card.classList.add('show');
}

/** Actualiza solo el botón de toggle (sin re-renderizar toda la card) */
function empRefreshToggleBtn(active) {
  const btn = document.getElementById('empToggleBtn');

  // Si el usuario no tiene permisos de edición, ocultar botón
  if (!EMP_CFG.canEdit) {
    btn.style.display = 'none';
    return;
  }

  btn.style.display = '';

  if (active) {
    btn.className = 'btn btn-sm btn-baja';
    btn.innerHTML = '<i class="bi bi-person-dash-fill"></i> Dar de baja';
  } else {
    btn.className = 'btn btn-sm btn-reactivar';
    btn.innerHTML = '<i class="bi bi-person-check-fill"></i> Reactivar empleado';
  }
}

// ============================================================================
// COPIAR EMAIL
// ============================================================================
function empCopyEmail() {
  const email = empCurrent?.email;
  if (!email) return;

  navigator.clipboard.writeText(email)
    .then(() => empToast('Email copiado al portapapeles', 'success'))
    .catch(() => empToast('No se pudo copiar', 'error'));
}

// ============================================================================
// TOGGLE DE ESTADO (dar de baja / reactivar)
// ============================================================================

/** Muestra el modal de confirmación */
function empPromptToggle() {
  if (!empCurrent || !EMP_CFG.canEdit) return;

  const active = empCurrent.is_active !== false && empCurrent.is_active !== 0;
  const name   = empCurrent.full_name;

  document.getElementById('empConfirmIcon').textContent  = active ? '⚠️' : '✅';
  document.getElementById('empConfirmTitle').textContent = active
    ? 'Dar de baja al empleado'
    : 'Reactivar empleado';
  document.getElementById('empConfirmMsg').textContent   = active
    ? `¿Estás seguro de que deseas dar de baja a ${name}? El empleado quedará inactivo en el sistema.`
    : `¿Deseas reactivar a ${name}? El empleado volverá a estar activo en el sistema.`;

  const btn = document.getElementById('empConfirmBtn');
  if (active) {
    btn.textContent = 'Sí, dar de baja';
    btn.className   = 'btn btn-sm btn-baja';
  } else {
    btn.textContent = 'Sí, reactivar';
    btn.className   = 'btn btn-sm btn-reactivar';
  }

  empConfirmAction = active ? 'deactivate' : 'activate';
  document.getElementById('empConfirmOverlay').classList.add('show');
}

function empCloseConfirm() {
  document.getElementById('empConfirmOverlay').classList.remove('show');
  empConfirmAction = null;
}

/** Ejecuta el cambio de estado llamando a la API */
async function empExecuteConfirm() {
  if (!empConfirmAction || !empCurrent) return;

  empCloseConfirm();

  const newStatus = (empConfirmAction === 'activate');
  const empId     = empCurrent.id;

  // Deshabilitar botón temporalmente
  const toggleBtn = document.getElementById('empToggleBtn');
  const originalHtml = toggleBtn.innerHTML;
  toggleBtn.disabled = true;
  toggleBtn.innerHTML = '<span class="emp-spin"></span>';

  try {
    const res = await fetch(`${EMP_CFG.apiBase}/employees/${empId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ is_active: newStatus })
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      throw new Error(json.error || json.message || 'Error al actualizar');
    }

    // Actualizar estado local
    empCurrent.is_active = newStatus;

    // Re-renderizar la card completa para reflejar el cambio
    empRenderCard(empCurrent);

    empToast(
      newStatus
        ? `✅ ${empCurrent.full_name} ha sido reactivado correctamente`
        : `⚠️ ${empCurrent.full_name} ha sido dado de baja`,
      newStatus ? 'success' : 'info'
    );

  } catch (err) {
    console.error('Error cambiando estado:', err);
    empToast('Error: ' + err.message, 'error');
    // Restaurar botón
    toggleBtn.disabled = false;
    toggleBtn.innerHTML = originalHtml;
  }
}

// ============================================================================
// CERRAR CONFIRM al hacer click fuera
// ============================================================================
document.getElementById('empConfirmOverlay').addEventListener('click', function (e) {
  if (e.target === this) empCloseConfirm();
});

console.log('✅ employees-profile.js cargado');
