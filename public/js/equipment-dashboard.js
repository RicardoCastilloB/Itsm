// ============================================================================
// equipment-dashboard.js — Dashboard de Equipos CON GRÁFICOS INTERACTIVOS
// ============================================================================

const BASE_URL      = window.APP_URL || '';
const API_EQUIPMENT = `${BASE_URL}/api/equipment`;



let equiposTable = null;
let searchTimeout = null;
let chartMarcas = null;
let chartModelos = null;
let filtroActivo = null;

$(document).ready(function() {
    console.log('🚀 Inicializando Equipment Dashboard...');
    
    cargarEstadisticas();
    cargarGraficoMarcas();
    cargarGraficoSO();
    inicializarTablaEquipos();
    
    $('#globalSearch').on('keyup', function() {
        const term = $(this).val().trim();
        clearTimeout(searchTimeout);
        if (term.length < 2 && term.length > 0) return;
        searchTimeout = setTimeout(() => {
            if (equiposTable) equiposTable.search(term).draw();
        }, 300);
    });
    
    $('#addEquipmentForm').on('submit', handleAddEquipment);
    $('#saveEquipmentChanges').on('click', handleEditEquipment);
});

// ============================================================================
// CARGAR KPIs
// ============================================================================
async function cargarEstadisticas() {
    try {
        const resStats = await fetch(`${BASE_URL}/api/dashboard/stats-completo`, { credentials: 'include' });
        const dataStats = await resStats.json();
        if (dataStats.success) {
            $('#kpiTotalEquipos').text(dataStats.data.totalEquipos || 0);
            $('#equiposAsignados').text(dataStats.data.equiposAsignados || 0);
            $('#equiposDisponibles').text(dataStats.data.equiposDisponibles || 0);
            $('#equiposGarantia').text(dataStats.data.equiposGarantia || 0);
        }
        const resTipo = await fetch(`${BASE_URL}/api/dashboard/equipos-por-tipo`, { credentials: 'include' });
        const dataTipo = await resTipo.json();
        if (dataTipo.success && dataTipo.data) {
            const desktop = dataTipo.data.find(e => e.tipo === 'Desktop');
            const laptop  = dataTipo.data.find(e => e.tipo === 'Laptop' || e.tipo === 'laptop');
            const monitor = dataTipo.data.find(e => e.tipo === 'Monitor');
            const tablet  = dataTipo.data.find(e => e.tipo === 'Tablet');
            $('#equipos_desktop').text(desktop ? desktop.total : 0);
            $('#equipos_laptop').text(laptop   ? laptop.total  : 0);
            $('#equipos_monitores').text(monitor ? monitor.total : 0);
            $('#equipos_tablets').text(tablet  ? tablet.total  : 0);
        }
    } catch (error) {
        console.error('❌ Error cargando estadísticas:', error);
    }
}

// ============================================================================
// GRÁFICOS
// ============================================================================
async function cargarGraficoMarcas() {
    try {
        const res  = await fetch(API_EQUIPMENT + '?limit=9999', { credentials: 'include' });
        const data = await res.json();
        if (!data.data || !data.data.length) return;
        const conteo = {};
        data.data.forEach(eq => { const m = (eq.brand||'Sin marca').trim(); conteo[m]=(conteo[m]||0)+1; });
        const top10  = Object.entries(conteo).sort((a,b)=>b[1]-a[1]).slice(0,10);
        const ctx    = document.getElementById('chartTopMarcas');
        if (!ctx) return;
        if (chartMarcas) chartMarcas.destroy();
        chartMarcas = new Chart(ctx, {
            type: 'bar',
            data: { labels: top10.map(m=>m[0]), datasets: [{ label:'Cantidad de Equipos', data: top10.map(m=>m[1]), backgroundColor:'#3b82f6', borderRadius:6, hoverBackgroundColor:'#2563eb' }] },
            options: { indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} }, scales:{ x:{beginAtZero:true,ticks:{stepSize:1}}, y:{grid:{display:false}} },
                onClick:(event,elements)=>{ if(elements.length>0) filtrarTablaPorMarca(chartMarcas.data.labels[elements[0].index]); },
                onHover:(event,elements)=>{ event.native.target.style.cursor=elements.length?'pointer':'default'; } }
        });
    } catch(e) { console.error('❌ Error gráfico marcas:', e); }
}

