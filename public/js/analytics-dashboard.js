// ============================================================================
// analytics-dashboard.js — COMPLETO + DARK MODE
// ============================================================================

const API_BASE = '/api/dashboard';
let charts = {};
let tabsLoaded = { overview: false, distribution: false, locations: false, warranty: false, assignments: false };

// ============================================================================
// THEME HELPERS — colores dinámicos según data-theme
// ============================================================================
function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function themeColors() {
    const dark = isDark();
    return {
        text:        dark ? '#e2e8f0' : '#1e293b',
        textMuted:   dark ? '#94a3b8' : '#64748b',
        gridColor:   dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        tickColor:   dark ? '#94a3b8' : '#64748b',
        legendColor: dark ? '#e2e8f0' : '#1e293b',
        tooltipBg:   dark ? '#1e293b' : '#ffffff',
        tooltipBorder: dark ? '#334155' : '#e2e8f0',
        tooltipText: dark ? '#e2e8f0' : '#1e293b',
        panelBg:     dark ? '#1e293b' : '#ffffff',
        panelHeader: dark ? '#162032' : '#fafbfc',
        panelBorder: dark ? '#2d3f55' : '#e2e8f0',
        panelText:   dark ? '#e2e8f0' : '#1e293b',
        panelMuted:  dark ? '#94a3b8' : '#94a3b8',
        rowHover:    dark ? '#243348' : '#f8fafc',
        rowBorder:   dark ? '#2d3f55' : '#f1f5f9',
        inputBg:     dark ? '#1e293b' : '#ffffff',
        inputBorder: dark ? '#334155' : '#e2e8f0',
        inputText:   dark ? '#e2e8f0' : '#1e293b',
    };
}

// Defaults globales de Chart.js según tema
function applyChartDefaults() {
    const c = themeColors();
    Chart.defaults.color = c.tickColor;
    Chart.defaults.borderColor = c.gridColor;
    Chart.defaults.plugins.tooltip.backgroundColor = c.tooltipBg;
    Chart.defaults.plugins.tooltip.borderColor     = c.tooltipBorder;
    Chart.defaults.plugins.tooltip.borderWidth     = 1;
    Chart.defaults.plugins.tooltip.titleColor      = c.tooltipText;
    Chart.defaults.plugins.tooltip.bodyColor       = c.tooltipText;
    Chart.defaults.plugins.legend.labels.color     = c.legendColor;
}

// Reconstruir opciones de escala con colores del tema actual
function scaleOpts(extra = {}) {
    const c = themeColors();
    return {
        grid:  { color: c.gridColor },
        ticks: { color: c.tickColor },
        ...extra
    };
}

// ============================================================================
// updateChartsTheme — llamado por el toggle de dark mode
// ============================================================================
function updateChartsTheme(theme) {
    applyChartDefaults();
    updatePanelStyles();

    // Reconstruir cada gráfico activo con los nuevos colores
    if (charts.almacen)   { const d = charts.almacen.data.datasets[0].data; createChartAlmacen({ laptops: d[0], desktops: d[1], monitores: d[2] }); }
    if (charts.propios)   { cargarPropiosVsAlquilados(); }
    if (charts.historico) { cambiarPeriodoHistorico(document.getElementById('periodoSelector')?.value || 12); }
    if (charts.type)      { loadDistributionTab(); }
    if (charts.location)  { loadLocationsTab(); }
    if (charts.age)       { /* se recarga con loadDistributionTab */ }
}

