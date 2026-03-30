// ============================================================================
// almacen-dashboard.js — Módulo Almacén
// Equipos disponibles · Fallas técnicas · Traslados
// ============================================================================

const API = '/api/almacen';

// ── Estado local ─────────────────────────────────────────────────────────────
let _tipoFiltro  = '';          // KPI activo: '' | 'Laptop' | 'Desktop' | 'Monitor'
let _tabActiva   = 'disponibles';
let _detalleEquipo = null;      // equipo abierto en modal detalle

// Paginación
const _pag = { disponibles: 1, fallas: 1, traslados: 1 };

// Debounce timers
let _tDisp = null, _tFallas = null, _tTr = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Fecha de hoy en el formulario de traslado
    document.getElementById('trFecha').value = new Date().toISOString().slice(0, 10);

    cargarStats();
    cargarDisponibles();
    cargarFallas();
    cargarTraslados();
    cargarLocations();
});

// ============================================================================
// STATS / KPIs
// ============================================================================
async function cargarStats() {
    try {
        const res  = await fetch(`${API}/stats`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) return;

        const d = data.data;

        // Conteos por tipo
        const getTotal = (tipo) => {
            const row = (d.porTipo || []).find(r => r.tipo === tipo);
            return row ? row.total : 0;
        };

        document.getElementById('kpi-laptop') .textContent = getTotal('Laptop');
        document.getElementById('kpi-desktop').textContent = getTotal('Desktop');
        document.getElementById('kpi-monitor').textContent = getTotal('Monitor');
        document.getElementById('kpi-total')  .textContent = d.totalDisponibles ?? 0;

        // Sub-label fallas
        const badgeFallas = document.getElementById('badge-fallas');
        const fallasSub   = document.getElementById('kpi-fallas-sub');
        const nFallas     = d.fallasPendientes ?? 0;

        fallasSub.textContent = `${nFallas} con falla`;
        if (nFallas > 0) {
            badgeFallas.textContent = nFallas;
            badgeFallas.style.display = '';
        } else {
            badgeFallas.style.display = 'none';
        }
    } catch (e) {
        console.error('❌ [stats]', e);
    }
}

// ============================================================================
// DISPONIBLES
// ============================================================================
async function cargarDisponibles(page = 1) {
    _pag.disponibles = page;
    const search = document.getElementById('searchDisp').value.trim();
    const tipo   = document.getElementById('filterTipoDisp').value || _tipoFiltro;

    const params = new URLSearchParams({ page, limit: 25 });
    if (search) params.set('search', search);
    if (tipo)   params.set('tipo', tipo);

    const tbody = document.getElementById('tbl-disp');
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9"><span class="spinner"></span> Cargando...</td></tr>`;

    try {
        const res  = await fetch(`${API}/disponibles?${params}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const rows = data.data;
        document.getElementById('cnt-disponibles').textContent = data.pagination?.total ?? rows.length;

        if (!rows.length) {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="9">No se encontraron equipos disponibles</td></tr>`;
        } else {
            tbody.innerHTML = rows.map(r => `
                <tr onclick="abrirDetalle(${r.id})">
                    <td><span class="mono link-cell">${r.device_code || '—'}</span></td>
                    <td>${tipoBadge(r.equipment_type)}</td>
                    <td><strong>${r.brand || '—'}</strong></td>
                    <td style="color:var(--muted);font-size:12px;">${r.model || '—'}</td>
                    <td>${r.operating_system || '—'}</td>
                    <td>${r.ram_memory || '—'}</td>
                    <td>${r.disk_capacity || '—'}</td>
                    <td>${r.domain || '<span style="color:var(--muted)">—</span>'}</td>
                    <td>${garantiaBadge(r.warranty_expiry_calc, r.warranty_months, r.created_at)}</td>
                </tr>
            `).join('');
        }

        renderPag('pag-disp', data.pagination, cargarDisponibles);
    } catch (e) {
        console.error('❌ [disponibles]', e);
        tbody.innerHTML = `<tr class="empty-row"><td colspan="9" style="color:var(--danger)">Error al cargar datos</td></tr>`;
    }
}

