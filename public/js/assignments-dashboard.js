// ============================================================================
// assignments-dashboard.js — Dashboard de Asignaciones CON GRÁFICOS INTERACTIVOS
// ============================================================================

const API_ASSIGNMENTS = 'http://localhost:3000/api/assignments';
const API_DASHBOARD = 'http://localhost:3000/api/dashboard';

let asignacionesTable = null;
let searchTimeout = null;
let chartTopModelos = null;
let chartTopUbicaciones = null;
let chartTopDepartamentos = null;
let filtroActivo = null; // { tipo: 'modelo'|'ubicacion'|'departamento', valor: 'HP EliteBook' }

// Timeouts para búsquedas en modales
let addEmployeeSearchTimeout = null;
let addEquipmentSearchTimeout = null;
let addDepartmentSearchTimeout = null;
let addLocationSearchTimeout = null;
let employeeSearchTimeout = null;
let equipmentSearchTimeout = null;
let departmentSearchTimeout = null;
let locationSearchTimeout = null;

// ============================================================================
// INICIALIZACIÓN
// ============================================================================
$(document).ready(function() {
    console.log('🚀 Inicializando Assignments Dashboard...');
    
    cargarKPIs();
    cargarGraficoTopModelos();
    cargarGraficoTopUbicaciones();
    cargarGraficoTopDepartamentos();
    inicializarTablaAsignaciones();
    
    // Búsqueda global con debounce
    $('#globalSearch').on('keyup', function() {
        const term = $(this).val().trim();
        clearTimeout(searchTimeout);
        
        if (term.length < 2 && term.length > 0) return;
        
        searchTimeout = setTimeout(() => {
            if (asignacionesTable) {
                asignacionesTable.search(term).draw();
            }
        }, 300);
    });
    
    // Event listeners para modales AÑADIR
    configurarBusquedasModalAñadir();
    $('#saveNewAssignment').on('click', handleAddAssignment);
    
    // Event listeners para modales EDITAR
    configurarBusquedasModalEditar();
    $('#saveAssignmentChanges').on('click', handleEditAssignment);
});

// ============================================================================
// CARGAR KPIs
// ============================================================================
async function cargarKPIs() {
    try {
        // Total activas
        const resActivas = await fetch(API_ASSIGNMENTS, { credentials: 'include' });
        const dataActivas = await resActivas.json();
        $('#kpiAsignacionesActivas').text(dataActivas.count || 0);
        
        // Asignaciones este mes
        const resMes = await fetch(`${API_DASHBOARD}/historico-asignaciones?meses=1`, { credentials: 'include' });
        const dataMes = await resMes.json();
        const esteMes = dataMes.data?.[0]?.total_asignaciones || 0;
        $('#kpiAsignacionesMes').text(esteMes);
        
        // Empleados con equipo
        const resEmpleados = await fetch(`${API_DASHBOARD}/top-empleados-equipos`, { credentials: 'include' });
        const dataEmpleados = await resEmpleados.json();
        $('#kpiEmpleadosEquipo').text(dataEmpleados.data?.length || 0);
        
    } catch (error) {
        console.error('❌ Error cargando KPIs:', error);
    }
}

// ============================================================================
// GRÁFICO 1: TOP 10 MODELOS MÁS ASIGNADOS (BARRAS HORIZONTALES)
// ============================================================================
async function cargarGraficoTopModelos() {
    try {
        const res = await fetch(`${API_DASHBOARD}/top-modelos-asignados?limite=10`, { credentials: 'include' });
        const data = await res.json();
        
        if (!data.success || !data.data.length) return;
        
        const modelos = data.data;
        const labels = modelos.map(m => `${m.marca} ${m.modelo}`);
        const valores = modelos.map(m => m.cantidad_asignada);
        
        const ctx = document.getElementById('chartTopModelos');
        if (!ctx) return;
        
        if (chartTopModelos) chartTopModelos.destroy();
        
        chartTopModelos = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Asignaciones',
                    data: valores,
                    backgroundColor: '#f59e0b',
                    borderRadius: 6,
                    hoverBackgroundColor: '#d97706'
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            afterLabel: () => '  👆 Clic para filtrar'
                        }
                    }
                },
                scales: {
                    x: { beginAtZero: true, ticks: { stepSize: 1 } },
                    y: { grid: { display: false } }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const modelo = chartTopModelos.data.labels[index];
                        filtrarTablaPorModelo(modelo);
                    }
                },
                onHover: (event, elements) => {
                    event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error cargando gráfico de modelos:', error);
    }
}

