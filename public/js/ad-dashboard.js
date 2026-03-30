// ============================================================================
// ad-dashboard.js — Active Directory Support Dashboard
// ============================================================================

const API = '/api/ad';

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadKPIs();
    loadStale();
    loadOffline();
    updateCacheStatus();
    setInterval(updateCacheStatus, 30000);
    initAutocomplete();
    initTableFilters();
    initTableAutocomplete();

    // Modal backdrop close
    document.getElementById('resetModal')?.addEventListener('click', e => {
        if (e.target === document.getElementById('resetModal')) closeResetModal();
    });

    const inp = document.getElementById('searchInp');
    const btn = document.getElementById('btnSearch');
    btn.addEventListener('click', searchUser);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') searchUser(); });
    inp.focus();
});

// ── KPIs ─────────────────────────────────────────────────────────────────────
async function loadKPIs() {
    try {
        const { success, data, error } = await apiFetch(`${API}/kpis`);
        if (!success) throw new Error(error);

        document.getElementById('kpiRow').innerHTML = `
          ${kpiCard('Usuarios totales', fmt(data.total),    'Total en AD',       'bi-people-fill',     'cb')}
          ${kpiCard('Cuentas activas',  fmt(data.active),   `De ${fmt(data.total)} totales`, 'bi-person-check-fill','cg')}
          ${kpiCard('Inactivas',        fmt(data.inactive), 'Deshabilitadas',    'bi-person-slash',    'cm')}
          ${kpiCard('Expiradas',        fmt(data.expired),  'Fecha de cuenta',   'bi-calendar-x-fill', 'cr')}
          ${kpiCard('Bloqueadas',       fmt(data.locked),   'Lockout activo',    'bi-lock-fill',       'ca')}
          ${kpiCard('Pwd expirada',     fmt(data.pwdExpired),'Activas con pwd exp','bi-key-fill',      'cp')}
          ${kpiCard('Sin login +90d',   fmt(data.stale90),  'Usuarios inactivos','bi-clock-history',   'ca')}
          ${kpiCard('Equipos en AD',    fmt(data.computers),'Objetos computer',  'bi-pc-display',      'cb')}
          ${kpiCard('Equipos offline',  fmt(data.compOff30),'Sin conexión +30d', 'bi-wifi-off',        'cr')}
        `;
    } catch(e) {
        console.error('[KPIs]', e);
        toast('Error cargando KPIs: ' + e.message, 'err');
    }
}

function kpiCard(lbl, val, sub, ico, cls) {
    return `<div class="kpi">
        <div>
          <div class="kpi-lbl">${lbl}</div>
          <div class="kpi-val ${cls}">${val}</div>
          <div class="kpi-sub">${sub}</div>
        </div>
        <i class="bi ${ico} kpi-ico ${cls}"></i>
    </div>`;
}

// ── User search ───────────────────────────────────────────────────────────────
async function searchUser() {
    const inp     = document.getElementById('searchInp');
    const btn     = document.getElementById('btnSearch');
    const account = inp.value.trim();
    if (!account) { inp.focus(); return; }
    closeAC();

    // UI — loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" style="width:14px;height:14px;"></span>Consultando...';

    const card     = document.getElementById('userCard');
    const body     = document.getElementById('userCardBody');
    const timeEl   = document.getElementById('queryTime');
    card.style.display = 'block';
    body.innerHTML = skeletonUser();
    timeEl.textContent = '';

    try {
        const { success, data, error } = await apiFetch(`${API}/user?account=${encodeURIComponent(account)}`);
        if (!success) throw new Error(error);

        if (!data.found) {
            body.innerHTML = `<div class="empty-state">
                <i class="bi bi-person-x-fill"></i>
                <strong>No se encontró "${esc(account)}"</strong>
                <p style="margin-top:6px;font-size:12px;">${esc(data.error || 'La cuenta no existe en Active Directory.')}</p>
            </div>`;
            return;
        }

        timeEl.textContent = `Consultado: ${new Date().toLocaleString('es-PE')}`;
        renderUser(data, body);

    } catch(e) {
        console.error('[search]', e);
        body.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle-fill"></i><p>Error: ${esc(e.message)}</p></div>`;
        toast('Error consultando AD: ' + e.message, 'err');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-search me-1"></i>Consultar AD';
    }
}