function onSearchDisp() {
    clearTimeout(_tDisp);
    _tDisp = setTimeout(() => cargarDisponibles(1), 280);
}

// ============================================================================
// DETALLE EQUIPO
// ============================================================================
async function abrirDetalle(id) {
    try {
        const res  = await fetch(`${API}/disponibles/${id}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const e = data.data;
        _detalleEquipo = e;

        document.getElementById('detalleTitle').textContent = `${e.brand} ${e.model}`;
        document.getElementById('detalleSub').textContent   = e.device_code;

        const grid = document.getElementById('detalleGrid');
        grid.innerHTML = `
            ${cell('Código',            `<span class="mono">${e.device_code || '—'}</span>`)}
            ${cell('Número de serie',   `<span class="mono">${e.serial_number || '—'}</span>`)}
            ${cell('Tipo',              tipoBadge(e.equipment_type))}
            ${cell('Estado',            statusBadge(e.status))}
            ${cell('Marca',             `<strong>${e.brand || '—'}</strong>`)}
            ${cell('Modelo',            e.model || '—')}
            ${cell('Procesador',        e.processor || '—')}
            ${cell('Sistema Operativo', e.operating_system || '—')}
            ${cell('RAM',               e.ram_memory || '—')}
            ${cell('Disco',             e.disk_capacity || '—')}
            ${cell('Dominio',           e.domain || '—')}
            ${cell('Adquisición',       e.acquisition_type || '—')}
            ${cell('Meses garantía',    e.warranty_months ? e.warranty_months + ' meses' : '—')}
            ${cell('Vence garantía',    garantiaBadge(e.warranty_expiry_calc, e.warranty_months, e.created_at), true)}
        `;

        document.getElementById('modalDetalle').classList.add('open');
    } catch (e) {
        console.error('❌ [detalle]', e);
        toast('Error al cargar detalle del equipo', 'err');
    }
}

function cell(lbl, val, span2 = false) {
    return `<div class="detail-cell${span2 ? ' span2' : ''}">
        <div class="detail-lbl">${lbl}</div>
        <div class="detail-val">${val}</div>
    </div>`;
}

// ============================================================================
// FALLAS
// ============================================================================
async function cargarFallas(page = 1) {
    _pag.fallas = page;
    const search = document.getElementById('searchFallas').value.trim();
    const status = document.getElementById('filterStatusFalla').value;

    const params = new URLSearchParams({ page, limit: 25 });
    if (search) params.set('search', search);
    if (status) params.set('status', status);

    const tbody = document.getElementById('tbl-fallas');
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8"><span class="spinner"></span> Cargando...</td></tr>`;

    try {
        const res  = await fetch(`${API}/fallas?${params}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const rows = data.data;
        document.getElementById('cnt-fallas').textContent = data.pagination?.total ?? rows.length;

        if (!rows.length) {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No se encontraron fallas registradas</td></tr>`;
        } else {
            tbody.innerHTML = rows.map(r => `
                <tr>
                    <td>
                        <span class="mono link-cell" onclick="abrirDetalle(${r.equipment_id})">${r.device_code}</span><br>
                        <small style="color:var(--muted);font-size:11px;">${r.brand} ${r.model}</small>
                    </td>
                    <td><span class="badge bg-secondary">${r.component}</span></td>
                    <td style="max-width:220px;font-size:12px;color:var(--muted);">${r.description}</td>
                    <td style="font-size:12px;">${r.supplier || '—'}</td>
                    <td style="font-size:12px;">${r.estimated_cost ? 'S/. ' + parseFloat(r.estimated_cost).toFixed(2) : '—'}</td>
                    <td>${fallaStatusBadge(r.repair_status)}</td>
                    <td style="font-size:11px;color:var(--muted);">${fmtDate(r.created_at)}</td>
                    <td>
                        <button class="btn btn-outline btn-sm" onclick="openEditFalla(${JSON.stringify(r).replace(/"/g,'&quot;')})" title="Editar estado">
                            <i class="bi bi-pencil-square"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        }

        renderPag('pag-fallas', data.pagination, cargarFallas);
    } catch (e) {
        console.error('❌ [fallas]', e);
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8" style="color:var(--danger)">Error al cargar datos</td></tr>`;
    }
}

function onSearchFallas() {
    clearTimeout(_tFallas);
    _tFallas = setTimeout(() => cargarFallas(1), 280);
}

// ============================================================================
// REGISTRAR FALLA
// ============================================================================
function openModalFalla(equipoId = null, equipoLabel = null) {
    // Resetear
    document.getElementById('fallaEquipoQ').value   = equipoLabel || '';
    document.getElementById('fallaEquipoId').value  = equipoId   || '';
    document.getElementById('fallaEquipoSub').textContent = equipoLabel ? `Equipo: ${equipoLabel}` : 'Selecciona un equipo';
    document.getElementById('fallaComponente').value = '';
    document.getElementById('fallaDesc').value       = '';
    document.getElementById('fallaProveedor').value  = '';
    document.getElementById('fallaCosto').value      = '';
    document.getElementById('fallaEstado').value     = 'Pendiente';
    document.getElementById('alertFalla').style.display = 'none';

    // Si viene de "Registrar falla desde detalle" bloqueamos el selector
    const selector = document.getElementById('fallaEquipoSelector');
    if (equipoId) {
        selector.style.opacity = '.5';
        selector.style.pointerEvents = 'none';
    } else {
        selector.style.opacity = '';
        selector.style.pointerEvents = '';
    }

    document.getElementById('modalFalla').classList.add('open');
}

async function guardarFalla() {
    const equipoId   = document.getElementById('fallaEquipoId').value;
    const componente = document.getElementById('fallaComponente').value;
    const desc       = document.getElementById('fallaDesc').value.trim();
    const alertEl    = document.getElementById('alertFalla');

    if (!equipoId)   return showAlert(alertEl, 'Selecciona un equipo');
    if (!componente) return showAlert(alertEl, 'Selecciona el componente afectado');
    if (!desc)       return showAlert(alertEl, 'Ingresa la descripción del problema');

    const btn = document.getElementById('btnGuardarFalla');
    setBtnLoading(btn, true, 'Guardando...');

    try {
        const res = await fetch(`${API}/fallas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                equipment_id:   equipoId,
                component:      componente,
                description:    desc,
                supplier:       document.getElementById('fallaProveedor').value.trim() || null,
                estimated_cost: document.getElementById('fallaCosto').value || null,
                repair_status:  document.getElementById('fallaEstado').value,
            })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        closeModalById('modalFalla');
        toast(data.message || 'Falla registrada correctamente', 'ok');
        cargarStats();
        cargarFallas(1);
        cargarDisponibles(1); // El equipo ya no aparecerá como disponible
    } catch (e) {
        showAlert(alertEl, e.message);
    } finally {
        setBtnLoading(btn, false, '<i class="bi bi-exclamation-triangle-fill"></i> Registrar falla');
    }
}

// ============================================================================
// EDITAR FALLA
// ============================================================================
function openEditFalla(falla) {
    document.getElementById('editFallaId').value       = falla.id;
    document.getElementById('editFallaSub').textContent = `${falla.device_code} — ${falla.component}`;
    document.getElementById('editFallaEstado').value    = falla.repair_status;
    document.getElementById('editFallaProveedor').value = falla.supplier || '';
    document.getElementById('editFallaCosto').value     = falla.estimated_cost || '';
    document.getElementById('editFallaDesc').value      = falla.description || '';
    document.getElementById('modalEditFalla').classList.add('open');
}

async function guardarEditFalla() {
    const id  = document.getElementById('editFallaId').value;
    const btn = document.getElementById('btnGuardarEditFalla');
    setBtnLoading(btn, true, 'Guardando...');

    try {
        const res = await fetch(`${API}/fallas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                repair_status:  document.getElementById('editFallaEstado').value,
                supplier:       document.getElementById('editFallaProveedor').value.trim() || null,
                estimated_cost: document.getElementById('editFallaCosto').value || null,
                description:    document.getElementById('editFallaDesc').value.trim() || null,
            })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        closeModalById('modalEditFalla');
        toast(data.message || 'Falla actualizada', 'ok');
        cargarStats();
        cargarFallas(_pag.fallas);
        cargarDisponibles(1);
    } catch (e) {
        toast(e.message, 'err');
    } finally {
        setBtnLoading(btn, false, '<i class="bi bi-check-circle-fill"></i> Guardar cambios');
    }
}

// ============================================================================
// ABRIR FALLA DESDE DETALLE
// ============================================================================
function abrirFallaDesdeDetalle() {
    if (!_detalleEquipo) return;
    closeModalById('modalDetalle');
    const label = `${_detalleEquipo.device_code} — ${_detalleEquipo.brand} ${_detalleEquipo.model}`;
    openModalFalla(_detalleEquipo.id, label);
}

// ============================================================================
// TRASLADOS
// ============================================================================
async function cargarTraslados(page = 1) {
    _pag.traslados = page;
    const search = document.getElementById('searchTr').value.trim();
    const params = new URLSearchParams({ page, limit: 25 });
    if (search) params.set('search', search);

    const tbody = document.getElementById('tbl-tr');
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><span class="spinner"></span> Cargando...</td></tr>`;

    try {
        const res  = await fetch(`${API}/traslados?${params}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const rows = data.data;
        document.getElementById('cnt-traslados').textContent = data.pagination?.total ?? rows.length;

        if (!rows.length) {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No hay traslados registrados</td></tr>`;
        } else {
            tbody.innerHTML = rows.map(r => `
                <tr>
                    <td style="font-size:12px;white-space:nowrap;">${fmtDate(r.transfer_date)}</td>
                    <td>
                        <span class="mono" style="font-size:12px;">${r.device_code}</span><br>
                        <small style="color:var(--muted);font-size:11px;">${r.brand} ${r.model}</small>
                    </td>
                    <td>${tipoBadge(r.equipment_type)}</td>
                    <td style="font-size:12px;">${r.origin_name ? `${r.origin_name}${r.origin_city ? ', '+r.origin_city : ''}` : '<span style="color:var(--muted)">—</span>'}</td>
                    <td style="font-size:12px;font-weight:600;">${r.destination_name}${r.destination_city ? ', '+r.destination_city : ''}</td>
                    <td style="font-size:11px;color:var(--muted);max-width:180px;">${r.notes || '—'}</td>
                </tr>
            `).join('');
        }

        renderPag('pag-tr', data.pagination, cargarTraslados);
    } catch (e) {
        console.error('❌ [traslados]', e);
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6" style="color:var(--danger)">Error al cargar datos</td></tr>`;
    }
}

function onSearchTr() {
    clearTimeout(_tTr);
    _tTr = setTimeout(() => cargarTraslados(1), 280);
}

// ── Registrar traslado ────────────────────────────────────────────────────────
async function registrarTraslado() {
    const equipoId = document.getElementById('trEquipoId').value;
    const destino  = document.getElementById('trDestino').value;
    const fecha    = document.getElementById('trFecha').value;

    if (!equipoId) return toast('Selecciona un equipo', 'warn');
    if (!destino)  return toast('Selecciona el destino', 'warn');
    if (!fecha)    return toast('Ingresa la fecha del traslado', 'warn');

    try {
        const res = await fetch(`${API}/traslados`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                equipment_id:             equipoId,
                destination_location_id:  destino,
                transfer_date:            fecha,
                notes:                    document.getElementById('trNotas').value.trim() || null,
            })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        // Reset form
        document.getElementById('trEquipoQ').value  = '';
        document.getElementById('trEquipoId').value = '';
        document.getElementById('trEquipoInfo').textContent = '';
        document.getElementById('trNotas').value = '';
        document.getElementById('trFecha').value = new Date().toISOString().slice(0, 10);
        document.getElementById('trEquipoDrop').style.display = 'none';

        toast(data.message || 'Traslado registrado', 'ok');
        cargarStats();
        cargarTraslados(1);
        cargarDisponibles(1);
    } catch (e) {
        toast(e.message, 'err');
    }
}

// ============================================================================
// AUTOCOMPLETE — EQUIPO PARA TRASLADO
// ============================================================================
let _tTrAC = null;
async function buscarEquipoTraslado(q) {
    clearTimeout(_tTrAC);
    const drop = document.getElementById('trEquipoDrop');
    if (q.length < 2) { drop.style.display = 'none'; return; }

    _tTrAC = setTimeout(async () => {
        const res  = await fetch(`${API}/equipment-search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success || !data.data.length) { drop.style.display = 'none'; return; }

        drop.innerHTML = data.data.map(e => `
            <div style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);"
                 onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background=''"
                 onclick="selEquipoTraslado(${e.id},'${e.device_code} — ${e.brand} ${e.model}')">
                <strong class="mono" style="font-size:12px;">${e.device_code}</strong>
                <span style="color:var(--muted);margin-left:8px;">${e.brand} ${e.model}</span>
                ${statusBadge(e.status)}
            </div>
        `).join('');
        drop.style.display = '';
    }, 200);
}

function selEquipoTraslado(id, label) {
    document.getElementById('trEquipoId').value   = id;
    document.getElementById('trEquipoQ').value    = label;
    document.getElementById('trEquipoDrop').style.display = 'none';
    document.getElementById('trEquipoInfo').textContent   = '';
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#trEquipoQ') && !e.target.closest('#trEquipoDrop')) {
        document.getElementById('trEquipoDrop').style.display = 'none';
    }
    if (!e.target.closest('#fallaEquipoQ') && !e.target.closest('#fallaEquipoDrop')) {
        document.getElementById('fallaEquipoDrop').style.display = 'none';
    }
});

// ============================================================================
// AUTOCOMPLETE — EQUIPO PARA FALLA
// ============================================================================
let _tFallaAC = null;
async function buscarEquipoFalla(q) {
    clearTimeout(_tFallaAC);
    const drop = document.getElementById('fallaEquipoDrop');
    if (q.length < 2) { drop.style.display = 'none'; return; }

    _tFallaAC = setTimeout(async () => {
        const res  = await fetch(`${API}/equipment-search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success || !data.data.length) { drop.style.display = 'none'; return; }

        drop.innerHTML = data.data.map(e => `
            <div style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);"
                 onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background=''"
                 onclick="selEquipoFalla(${e.id},'${e.device_code} — ${e.brand} ${e.model}')">
                <strong class="mono" style="font-size:12px;">${e.device_code}</strong>
                <span style="color:var(--muted);margin-left:8px;">${e.brand} ${e.model}</span>
                ${statusBadge(e.status)}
            </div>
        `).join('');
        drop.style.display = '';
    }, 200);
}

function selEquipoFalla(id, label) {
    document.getElementById('fallaEquipoId').value  = id;
    document.getElementById('fallaEquipoQ').value   = label;
    document.getElementById('fallaEquipoSub').textContent = `Equipo: ${label}`;
    document.getElementById('fallaEquipoDrop').style.display = 'none';
}

// ============================================================================
// LOCATIONS (para selects de traslado y nuevo equipo)
// ============================================================================
async function cargarLocations() {
    try {
        const res  = await fetch(`${API}/locations`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) return;

        const opts = data.data.map(l =>
            `<option value="${l.id}">${l.location_name}${l.city ? ' — '+l.city : ''}</option>`
        ).join('');

        // Solo para el formulario de traslados
        document.getElementById('trDestino').innerHTML =
            `<option value="">Seleccionar ubicación...</option>${opts}`;
    } catch (e) {
        console.error('❌ [locations]', e);
    }
}

// ============================================================================
// NUEVO EQUIPO
// ============================================================================
function openModalNuevo() {
    ['nCodigo','nSerie','nMarca','nModelo','nSO','nCPU','nRAM','nDisco','nGarantia','nObsolescencia','nDominio']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('nTipo').value = '';
    document.getElementById('nAdq').value  = 'Propio';
    document.getElementById('alertNuevo').style.display = 'none';
    document.getElementById('modalNuevo').classList.add('open');
}

async function guardarNuevoEquipo() {
    const alertEl = document.getElementById('alertNuevo');
    const codigo  = document.getElementById('nCodigo').value.trim();
    const tipo    = document.getElementById('nTipo').value;
    const marca   = document.getElementById('nMarca').value.trim();
    const modelo  = document.getElementById('nModelo').value.trim();

    if (!codigo) return showAlert(alertEl, 'El código del equipo es requerido');
    if (!tipo)   return showAlert(alertEl, 'Selecciona el tipo de equipo');
    if (!marca)  return showAlert(alertEl, 'Ingresa la marca del equipo');
    if (!modelo) return showAlert(alertEl, 'Ingresa el modelo del equipo');

    const btn = document.getElementById('btnGuardarNuevo');
    setBtnLoading(btn, true, 'Guardando...');

    try {
        const res = await fetch(`${API}/equipment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                device_code:       codigo,
                serial_number:     document.getElementById('nSerie').value.trim()        || null,
                equipment_type:    tipo,
                brand:             marca,
                model:             modelo,
                operating_system:  document.getElementById('nSO').value.trim()           || null,
                processor:         document.getElementById('nCPU').value.trim()          || null,
                ram_memory:        document.getElementById('nRAM').value.trim()          || null,
                disk_capacity:     document.getElementById('nDisco').value.trim()        || null,
                acquisition_type:  document.getElementById('nAdq').value,
                warranty_months:   document.getElementById('nGarantia').value           || null,
                obsolescence_years:document.getElementById('nObsolescencia').value      || null,
                domain:            document.getElementById('nDominio').value.trim()      || null,
                status:            'Disponible',
            })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        closeModalById('modalNuevo');
        toast(`Equipo "${codigo}" creado correctamente`, 'ok');
        cargarStats();
        cargarDisponibles(1);
    } catch (e) {
        showAlert(alertEl, e.message);
    } finally {
        setBtnLoading(btn, false, '<i class="bi bi-check-circle-fill"></i> Guardar equipo');
    }
}

// ============================================================================
// FILTRO POR TIPO (KPI cards)
// ============================================================================
function filtrarPorTipo(tipo) {
    _tipoFiltro = tipo;
    document.getElementById('filterTipoDisp').value = tipo;

    // Activar / desactivar KPI cards
    document.querySelectorAll('.kpi').forEach(el => {
        el.classList.toggle('active', el.dataset.tipo === tipo);
    });

    // Si no estamos en disponibles, cambiar tab
    if (_tabActiva !== 'disponibles') {
        const btn = document.querySelector('.tab-btn');
        switchTab('disponibles', btn);
    }

    cargarDisponibles(1);
}

// ============================================================================
// TABS
// ============================================================================
function switchTab(name, btn) {
    _tabActiva = name;
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
    btn.classList.add('active');
}

// ============================================================================
// PAGINACIÓN
// ============================================================================
function renderPag(containerId, pagination, callback) {
    const el = document.getElementById(containerId);
    if (!pagination || pagination.pages <= 1) { el.innerHTML = ''; return; }

    const { page, pages, total, limit } = pagination;
    const from = (page - 1) * limit + 1;
    const to   = Math.min(page * limit, total);

    let html = `<span class="pag-info">Mostrando ${from}–${to} de ${total}</span>`;

    const btn = (label, p, active = false, disabled = false) =>
        `<button class="pag-btn${active?' active':''}" ${disabled?'disabled':''} onclick="${callback.name}(${p})">${label}</button>`;

    html += btn('‹', page - 1, false, page === 1);

    // Ventana de páginas
    let start = Math.max(1, page - 2);
    let end   = Math.min(pages, start + 4);
    start     = Math.max(1, end - 4);

    if (start > 1) html += btn('1', 1) + (start > 2 ? '<span style="padding:0 4px;color:var(--muted)">…</span>' : '');
    for (let p = start; p <= end; p++) html += btn(p, p, p === page);
    if (end < pages) html += (end < pages - 1 ? '<span style="padding:0 4px;color:var(--muted)">…</span>' : '') + btn(pages, pages);

    html += btn('›', page + 1, false, page === pages);

    el.innerHTML = html;
}

// ============================================================================
// HELPERS — RENDER
// ============================================================================
function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric' });
}

function statusBadge(s) {
    const map = {
        'Disponible':       'bg-success',
        'Asignado':         'bg-info',
        'En Reparación': 'bg-warning',
        'Dado de Baja':     'bg-danger',
        'En Tránsito':      'bg-purple',
    };
    return `<span class="badge ${map[s]||'bg-secondary'}">${s||'—'}</span>`;
}

function tipoBadge(t) {
    const map = {
        'Laptop':  'bg-info',
        'Desktop': 'bg-success',
        'Monitor': 'bg-warning',
        'Tablet':  'bg-purple',
    };
    return `<span class="badge ${map[t]||'bg-secondary'}">${t||'—'}</span>`;
}

function fallaStatusBadge(s) {
    const map = {
        'Pendiente':          'chip-pendiente',
        'En proceso':         'chip-en-proceso',
        'Esperando repuesto': 'chip-esperando',
        'Resuelto':           'chip-resuelto',
        'Dado de baja':       'chip-dado-de-baja',
    };
    return `<span class="badge ${map[s]||'bg-secondary'}">${s||'—'}</span>`;
}

function garantiaBadge(fecha, warrantyMonths, createdAt) {
    if (!warrantyMonths || parseInt(warrantyMonths) <= 0) {
        return '<span style="color:var(--muted);font-size:12px;">—</span>';
    }
    let exp;
    if (createdAt) {
        const baseStr = typeof createdAt === 'string' ? createdAt.substring(0, 10) : new Date(createdAt).toISOString().substring(0, 10);
        const [by, bm, bd] = baseStr.split('-').map(Number);
        exp = new Date(by, bm - 1 + parseInt(warrantyMonths), bd);
    } else if (fecha) {
        const fechaStr = typeof fecha === 'string' ? fecha.substring(0, 10) : new Date(fecha).toISOString().substring(0, 10);
        const [y, m, d] = fechaStr.split('-').map(Number);
        exp = new Date(y, m - 1, d);
    } else {
        return '<span style="color:var(--muted);font-size:12px;">—</span>';
    }
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((exp - hoy) / 86400000);
    const label = exp.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
    if (dias < 0)   return `<span class="badge bg-danger"><i class="bi bi-shield-x me-1"></i>Vencida</span>`;
    if (dias <= 30)  return `<span class="badge bg-danger"><i class="bi bi-alarm me-1"></i>${label} (${dias}d)</span>`;
    if (dias <= 90)  return `<span class="badge bg-warning"><i class="bi bi-shield-half me-1"></i>${label} (${dias}d)</span>`;
    return `<span class="badge bg-success"><i class="bi bi-shield-check me-1"></i>${label} (${dias}d)</span>`;
}

// ============================================================================
// HELPERS — MODALES / UI
// ============================================================================
function closeModalById(id) {
    document.getElementById(id).classList.remove('open');
}

function toast(msg, type = 'inf') {
    const icons = { ok:'check-circle-fill', err:'x-circle-fill', warn:'exclamation-triangle-fill', inf:'info-circle-fill' };
    const cls   = { ok:'toast-ok', err:'toast-err', warn:'toast-warn', inf:'toast-inf' };
    const el    = document.createElement('div');
    el.className = `toast-item ${cls[type]||'toast-inf'}`;
    el.innerHTML = `<i class="bi bi-${icons[type]||'info-circle-fill'}"></i> ${msg}`;
    document.getElementById('toastZone').appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function showAlert(el, msg) {
    el.textContent = msg;
    el.style.display = '';
}

function setBtnLoading(btn, loading, label) {
    btn.disabled = loading;
    btn.innerHTML = loading
        ? `<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> ${label}`
        : label;
}

console.log('✅ Almacén Dashboard cargado');