// ============================================================================
// GRÁFICO 2: TOP 10 UBICACIONES (BARRAS VERTICALES)
// ============================================================================
async function cargarGraficoTopUbicaciones() {
    try {
        const res = await fetch(`${API_DASHBOARD}/equipos-por-ubicacion`, { credentials: 'include' });
        const data = await res.json();
        
        if (!data.success || !data.data.length) return;
        
        // Top 10
        const top10 = data.data.slice(0, 10);
        const labels = top10.map(u => u.ubicacion);
        const valores = top10.map(u => u.total_equipos);
        
        const ctx = document.getElementById('chartTopUbicaciones');
        if (!ctx) return;
        
        if (chartTopUbicaciones) chartTopUbicaciones.destroy();
        
        chartTopUbicaciones = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Equipos Asignados',
                    data: valores,
                    backgroundColor: '#3b82f6',
                    borderRadius: 6,
                    hoverBackgroundColor: '#2563eb'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            afterLabel: () => '  👆 Clic para filtrar'
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } },
                    x: { grid: { display: false } }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const ubicacion = chartTopUbicaciones.data.labels[index];
                        filtrarTablaPorUbicacion(ubicacion);
                    }
                },
                onHover: (event, elements) => {
                    event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error cargando gráfico de ubicaciones:', error);
    }
}

// ============================================================================
// GRÁFICO 3: TOP 10 DEPARTAMENTOS (BARRAS VERTICALES)
// ============================================================================
async function cargarGraficoTopDepartamentos() {
    try {
        const res = await fetch(`${API_DASHBOARD}/departamentos-stats`, { credentials: 'include' });
        const data = await res.json();
        
        if (!data.success || !data.data.length) return;
        
        // Top 10
        const top10 = data.data.slice(0, 10);
        const labels = top10.map(d => d.departamento);
        const valores = top10.map(d => d.total_equipos);
        
        const ctx = document.getElementById('chartTopDepartamentos');
        if (!ctx) return;
        
        if (chartTopDepartamentos) chartTopDepartamentos.destroy();
        
        chartTopDepartamentos = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Equipos Asignados',
                    data: valores,
                    backgroundColor: '#10b981',
                    borderRadius: 6,
                    hoverBackgroundColor: '#059669'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            afterLabel: () => '  👆 Clic para filtrar'
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } },
                    x: { grid: { display: false } }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const departamento = chartTopDepartamentos.data.labels[index];
                        filtrarTablaPorDepartamento(departamento);
                    }
                },
                onHover: (event, elements) => {
                    event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error cargando gráfico de departamentos:', error);
    }
}