// ── Render user card ──────────────────────────────────────────────────────────
function renderUser(d, container) {
    const initials = (d.displayName || d.samAccount || '?')
        .split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

    // ─── Status badges ───
    const badges = [];
    if (d.isProveedor)       badges.push(pill('prov', 'bi-building-check',  'Proveedor'));
    if (d.enabled)           badges.push(pill('ok',   'bi-check-circle-fill','Activa'));
    else                     badges.push(pill('bad',  'bi-x-circle-fill',   'Deshabilitada'));
    if (d.lockedOut)         badges.push(pill('lock', 'bi-lock-fill',        'Bloqueada'));
    if (d.passwordExpired)   badges.push(pill('warn', 'bi-key-fill',         'Contraseña expirada'));

    if (d.accountExpDays !== null && d.accountExpDays !== undefined) {
        if (d.accountExpDays < 0)       badges.push(pill('bad',  'bi-calendar-x',     'Cuenta expirada'));
        else if (d.accountExpDays < 14) badges.push(pill('warn', 'bi-calendar-event', `Expira en ${d.accountExpDays}d`));
    }
    if (d.daysNoLogin !== null && d.daysNoLogin > 90)
        badges.push(pill('warn', 'bi-clock-history', `Sin login ${d.daysNoLogin}d`));
    if (d.daysNoLogin === null)
        badges.push(pill('lock', 'bi-question-circle', 'Nunca inició sesión'));

    // ─── Password status ───
    const pwdCls = d.pwdExpDays === null ? '' : d.pwdExpDays < 0 ? 'bad' : d.pwdExpDays < 14 ? 'warn' : 'ok';
    const pwdTxt = d.pwdExpDays === null ? '<span class="ic-val muted">No expira</span>'
        : d.pwdExpDays < 0  ? `<span class="ic-val bad">Expirada hace ${Math.abs(d.pwdExpDays)} días</span>`
        : `<span class="ic-val ${pwdCls}">${d.pwdExpDays} días restantes</span>`;

    // ─── Account expiry ───
    const accCls = d.accountExpDays === null ? '' : d.accountExpDays < 0 ? 'bad' : d.accountExpDays < 14 ? 'warn' : '';
    const accTxt = d.accountExpDate
        ? `<span class="ic-val ${accCls}">${fmtDate(d.accountExpDate)}${d.accountExpDays !== null ? ` (${d.accountExpDays}d)` : ''}</span>`
        : `<span class="ic-val muted">Sin expiración</span>`;

    // ─── Computer strip ───
    const compHtml = d.computer ? `
        <div class="comp-strip">
            <i class="bi bi-laptop comp-ico"></i>
            <div>
                <div class="comp-name">${esc(d.computer.name)}</div>
                <div class="comp-meta">${esc(d.computer.os || 'SO no registrado')}</div>
                <div class="comp-meta" style="margin-top:2px;">
                    <i class="bi bi-calendar-check me-1"></i>Último logon: ${fmtDate(d.computer.lastLogon)}
                </div>
            </div>
        </div>` :
        `<div style="margin-top:12px;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;">
            <i class="bi bi-pc-display"></i>Sin equipo asociado en Active Directory
        </div>`;

    // ─── Groups ───
    const groups = Array.isArray(d.groups) && d.groups.length
        ? d.groups.filter(Boolean).map(g => `<span class="grp-tag">${esc(g)}</span>`).join('')
        : '<span style="font-size:12px;color:var(--muted);">Sin grupos registrados</span>';

    // ─── Action buttons — siempre visibles, unlock deshabilitado si no está bloqueado ───
    const sa = esc(d.samAccount);
    const unlockDisabled = d.lockedOut ? '' : 'disabled title="La cuenta no está bloqueada"';
    const actions = `
        <button class="btn-act btn-pwd"    onclick="openResetModal('${sa}')">
            <i class="bi bi-key-fill"></i>Restablecer contraseña
        </button>
        <button class="btn-act btn-unlock" onclick="doUnlock('${sa}')" ${unlockDisabled}>
            <i class="bi bi-unlock-fill"></i>Desbloquear cuenta
        </button>
        <button class="btn-act btn-copy"   onclick="doCopy('${sa}','${esc(d.email||'')}','${esc(d.displayName||'')}')">
            <i class="bi bi-clipboard"></i>Copiar info
        </button>`;

    container.innerHTML = `
        <!-- Header -->
        <div class="u-header">
            <div class="u-avatar">${initials}</div>
            <div>
                <div class="u-name">${esc(d.displayName || d.samAccount)}</div>
                <div class="u-account">${esc(d.samAccount)}</div>
                <div class="badges">${badges.join('')}</div>
            </div>
        </div>

        <!-- Info grid -->
        <div class="info-grid">
            ${infoCell('bi-envelope',      'Correo electrónico',        esc(d.email||'—'), 'mono')}
            ${infoCell('bi-building',      'Departamento',              esc(d.department||'—'))}
            ${infoCell('bi-briefcase',     'Cargo / Título',            esc(d.title||'—'))}
            ${infoCell('bi-telephone',     'Teléfono',                  esc(d.phone||'—'))}
            ${infoCell('bi-calendar-check','Último login',
                `<span class="ic-val ${d.daysNoLogin > 90 ? 'warn' : ''}">${fmtDate(d.lastLogonDate)}
                ${d.daysNoLogin !== null ? `<span style="font-size:11px;opacity:.7;">(${d.daysNoLogin}d)</span>` : ''}</span>`, '', true)}
            ${infoCell('bi-key',           'Contraseña expira',         pwdTxt, '', true)}
            ${infoCell('bi-shield-lock',   'Pwd actualizada',           fmtDate(d.pwdLastSet))}
            ${infoCell('bi-calendar-x',    'Expiración cuenta',         accTxt, '', true)}
            ${infoCell('bi-calendar-plus', 'Cuenta creada',             fmtDate(d.created))}
            ${d.webPage ? infoCell('bi-globe', 'Página web',
                `<a href="${esc(d.webPage)}" target="_blank" rel="noopener"
                    style="color:var(--primary);font-size:12px;">${esc(d.webPage)}</a>`, '', false, true) : ''}
            ${infoCell('bi-info-circle',   'Descripción / Obs.',        esc(d.description||'—'), '', false, true)}
            ${infoCell('bi-diagram-3',     'Unidad Organizativa (OU)',
                `<span class="ic-val mono" style="font-size:11px;">${esc(d.ou||'—')}</span>`, '', true, true)}
        </div>

        <!-- Computer -->
        ${compHtml}

        <!-- Groups -->
        <div class="grp-wrap">
            <div class="grp-lbl"><i class="bi bi-people"></i>Grupos de seguridad</div>
            <div>${groups}</div>
        </div>

        <!-- Actions -->
        <div class="act-row">${actions}</div>
    `;
}