async function cargarGraficoSO() {
    try {
        const res  = await fetch(API_EQUIPMENT + '?limit=9999', { credentials: 'include' });
        const data = await res.json();
        if (!data.data || !data.data.length) return;
        const conteo = {};
        data.data.forEach(eq => { const so=(eq.operating_system||'Sin SO').trim(); conteo[so]=(conteo[so]||0)+1; });
        const sorted = Object.entries(conteo).sort((a,b)=>b[1]-a[1]);
        const labels = sorted.map(s=>s[0]);
        const valores= sorted.map(s=>s[1]);
        const colores= labels.map(l=>{ const v=l.toLowerCase(); if(v.includes('windows 11'))return'#0078d4'; if(v.includes('windows 10'))return'#00a4ef'; if(v.includes('windows'))return'#357ec7'; if(v.includes('linux')||v.includes('ubuntu'))return'#e95420'; if(v.includes('mac'))return'#555555'; if(v.includes('sin so'))return'#9ca3af'; return'#'+Math.floor(Math.random()*16777215).toString(16); });
        const ctx = document.getElementById('chartTopSO');
        if (!ctx) return;
        if (chartModelos) chartModelos.destroy();
        chartModelos = new Chart(ctx, {
            type:'doughnut',
            data:{ labels, datasets:[{ data:valores, backgroundColor:colores, borderWidth:2, borderColor:'#ffffff', hoverOffset:12 }] },
            options:{ responsive:true, maintainAspectRatio:false, cutout:'60%',
                plugins:{ legend:{ position:'bottom', labels:{ padding:10, font:{size:10}, generateLabels:(chart)=>chart.data.labels.map((label,i)=>({ text:`${label} (${chart.data.datasets[0].data[i]})`, fillStyle:chart.data.datasets[0].backgroundColor[i], hidden:false, index:i })) } },
                    tooltip:{ callbacks:{ label:(ctx)=>{ const total=ctx.dataset.data.reduce((a,b)=>a+b,0); return `  ${ctx.label}: ${ctx.parsed} (${((ctx.parsed/total)*100).toFixed(1)}%)`; } } } },
                onClick:(event,elements)=>{ if(elements.length>0) filtrarTablaPorSO(chartModelos.data.labels[elements[0].index]); },
                onHover:(event,elements)=>{ event.native.target.style.cursor=elements.length?'pointer':'default'; } }
        });
    } catch(e) { console.error('❌ Error gráfico SO:', e); }
}

// ============================================================================
// FILTROS
// ============================================================================
function filtrarTablaPorMarca(marca) {
    filtroActivo = { tipo:'marca', valor:marca };
    if (equiposTable) { equiposTable.ajax.reload(null,true); $('#globalSearch').val(''); setTimeout(()=>document.getElementById('equiposTable')?.scrollIntoView({behavior:'smooth',block:'start'}),200); }
    showNotification('info', `🔍 Filtrando marca: ${marca}`);
}
function filtrarTablaPorSO(so) {
    filtroActivo = { tipo:'so', valor:so };
    if (equiposTable) { equiposTable.ajax.reload(null,true); $('#globalSearch').val(''); setTimeout(()=>document.getElementById('equiposTable')?.scrollIntoView({behavior:'smooth',block:'start'}),200); }
    showNotification('info', `🔍 Filtrando SO: ${so}`);
}
function limpiarFiltroTabla() {
    filtroActivo = null;
    if (equiposTable) { equiposTable.ajax.reload(null,true); $('#globalSearch').val(''); }
    showNotification('success', '✅ Filtro limpiado');
}