// ============================================================================
// PANEL UNIVERSAL — estilos inyectados/actualizados dinámicamente
// ============================================================================
function updatePanelStyles() {
    const c = themeColors();
    let s = document.getElementById('_panelStyle');
    if (!s) { s = document.createElement('style'); s.id = '_panelStyle'; document.head.appendChild(s); }
    s.textContent = `
        .detalle-panel {
            background:${c.panelBg}; border-radius:12px;
            border:1px solid ${c.panelBorder};
            box-shadow:0 2px 8px rgba(0,0,0,.12);
            overflow:hidden; margin-top:20px;
            animation:panelSlide .2s ease;
        }
        @keyframes panelSlide {
            from { opacity:0; transform:translateY(-8px); }
            to   { opacity:1; transform:translateY(0); }
        }
        .detalle-panel .dp-header {
            padding:13px 20px; background:${c.panelHeader};
            border-bottom:1px solid ${c.panelBorder};
            display:flex; align-items:center;
            justify-content:space-between; flex-wrap:wrap; gap:8px;
        }
        .detalle-panel .dp-title {
            display:flex; align-items:center; gap:8px;
            font-weight:600; font-size:14px; color:${c.panelText};
        }
        .detalle-panel .dp-dot {
            width:11px; height:11px; border-radius:50%; flex-shrink:0;
        }
        .detalle-panel .dp-pill {
            background:${isDark() ? '#2d3f55' : '#f1f5f9'};
            color:${c.panelMuted};
            font-size:11px; font-weight:600;
            padding:2px 10px; border-radius:20px;
        }
        .detalle-panel .dp-controls { display:flex; align-items:center; gap:6px; }
        .detalle-panel .dp-controls .input-group { width:260px; }
        .detalle-panel .dp-controls .input-group-text {
            background:${c.inputBg}; border-color:${c.inputBorder};
            color:${c.panelMuted};
        }
        .detalle-panel .dp-controls .form-control {
            background:${c.inputBg}; border-color:${c.inputBorder};
            color:${c.inputText};
        }
        .detalle-panel .dp-controls .form-control::placeholder { color:${c.panelMuted}; }
        .detalle-panel .dp-controls .form-control:focus {
            background:${c.inputBg}; color:${c.inputText};
            border-color:${c.inputBorder}; box-shadow:none;
        }
        .detalle-panel .dp-controls .btn-outline-secondary {
            border-color:${c.inputBorder}; color:${c.panelMuted};
            background:${c.inputBg};
        }
        .detalle-panel .dp-controls .btn-outline-secondary:hover {
            background:${isDark() ? '#2d3f55' : '#f1f5f9'}; color:${c.panelText};
        }
        .detalle-panel .dp-close {
            background:none; border:none; cursor:pointer;
            color:${c.panelMuted}; font-size:22px;
            line-height:1; padding:0 4px; transition:color .15s;
        }
        .detalle-panel .dp-close:hover { color:#ef4444; }
        .detalle-panel .dp-body {
            max-height:440px; overflow-y:auto; overflow-x:auto;
            background:${c.panelBg};
        }
        .detalle-panel table { width:100%; border-collapse:collapse; font-size:13px; }
        .detalle-panel thead th {
            font-size:10px; text-transform:uppercase;
            color:${c.panelMuted}; font-weight:600;
            padding:10px 14px; background:${c.panelHeader};
            border-bottom:1px solid ${c.panelBorder};
            position:sticky; top:0; z-index:5;
            white-space:nowrap; text-align:center;
        }
        .detalle-panel thead th:first-child { text-align:left; }
        .detalle-panel tbody td {
            padding:11px 14px; border-bottom:1px solid ${c.rowBorder};
            vertical-align:middle; text-align:center;
            color:${c.panelText};
        }
        .detalle-panel tbody td:first-child { text-align:left; }
        .detalle-panel tbody td strong { color:${c.panelText}; }
        .detalle-panel tbody tr:last-child td { border-bottom:none; }
        .detalle-panel tbody tr:hover td { background:${c.rowHover}; }
        .detalle-panel .dp-body::-webkit-scrollbar { width:5px; height:5px; }
        .detalle-panel .dp-body::-webkit-scrollbar-thumb {
            background:${isDark() ? '#334155' : '#cbd5e1'}; border-radius:3px;
        }
        .dp-empty {
            text-align:center; padding:52px 20px;
            color:${c.panelMuted}; font-size:13px;
            background:${c.panelBg};
        }
        .dp-empty i { font-size:38px; display:block; margin-bottom:10px; opacity:.25; }
        .dp-spin {
            display:inline-block; width:16px; height:16px;
            border:2px solid ${isDark() ? '#334155' : '#e2e8f0'};
            border-top-color:#3b82f6; border-radius:50%;
            animation:dpSpin .65s linear infinite;
            vertical-align:middle; margin-right:6px;
        }
        @keyframes dpSpin { to { transform:rotate(360deg); } }
    `;
}

// Init estilos al cargar
updatePanelStyles();

// Estado del panel activo
let _panelActivo = { chartId: null, key: null };
window._panelData = [];

// ──────────────────────────────────────────────────────────────────────────────
// Crear / alternar panel universal
// ──────────────────────────────────────────────────────────────────────────────
async function mostrarPanel({ anchorEl, panelId, chartId, key, title, color, fetchFn, columns, searchKeys }) {
    const existing = document.getElementById(panelId);
    if (_panelActivo.chartId === chartId && _panelActivo.key === key && existing) {
        existing.remove();
        _panelActivo = { chartId: null, key: null };
        return;
    }
    _panelActivo = { chartId, key };
    document.getElementById(panelId)?.remove();

    const panel = document.createElement('div');
    panel.id = panelId;
    panel.className = 'detalle-panel';
    panel.innerHTML = `
        <div class="dp-header">
            <div class="dp-title">
                <span class="dp-dot" style="background:${color}"></span>
                ${title}
                <span class="dp-pill" id="${panelId}_count">…</span>
            </div>
            <div class="dp-controls">
                <div class="input-group input-group-sm">
                    <span class="input-group-text"><i class="bi bi-search"></i></span>
                    <input type="text" class="form-control" id="${panelId}_search"
                           placeholder="Buscar..." oninput="filtrarPanel('${panelId}')">
                    <button class="btn btn-outline-secondary"
                            onclick="document.getElementById('${panelId}_search').value='';filtrarPanel('${panelId}')">
                        <i class="bi bi-x"></i>
                    </button>
                </div>
                <button class="btn btn-sm btn-outline-secondary"
                        onclick="exportarPanel('${panelId}')" title="Exportar CSV">
                    <i class="bi bi-download"></i>
                </button>
                <button class="dp-close"
                        onclick="document.getElementById('${panelId}').remove();_panelActivo={chartId:null,key:null};">×</button>
            </div>
        </div>
        <div class="dp-body" id="${panelId}_body">
            <div class="dp-empty"><span class="dp-spin"></span> Cargando...</div>
        </div>`;

    anchorEl.insertAdjacentElement('afterend', panel);
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);

    try {
        const data = await fetchFn();
        window._panelData = data;
        window._panelColumns = columns;
        window._panelSearchKeys = searchKeys || columns.map(c => c.key);
        document.getElementById(`${panelId}_count`).textContent = data.length;
        renderPanel(panelId, data, columns);
    } catch (err) {
        console.error(err);
        document.getElementById(`${panelId}_body`).innerHTML =
            '<div class="dp-empty"><i class="bi bi-exclamation-circle"></i> Error al cargar datos.</div>';
    }
}