// ── Stale users ───────────────────────────────────────────────────────────────
let _staleData   = [];
let _offlineData = [];

function filterTable(data, q, cols, tbodyId, renderRow, emptyMsg, colCount) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const ql = q.toLowerCase();
    const filtered = q.length < 2 ? data : data.filter(r => cols.some(c => (r[c]||'').toLowerCase().includes(ql)));
    if (!filtered.length) { tbody.innerHTML = emptyRow(colCount, emptyMsg); return; }
    tbody.innerHTML = filtered.map(renderRow).join('');
}

async function loadStale() {
    const tbody = document.getElementById('staleBody');
    tbody.innerHTML = loadingRow(5);
    try {
        const { success, data, error } = await apiFetch(`${API}/stale-users`);
        if (!success) throw new Error(error);
        _staleData = data;
        renderStaleRows(data);
    } catch(e) { tbody.innerHTML = errorRow(5, e.message); }
}

function renderStaleRows(data) {
    const tbody = document.getElementById('staleBody');
    if (!data.length) { tbody.innerHTML = emptyRow(5, 'Sin usuarios inactivos +90d'); return; }
    tbody.innerHTML = data.map(u => `
        <tr>
            <td><span class="link-cell" onclick="quickSearch('${esc(u.account)}')" title="Ver en AD">${esc(u.account)}</span></td>
            <td>${esc(u.name || '—')}</td>
            <td style="font-size:12px;color:var(--muted);">${esc(u.department || '—')}</td>
            <td style="font-size:12px;color:var(--muted);">${esc(u.title || '—')}</td>
            <td>${daysBadge(u.days)}</td>
        </tr>`).join('');
}

// ── Offline computers ─────────────────────────────────────────────────────────
async function loadOffline() {
    const tbody = document.getElementById('offlineBody');
    tbody.innerHTML = loadingRow(4);
    try {
        const { success, data, error } = await apiFetch(`${API}/offline-computers`);
        if (!success) throw new Error(error);
        _offlineData = data;
        renderOfflineRows(data);
    } catch(e) { tbody.innerHTML = errorRow(4, e.message); }
}

