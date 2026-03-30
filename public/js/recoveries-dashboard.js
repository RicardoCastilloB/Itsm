// ============================================================================
// recoveries-dashboard.js — envuelto en IIFE para evitar colisión con almacen-dashboard.js
// Funciones expuestas globalmente con prefijo rec_:
//   rec_aplicarFiltro, rec_abrirModalNuevo, rec_recargarTabla,
//   rec_abrirModalEdicion, rec_eliminarRecupero
// ============================================================================

(function () {
    'use strict';

    const REC_API = '/api/recoveries';   // nombre único, no choca con API de almacen

    let recoveriesTable = null;

    const STATUS_LABELS = {
        por_recuperar:        'Por recuperar',
        en_gestion:           'En gestión',
        recogido_tecnico:     'Recogido (téc.)',
        traido_oficina:       'En oficina',
        en_revision:          'En revisión',
        listo_para_asignar:   'Listo para asignar',
        envio_provincia:      'Envío provincia',
        recuperado:           'Recuperado'
    };

    const STATUS_FLOW = [
        'por_recuperar', 'en_gestion', 'recogido_tecnico',
        'traido_oficina', 'en_revision', 'listo_para_asignar',
        'envio_provincia', 'recuperado'
    ];

    // ── Init ─────────────────────────────────────────────────────────────────
    $(document).ready(function () {
        cargarKPIs();
        inicializarTabla();
        configurarBusquedasModal();
        $('#btnGuardarNuevo').on('click', guardarNuevoRecupero);
        $('#btnGuardarEdicion').on('click', guardarEdicion);
        $(document).on('click', function (e) {
            if (!$(e.target).closest('#newEquipmentCode, #newEquipmentResults').length) $('#newEquipmentResults').hide();
            if (!$(e.target).closest('#newEmployeeName,  #newEmployeeResults').length)  $('#newEmployeeResults').hide();
        });
        $('#newRecoveryModal').on('hidden.bs.modal', limpiarModalNuevo);
    });

    // ── KPIs ─────────────────────────────────────────────────────────────────
    async function cargarKPIs() {
        try {
            const res  = await fetch(`${REC_API}/kpis`, { credentials: 'include' });
            const data = await res.json();
            if (!data.success) return;
            const k = data.data;
            $('#kpiPorRecuperar').text(k.por_recuperar   || 0);
            $('#kpiEnProceso').text(k.en_proceso          || 0);
            $('#kpiEnRevision').text(k.en_revision         || 0);
            $('#kpiListos').text(k.listos                  || 0);
            $('#kpiRecuperadosMes').text(k.recuperados_mes || 0);
        } catch (err) { console.error('KPIs recuperos:', err); }
    }

    // ── DataTable ─────────────────────────────────────────────────────────────
    function inicializarTabla(status = 'todos') {
        if (recoveriesTable) { recoveriesTable.destroy(); $('#recoveriesTable tbody').empty(); }

        const url = status === 'todos' ? REC_API : `${REC_API}?status=${status}`;

        recoveriesTable = $('#recoveriesTable').DataTable({
            language: {
                search: 'Buscar:', lengthMenu: 'Mostrar _MENU_ registros',
                info: 'Mostrando _START_ a _END_ de _TOTAL_ registros',
                infoEmpty: 'Sin registros', zeroRecords: 'No se encontraron resultados',
                paginate: { first: '«', last: '»', next: '›', previous: '‹' }
            },
            pageLength: 25,
            processing: true,
            serverSide: false,
            ajax: {
                url,
                credentials: 'include',
                dataSrc: function (res) {
                    $('#totalCount').text(res.count || 0);
                    if (res.kpis) {
                        const k = res.kpis;
                        $('#kpiPorRecuperar').text(k.por_recuperar   || 0);
                        $('#kpiEnProceso').text(k.en_proceso          || 0);
                        $('#kpiEnRevision').text(k.en_revision         || 0);
                        $('#kpiListos').text(k.listos                  || 0);
                        $('#kpiRecuperadosMes').text(k.recuperados_mes || 0);
                    }
                    return res.data || [];
                }
            },
            columns: [
                {
                    data: 'recovery_id',
                    render: d => `<strong style="font-size:12px;font-family:monospace;">#${d}</strong>`
                },
                {
                    data: null,
                    render: r => `
                        <div style="line-height:1.4">
                            <strong style="font-size:13px;">${r.device_code || '—'}</strong><br>
                            <span style="font-size:11px;color:var(--muted);">${(r.equipment_brand||'')+' '+(r.equipment_model||'')}</span><br>
                            <span style="font-size:10px;color:var(--muted);">S/N: ${r.serial_number||'—'}</span>
                        </div>`
                },
                {
                    data: null,
                    render: r => `
                        <div style="line-height:1.4">
                            <strong style="font-size:13px;">${r.employee_name || '—'}</strong><br>
                            <span style="font-size:11px;color:var(--muted);">CIP: ${r.employee_cip||'—'}</span><br>
                            <span style="font-size:10px;color:var(--muted);">${r.position_name||''}</span>
                        </div>`
                },
                {
                    data: 'status',
                    render: d => `<span class="status-badge status-${d}">${STATUS_LABELS[d]||d}</span>`
                },
                {
                    data: 'recovery_method',
                    render: d => {
                        const m = { recojo_tecnico:'Técnico', entrega_usuario:'Usuario', envio_courier:'Courier', pendiente:'Pendiente' };
                        return `<span class="method-badge">${m[d]||d||'—'}</span>`;
                    }
                },
                {
                    data: 'technician_name',
                    render: d => d || '<span style="color:var(--muted)">—</span>'
                },
                {
                    data: 'scheduled_date',
                    render: d => d ? new Date(d).toLocaleDateString('es-PE') : '—'
                },
                {
                    data: 'department_name',
                    render: d => d || '—'
                },
                {
                    data: 'created_at',
                    render: d => {
                        const dias = Math.floor((Date.now() - new Date(d)) / 86400000);
                        const color = dias > 7 ? 'var(--danger)' : dias > 3 ? 'var(--warning)' : 'var(--success)';
                        return `<span style="font-weight:700;color:${color}">${dias}d</span>`;
                    }
                },
                {
                    data: null,
                    orderable: false,
                    render: r => `
                        <div class="d-flex gap-1">
                            <button class="btn-action btn-advance" title="Gestionar"
                                onclick="rec_abrirModalEdicion(${r.recovery_id})">
                                <i class="bi bi-arrow-right-circle"></i>
                            </button>
                            <button class="btn-action btn-delete" title="Eliminar"
                                onclick="rec_eliminarRecupero(${r.recovery_id})">
                                <i class="bi bi-trash3"></i>
                            </button>
                        </div>`
                }
            ],
            order: [[8, 'desc']]
        });
    }

    function recargarTabla() {
        if (recoveriesTable) recoveriesTable.ajax.reload(null, false);
    }

    // ── Filtros ───────────────────────────────────────────────────────────────
    function aplicarFiltro(btn, status) {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        inicializarTabla(status);
    }

    // ── Modal Nuevo Recupero ──────────────────────────────────────────────────
    function abrirModalNuevoRecupero() {
        limpiarModalNuevo();
        $('#newScheduledDate').val(new Date().toISOString().split('T')[0]);
        new bootstrap.Modal(document.getElementById('newRecoveryModal')).show();
    }

    function limpiarModalNuevo() {
        $('#newEquipmentCode, #newEmployeeName, #newTechnicianName, #newNotes').val('');
        $('#newEquipmentId, #newEmployeeId').val('');
        $('#newScheduledDate').val('');
        $('#newEquipmentResults, #newEmployeeResults').hide();
        $('#newEquipmentStatus').text('Escribe al menos 2 caracteres');
        $('#newEmployeeStatus').text('Escribe al menos 3 caracteres');
        $('#newRecoveryMethod').val('pendiente');
    }

    // ── Autocomplete busquedas ────────────────────────────────────────────────
    let eqTimer = null, empTimer = null;

    function configurarBusquedasModal() {
        $('#newEquipmentCode').on('input', function () {
            const q = $(this).val().trim();
            clearTimeout(eqTimer);
            if (q.length < 2) { $('#newEquipmentResults').hide(); return; }
            eqTimer = setTimeout(async () => {
                try {
                    const res  = await fetch(`/api/equipment/search?term=${encodeURIComponent(q)}`, { credentials: 'include' });
                    const data = await res.json();
                    mostrarResultadosEquipo(data.data || []);
                } catch (e) { console.error(e); }
            }, 400);
        });

        $('#newEmployeeName').on('input', function () {
            const q = $(this).val().trim();
            clearTimeout(empTimer);
            if (q.length < 3) { $('#newEmployeeResults').hide(); return; }
            empTimer = setTimeout(async () => {
                try {
                    const res  = await fetch(`/api/employees/search?q=${encodeURIComponent(q)}&include_baja=true`, { credentials: 'include' });
                    const data = await res.json();
                    mostrarResultadosEmpleado(data.data || []);
                } catch (e) { console.error(e); }
            }, 400);
        });
    }

    function mostrarResultadosEquipo(items) {
        const c = $('#newEquipmentResults').empty().show();
        if (!items.length) { c.html('<div class="search-result-item" style="color:var(--muted)">Sin resultados</div>'); return; }
        items.forEach(eq => {
            $(`<div class="search-result-item">
                <strong>${eq.device_code}</strong>
                <small>${eq.brand||''} ${eq.model||''} — ${eq.status||''}</small>
            </div>`).on('click', function () {
                $('#newEquipmentCode').val(eq.device_code);
                $('#newEquipmentId').val(eq.id);
                $('#newEquipmentStatus').text(`${eq.brand||''} ${eq.model||''}`);
                c.hide();
            }).appendTo(c);
        });
    }

    function mostrarResultadosEmpleado(items) {
        const c = $('#newEmployeeResults').empty().show();
        if (!items.length) { c.html('<div class="search-result-item" style="color:var(--muted)">Sin resultados</div>'); return; }
        items.forEach(emp => {
            $(`<div class="search-result-item">
                <strong>${emp.full_name}</strong>
                <small>CIP: ${emp.cip} | ${emp.position_name||''}</small>
            </div>`).on('click', function () {
                $('#newEmployeeName').val(emp.full_name);
                $('#newEmployeeId').val(emp.id);
                $('#newEmployeeStatus').text(`CIP: ${emp.cip}`);
                c.hide();
            }).appendTo(c);
        });
    }

    // ── Guardar nuevo recupero ────────────────────────────────────────────────
    async function guardarNuevoRecupero() {
        const equipmentId = $('#newEquipmentId').val();
        const employeeId  = $('#newEmployeeId').val();
        if (!equipmentId) { showToast('warning', '⚠️ Selecciona un equipo de la lista'); return; }
        if (!employeeId)  { showToast('warning', '⚠️ Selecciona un empleado de la lista'); return; }

        setLoadingBtn('#btnGuardarNuevo', '#spinnerNuevo', '#btnNuevoText', true, 'Creando...');
        try {
            const res  = await fetch(REC_API, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    equipment_id:    parseInt(equipmentId),
                    employee_id:     parseInt(employeeId),
                    recovery_method: $('#newRecoveryMethod').val(),
                    technician_name: $('#newTechnicianName').val().trim() || null,
                    scheduled_date:  $('#newScheduledDate').val() || null,
                    notes:           $('#newNotes').val().trim() || null
                })
            });
            const data = await res.json();
            if (data.success) {
                bootstrap.Modal.getInstance(document.getElementById('newRecoveryModal')).hide();
                recargarTabla();
                showToast('success', '✅ Recupero creado exitosamente');
            } else {
                showToast('error', `❌ ${data.message}`);
            }
        } catch (err) {
            showToast('error', '❌ Error de conexión');
        } finally {
            setLoadingBtn('#btnGuardarNuevo', '#spinnerNuevo', '#btnNuevoText', false, 'Crear recupero');
        }
    }

    // ── Modal Edición ─────────────────────────────────────────────────────────
    async function abrirModalEdicion(recoveryId) {
        $('#editRecoveryId').val(recoveryId);
        $('#editRecoveryIdLabel').text(`#${recoveryId}`);
        $('#logTimeline').html('<div style="text-align:center;padding:12px;font-size:12px;color:var(--muted);">Cargando...</div>');

        const rowData = recoveriesTable.rows().data().toArray().find(r => r.recovery_id == recoveryId);
        if (rowData) {
            poblarStepper(rowData.status);
            poblarSelectEstados(rowData.status);
            $('#editTechnicianName').val(rowData.technician_name || '');
            if (rowData.scheduled_date) {
                $('#editScheduledDate').val(new Date(rowData.scheduled_date).toISOString().split('T')[0]);
            }
        }
        cargarHistorial(recoveryId);
        new bootstrap.Modal(document.getElementById('editRecoveryModal')).show();
    }

    function poblarStepper(currentStatus) {
        const $s = $('#flowStepper').empty();
        const ci = STATUS_FLOW.indexOf(currentStatus);
        STATUS_FLOW.forEach((s, i) => {
            const cls  = i < ci ? 'completed' : i === ci ? 'active' : '';
            const icon = i < ci ? '<i class="bi bi-check-lg"></i>' : (i + 1);
            $s.append(`<div class="flow-step ${cls}">
                <div class="flow-step-dot">${icon}</div>
                <div class="flow-step-label">${STATUS_LABELS[s]}</div>
            </div>`);
        });
    }

    function poblarSelectEstados(currentStatus) {
        const $sel = $('#editNewStatus').empty();
        const ci   = STATUS_FLOW.indexOf(currentStatus);
        STATUS_FLOW.forEach((s, i) => {
            if (i >= ci) {
                $sel.append(`<option value="${s}" ${i === ci ? 'selected' : ''}>${STATUS_LABELS[s]}${i === ci ? ' (actual)' : ''}</option>`);
            }
        });
    }

    async function cargarHistorial(recoveryId) {
        try {
            const res  = await fetch(`${REC_API}/${recoveryId}/logs`, { credentials: 'include' });
            const data = await res.json();
            const $tl  = $('#logTimeline').empty();
            if (!data.success || !data.data.length) {
                $tl.html('<div style="text-align:center;padding:8px;font-size:12px;color:var(--muted);">Sin historial aún</div>');
                return;
            }
            data.data.forEach(log => {
                const fecha = new Date(log.created_at).toLocaleString('es-PE');
                $tl.append(`<div class="log-entry">
                    <div class="log-dot"></div>
                    <div>
                        <div class="log-text">
                            ${log.old_status ? `<span class="status-badge status-${log.old_status}" style="font-size:10px;">${STATUS_LABELS[log.old_status]}</span> → ` : ''}
                            <span class="status-badge status-${log.new_status}" style="font-size:10px;">${STATUS_LABELS[log.new_status]}</span>
                            ${log.note ? `<br><em style="font-size:11px;color:var(--muted);">"${log.note}"</em>` : ''}
                        </div>
                        <div class="log-meta">${fecha}</div>
                    </div>
                </div>`);
            });
        } catch (err) {
            $('#logTimeline').html('<div style="text-align:center;padding:8px;font-size:12px;color:var(--muted);">Error al cargar historial</div>');
        }
    }

    // ── Guardar edición ───────────────────────────────────────────────────────
    async function guardarEdicion() {
        const recoveryId = $('#editRecoveryId').val();
        const newStatus  = $('#editNewStatus').val();
        if (!newStatus) { showToast('warning', '⚠️ Selecciona un estado'); return; }

        setLoadingBtn('#btnGuardarEdicion', '#spinnerEdicion', '#btnEdicionText', true, 'Guardando...');
        try {
            const res  = await fetch(`${REC_API}/${recoveryId}/status`, {
                method: 'PUT', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status:          newStatus,
                    recovery_method: $('#editRecoveryMethod').val() || null,
                    technician_name: $('#editTechnicianName').val().trim() || null,
                    technician_note: $('#editTechnicianNote').val().trim() || null,
                    scheduled_date:  $('#editScheduledDate').val() || null
                })
            });
            const data = await res.json();
            if (data.success) {
                bootstrap.Modal.getInstance(document.getElementById('editRecoveryModal')).hide();
                recargarTabla();
                showToast('success', `✅ Estado → ${STATUS_LABELS[newStatus]}`);
            } else {
                showToast('error', `❌ ${data.message}`);
            }
        } catch (err) {
            showToast('error', '❌ Error de conexión');
        } finally {
            setLoadingBtn('#btnGuardarEdicion', '#spinnerEdicion', '#btnEdicionText', false, 'Guardar cambio');
        }
    }

    // ── Eliminar ──────────────────────────────────────────────────────────────
    async function eliminarRecupero(recoveryId) {
        if (!confirm(`¿Eliminar recupero #${recoveryId}?`)) return;
        try {
            const res  = await fetch(`${REC_API}/${recoveryId}`, { method: 'DELETE', credentials: 'include' });
            const data = await res.json();
            if (data.success) { recargarTabla(); showToast('success', `✅ Recupero #${recoveryId} eliminado`); }
            else showToast('error', `❌ ${data.message}`);
        } catch (err) { showToast('error', '❌ Error de conexión'); }
    }

    // ── Utilidades ────────────────────────────────────────────────────────────
    function setLoadingBtn(btn, spinner, text, loading, label) {
        $(btn).prop('disabled', loading);
        $(spinner).toggleClass('d-none', !loading);
        $(text).text(label);
    }

    function showToast(type, message) {
        const colors = { success:'#28a745', error:'#dc3545', warning:'#f59e0b' };
        const icons  = { success:'check-circle-fill', error:'exclamation-circle-fill', warning:'exclamation-triangle-fill' };
        const $t = $(`<div class="toast show align-items-center text-white border-0"
            style="background:${colors[type]};border-radius:10px;min-width:280px;margin-bottom:6px;" role="alert">
            <div class="d-flex">
                <div class="toast-body" style="font-size:13px;">
                    <i class="bi bi-${icons[type]} me-2"></i>${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto"
                    onclick="$(this).closest('.toast').remove()"></button>
            </div>
        </div>`);
        let $tc = $('.toast-container-custom');
        if (!$tc.length) $tc = $('<div class="toast-container-custom"></div>').appendTo('body');
        $tc.append($t);
        setTimeout(() => $t.remove(), 4500);
    }

    // ── Exponer al scope global ───────────────────────────────────────────────
    // El HTML llama estas funciones directamente desde onclick=""
    window.rec_aplicarFiltro     = aplicarFiltro;
    window.rec_abrirModalNuevo   = abrirModalNuevoRecupero;
    window.rec_recargarTabla     = recargarTabla;
    window.rec_abrirModalEdicion = abrirModalEdicion;
    window.rec_eliminarRecupero  = eliminarRecupero;

    console.log('✅ Recoveries Dashboard cargado (IIFE, sin conflictos)');

})();