function renderPanel(panelId, data, columns) {
    const body = document.getElementById(`${panelId}_body`);
    if (!body) return;
    if (!data.length) {
        body.innerHTML = '<div class="dp-empty"><i class="bi bi-inbox"></i> Sin resultados.</div>';
        return;
    }
    body.innerHTML = `
        <table>
            <thead><tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
            <tbody>
                ${data.map(row => `
                    <tr>${columns.map(c => `<td>${c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}</td>`).join('')}</tr>
                `).join('')}
            </tbody>
        </table>`;
}

function filtrarPanel(panelId) {
    const input = document.getElementById(`${panelId}_search`);
    const t     = (input?.value || '').toLowerCase().trim();
    const all   = window._panelData || [];
    const keys  = window._panelSearchKeys || [];
    const filtered = t.length < 1 ? all : all.filter(row =>
        keys.some(k => (row[k] || '').toString().toLowerCase().includes(t))
    );
    const countEl = document.getElementById(`${panelId}_count`);
    if (countEl) countEl.textContent = filtered.length;
    renderPanel(panelId, filtered, window._panelColumns || []);
}

function exportarPanel(panelId) {
    const data    = window._panelData || [];
    const columns = window._panelColumns || [];
    if (!data.length) return;
    const header = columns.map(c => c.label).join(',');
    const rows   = data.map(row =>
        columns.map(c => `"${(row[c.key] ?? '').toString().replace(/"/g, '""')}"`).join(',')
    );
    const csv  = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${panelId}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
}

// ============================================================================
// HELPERS DE RENDER
// ============================================================================
const sBg = { Disponible:'#cffafe', Asignado:'#dcfce7', Mantenimiento:'#fef9c3', Obsoleto:'#fee2e2', 'En Garantía':'#ede9fe' };
const sFg = { Disponible:'#0e7490', Asignado:'#16a34a', Mantenimiento:'#92400e', Obsoleto:'#dc2626', 'En Garantía':'#6d28d9' };

const renderMono  = v => `<strong style="font-family:monospace;font-size:12px;">${v||'—'}</strong>`;
const renderMono2 = v => `<span style="font-family:monospace;font-size:11px;color:${isDark()?'#94a3b8':'#64748b'};">${v||'—'}</span>`;
const renderBadge = v => `<span class="badge bg-secondary">${v||'—'}</span>`;
const renderUbic  = v => v
    ? `<span style="background:${isDark()?'#1e3a5f':'#dbeafe'};color:${isDark()?'#60a5fa':'#1d4ed8'};font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;">${v}</span>`
    : `<span style="color:#94a3b8;font-size:12px;">—</span>`;
const renderStatus = v => `<span style="background:${sBg[v]||'#f1f5f9'};color:${sFg[v]||'#475569'};font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;">${v||'—'}</span>`;
const renderNum    = v => `<span class="badge bg-primary">${v||0}</span>`;

const COLS_EQUIPOS = [
    { key: 'device_code',     label: 'CÓDIGO',     render: renderMono },
    { key: 'serial_number',   label: 'SERIE',      render: renderMono2 },
    { key: 'equipment_type',  label: 'TIPO' },
    { key: 'brand',           label: 'MARCA',      render: v => `<strong>${v||'—'}</strong>` },
    { key: 'model',           label: 'MODELO',     render: v => `<span style="color:${isDark()?'#94a3b8':'#64748b'};font-size:12px;">${v||'—'}</span>` },
    { key: 'processor',       label: 'PROCESADOR', render: v => `<span style="font-size:11px;color:${isDark()?'#94a3b8':'#475569'};max-width:160px;word-break:break-word;display:block;">${v||'—'}</span>` },
    { key: 'ram_memory',      label: 'RAM',        render: renderBadge },
    { key: 'disk_capacity',   label: 'DISCO',      render: renderBadge },
    { key: 'branch_office_id',label: 'UBICACIÓN',  render: renderUbic },
    { key: 'status',          label: 'ESTADO',     render: renderStatus }
];
const SEARCH_EQUIPOS = ['device_code','serial_number','brand','model','processor','branch_office_id','ram_memory'];