function renderOfflineRows(data) {
    const tbody = document.getElementById('offlineBody');
    if (!data.length) { tbody.innerHTML = emptyRow(4, 'Sin equipos offline +30d'); return; }
    tbody.innerHTML = data.map(c => `
        <tr>
            <td><span class="mono-cell">${esc(c.name)}</span></td>
            <td style="font-size:12px;color:var(--muted);">${esc(c.os || 'Desconocido')}</td>
            <td style="font-size:12px;color:var(--muted);">${esc(c.desc || '—')}</td>
            <td>${daysBadge(c.days)}</td>
        </tr>`).join('');
}

// ── Filtros locales en tablas (0 ms, sin AD) ──────────────────────────────────
function initTableFilters() {
    // Stale users filter
    const staleInp = document.getElementById('staleFilter');
    if (staleInp) {
        staleInp.addEventListener('input', () => {
            const q = staleInp.value.trim().toLowerCase();
            const filtered = q.length < 2 ? _staleData
                : _staleData.filter(u => (u.account||'').toLowerCase().includes(q) || (u.name||'').toLowerCase().includes(q) || (u.department||'').toLowerCase().includes(q));
            renderStaleRows(filtered);
        });
    }
    // Offline computers filter
    const offInp = document.getElementById('offlineFilter');
    if (offInp) {
        offInp.addEventListener('input', () => {
            const q = offInp.value.trim().toLowerCase();
            const filtered = q.length < 2 ? _offlineData
                : _offlineData.filter(c => (c.name||'').toLowerCase().includes(q) || (c.os||'').toLowerCase().includes(q) || (c.desc||'').toLowerCase().includes(q));
            renderOfflineRows(filtered);
        });
    }
}

// ── Autocomplete en tablas (desde cache de usuarios/equipos) ──────────────────
function initTableAutocomplete() {
    setupTableAC('staleFilter', 'staleAcDrop', () => cache.users.data || [], 'account', 'name',
        item => { document.getElementById('staleFilter').value = item.account; document.getElementById('staleFilter').dispatchEvent(new Event('input')); });
    setupTableAC('offlineFilter', 'offlineAcDrop', () => cache.computers || [], 'name', 'os',
        item => { document.getElementById('offlineFilter').value = item.name; document.getElementById('offlineFilter').dispatchEvent(new Event('input')); });
}

// cache de equipos para autocomplete de tabla offline
const cache = { users: { data: null } };
async function warmTableCache() {
    try {
        const r = await apiFetch(`${API}/cache-status`);
        if (r.success && r.data.entries.kpis.loaded) {
            // usuarios ya en memoria del servidor, usamos el endpoint /search
        }
    } catch {}
}

function setupTableAC(inputId, dropId, getItems, keyField, labelField, onSelect) {
    const inp  = document.getElementById(inputId);
    const drop = document.getElementById(dropId);
    if (!inp || !drop) return;
    let tmt = null, idx = -1, results = [];

    inp.addEventListener('input', () => {
        const q = inp.value.trim().toLowerCase();
        clearTimeout(tmt);
        idx = -1;
        if (q.length < 2) { drop.style.display = 'none'; return; }
        tmt = setTimeout(() => {
            const items = getItems();
            results = items.filter(i => (i[keyField]||'').toLowerCase().includes(q) || (i[labelField]||'').toLowerCase().includes(q)).slice(0, 6);
            if (!results.length) { drop.style.display = 'none'; return; }
            const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
            drop.innerHTML = results.map((item, i) => `
                <div class="ac-item" onmousedown="void(0)" data-i="${i}"
                    style="padding:8px 12px;font-size:12px;display:flex;gap:10px;align-items:center;cursor:pointer;border-bottom:1px solid var(--border);">
                    <span class="ac-account" style="min-width:90px;">${(item[keyField]||'').replace(re,'<mark>$1</mark>')}</span>
                    <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item[labelField]||'')}</span>
                </div>`).join('');
            drop.style.display = 'block';
            drop.querySelectorAll('.ac-item').forEach((el, i) => {
                el.addEventListener('mousedown', e => { e.preventDefault(); onSelect(results[i]); drop.style.display = 'none'; });
            });
        }, 150);
    });

    inp.addEventListener('keydown', e => {
        const items = drop.querySelectorAll('.ac-item');
        if (!items.length || drop.style.display === 'none') return;
        if (e.key === 'ArrowDown') { e.preventDefault(); items[idx]?.classList.remove('active'); idx = Math.min(results.length-1, idx+1); items[idx]?.classList.add('active'); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[idx]?.classList.remove('active'); idx = Math.max(0, idx-1); items[idx]?.classList.add('active'); }
        else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); onSelect(results[idx]); drop.style.display = 'none'; }
        else if (e.key === 'Escape') { drop.style.display = 'none'; }
    });
    document.addEventListener('click', e => { if (!inp.contains(e.target) && !drop.contains(e.target)) drop.style.display = 'none'; });
}