// ============================================================================
// DATATABLE
// ============================================================================
function inicializarTablaEquipos() {
    if (equiposTable) equiposTable.destroy();
    equiposTable = $('#equiposTable').DataTable({
        language: { url: '/js/es-ES.json' },
        pageLength: 25,
        processing: true,
        serverSide: true,
        ajax: {
            url: API_EQUIPMENT,
            credentials: 'include',
            data: function(d) {
                const params = { page: Math.floor(d.start/d.length)+1, limit:d.length, search:d.search.value||'' };
                if (filtroActivo) {
                    if (filtroActivo.tipo==='marca') params.brand = filtroActivo.valor;
                    else if (filtroActivo.tipo==='so')  params.operating_system = filtroActivo.valor;
                }
                return params;
            },
            dataSrc: function(response) {
                $('#totalEquiposTabla').text(response.pagination?.totalItems||0);
                return response.data||[];
            }
        },
        columns: [
            { data:'device_code',    render:(d)=>`<strong style="font-family:monospace;font-size:12px;">${d||'—'}</strong>` },
            { data:'serial_number',  render:(d)=>`<span style="font-family:monospace;font-size:11px;color:#64748b;">${d||'—'}</span>` },
            { data:'equipment_type' },
            { data:'brand',          render:(d)=>`<strong>${d||'—'}</strong>` },
            { data:'model',          render:(d)=>`<span style="color:#64748b;font-size:12px;">${d||'—'}</span>` },
            { data:'operating_system', render:(d)=>{ if(!d||d==='Sin SO')return'<span class="badge bg-secondary">Sin SO</span>'; const so=d.toLowerCase(); let c='primary'; if(so.includes('windows 11'))c='info'; else if(so.includes('linux')||so.includes('ubuntu'))c='warning'; else if(so.includes('mac'))c='dark'; return `<span class="badge bg-${c}" style="font-size:10px;">${d}</span>`; } },
            { data:'ram_memory',     render:(d)=>`<span class="badge bg-secondary">${d||'—'}</span>` },
            { data:'disk_capacity',  render:(d)=>`<span class="badge bg-secondary">${d||'—'}</span>` },
            { data:'status', render:(d)=>{ const colors={'Asignado':'success','Disponible':'info','En Mantenimiento':'warning','Dado de Baja':'danger','En Tránsito':'primary'}; return `<span class="badge bg-${colors[d]||'secondary'}">${d||'—'}</span>`; } },
            { data:null, orderable:false, render:()=>`<button class="btn btn-sm btn-primary edit-btn"><i class="bi bi-pencil-square"></i></button>` }
        ],
        order: [[0,'asc']]
    });
    
    $('#equiposTable').off('click','.edit-btn').on('click','.edit-btn', function() {
        const data = equiposTable.row($(this).parents('tr')).data();
        openEditModal(data);
    });
}

// ============================================================================
// MODAL: AGREGAR EQUIPO
// ============================================================================
async function handleAddEquipment(e) {
    e.preventDefault();
    const btn = $('#submitEquipmentBtn');
    const alertEl = $('#equipmentFormAlert');
    const originalText = btn.html();
    btn.prop('disabled',true).html('<span class="spinner-border spinner-border-sm me-2"></span>Creando...');
    alertEl.addClass('d-none');
    const formData = {
        device_code:    $('#device_code').val().trim(),
        serial_number:  $('#serial_number').val().trim(),
        equipment_type: $('#equipment_type').val(),
        brand:          $('#brand').val().trim(),
        model:          $('#model').val().trim(),
        ram_memory:     $('#ram').val().trim()||null,
        disk_capacity:  $('#storage').val().trim()||null,
        status:         $('#status').val()||'Disponible',
        acquisition_type:'Propio'
    };
    try {
        const response = await fetch(API_EQUIPMENT, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify(formData) });
        const result   = await response.json();
        if (response.ok && result.success) {
            $('#addEquipmentModal').modal('hide');
            $('#addEquipmentForm')[0].reset();
            showNotification('success', `✅ Equipo "${formData.device_code}" creado`);
            if (equiposTable) equiposTable.ajax.reload(null,false);
            cargarEstadisticas(); cargarGraficoMarcas(); cargarGraficoSO();
        } else { throw new Error(result.error||result.message||'Error al crear equipo'); }
    } catch(error) {
        alertEl.html(`<strong>Error:</strong> ${error.message}`).removeClass('d-none');
    } finally { btn.prop('disabled',false).html(originalText); }
}