// ============================================================================
// CACHE GLOBAL
// ============================================================================
const _cache = {
    equipos: null, asignaciones: null,
    _promEquipos: null, _promAsig: null,
};

async function getEquipos() {
    if (_cache.equipos)      return _cache.equipos;
    if (_cache._promEquipos) return _cache._promEquipos;
    _cache._promEquipos = fetch('/api/equipment?limit=5000', { credentials: 'include' })
        .then(r => r.json())
        .then(j => { _cache.equipos = j.data || []; return _cache.equipos; })
        .catch(() => []);
    return _cache._promEquipos;
}

async function getAsignaciones() {
    if (_cache.asignaciones) return _cache.asignaciones;
    if (_cache._promAsig)    return _cache._promAsig;
    _cache._promAsig = fetch('/api/dashboard/asignaciones-largas', { credentials: 'include' })
        .then(r => r.json())
        .then(j => { _cache.asignaciones = j.data || []; return _cache.asignaciones; })
        .catch(() => []);
    return _cache._promAsig;
}

// ============================================================================
// CARGA INICIAL
// ============================================================================
async function loadAllData() {
    fetch(`${API_BASE}/stats-completo`).then(r => r.json()).then(j => { if (j.success) updateKPIs(j.data); }).catch(() => {});
    fetch(`${API_BASE}/fast-all`).then(r => r.json()).then(j => { if (j.success) createChartAlmacen(j.almacen); }).catch(() => {});
    cargarPropiosVsAlquilados();
    fetch(`${API_BASE}/historico-asignaciones?meses=12`).then(r => r.json()).then(j => { if (j.success) createChartHistorico(j.data, j.estadisticas); }).catch(() => {});
    getEquipos();
    getAsignaciones();
    tabsLoaded.overview = true;
}

// ============================================================================
// KPIs
// ============================================================================
function updateKPIs(s) {
    if (!s) return;
    $('#kpiTotalEquipos').text(s.totalEquipos        || 0);
    $('#equiposAsignados').text(s.equiposAsignados    || 0);
    $('#equiposDisponibles').text(s.equiposDisponibles || 0);
    $('#equiposGarantia').text(s.equiposGarantia      || 0);
}

// ============================================================================
// GRÁFICO 1 — ALMACÉN
// ============================================================================
const TIPO_MAP    = { 'Laptops':'laptop', 'Desktops':'Desktop', 'Monitores':'Monitor' };
const TIPO_COLORS = ['#36a2eb', '#ff6384', '#4bc0c0'];

function createChartAlmacen(data) {
    const ctx = document.getElementById('chartEquiposAsignados');
    if (!ctx) return;
    Chart.getChart(ctx)?.destroy();
    document.getElementById('sk_almacen')?.classList.add('hidden');
    ctx.style.display = '';

    const d = data || {};
    const c = themeColors();

    charts.almacen = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Laptops', 'Desktops', 'Monitores'],
            datasets: [{
                label: 'Disponibles en Almacén',
                data: [d.laptops||0, d.desktops||0, d.monitores||0],
                backgroundColor: TIPO_COLORS,
                hoverBackgroundColor: ['#1a8fd1','#d03060','#2a9898'],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: c.tooltipBg,
                    borderColor: c.tooltipBorder,
                    borderWidth: 1,
                    titleColor: c.tooltipText,
                    bodyColor: c.tooltipText,
                    callbacks: { afterLabel: () => '  👆 Clic para ver equipos' }
                }
            },
            scales: {
                y: { ...scaleOpts({ beginAtZero: true, ticks: { stepSize: 1, color: c.tickColor } }) },
                x: { ...scaleOpts() }
            },
            onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
            onClick: (e, el) => {
                if (!el.length) return;
                const idx   = el[0].index;
                const label = charts.almacen.data.labels[idx];
                const tipo  = TIPO_MAP[label] || label;
                const color = TIPO_COLORS[idx];
                const anchor = document.getElementById('chartEquiposAsignados').closest('.row');
                mostrarPanel({
                    anchorEl: anchor, panelId: 'panel_almacen', chartId: 'almacen',
                    key: tipo, title: `${label} disponibles en almacén`, color,
                    columns: COLS_EQUIPOS, searchKeys: SEARCH_EQUIPOS,
                    fetchFn: async () => {
                        const all = await getEquipos();
                        return all.filter(e =>
                            (e.equipment_type||'').toLowerCase() === tipo.toLowerCase() &&
                            (e.status||'').toLowerCase().includes('disponible')
                        );
                    }
                });
            }
        }
    });
}