// ── Autocomplete ──────────────────────────────────────────────────────────────
let acTimeout  = null;
let acIndex    = -1;
let acResults  = [];

function initAutocomplete() {
    const inp  = document.getElementById('searchInp');
    const drop = document.getElementById('acDrop');

    inp.addEventListener('input', () => {
        const q = inp.value.trim();
        clearTimeout(acTimeout);
        acIndex = -1;

        if (q.length < 2) { closeAC(); return; }

        acTimeout = setTimeout(() => fetchAC(q), 180); // debounce 180 ms
    });

    inp.addEventListener('keydown', e => {
        if (!drop.style.display || drop.style.display === 'none') return;
        if (e.key === 'ArrowDown') { e.preventDefault(); moveAC(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveAC(-1); }
        else if (e.key === 'Enter') {
            if (acIndex >= 0 && acResults[acIndex]) {
                e.preventDefault(); // evitar que también dispare searchUser
                selectAC(acResults[acIndex]);
            }
        }
        else if (e.key === 'Escape') { closeAC(); }
    });

    // Cerrar al hacer click fuera
    document.addEventListener('click', e => {
        if (!inp.contains(e.target) && !drop.contains(e.target)) closeAC();
    });
}

async function fetchAC(q) {
    const drop = document.getElementById('acDrop');
    try {
        const { success, data, warming } = await apiFetch(`${API}/search?q=${encodeURIComponent(q)}`);
        if (!success) return;

        if (warming) {
            drop.innerHTML = `<div class="ac-empty"><i class="bi bi-hourglass-split me-1"></i>Cache cargando, intenta en unos segundos...</div>`;
            drop.style.display = 'block';
            return;
        }

        if (!data.length) { closeAC(); return; }

        acResults = data;
        acIndex   = -1;
        renderAC(q);
    } catch { closeAC(); }
}

function renderAC(q) {
    const drop = document.getElementById('acDrop');
    const re   = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');

    drop.innerHTML = acResults.map((u, i) => `
        <div class="ac-item" data-idx="${i}" onmousedown="selectAC(acResults[${i}])">
            <span class="ac-dot ${u.enabled ? 'on' : 'off'}" title="${u.enabled ? 'Activa' : 'Inactiva'}"></span>
            <span class="ac-account">${u.account.replace(re, '<mark>$1</mark>')}</span>
            <span class="ac-name">${esc(u.name)}</span>
            <span class="ac-dept">${esc(u.dept)}</span>
        </div>`).join('');

    drop.style.display = 'block';
}

function moveAC(dir) {
    const items = document.querySelectorAll('#acDrop .ac-item');
    if (!items.length) return;
    items[acIndex]?.classList.remove('active');
    acIndex = Math.max(0, Math.min(acResults.length - 1, acIndex + dir));
    items[acIndex]?.classList.add('active');
    // Actualizar input con la cuenta resaltada (sin disparar búsqueda)
    document.getElementById('searchInp').value = acResults[acIndex].account;
}

function selectAC(user) {
    closeAC();
    document.getElementById('searchInp').value = user.account;
    searchUser(); // lanzar búsqueda inmediatamente
}

function closeAC() {
    const drop = document.getElementById('acDrop');
    if (drop) drop.style.display = 'none';
    acResults = [];
    acIndex   = -1;
}

// ── Cache status indicator ────────────────────────────────────────────────────
async function updateCacheStatus() {
    try {
        const { success, data } = await apiFetch(`${API}/cache-status`);
        if (!success) return;
        const dot   = document.getElementById('cacheDot');
        const label = document.getElementById('cacheLabel');
        if (!dot || !label) return;
        const age = data.entries.kpis.ageSeconds;
        const loaded = data.entries.kpis.loaded;
        if (!loaded) {
            dot.style.background = 'var(--warning)';
            label.textContent = data.refreshRunning ? 'Cargando AD...' : 'Cache vacío';
        } else if (data.refreshRunning) {
            dot.style.background = 'var(--info)';
            label.textContent = 'Actualizando...';
        } else {
            dot.style.background = 'var(--success)';
            const mins = Math.floor(age / 60);
            label.textContent = `Cache: hace ${mins < 1 ? '<1' : mins} min`;
        }
    } catch { /* silencioso */ }
}

async function forceRefresh() {
    const btn = document.getElementById('btnRefresh');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Actualizando...'; }
    try {
        await apiFetch(`${API}/refresh`, 'POST');
        toast('Refresh iniciado — los datos se actualizarán en ~30 seg', 'inf');
        // Esperar y recargar
        setTimeout(async () => {
            await loadKPIs();
            await loadStale();
            await loadOffline();
            updateCacheStatus();
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Actualizar cache'; }
        }, 35000);
    } catch(e) {
        toast('Error: ' + e.message, 'err');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Actualizar cache'; }
    }
}

// ── Reset password modal ──────────────────────────────────────────────────────
let _resetAccount = '';

function openResetModal(account) {
    _resetAccount = account;
    document.getElementById('resetModalAccount').textContent = account;
    document.getElementById('resetPwdInput').value   = '';
    document.getElementById('resetPwdConfirm').value = '';
    document.getElementById('resetError').style.display = 'none';
    document.getElementById('btnConfirmReset').disabled = true;
    document.getElementById('btnConfirmReset').style.opacity = '.5';
    // Reset rules
    ['rule-len','rule-upper','rule-num','rule-spec','rule-match'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.classList.remove('ok'); el.querySelector('i').className = 'bi bi-circle'; }
    });
    const modal = document.getElementById('resetModal');
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('resetPwdInput').focus(), 80);
}