// ============================================================================
// FILTRAR TABLA AL HACER CLIC EN GRÁFICOS
// ============================================================================
function filtrarTablaPorModelo(modelo) {
    filtroActivo = { tipo: 'modelo', valor: modelo };
    
    if (asignacionesTable) {
        // Filtrar por la columna de MODELO (índice 4)
        asignacionesTable.column(4).search(modelo).draw();
        $('#globalSearch').val('');
        
        // Scroll suave hacia la tabla
        setTimeout(() => {
            const tabla = document.getElementById('asignacionesTable');
            if (tabla) {
                tabla.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 200);
    }
    
    showNotification('info', `🔍 Filtrando asignaciones de: ${modelo}`);
    console.log('📊 Filtro aplicado - Modelo:', modelo);
}

function filtrarTablaPorUbicacion(ubicacion) {
    filtroActivo = { tipo: 'ubicacion', valor: ubicacion };
    
    if (asignacionesTable) {
        // Filtrar por la columna de UBICACIÓN (índice 7)
        asignacionesTable.column(7).search(ubicacion).draw();
        $('#globalSearch').val('');
        
        setTimeout(() => {
            const tabla = document.getElementById('asignacionesTable');
            if (tabla) {
                tabla.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 200);
    }
    
    showNotification('info', `🔍 Filtrando asignaciones en: ${ubicacion}`);
    console.log('📊 Filtro aplicado - Ubicación:', ubicacion);
}

function filtrarTablaPorDepartamento(departamento) {
    filtroActivo = { tipo: 'departamento', valor: departamento };
    
    if (asignacionesTable) {
        // Filtrar por la columna de DEPARTAMENTO (índice 6)
        asignacionesTable.column(6).search(departamento).draw();
        $('#globalSearch').val('');
        
        setTimeout(() => {
            const tabla = document.getElementById('asignacionesTable');
            if (tabla) {
                tabla.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 200);
    }
    
    showNotification('info', `🔍 Filtrando asignaciones del departamento: ${departamento}`);
    console.log('📊 Filtro aplicado - Departamento:', departamento);
}

function limpiarFiltroTabla() {
    filtroActivo = null;
    
    if (asignacionesTable) {
        asignacionesTable.search('').columns().search('').draw();
        $('#globalSearch').val('');
    }
    
    showNotification('success', '✅ Filtro limpiado - Mostrando todas las asignaciones');
    console.log('🧹 Filtros limpiados');
}

// ============================================================================
// DATATABLE: ASIGNACIONES
// ============================================================================
function inicializarTablaAsignaciones() {
    if (asignacionesTable) {
        asignacionesTable.destroy();
    }
    
    asignacionesTable = $('#asignacionesTable').DataTable({
        language: { url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/es-ES.json' },
        pageLength: 25,
        processing: true,
        serverSide: false,
        ajax: {
            url: API_ASSIGNMENTS,
            credentials: 'include',
            dataSrc: function(response) {
                const total = response.count || 0;
                $('#totalAsignacionesTabla').text(total);
                console.log('📊 Asignaciones mostradas:', total);
                return response.data || [];
            }
        },
        columns: [
            { 
                data: 'assignment_id',
                render: (d) => `<strong style="font-family:monospace;font-size:12px;">${d || '—'}</strong>`
            },
            { 
                data: 'employee_name',
                render: (d) => `<strong>${d || '—'}</strong>`
            },
            { 
                data: 'employee_cip',
                render: (d) => `<span style="font-family:monospace;font-size:11px;color:#64748b;">${d || '—'}</span>`
            },
            { 
                data: 'equipment_code',
                render: (d) => `<strong style="font-family:monospace;font-size:12px;">${d || '—'}</strong>`
            },
            { 
                data: 'equipment_model',
                render: (d) => `<span style="color:#64748b;font-size:12px;">${d || '—'}</span>`
            },
            { 
                data: 'assignment_date',
                render: (d) => d ? new Date(d).toLocaleDateString('es-PE') : '—'
            },
            { 
                data: 'department_name',
                render: (d) => d ? `<span class="badge bg-info">${d}</span>` : '<span class="badge bg-secondary">Sin Depto</span>'
            },
            { 
                data: 'location_name',
                render: (d) => d ? `<span class="badge bg-primary">${d}</span>` : '<span class="badge bg-secondary">Sin Ubic</span>'
            },
            { 
                data: null,
                orderable: false,
                render: () => `<button class="btn btn-sm btn-primary edit-assignment-btn">
                    <i class="bi bi-pencil-square"></i>
                </button>`
            }
        ],
        order: [[0, 'desc']]
    });
    
    // Event listener para editar
    $('#asignacionesTable').off('click', '.edit-assignment-btn').on('click', '.edit-assignment-btn', function() {
        const row = $(this).parents('tr');
        const data = asignacionesTable.row(row).data();
        openEditAssignmentModal(data);
    });
}

// ============================================================================
// MODAL: AÑADIR ASIGNACIÓN - CONFIGURAR BÚSQUEDAS
// ============================================================================
function configurarBusquedasModalAñadir() {
    // Búsqueda de empleados
    $('#addEmployeeName').on('input', function() {
        const searchTerm = $(this).val().trim();
        clearTimeout(addEmployeeSearchTimeout);
        
        if (searchTerm.length < 3) {
            $('#addEmployeeSearchResults').hide();
            $('#addEmployeeSearchStatus').text('Escribe al menos 3 caracteres...');
            return;
        }
        
        $('#addEmployeeSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
        
        addEmployeeSearchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`http://localhost:3000/api/employees/search?q=${encodeURIComponent(searchTerm)}`);
                const result = await response.json();
                
                if (result.success && result.data.length > 0) {
                    displayAddEmployeeResults(result.data);
                    $('#addEmployeeSearchStatus').text(`${result.data.length} empleado(s) encontrado(s)`);
                } else {
                    $('#addEmployeeSearchResults').html('<div class="no-results p-2">No se encontraron empleados</div>').show();
                    $('#addEmployeeSearchStatus').text('Sin resultados');
                }
            } catch (error) {
                console.error('Error buscando empleados:', error);
                $('#addEmployeeSearchStatus').text('Error en la búsqueda');
            }
        }, 500);
    });
    
    // Búsqueda de equipos
    $('#addEquipmentCode').on('input', function() {
        const searchTerm = $(this).val().trim();
        clearTimeout(addEquipmentSearchTimeout);
        
        if (searchTerm.length < 2) {
            $('#addEquipmentSearchResults').hide();
            $('#addEquipmentSearchStatus').text('Escribe al menos 2 caracteres...');
            return;
        }
        
        $('#addEquipmentSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
        
        addEquipmentSearchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`http://localhost:3000/api/equipment/search?term=${encodeURIComponent(searchTerm)}`);
                const result = await response.json();
                
                if (result.success && result.data.length > 0) {
                    displayAddEquipmentResults(result.data);
                    $('#addEquipmentSearchStatus').text(`${result.data.length} equipo(s) encontrado(s)`);
                } else {
                    $('#addEquipmentSearchResults').html('<div class="no-results p-2">No se encontraron equipos</div>').show();
                    $('#addEquipmentSearchStatus').text('Sin resultados');
                }
            } catch (error) {
                console.error('Error buscando equipos:', error);
                $('#addEquipmentSearchStatus').text('Error en la búsqueda');
            }
        }, 500);
    });
    // Búsqueda de departamentos (AÑADIR)
    $('#addDepartmentName').on('input', function() {
        const searchTerm = $(this).val().trim();
        clearTimeout(addDepartmentSearchTimeout);
        
        if (searchTerm.length < 2) {
            $('#addDepartmentSearchResults').hide();
            $('#addDepartmentSearchStatus').text('Opcional - Escribe para buscar...');
            return;
        }
        
        $('#addDepartmentSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
        
        addDepartmentSearchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`http://localhost:3000/api/departments/search?term=${encodeURIComponent(searchTerm)}`);
                const result = await response.json();
                
                if (result.success && result.data.length > 0) {
                    displayAddDepartmentResults(result.data);
                    $('#addDepartmentSearchStatus').text(`${result.data.length} departamento(s) encontrado(s)`);
                } else {
                    $('#addDepartmentSearchResults').html('<div class="no-results p-2">No se encontraron departamentos</div>').show();
                    $('#addDepartmentSearchStatus').text('Sin resultados');
                }
            } catch (error) {
                console.error('Error buscando departamentos:', error);
                $('#addDepartmentSearchStatus').text('Error en la búsqueda');
            }
        }, 500);
    });
    
    // Búsqueda de ubicaciones (AÑADIR)
    $('#addLocationName').on('input', function() {
        const searchTerm = $(this).val().trim();
        clearTimeout(addLocationSearchTimeout);
        
        if (searchTerm.length < 2) {
            $('#addLocationSearchResults').hide();
            $('#addLocationSearchStatus').text('Opcional - Escribe para buscar...');
            return;
        }
        
        $('#addLocationSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
        
        addLocationSearchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`http://localhost:3000/api/locations/search?term=${encodeURIComponent(searchTerm)}`);
                const result = await response.json();
                
                if (result.success && result.data.length > 0) {
                    displayAddLocationResults(result.data);
                    $('#addLocationSearchStatus').text(`${result.data.length} ubicación(es) encontrada(s)`);
                } else {
                    $('#addLocationSearchResults').html('<div class="no-results p-2">No se encontraron ubicaciones</div>').show();
                    $('#addLocationSearchStatus').text('Sin resultados');
                }
            } catch (error) {
                console.error('Error buscando ubicaciones:', error);
                $('#addLocationSearchStatus').text('Error en la búsqueda');
            }
        }, 500);
    });
}