// ============================================================================
// GRÁFICO 2 — PROPIOS VS ALQUILADOS
// ============================================================================
async function cargarPropiosVsAlquilados() {
    const ctx = document.getElementById('chartPropiosAlquilados');
    if (!ctx) return;
    try {
        const res  = await fetch(`${API_BASE}/propios-arrendados`);
        const json = await res.json();
        if (!json.success || !json.data?.length) {
            ctx.closest('.chart-container').innerHTML =
                '<div class="dp-empty"><i class="bi bi-info-circle"></i> Sin datos de adquisición</div>';
            return;
        }
        const data  = json.data;
        const total = data.reduce((s, d) => s + Number(d.cantidad||0), 0);
        const c     = themeColors();

        const COLOR_MAP = {
            'Propio':      { bg:'rgba(59,130,246,0.85)',  border:'#3b82f6' },
            'Arrendado':   { bg:'rgba(245,158,11,0.85)',  border:'#f59e0b' },
            'Leasing':     { bg:'rgba(16,185,129,0.85)',  border:'#10b981' },
            'Donado':      { bg:'rgba(139,92,246,0.85)',  border:'#8b5cf6' },
            'Sin Definir': { bg:'rgba(148,163,184,0.85)', border:'#94a3b8' }
        };
        const fallbacks = ['#ef4444','#06b6d4','#ec4899','#84cc16'];
        let fi = 0;
        const bgColors     = data.map(d => COLOR_MAP[d.acquisition_type]?.bg     || fallbacks[fi++] || '#94a3b8');
        const borderColors = data.map(d => COLOR_MAP[d.acquisition_type]?.border || bgColors[0]);

        Chart.getChart(ctx)?.destroy();
        document.getElementById('sk_propios')?.classList.add('hidden');
        ctx.style.display = '';

        charts.propios = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.map(d => d.acquisition_type || 'Sin Definir'),
                datasets: [{ data: data.map(d => Number(d.cantidad||0)), backgroundColor: bgColors, borderColor: borderColors, borderWidth: 2, hoverOffset: 14 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '62%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 12,
                            font: { size: 11 },
                            usePointStyle: true,
                            // ✅ color explícito para que se vea en dark mode
                            color: c.legendColor,
                            generateLabels(chart) {
                                return chart.data.labels.map((label, i) => {
                                    const val = chart.data.datasets[0].data[i];
                                    const pct = total ? ((val/total)*100).toFixed(0) : 0;
                                    return {
                                        text: `${label}  ${val} (${pct}%)`,
                                        fillStyle: chart.data.datasets[0].backgroundColor[i],
                                        strokeStyle: chart.data.datasets[0].borderColor[i],
                                        fontColor: c.legendColor,  // ✅ color de fuente
                                        hidden: false, index: i
                                    };
                                });
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: c.tooltipBg,
                        borderColor: c.tooltipBorder,
                        borderWidth: 1,
                        titleColor: c.tooltipText,
                        bodyColor: c.tooltipText,
                        callbacks: {
                            label(ctx2) {
                                const pct = total ? ((ctx2.parsed/total)*100).toFixed(1) : 0;
                                return `  ${ctx2.label}: ${ctx2.parsed} equipos (${pct}%)`;
                            }
                        }
                    }
                },
                onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
                onClick: (e, el) => {
                    if (!el.length) return;
                    const idx      = el[0].index;
                    const label    = charts.propios.data.labels[idx];
                    const color    = bgColors[idx];
                    const anchorEl = document.getElementById('chartPropiosAlquilados').closest('.row');
                    mostrarPanel({
                        anchorEl, panelId: 'panel_propios', chartId: 'propios',
                        key: label, title: `Equipos ${label}`, color,
                        columns: [
                            ...COLS_EQUIPOS,
                            { key:'acquisition_type', label:'ADQUISICIÓN', render: v => `<span style="background:${isDark()?'#2d3f55':'#f1f5f9'};color:${isDark()?'#94a3b8':'#475569'};font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;">${v||'—'}</span>` }
                        ],
                        searchKeys: [...SEARCH_EQUIPOS, 'acquisition_type'],
                        fetchFn: async () => {
                            const all = await getEquipos();
                            return all.filter(e => (e.acquisition_type || 'Sin Definir') === label);
                        }
                    });
                }
            }
        });

        const propios    = data.find(d => d.acquisition_type === 'Propio');
        const alquilados = data.filter(d => ['Arrendado','Leasing'].includes(d.acquisition_type)).reduce((s,d)=>s+Number(d.cantidad),0);
        const otros      = data.filter(d => !['Propio','Arrendado','Leasing'].includes(d.acquisition_type)).reduce((s,d)=>s+Number(d.cantidad),0);
        $('#statPropios').text(propios ? Number(propios.cantidad).toLocaleString('es-PE') : '0');
        $('#statAlquilados').text(alquilados.toLocaleString('es-PE'));
        $('#statOtros').text(otros.toLocaleString('es-PE'));

    } catch (err) { console.error('❌ Propios vs Alquilados:', err); }
}

// ============================================================================
// GRÁFICO 3 — HISTÓRICO
// ============================================================================
let _historicoData = [];