// ============================================================================
// MODAL: EDITAR EQUIPO
// ============================================================================
function openEditModal(data) {
    console.log('📝 Editando:', data);
    $('#editEquipmentModal').data('originalData', data);
    
    $('#editDeviceCode').val(data.device_code);
    $('#editSerialNumber').val(data.serial_number||'');
    $('#editEquipmentType').val(data.equipment_type||'');
    $('#editBrand').val(data.brand||'');
    $('#editModel').val(data.model||'');
    $('#editRam').val(data.ram_memory||'');
    $('#editDisk').val(data.disk_capacity||'');
    $('#editStatus').val((data.status||'').trim());

    // ── Si está En Mantenimiento → bloquear el select de estado ──
    const enMantenimiento = (data.status || '').trim() === 'En Mantenimiento';
    const $select  = $('#editStatus');
    const $warning = $('#editStatusWarning');

    if (enMantenimiento) {
        $select.prop('disabled', true);
        // Mostrar aviso (lo creamos dinámicamente si no existe)
        if ($warning.length === 0) {
            $select.closest('.col-md-4').append(`
                <div id="editStatusWarning" class="mt-2 p-2 rounded" 
                     style="background:rgba(245,158,11,.12);border:1px solid #f59e0b;font-size:12px;color:#d97706;">
                    <i class="bi bi-lock-fill me-1"></i>
                    Estado bloqueado — solo se puede cambiar desde <strong>Recupero de Equipos</strong> 
                    cuando el recupero esté listo para asignar.
                </div>`);
        } else {
            $warning.show();
        }
    } else {
        $select.prop('disabled', false);
        $warning.hide();
    }

    $('#editEquipmentModal').modal('show');
}

async function handleEditEquipment() {
    const btn          = $('#saveEquipmentChanges');
    const originalText = btn.html();
    const originalData = $('#editEquipmentModal').data('originalData');
    if (!originalData) { alert('⚠️ Error: No se encontraron los datos originales'); return; }

    // Si está en mantenimiento el select está disabled → usar valor original
    const selectedStatus = $('#editStatus').prop('disabled')
        ? originalData.status
        : $('#editStatus').val();

    if (!selectedStatus) { alert('⚠️ Debes seleccionar un estado'); return; }

    btn.prop('disabled',true).html('<span class="spinner-border spinner-border-sm me-2"></span>Guardando...');

    const updatedData = {
        device_code:    $('#editDeviceCode').val().trim(),
        serial_number:  $('#editSerialNumber').val().trim()||originalData.serial_number,
        equipment_type: $('#editEquipmentType').val().trim()||originalData.equipment_type,
        brand:          $('#editBrand').val().trim()||originalData.brand,
        model:          $('#editModel').val().trim()||originalData.model,
        ram_memory:     $('#editRam').val().trim()||originalData.ram_memory,
        disk_capacity:  $('#editDisk').val().trim()||originalData.disk_capacity,
        status:         selectedStatus.trim(),
        processor:      originalData.processor,
        operating_system: originalData.operating_system,
        acquisition_type: originalData.acquisition_type
    };

    try {
        const response = await fetch(`${BASE_URL}/api/equipment/update`, {
            method:'PUT', headers:{'Content-Type':'application/json'},
            credentials:'include', body:JSON.stringify(updatedData)
        });
        const result = await response.json();
        if (result.success) {
            $('#editEquipmentModal').modal('hide');
            if (equiposTable) equiposTable.ajax.reload(null,false);
            cargarEstadisticas(); cargarGraficoMarcas(); cargarGraficoSO();
            showNotification('success', `✅ Equipo "${updatedData.device_code}" actualizado`);
        } else { alert(`❌ Error: ${result.message}`); }
    } catch(error) {
        console.error('❌ Error:', error);
        alert('❌ Error de conexión: '+error.message);
    } finally { btn.prop('disabled',false).html(originalText); }
}

// ============================================================================
// UTILIDADES
// ============================================================================
function showNotification(type, message) {
    const colors = { success:'#28a745', error:'#dc3545', info:'#3b82f6', warning:'#f59e0b' };
    const icons  = { success:'check-circle-fill', error:'exclamation-circle-fill', info:'info-circle-fill', warning:'exclamation-triangle-fill' };
    const n = $(`<div class="position-fixed top-0 end-0 p-3" style="z-index:9999;">
        <div class="toast show align-items-center text-white border-0" style="background-color:${colors[type]};" role="alert">
            <div class="d-flex"><div class="toast-body"><i class="bi bi-${icons[type]} me-2"></i>${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="this.closest('.toast').remove()"></button></div>
        </div></div>`);
    $('body').append(n);
    setTimeout(()=>n.remove(), 4000);
}

$('#addEquipmentModal').on('hidden.bs.modal', function() { $('#equipmentFormAlert').addClass('d-none'); $('#addEquipmentForm')[0].reset(); });
$('#editEquipmentModal').on('hidden.bs.modal', function() {
    $(this).removeData('originalData');
    $('#editEquipmentForm')[0].reset();
    $('#editStatus').prop('disabled', false);
    $('#editStatusWarning').hide();
});

console.log('✅ Equipment Dashboard cargado');