function closeResetModal() {
    document.getElementById('resetModal').style.display = 'none';
    _resetAccount = '';
}

function togglePwdVisibility() {
    const inp = document.getElementById('resetPwdInput');
    const ico = document.getElementById('pwdToggleIco');
    if (inp.type === 'password') {
        inp.type = 'text';
        ico.className = 'bi bi-eye-slash';
    } else {
        inp.type = 'password';
        ico.className = 'bi bi-eye';
    }
}

function validatePwd(pwd) {
    const confirm = document.getElementById('resetPwdConfirm').value;
    const rules = {
        'rule-len':   pwd.length >= 8,
        'rule-upper': /[A-Z]/.test(pwd),
        'rule-num':   /[0-9]/.test(pwd),
        'rule-spec':  /[^A-Za-z0-9]/.test(pwd),
        'rule-match': pwd.length > 0 && pwd === confirm,
    };
    let allOk = true;
    for (const [id, ok] of Object.entries(rules)) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.classList.toggle('ok', ok);
        el.querySelector('i').className = ok ? 'bi bi-check-circle-fill' : 'bi bi-circle';
        if (!ok) allOk = false;
    }
    const btn = document.getElementById('btnConfirmReset');
    btn.disabled      = !allOk;
    btn.style.opacity = allOk ? '1' : '.5';
    btn.style.cursor  = allOk ? 'pointer' : 'not-allowed';
}