function createChartHistorico(data, estadisticas) {
    const ctx = document.getElementById('myBarChart');
    if (!ctx || !data?.length) return;
    Chart.getChart(ctx)?.destroy();
    document.getElementById('sk_historico')?.classList.add('hidden');
    ctx.style.display = '';

    _historicoData = data;
    data.sort((a,b) => (a.mes||'').localeCompare(b.mes||''));
    const c = themeColors();

    charts.historico = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(h => (h.mes_nombre||h.mes||'').split(' ')[0]),
            datasets: [{
                label: 'Asignaciones',
                data: data.map(h => h.total||h.total_asignaciones||0),
                backgroundColor: '#4e73df',
                hoverBackgroundColor: '#2952c8',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: c.tooltipBg,
                    borderColor: c.tooltipBorder,
                    borderWidth: 1,
                    titleColor: c.tooltipText,
                    bodyColor: c.tooltipText,
                    callbacks: { afterLabel: () => '  👆 Clic para ver detalle' }
                }
            },
            scales: {
                y: { ...scaleOpts({ beginAtZero: true }) },
                x: { ...scaleOpts({ grid: { display: false } }) }
            },
            onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
            onClick: (e, el) => {
                if (!el.length) return;
                const idx     = el[0].index;
                const mesData = _historicoData[idx];
                const label   = mesData.mes_nombre || mesData.mes || `Mes ${idx+1}`;
                const anchor  = document.getElementById('myBarChart').closest('.row');
                mostrarPanel({
                    anchorEl: anchor, panelId: 'panel_historico', chartId: 'historico',
                    key: mesData.mes || idx, title: `Asignaciones — ${label}`, color: '#4e73df',
                    columns: [
                        { key:'device_code',    label:'CÓDIGO',    render: renderMono },
                        { key:'serial_number',  label:'SERIE',     render: renderMono2 },
                        { key:'equipment_type', label:'TIPO' },
                        { key:'brand',          label:'MARCA',     render: v => `<strong>${v||'—'}</strong>` },
                        { key:'model',          label:'MODELO',    render: v => `<span style="color:${isDark()?'#94a3b8':'#64748b'};font-size:12px;">${v||'—'}</span>` },
                        { key:'employee_name',  label:'EMPLEADO',  render: v => `<strong>${v||'—'}</strong>` },
                        { key:'assignment_date',label:'FECHA ASIG',render: v => v ? new Date(v).toLocaleDateString('es-PE') : '—' },
                        { key:'branch_office_id',label:'UBICACIÓN', render: renderUbic },
                        { key:'status',         label:'ESTADO',    render: renderStatus }
                    ],
                    searchKeys: ['device_code','brand','model','employee_name','branch_office_id'],
                    fetchFn: async () => {
                        const all = await getAsignaciones();
                        const [anio, mes] = (mesData.mes || '').split('-');
                        if (anio && mes) {
                            const filtrado = all.filter(a => {
                                if (!a.assignment_date) return false;
                                const d = new Date(a.assignment_date);
                                return d.getFullYear() == anio && (d.getMonth()+1) == parseInt(mes);
                            });
                            if (filtrado.length) return filtrado;
                        }
                        const total = mesData.total || mesData.total_asignaciones || 0;
                        return [{
                            device_code: '—', serial_number: '—', equipment_type: 'Resumen del mes',
                            brand: '—', model: '—', employee_name: `${total} asignaciones registradas`,
                            assignment_date: mesData.mes ? `${mesData.mes}-01` : null,
                            branch_office_id: null, status: 'Asignado'
                        }];
                    }
                });
            }
        }
    });

    if (estadisticas) {
        $('#totalAsignaciones').text(estadisticas.total_asignaciones?.toLocaleString('es-PE') || 0);
        $('#promedioMensual').text(estadisticas.promedio_mensual || 0);
        $('#mesPico').text(estadisticas.mes_pico?.mes?.split(' ')[0] || '—');
    }
}

async function cambiarPeriodoHistorico(meses) {
    try {
        const res  = await fetch(`${API_BASE}/historico-asignaciones?meses=${meses}`);
        const json = await res.json();
        if (json.success) createChartHistorico(json.data, json.estadisticas);
    } catch(err) { console.error(err); }
}

// ============================================================================
// LAZY LOADING DE PESTAÑAS
// ============================================================================
$(document).on('shown.bs.tab', 'button[data-bs-toggle="tab"]', function (e) {
    const id = $(e.target).data('bs-target').replace('#', '');
    if (!tabsLoaded[id]) { loadTabData(id); tabsLoaded[id] = true; }
});

async function loadTabData(tabId) {
    try {
        if (tabId === 'distribution') await loadDistributionTab();
        if (tabId === 'locations')    await loadLocationsTab();
        if (tabId === 'warranty')     await loadWarrantyTab();
        if (tabId === 'assignments')  await loadAssignmentsTab();
    } catch (err) { console.error(`❌ Tab ${tabId}:`, err); }
}

// ============================================================================
// TAB DISTRIBUCIÓN
// ============================================================================
async function loadDistributionTab() {
    const [tipoRes, ageRes] = await Promise.all([
        fetch(`${API_BASE}/equipos-por-tipo`).then(r => r.json()),
        fetch(`${API_BASE}/antiguedad-promedio`).then(r => r.json())
    ]);
    if (tipoRes.success) { createTypeChart(tipoRes.data); fillTypeDetailTable(tipoRes.data); }
    if (ageRes.success)   createAgeChart(ageRes.data);
}