function displayAddDepartmentResults(departments) {
    const resultsContainer = $('#addDepartmentSearchResults');
    resultsContainer.empty();
    
    departments.forEach(dept => {
        const item = $(`
            <div class="search-item" data-id="${dept.id}" data-name="${dept.department_name}">
                <strong>${dept.department_name}</strong>
                ${dept.division ? `<br><small>${dept.division}</small>` : ''}
            </div>
        `);
        
        item.on('click', function() {
            $('#addDepartmentName').val($(this).data('name'));
            $('#addDepartmentId').val($(this).data('id'));
            $('#addDepartmentUpdateMessage').fadeIn().delay(3000).fadeOut();
            resultsContainer.hide();
            $('#addDepartmentSearchStatus').text('Departamento seleccionado');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

function displayAddLocationResults(locations) {
    const resultsContainer = $('#addLocationSearchResults');
    resultsContainer.empty();
    
    locations.forEach(loc => {
        const item = $(`
            <div class="search-item" data-id="${loc.id}" data-name="${loc.location_name}">
                <strong>${loc.location_name}</strong>
                ${loc.city ? `<br><small>${loc.city}, ${loc.state || ''}</small>` : ''}
            </div>
        `);
        
        item.on('click', function() {
            $('#addLocationName').val($(this).data('name'));
            $('#addLocationId').val($(this).data('id'));
            $('#addLocationUpdateMessage').fadeIn().delay(3000).fadeOut();
            resultsContainer.hide();
            $('#addLocationSearchStatus').text('Ubicación seleccionada');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

function displayAddEmployeeResults(employees) {
    const resultsContainer = $('#addEmployeeSearchResults');
    resultsContainer.empty();
    
    employees.forEach(emp => {
        const item = $(`
            <div class="employee-search-item" 
                 data-cip="${emp.cip}" 
                 data-name="${emp.full_name}"
                 data-department="${emp.department_name || ''}"
                 data-department-id="${emp.department_id || ''}">
                <span class="employee-name">${emp.full_name}</span>
                <div class="employee-details">
                    CIP: ${emp.cip} | ${emp.email || 'Sin email'} | ${emp.position_name || 'Sin cargo'}
                    ${emp.department_name ? `<br><small>Depto: ${emp.department_name}</small>` : ''}
                </div>
            </div>
        `);
        
        item.on('click', function() {
            $('#addEmployeeName').val($(this).data('name'));
            $('#addEmployeeCip').val($(this).data('cip'));
            
            const dept = $(this).data('department');
            const deptId = $(this).data('department-id');
            if (dept) {
                $('#addDepartmentName').val(dept);
                $('#addDepartmentId').val(deptId);
                $('#addDepartmentUpdateMessage').fadeIn().delay(3000).fadeOut();
            }
            
            $('#addCipUpdateMessage').fadeIn().delay(3000).fadeOut();
            resultsContainer.hide();
            $('#addEmployeeSearchStatus').text('Empleado seleccionado');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

function displayAddEquipmentResults(equipment) {
    const resultsContainer = $('#addEquipmentSearchResults');
    resultsContainer.empty();
    
    equipment.forEach(eq => {
        const item = $(`
            <div class="equipment-search-item" data-code="${eq.device_code}" data-model="${eq.model || 'Sin modelo'}" data-brand="${eq.brand || ''}">
                <span class="equipment-code">${eq.device_code}</span>
                <div class="equipment-details">
                    ${eq.brand || ''} ${eq.model || ''} | ${eq.equipment_type || ''} | ${eq.status || ''}
                </div>
            </div>
        `);
        
        item.on('click', function() {
            $('#addEquipmentCode').val($(this).data('code'));
            $('#addEquipmentModel').val(`${$(this).data('brand')} ${$(this).data('model')}`.trim());
            $('#addEquipmentUpdateMessage').fadeIn().delay(3000).fadeOut();
            resultsContainer.hide();
            $('#addEquipmentSearchStatus').text('Equipo seleccionado');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

// ============================================================================
// MODAL: AÑADIR ASIGNACIÓN - GUARDAR
// ============================================================================
async function handleAddAssignment() {
    const button = $('#saveNewAssignment');
    const spinner = $('#saveNewSpinner');
    const buttonText = $('#saveNewButtonText');
    
    const employeeName = $('#addEmployeeName').val().trim();
    const employeeCip = $('#addEmployeeCip').val().trim();
    const equipmentCode = $('#addEquipmentCode').val().trim();
    const departmentId = $('#addDepartmentId').val();
    const locationId = $('#addLocationId').val();
    const assignmentDate = $('#addAssignmentDate').val();
    
    if (!employeeName) {
        alert('⚠️ El nombre del empleado es obligatorio');
        $('#addEmployeeName').focus();
        return;
    }
    
    if (!employeeCip) {
        alert('⚠️ Debes seleccionar un empleado de la lista');
        $('#addEmployeeName').focus();
        return;
    }
    
    if (!equipmentCode) {
        alert('⚠️ El código del equipo es obligatorio');
        $('#addEquipmentCode').focus();
        return;
    }
    
    if (!assignmentDate) {
        alert('⚠️ La fecha de asignación es obligatoria');
        $('#addAssignmentDate').focus();
        return;
    }
    
    button.prop('disabled', true);
    spinner.removeClass('d-none');
    buttonText.text('Guardando...');
    
    const newAssignment = {
        employee_cip: employeeCip,
        equipment_code: equipmentCode,
        department_id: departmentId || null,
        location_id: locationId || null,
        assignment_date: assignmentDate
    };
    
    console.log('📤 Enviando nueva asignación:', newAssignment);
    
    try {
        const response = await fetch(API_ASSIGNMENTS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(newAssignment)
        });
        
        const result = await response.json();
        console.log('📥 Respuesta:', result);
        
        if (result.success) {
            $('#addAssignmentModal').modal('hide');
            
            // Recargar tabla
            if (asignacionesTable) {
                asignacionesTable.ajax.reload(null, false);
            }
            
            // Recargar KPIs y gráficos
            cargarKPIs();
            cargarGraficoTopModelos();
            cargarGraficoTopUbicaciones();
            cargarGraficoTopDepartamentos();
            
            showNotification('success', `✅ ${result.message || 'Asignación creada exitosamente'}`);
            
            // Limpiar formulario
            $('#addAssignmentForm')[0].reset();
            
        } else {
            alert(`❌ Error: ${result.message || result.error}`);
        }
    } catch (error) {
        console.error('❌ Error:', error);
        alert('❌ Error de conexión: ' + error.message);
    } finally {
        button.prop('disabled', false);
        spinner.addClass('d-none');
        buttonText.text('Guardar Asignación');
    }
}

// ============================================================================
// MODAL: EDITAR ASIGNACIÓN - CONFIGURAR BÚSQUEDAS
// ============================================================================
function configurarBusquedasModalEditar() {
    // Búsqueda de empleados (EDITAR)
    $('#editEmployeeName').on('input', function() {
        const searchTerm = $(this).val().trim();
        clearTimeout(employeeSearchTimeout);
        
        if (searchTerm.length < 3) {
            $('#employeeSearchResults').hide();
            $('#employeeSearchStatus').text('Escribe al menos 3 caracteres...');
            return;
        }
        
        $('#employeeSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
        
        employeeSearchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`http://localhost:3000/api/employees/search?q=${encodeURIComponent(searchTerm)}`);
                const result = await response.json();
                
                if (result.success && result.data.length > 0) {
                    displayEditEmployeeResults(result.data);
                    $('#employeeSearchStatus').text(`${result.data.length} empleado(s) encontrado(s)`);
                } else {
                    $('#employeeSearchResults').html('<div class="no-results p-2">No se encontraron empleados</div>').show();
                    $('#employeeSearchStatus').text('Sin resultados');
                }
            } catch (error) {
                console.error('Error buscando empleados:', error);
                $('#employeeSearchStatus').text('Error en la búsqueda');
            }
        }, 500);
    });
    
    // Búsqueda de equipos (EDITAR)
    $('#editEquipmentCode').on('input', function() {
        const searchTerm = $(this).val().trim();
        clearTimeout(equipmentSearchTimeout);
        
        if (searchTerm.length < 2) {
            $('#equipmentSearchResults').hide();
            $('#equipmentSearchStatus').text('Escribe al menos 2 caracteres...');
            return;
        }
        
        $('#equipmentSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
        
        equipmentSearchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`http://localhost:3000/api/equipment/search?term=${encodeURIComponent(searchTerm)}`);
                const result = await response.json();
                
                if (result.success && result.data.length > 0) {
                    displayEditEquipmentResults(result.data);
                    $('#equipmentSearchStatus').text(`${result.data.length} equipo(s) encontrado(s)`);
                } else {
                    $('#equipmentSearchResults').html('<div class="no-results p-2">No se encontraron equipos</div>').show();
                    $('#equipmentSearchStatus').text('Sin resultados');
                }
            } catch (error) {
                console.error('Error buscando equipos:', error);
                $('#equipmentSearchStatus').text('Error en la búsqueda');
            }
        }, 500);
    });
    
    // Búsqueda de departamentos (EDITAR)
    $('#editDepartmentName').on('input', function() {
        const searchTerm = $(this).val().trim();
        clearTimeout(departmentSearchTimeout);
        
        if (searchTerm.length < 2) {
            $('#departmentSearchResults').hide();
            $('#departmentSearchStatus').text('Opcional...');
            return;
        }
        
        $('#departmentSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
        
        departmentSearchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`http://localhost:3000/api/departments/search?term=${encodeURIComponent(searchTerm)}`);
                const result = await response.json();
                
                if (result.success && result.data.length > 0) {
                    displayEditDepartmentResults(result.data);
                    $('#departmentSearchStatus').text(`${result.data.length} departamento(s) encontrado(s)`);
                } else {
                    $('#departmentSearchResults').html('<div class="no-results p-2">No se encontraron departamentos</div>').show();
                    $('#departmentSearchStatus').text('Sin resultados');
                }
            } catch (error) {
                console.error('Error buscando departamentos:', error);
                $('#departmentSearchStatus').text('Error en la búsqueda');
            }
        }, 500);
    });
    
    // Búsqueda de ubicaciones (EDITAR)
    $('#editLocationName').on('input', function() {
        const searchTerm = $(this).val().trim();
        clearTimeout(locationSearchTimeout);
        
        if (searchTerm.length < 2) {
            $('#locationSearchResults').hide();
            $('#locationSearchStatus').text('Opcional...');
            return;
        }
        
        $('#locationSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
        
        locationSearchTimeout = setTimeout(async () => {
            try {
                const response = await fetch(`http://localhost:3000/api/locations/search?term=${encodeURIComponent(searchTerm)}`);
                const result = await response.json();
                
                if (result.success && result.data.length > 0) {
                    displayEditLocationResults(result.data);
                    $('#locationSearchStatus').text(`${result.data.length} ubicación(es) encontrada(s)`);
                } else {
                    $('#locationSearchResults').html('<div class="no-results p-2">No se encontraron ubicaciones</div>').show();
                    $('#locationSearchStatus').text('Sin resultados');
                }
            } catch (error) {
                console.error('Error buscando ubicaciones:', error);
                $('#locationSearchStatus').text('Error en la búsqueda');
            }
        }, 500);
    });
}

function displayEditEmployeeResults(employees) {
    const resultsContainer = $('#employeeSearchResults');
    resultsContainer.empty();
    
    employees.forEach(emp => {
        const item = $(`
            <div class="employee-search-item" 
                 data-cip="${emp.cip}" 
                 data-name="${emp.full_name}"
                 data-department="${emp.department_name || ''}"
                 data-department-id="${emp.department_id || ''}">
                <span class="employee-name">${emp.full_name}</span>
                <div class="employee-details">
                    CIP: ${emp.cip} | ${emp.email || 'Sin email'} | ${emp.position_name || 'Sin cargo'}
                    ${emp.department_name ? `<br><small>Depto: ${emp.department_name}</small>` : ''}
                </div>
            </div>
        `);
        
        item.on('click', function() {
            $('#editEmployeeName').val($(this).data('name'));
            $('#editEmployeeCip').val($(this).data('cip'));
            
            const dept = $(this).data('department');
            const deptId = $(this).data('department-id');
            if (dept) {
                $('#editDepartmentName').val(dept);
                $('#editDepartmentId').val(deptId);
                $('#departmentUpdateMessage').fadeIn().delay(3000).fadeOut();
            }
            
            $('#cipUpdateMessage').fadeIn().delay(3000).fadeOut();
            resultsContainer.hide();
            $('#employeeSearchStatus').text('Empleado seleccionado');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

function displayEditEquipmentResults(equipment) {
    const resultsContainer = $('#equipmentSearchResults');
    resultsContainer.empty();
    
    equipment.forEach(eq => {
        const item = $(`
            <div class="equipment-search-item" data-code="${eq.device_code}" data-model="${eq.model || 'Sin modelo'}" data-brand="${eq.brand || ''}">
                <span class="equipment-code">${eq.device_code}</span>
                <div class="equipment-details">
                                
                     ${eq.brand || ''} ${eq.model || ''} | ${eq.equipment_type || ''} | <span style="color:#10b981;font-weight:600;">✓ Disponible</span>
                </div>
            </div>
        `);
        
        item.on('click', function() {
            $('#editEquipmentCode').val($(this).data('code'));
            $('#editEquipmentModel').val(`${$(this).data('brand')} ${$(this).data('model')}`.trim());
            $('#equipmentUpdateMessage').fadeIn().delay(3000).fadeOut();
            resultsContainer.hide();
            $('#equipmentSearchStatus').text('Equipo seleccionado');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

function displayEditDepartmentResults(departments) {
    const resultsContainer = $('#departmentSearchResults');
    resultsContainer.empty();
    
    departments.forEach(dept => {
        const item = $(`
            <div class="search-item" data-id="${dept.id}" data-name="${dept.department_name}">
                <strong>${dept.department_name}</strong>
                ${dept.division ? `<br><small>${dept.division}</small>` : ''}
            </div>
        `);
        
        item.on('click', function() {
            $('#editDepartmentName').val($(this).data('name'));
            $('#editDepartmentId').val($(this).data('id'));
            $('#departmentUpdateMessage').fadeIn().delay(3000).fadeOut();
            resultsContainer.hide();
            $('#departmentSearchStatus').text('Departamento seleccionado');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

function displayEditLocationResults(locations) {
    const resultsContainer = $('#locationSearchResults');
    resultsContainer.empty();
    
    locations.forEach(loc => {
        const item = $(`
            <div class="search-item" data-id="${loc.id}" data-name="${loc.location_name}">
                <strong>${loc.location_name}</strong>
                ${loc.city ? `<br><small>${loc.city}, ${loc.state || ''}</small>` : ''}
            </div>
        `);
        
        item.on('click', function() {
            $('#editLocationName').val($(this).data('name'));
            $('#editLocationId').val($(this).data('id'));
            $('#locationUpdateMessage').fadeIn().delay(3000).fadeOut();
            resultsContainer.hide();
            $('#locationSearchStatus').text('Ubicación seleccionada');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

function openEditAssignmentModal(data) {
    console.log('📝 Editando asignación:', data);
    
    $('#editAssignmentId').val(data.assignment_id || '');
    $('#editEmployeeName').val(data.employee_name || '');
    $('#editEmployeeCip').val(data.employee_cip || '');
    $('#editEquipmentCode').val(data.equipment_code || '');
    $('#editEquipmentModel').val(data.equipment_model || '');
    $('#editDepartmentName').val(data.department_name || '');
    $('#editDepartmentId').val(data.department_id || '');
    $('#editLocationName').val(data.location_name || '');
    $('#editLocationId').val(data.location_id || '');
    
    // Ocultar mensajes
    $('#cipUpdateMessage, #equipmentUpdateMessage, #departmentUpdateMessage, #locationUpdateMessage').hide();
    $('#employeeSearchResults, #equipmentSearchResults, #departmentSearchResults, #locationSearchResults').hide();
    
    if (data.assignment_date) {
        const date = new Date(data.assignment_date);
        const formatted = date.toISOString().split('T')[0];
        $('#editAssignmentDate').val(formatted);
    }
    
    $('#editAssignmentModal').modal('show');
}

async function handleEditAssignment() {
    const assignmentId = $('#editAssignmentId').val();
    const employeeName = $('#editEmployeeName').val();
    const employeeCip = $('#editEmployeeCip').val();
    const equipmentCode = $('#editEquipmentCode').val();
    const departmentId = $('#editDepartmentId').val();
    const locationId = $('#editLocationId').val();
    const assignmentDate = $('#editAssignmentDate').val();
    
    if (!employeeName || !employeeCip) {
        alert('⚠️ El empleado es obligatorio');
        return;
    }
    
    if (!equipmentCode) {
        alert('⚠️ El equipo es obligatorio');
        return;
    }
    
    const updatedData = {
        assignment_id: assignmentId,
        employee_cip: employeeCip.trim(),
        employee_name: employeeName.trim(),
        equipment_code: equipmentCode.trim(),
        department_id: departmentId || null,
        location_id: locationId || null,
        assignment_date: assignmentDate
    };
    
    console.log('📤 Actualizando asignación:', updatedData);
    
    try {
        const response = await fetch('http://localhost:3000/api/assignments/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(updatedData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            $('#editAssignmentModal').modal('hide');
            
            if (asignacionesTable) {
                asignacionesTable.ajax.reload(null, false);
            }
            
            cargarKPIs();
            showNotification('success', `✅ ${result.message}`);
        } else {
            alert(`❌ Error: ${result.message}`);
        }
    } catch (error) {
        console.error('❌ Error:', error);
        alert('❌ Error de conexión: ' + error.message);
    }
}

// ============================================================================
// UTILIDADES
// ============================================================================
function showNotification(type, message) {
    const colors = {
        success: '#28a745',
        error: '#dc3545',
        info: '#3b82f6',
        warning: '#f59e0b'
    };
    const icons = {
        success: 'check-circle-fill',
        error: 'exclamation-circle-fill',
        info: 'info-circle-fill',
        warning: 'exclamation-triangle-fill'
    };
    
    const notification = $(`
        <div class="position-fixed top-0 end-0 p-3" style="z-index: 9999;">
            <div class="toast show align-items-center text-white border-0" 
                 style="background-color: ${colors[type]};" role="alert">
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="bi bi-${icons[type]} me-2"></i>${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" 
                            onclick="this.closest('.toast').remove()"></button>
                </div>
            </div>
        </div>
    `);
    
    $('body').append(notification);
    setTimeout(() => notification.remove(), 4000);
}

// Limpiar modales al cerrar
$('#addAssignmentModal').on('hidden.bs.modal', function() {
    $('#addAssignmentForm')[0].reset();
    $('#addEmployeeCip, #addEquipmentModel, #addDepartmentId, #addLocationId').val('');
    $('#addEmployeeSearchResults, #addEquipmentSearchResults').hide();
});

$('#editAssignmentModal').on('hidden.bs.modal', function() {
    $('#editAssignmentForm')[0].reset();
});

console.log('✅ Assignments Dashboard cargado');