async function confirmReset() {
    const pwd = document.getElementById('resetPwdInput').value;
    const btn = document.getElementById('btnConfirmReset');
    const err = document.getElementById('resetError');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" style="width:13px;height:13px;"></span> Restableciendo...';
    err.style.display = 'none';

    try {
        const { success, message, error } = await apiFetch(`${API}/reset-password`, 'POST', {
            account:  _resetAccount,
            password: pwd,
        });
        if (!success) throw new Error(error);

        closeResetModal();
        toast(`✅ ${message}`, 'ok');
        // Refrescar datos del usuario en pantalla
        document.getElementById('searchInp').value = _resetAccount || document.getElementById('searchInp').value;
        searchUser();
    } catch(e) {
        err.textContent    = '❌ ' + e.message;
        err.style.display  = 'block';
        btn.disabled       = false;
        btn.innerHTML      = '<i class="bi bi-key-fill"></i> Restablecer contraseña';
    }
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function doUnlock(account) {
    if (!confirm(`¿Desbloquear la cuenta "${account}"?`)) return;
    try {
        const { success, message, error } = await apiFetch(`${API}/unlock`, 'POST', { account });
        if (!success) throw new Error(error);
        toast(message, 'ok');
        quickSearch(account);
        loadKPIs();
    } catch(e) { toast('Error desbloqueando: ' + e.message, 'err'); }
}

function doCopy(account, email, name) {
    const text = `Cuenta: ${account}\nNombre: ${name}\nEmail: ${email}`;
    navigator.clipboard.writeText(text)
        .then(() => toast('Info copiada al portapapeles', 'inf'))
        .catch(() => toast('No se pudo copiar', 'err'));
}

function quickSearch(account) {
    document.getElementById('searchInp').value = account;
    searchUser();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Helpers — DOM ─────────────────────────────────────────────────────────────
function pill(type, ico, label) {
    return `<span class="badge-pill bp-${type}"><i class="bi ${ico}"></i>${label}</span>`;
}

function infoCell(ico, lbl, val, valCls = '', rawVal = false, span2 = false) {
    const valHtml = rawVal ? val : `<div class="ic-val ${valCls}">${val}</div>`;
    return `<div class="info-cell${span2 ? ' span2' : ''}">
        <div class="ic-lbl"><i class="bi ${ico}"></i>${lbl}</div>
        ${valHtml}
    </div>`;
}

function skeletonUser() {
    return `
    <div style="display:flex;gap:20px;align-items:flex-start;">
        <div class="skel" style="width:68px;height:68px;border-radius:16px;flex-shrink:0;"></div>
        <div style="flex:1;">
            <div class="skel" style="width:220px;height:22px;margin-bottom:8px;"></div>
            <div class="skel" style="width:120px;height:14px;margin-bottom:10px;"></div>
            <div style="display:flex;gap:8px;">
                <div class="skel" style="width:80px;height:24px;border-radius:20px;"></div>
                <div class="skel" style="width:80px;height:24px;border-radius:20px;"></div>
            </div>
        </div>
    </div>
    <div class="info-grid" style="margin-top:16px;">
        ${Array(8).fill(0).map(()=>`
            <div class="info-cell">
                <div class="skel" style="width:70%;height:10px;margin-bottom:7px;"></div>
                <div class="skel" style="width:90%;height:15px;"></div>
            </div>`).join('')}
    </div>`;
}

function daysBadge(days) {
    if (days >= 9999) return `<span class="days-badge days-never">Nunca</span>`;
    if (days > 180)   return `<span class="days-badge days-bad">${days}d</span>`;
    if (days > 90)    return `<span class="days-badge days-warn">${days}d</span>`;
    return `<span class="days-badge days-ok">${days}d</span>`;
}

function loadingRow(cols) {
    return `<tr><td colspan="${cols}" class="empty-state"><i class="bi bi-hourglass-split"></i>Consultando Active Directory...</td></tr>`;
}
function emptyRow(cols, msg) {
    return `<tr><td colspan="${cols}" class="empty-state"><i class="bi bi-check2-circle"></i>${msg}</td></tr>`;
}
function errorRow(cols, msg) {
    return `<tr><td colspan="${cols}" class="empty-state"><i class="bi bi-exclamation-triangle"></i>${esc(msg)}</td></tr>`;
}

// ── Helpers — utils ───────────────────────────────────────────────────────────
function fmt(n) {
    return (n !== null && n !== undefined) ? Number(n).toLocaleString('es-PE') : '—';
}

function fmtDate(str) {
    if (!str) return '—';
    try {
        return new Date(str).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return str; }
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function apiFetch(url, method = 'GET', body = null) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    return res.json();
}

function toast(msg, type = 'inf') {
    const icons = { ok:'bi-check-circle-fill', err:'bi-exclamation-triangle-fill', inf:'bi-info-circle-fill', wrn:'bi-exclamation-circle-fill' };
    const colors= { ok:'var(--success)', err:'var(--danger)', inf:'var(--info)', wrn:'var(--warning)' };
    const el = document.createElement('div');
    el.className = `t-item t-${type}`;
    el.innerHTML = `<i class="bi ${icons[type]||icons.inf}" style="color:${colors[type]||colors.inf};font-size:16px;flex-shrink:0;"></i>${msg}`;
    document.getElementById('toastBox').appendChild(el);
    setTimeout(() => {
        el.style.cssText = 'opacity:0;transform:translateX(16px);transition:.25s;';
        setTimeout(() => el.remove(), 260);
    }, 5000);
}