function createTypeChart(data) {
    const ctx = document.getElementById('typeChart');
    if (!ctx) return;
    Chart.getChart(ctx)?.destroy();
    const c      = themeColors();
    const colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

    charts.type = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.tipo),
            datasets: [
                { label: 'Total',       data: data.map(d => d.total),       backgroundColor: '#3b82f6' },
                { label: 'Asignados',   data: data.map(d => d.asignados),   backgroundColor: '#10b981' },
                { label: 'Disponibles', data: data.map(d => d.disponibles), backgroundColor: '#8b5cf6' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: c.legendColor } },
                tooltip: {
                    backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
                    borderWidth: 1, titleColor: c.tooltipText, bodyColor: c.tooltipText,
                    callbacks: { afterBody: () => ['', '  👆 Clic para ver equipos'] }
                }
            },
            scales: {
                y: { ...scaleOpts({ beginAtZero: true }) },
                x: { ...scaleOpts() }
            },
            onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
            onClick: (e, el) => {
                if (!el.length) return;
                const idx      = el[0].index;
                const tipoItem = data[idx];
                const color    = colors[idx % colors.length];
                const anchor   = document.getElementById('typeChart').closest('.col-md-8') || document.getElementById('typeChart').closest('.row');
                mostrarPanel({
                    anchorEl: anchor, panelId: 'panel_tipo', chartId: 'tipo',
                    key: tipoItem.tipo, title: `Equipos — ${tipoItem.tipo}`, color,
                    columns: COLS_EQUIPOS, searchKeys: SEARCH_EQUIPOS,
                    fetchFn: async () => {
                        const all = await getEquipos();
                        return all.filter(e => (e.equipment_type||'').toLowerCase() === tipoItem.tipo.toLowerCase());
                    }
                });
            }
        }
    });
}

function createAgeChart(data) {
    const ctx = document.getElementById('ageChart');
    if (!ctx) return;
    Chart.getChart(ctx)?.destroy();
    const c = themeColors();
    charts.age = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.equipment_type),
            datasets: [{ label: 'Años', data: data.map(d => d.antiguedad_promedio), backgroundColor: '#f59e0b' }]
        },
        options: {
            indexAxis:'y', responsive:true, maintainAspectRatio:false,
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1, titleColor: c.tooltipText, bodyColor: c.tooltipText }
            },
            scales: {
                y: { ...scaleOpts() },
                x: { ...scaleOpts({ beginAtZero: true }) }
            }
        }
    });
}

function fillTypeDetailTable(data) {
    const tbody = $('#typeDetailTableBody');
    if (!tbody.length) return;
    tbody.empty();
    data.forEach(item => {
        const pct = parseFloat(item.porcentaje_asignados) || 0;
        tbody.append(`<tr>
            <td><strong>${item.tipo}</strong></td>
            <td>${item.total}</td>
            <td><span class="badge bg-success">${item.asignados}</span></td>
            <td><span class="badge bg-primary">${item.disponibles}</span></td>
            <td><div class="progress" style="height:18px;"><div class="progress-bar" style="width:${pct}%">${pct.toFixed(1)}%</div></div></td>
        </tr>`);
    });
}

// ============================================================================
// TAB UBICACIONES
// ============================================================================
let _ubicData = [];

async function loadLocationsTab() {
    const res = await fetch(`${API_BASE}/equipos-por-ubicacion`).then(r => r.json());
    if (res.success) { _ubicData = res.data; createLocationChart(res.data); fillLocationTable(res.data); }
}

function createLocationChart(data) {
    const ctx = document.getElementById('locationChart');
    if (!ctx) return;
    Chart.getChart(ctx)?.destroy();
    const c     = themeColors();
    const top10 = data.slice(0, 10);
    const UBIC_COLORS = ['#3b82f6','#10b981','#f59e0b'];

    charts.location = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top10.map(d => d.ubicacion),
            datasets: [
                { label:'Laptops',   data:top10.map(d=>d.laptops),   backgroundColor:UBIC_COLORS[0], stack:'a' },
                { label:'Desktops',  data:top10.map(d=>d.desktops),  backgroundColor:UBIC_COLORS[1], stack:'a' },
                { label:'Monitores', data:top10.map(d=>d.monitores), backgroundColor:UBIC_COLORS[2], stack:'a' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position:'top', labels: { color: c.legendColor } },
                tooltip: {
                    backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
                    borderWidth: 1, titleColor: c.tooltipText, bodyColor: c.tooltipText,
                    callbacks: { afterBody: () => ['', '  👆 Clic para ver equipos'] }
                }
            },
            scales: {
                x: { stacked:true, ...scaleOpts() },
                y: { stacked:true, beginAtZero:true, ...scaleOpts() }
            },
            onHover: (e, el) => { e.native.target.style.cursor = el.length ? 'pointer' : 'default'; },
            onClick: (e, el) => {
                if (!el.length) return;
                const idx      = el[0].index;
                const ubicItem = top10[idx];
                const anchor   = document.getElementById('locationChart').closest('.col-12') || document.getElementById('locationChart').closest('.row');
                mostrarPanel({
                    anchorEl: anchor, panelId: 'panel_ubicacion', chartId: 'ubicacion',
                    key: ubicItem.ubicacion, title: `Equipos en ${ubicItem.ubicacion}`, color: '#3b82f6',
                    columns: COLS_EQUIPOS, searchKeys: SEARCH_EQUIPOS,
                    fetchFn: async () => {
                        const all = await getEquipos();
                        const u   = ubicItem.ubicacion.toLowerCase();
                        return all.filter(e =>
                            (e.branch_office_id||'').toLowerCase().includes(u) ||
                            (e.location_name   ||'').toLowerCase().includes(u)
                        );
                    }
                });
            }
        }
    });
}

function fillLocationTable(data) {
    const tbody = $('#locationTableBody');
    if (!tbody.length) return;
    tbody.empty();
    data.forEach(item => {
        tbody.append(`<tr>
            <td><strong>${item.ubicacion}</strong></td>
            <td>${item.ciudad}</td>
            <td><span class="badge bg-primary">${item.total_equipos}</span></td>
            <td>${item.laptops}</td><td>${item.desktops}</td>
            <td>${item.monitores}</td><td>${item.tablets}</td>
        </tr>`);
    });
}

// ============================================================================
// TAB GARANTÍAS
// ============================================================================
async function loadWarrantyTab() {
    const res = await fetch(`${API_BASE}/equipos-garantia`).then(r => r.json());
    if (res.success) fillWarrantyTable(res.data);
}

function fillWarrantyTable(data) {
    const tbody = $('#warrantyTableBody');
    if (!tbody.length) return;
    $('#warrantyAlertCount').text(data.filter(d => d.dias_restantes <= 30).length);
    tbody.empty();
    data.forEach(item => {
        const u = item.dias_restantes <= 30;
        tbody.append(`<tr class="${u ? 'table-warning' : ''}">
            <td><strong>${item.device_code}</strong></td>
            <td>${item.equipment_type}</td>
            <td>${item.brand}</td>
            <td>${item.model}</td>
            <td>${new Date(item.warranty_end).toLocaleDateString('es-PE')}</td>
            <td><span class="badge ${u?'bg-danger':'bg-success'}">${item.dias_restantes} días</span></td>
            <td>${u?'<i class="bi bi-exclamation-triangle text-danger"></i>':'<i class="bi bi-check-circle text-success"></i>'}</td>
        </tr>`);
    });
}

// ============================================================================
// TAB ASIGNACIONES
// ============================================================================
async function loadAssignmentsTab() {
    const [asignaciones, tiempoRes] = await Promise.all([
        getAsignaciones(),
        fetch(`${API_BASE}/tiempo-asignacion-promedio`).then(r => r.json())
    ]);
    if (tiempoRes.success) createAssignmentTimeChart(tiempoRes.data);
    if (asignaciones.length) fillAssignmentsTable(asignaciones);
}

function createAssignmentTimeChart(data) {
    const ctx = document.getElementById('assignmentTimeChart');
    if (!ctx) return;
    Chart.getChart(ctx)?.destroy();
    const c = themeColors();
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.equipment_type),
            datasets: [{
                label: 'Días Promedio',
                data: data.map(d => d.dias_promedio),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.1)',
                fill: true, tension: 0.4
            }]
        },
        options: {
            responsive:true, maintainAspectRatio:false,
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1, titleColor: c.tooltipText, bodyColor: c.tooltipText }
            },
            scales: {
                y: { ...scaleOpts() },
                x: { ...scaleOpts() }
            }
        }
    });
}

function fillAssignmentsTable(data) {
    const tbody = $('#assignmentsTableBody');
    if (!tbody.length) return;
    tbody.empty();
    data.forEach(item => {
        const meses = Math.floor(item.dias_asignado / 30);
        tbody.append(`<tr>
            <td><strong>${item.device_code}</strong></td>
            <td>${item.equipment_type}</td>
            <td>${item.employee_name}</td>
            <td>${item.employee_cip || '—'}</td>
            <td>${item.location_name || '—'}</td>
            <td><span class="badge ${item.dias_asignado > 365 ? 'bg-warning text-dark' : 'bg-info'}">${item.dias_asignado} días</span></td>
            <td>${meses} meses</td>
        </tr>`);
    });
}

// ============================================================================
// EXPORTAR GRÁFICO PNG
// ============================================================================
function exportChart(chartId, filename) {
    const canvas = document.getElementById(chartId);
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `${filename}-${new Date().toISOString().split('T')[0]}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
}

// ============================================================================
// INIT
// ============================================================================
$(document).ready(() => {
    if (typeof Chart === 'undefined') { console.error('❌ Chart.js no disponible'); return; }
    applyChartDefaults();
    loadAllData();
    setInterval(loadAllData, 5 * 60 * 1000);
    console.log('✅ analytics-dashboard.js cargado');
});