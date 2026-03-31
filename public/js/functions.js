// ============================================================================
// CONFIGURACIÓN GENERAL Y VARIABLES GLOBALES
// ============================================================================

const API_BASE_URL = window.location.origin;
const API_BASE     = `${API_BASE_URL}/api/dashboard`;

let tables = {}; // Almacena las instancias de DataTables
let searchTimeout = null; // Timeout para búsqueda global con debounce
let currentActiveTable = 'employees'; // Tabla actualmente activa
let isSearchActive = false; // Flag para indicar si hay una búsqueda activa

// Timeouts para búsquedas en modales
let employeeSearchTimeout = null;
let equipmentSearchTimeout = null;
let departmentSearchTimeout = null;
let locationSearchTimeout = null;

// ============================================================================
// INICIALIZACIÓN
// ============================================================================
// ⭐ NUEVA FUNCIÓN: Carga ultra rápida solo stats
// ⭐ FUNCIÓN OPTIMIZADA: Carga stats + datos para tablas sin server-side
// ⭐ CARGA ULTRA RÁPIDA: Solo stats, sin datos
async function loadDashboardStatsOnly() {
    try {
        const start = performance.now();
        console.log('⚡ Cargando solo estadísticas...');
        
        const response = await fetch(`${API_BASE}/stats-only`);
        if (!response.ok) throw new Error('Error al cargar stats');
        
        const result = await response.json();
        
        updateStats(result.stats);
        $('#lastUpdate').text(new Date().toLocaleString('es-PE'));
        
        const duration = performance.now() - start;
        console.log(`✅ Stats cargados en ${duration.toFixed(0)}ms`);
        
        // ⭐ Inicializar tablas VACÍAS (sin datos todavía)
        initTablesEmpty();
        
        // ⭐ Cargar datos SOLO de la primera pestaña (Empleados)
        setTimeout(() => {
            loadEmployeesData();
        }, 100);
        
    } catch (error) {
        console.error('❌ Error:', error);
        loadDashboardData(); // Fallback
    }
}
// ============================================================================
// INICIALIZACIÓN CORREGIDA
// ============================================================================

$(document).ready(function() {
    loadDashboardData();

    // Búsqueda global con debounce
    $('#globalSearch').on('keyup', function() {
        const term = $(this).val().trim();
        clearTimeout(searchTimeout);
        
        if (term.length < 2) {
            $('#searchStatus').text('Mín. 2 caracteres...');
            if (term.length === 0) {
                clearSearch();
            }
            return;
        }

        $('#searchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
        
        searchTimeout = setTimeout(() => {
            performGlobalSearch(term);
        }, 500);
    });

    // Botón refrescar
    $('#btnRefresh').on('click', () => {
        clearSearch();
        loadDashboardData();
    });

    // Limpiar búsqueda
    $('#btnClearSearch').on('click', clearSearch);

    // Detectar cambio de pestaña
    $('a[data-bs-toggle="tab"]').on('shown.bs.tab', function(e) {
        currentActiveTable = $(e.target).data('table');
    });

    // Exportación
    $('#exportExcel').on('click', () => exportTable('excel'));
    $('#exportCSV').on('click', () => exportTable('csv'));
    $('#exportPDF').on('click', () => exportTable('pdf'));
});


// ============================================================================
// FUNCIONES DE CARGA DE DATOS
// ============================================================================

/**
 * Carga los datos principales del dashboard
 */
async function loadDashboardData() {
    try {
        showLoading('Cargando datos...', 'Cargando primeros 100 registros');
        
        const response = await fetch(`${API_BASE}/unified?limit=100`);
        if (!response.ok) throw new Error('Error al cargar datos');
        
        const result = await response.json();
        
        console.log('📊 Datos cargados:', result);
        
        // Actualizar estadísticas
        updateStats(result.stats);
        
        // Recrear tablas con server-side
        initTablesServerSide(result.data);
        
        // Actualizar timestamp
        $('#lastUpdate').text(new Date(result.timestamp).toLocaleString('es-PE'));
        
        hideLoading();
        
        console.log('✅ Dashboard cargado correctamente');
        
    } catch (error) {
        console.error('❌ Error:', error);
        hideLoading();
        alert('Error al cargar el dashboard: ' + error.message);
    }
}




function initTablesServerSide(data) {
    console.log('🔄 Inicializando tablas con server-side...');
    
    // ===== EMPLEADOS =====
    if (tables.employees) {
        tables.employees.destroy();
        $('#employeesTable').empty(); // Limpiar HTML residual
    }
    
    tables.employees = $('#employeesTable').DataTable({
        language: { url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/es-ES.json' },
        pageLength: 25,
        dom: 'Bfrtip',
        buttons: [],
        processing: true,
        serverSide: true,
        ajax: {
            url: '${API_BASE_URL}/api/employees',
            type: 'GET',
            credentials: 'include',
            data: function(d) {
                return {
                    page: Math.floor(d.start / d.length) + 1,
                    limit: d.length,
                    search: d.search.value || ''
                };
            },
            dataSrc: function(response) {
                return response.data;
            }
        },
        columns: [
            { data: 'cip' },
            { data: 'full_name' },
            { data: 'national_id' },
            { data: 'email', render: (d) => d ? `<a href="mailto:${d}">${d}</a>` : '' },
            { data: 'position_name' },
            { 
                    data: 'category', 
    render: (d) => {
        if (!d) return '<span class="badge bg-secondary">Sin categoría</span>';
        
        // ⭐ COLORES CORRECTOS
        const badgeClass = {
            'Especialista': 'badge-especialista',
            'Analista': 'badge-analista',
            'Coordinador': 'badge-coordinador',
            'Gerente': 'badge-gerente',
            'Asistente': 'badge-asistente',
            'Técnico': 'badge-tecnico'
        };
        
        const cssClass = badgeClass[d] || 'bg-secondary';
        return `<span class="badge ${cssClass}">${d}</span>`;
    }
},
            { data: 'supervisor_name' },
            { data: 'branch_office_id' }
        ],
        order: [[1, 'asc']]
    });

    // ===== EQUIPOS =====
    if (tables.equipment) {
        tables.equipment.destroy();
        $('#equipmentTable').empty();
    }
    
    tables.equipment = $('#equipmentTable').DataTable({
        language: { url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/es-ES.json' },
        pageLength: 25,
        dom: 'Bfrtip',
        buttons: [],
        processing: true,
        serverSide: true,
        ajax: {
            url: '${API_BASE_URL}/api/equipment',
            type: 'GET',
            credentials: 'include',
            data: function(d) {
                return {
                    page: Math.floor(d.start / d.length) + 1,
                    limit: d.length,
                    search: d.search.value || ''
                };
            },
            dataSrc: function(response) {
                return response.data;
            }
        },
        columns: [
            { data: 'device_code' },
            { data: 'serial_number' },
            { data: 'equipment_type' },
            { data: 'brand' },
            { data: 'model' },
            { data: 'ram_memory' },
            { data: 'disk_capacity' },
            { 
                data: 'status',
                render: (d) => {
                    const colors = { 
                        'Asignado': 'success', 
                        'Disponible': 'info', 
                        'Mantenimiento': 'warning', 
                        'Obsoleto': 'danger' 
                    };
                    return `<span class="badge bg-${colors[d] || 'secondary'}">${d}</span>`;
                }
            },
            { 
                data: null,
                orderable: false,
                render: () => `<button class="btn btn-sm btn-primary edit-btn">
                    <i class="bi bi-pencil-square"></i>
                </button>`
            }
        ],
        order: [[0, 'asc']]
    });

    // Reconectar event listeners para equipos
    $('#equipmentTable').off('click', '.edit-btn').on('click', '.edit-btn', function() {
        const row = $(this).parents('tr');
        const data = tables.equipment.row(row).data();
        openEditEquipmentModal(data);
    });

    // ===== ASIGNACIONES =====
    if (tables.assignments) {
        tables.assignments.destroy();
        $('#assignmentsTable').empty();
    }
    
    tables.assignments = $('#assignmentsTable').DataTable({
        language: { url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/es-ES.json' },
        pageLength: 25,
        dom: 'Bfrtip',
        buttons: [],
        data: data.assignments,
        columns: [
            { data: 'assignment_id' },
            { data: 'employee_name' },
            { data: 'employee_cip' },
            { data: 'equipment_model' },
            { data: 'equipment_code' },
            { data: 'assignment_date', render: (d) => new Date(d).toLocaleDateString('es-PE') },
            { data: 'department_name' },
            { data: 'location_name' },
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

    // Reconectar event listeners para asignaciones
    $('#assignmentsTable').off('click', '.edit-assignment-btn').on('click', '.edit-assignment-btn', function() {
        const row = $(this).parents('tr');
        const data = tables.assignments.row(row).data();
        openEditAssignmentModal(data);
    });

    // ===== DEPARTAMENTOS =====
    if (tables.departments) {
        tables.departments.destroy();
        $('#departmentsTable').empty();
    }
    
    tables.departments = $('#departmentsTable').DataTable({
        language: { url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/es-ES.json' },
        pageLength: 25,
        dom: 'Bfrtip',
        buttons: [],
        data: data.departments,
        columns: [
            { data: 'id' },
            { data: 'department_name' },
            { data: 'division' },
            { data: 'subactivity' },
            { data: 'desc_ceo_4' },
            { 
                data: null, 
                orderable: false,
                render: () => `<button class="btn btn-sm btn-primary edit-department-btn">
                    <i class="bi bi-pencil-square"></i>
                </button>` 
            }
        ],
        order: [[1, 'asc']]
    });

    // Reconectar event listeners para departamentos
    $('#departmentsTable').off('click', '.edit-department-btn').on('click', '.edit-department-btn', function() {
        const row = $(this).parents('tr');
        const data = tables.departments.row(row).data();
        openEditDepartmentModal(data);
    });

    // ===== UBICACIONES =====
    if (tables.locations) {
        tables.locations.destroy();
        $('#locationsTable').empty();
    }
    
    tables.locations = $('#locationsTable').DataTable({
        language: { url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/es-ES.json' },
        pageLength: 25,
        dom: 'Bfrtip',
        buttons: [],
        data: data.locations,
        columns: [
            { data: 'branch_office_id' },
            { data: 'location_name' },
            { data: 'city' },
            { data: 'state' },
            { data: 'address' },
            { data: 'phone' },
            { 
                data: null, 
                orderable: false,
                render: () => `<button class="btn btn-sm btn-primary edit-location-btn">
                    <i class="bi bi-pencil-square"></i>
                </button>` 
            }
        ],
        order: [[1, 'asc']]
    });

    // Reconectar event listeners para ubicaciones
    $('#locationsTable').off('click', '.edit-location-btn').on('click', '.edit-location-btn', function() {
        const row = $(this).parents('tr');
        const data = tables.locations.row(row).data();
        openEditLocationModal(data);
    });
    
    console.log('✅ Tablas inicializadas con server-side');
}

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================

function updateStats(stats) {
    $('#totalEmployees').text(stats.totalEmployees.toLocaleString());
    $('#totalEquipment').text(stats.totalEquipment.toLocaleString());
    $('#totalAssignments').text(stats.totalAssignments.toLocaleString());
    $('#totalDepartments').text(stats.totalDepartments.toLocaleString());
    $('#totalLocations').text(stats.totalLocations.toLocaleString());
    
    $('#countEmployees').text(stats.totalEmployees.toLocaleString());
    $('#countEquipment').text(stats.totalEquipment.toLocaleString());
    $('#countAssignments').text(stats.totalAssignments.toLocaleString());
    $('#countDepartments').text(stats.totalDepartments.toLocaleString());
    $('#countLocations').text(stats.totalLocations.toLocaleString());
}

function showLoading(title, subtitle) {
    $('#loadingText').text(title);
    $('#loadingSubtext').text(subtitle);
    $('#loadingOverlay').fadeIn(200);
}

function hideLoading() {
    $('#loadingOverlay').fadeOut(200);
}

console.log('✅ Módulo de Búsqueda Global corregido');

// ============================================================================
// FUNCIONES AUXILIARES
// ============================================================================

function updateStats(stats) {
    $('#totalEmployees').text(stats.totalEmployees.toLocaleString());
    $('#totalEquipment').text(stats.totalEquipment.toLocaleString());
    $('#totalAssignments').text(stats.totalAssignments.toLocaleString());
    $('#totalDepartments').text(stats.totalDepartments.toLocaleString());
    $('#totalLocations').text(stats.totalLocations.toLocaleString());
    
    $('#countEmployees').text(stats.totalEmployees.toLocaleString());
    $('#countEquipment').text(stats.totalEquipment.toLocaleString());
    $('#countAssignments').text(stats.totalAssignments.toLocaleString());
    $('#countDepartments').text(stats.totalDepartments.toLocaleString());
    $('#countLocations').text(stats.totalLocations.toLocaleString());
}

function showLoading(title, subtitle) {
    $('#loadingText').text(title);
    $('#loadingSubtext').text(subtitle);
    $('#loadingOverlay').fadeIn(200);
}

function hideLoading() {
    $('#loadingOverlay').fadeOut(200);
}

console.log('✅ Módulo de Búsqueda Global corregido');
/**
 * Realiza una búsqueda global en todas las tablas
 * @param {string} term - Término de búsqueda
 */
async function performGlobalSearch(term) {
    try {
        isSearchActive = true;
        showLoading('Buscando...', `Buscando "${term}" en toda la base de datos`);
        
        const response = await fetch(`${API_BASE}/search?term=${encodeURIComponent(term)}`);
        if (!response.ok) throw new Error('Error en búsqueda');
        
        const result = await response.json();
        
        console.log('📊 Resultados de búsqueda:', result);
        
        // ⭐ CLAVE: Destruir y recrear las tablas con los datos filtrados
        destroyAndRecreateTables(result.data);
        
        // Actualizar UI
        $('#searchTermDisplay').text(term);
        $('#searchResultsCount').text(result.totalResults);
        $('#searchResultsInfo').addClass('active');
        $('#btnClearSearch').show();
        $('#searchStatus').text(`${result.totalResults} resultados`);
        $('#loadingInfo').hide();
        
        // Actualizar contadores
        updateCounts(result.data);
        
        hideLoading();
    } catch (error) {
        console.error('Error:', error);
        $('#searchStatus').text('Error en búsqueda');
        hideLoading();
    }
}

function destroyAndRecreateTables(data) {
    const commonConfig = {
        language: { url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/es-ES.json' },
        pageLength: 25,
        dom: 'Bfrtip',
        buttons: [],
        // ⭐ SIN serverSide cuando hay búsqueda activa
        processing: false,
        serverSide: false
    };

    // ===== TABLA EMPLEADOS =====
    if (tables.employees) {
        tables.employees.destroy();
    }
    
    tables.employees = $('#employeesTable').DataTable({
        ...commonConfig,
        data: data.employees,
        columns: [
            { data: 'cip' },
            { data: 'full_name' },
            { data: 'national_id' },
            { 
                data: 'email', 
                render: (d) => d ? `<a href="mailto:${d}">${d}</a>` : '' 
            },
            { data: 'position_name' },
            { 
                data: 'category', 
                render: (d) => {
                    if (!d) return '<span class="badge bg-secondary">Sin categoría</span>';
                    
                    // ⭐ MAPEO CORRECTO DE COLORES
                    const badgeClass = {
                        'Especialista': 'badge-especialista',
                        'Analista': 'badge-analista',
                        'Coordinador': 'badge-coordinador',
                        'Gerente': 'badge-gerente',
                        'Asistente': 'badge-asistente',
                        'Técnico': 'badge-tecnico'
                    };
                    
                    const cssClass = badgeClass[d] || 'bg-secondary';
                    return `<span class="badge ${cssClass}">${d}</span>`;
                }
            },
            { data: 'supervisor_name' },
            { data: 'branch_office_id' }
        ],
        order: [[1, 'asc']]
    });

    // ===== TABLA EQUIPOS =====
    if (tables.equipment) {
        tables.equipment.destroy();
    }
    
    tables.equipment = $('#equipmentTable').DataTable({
        ...commonConfig,
        data: data.equipment,
        columns: [
            { data: 'device_code' },
            { data: 'serial_number' },
            { data: 'equipment_type' },
            { data: 'brand' },
            { data: 'model' },
            { data: 'ram_memory' },
            { data: 'disk_capacity' },
            { 
                data: 'status',
                render: (d) => {
                    const colors = { 
                        'Asignado': 'success', 
                        'Disponible': 'info', 
                        'Mantenimiento': 'warning', 
                        'Obsoleto': 'danger' 
                    };
                    return `<span class="badge bg-${colors[d] || 'secondary'}">${d}</span>`;
                }
            },
            { 
                data: null,
                orderable: false,
                render: () => `<button class="btn btn-sm btn-primary edit-btn">
                    <i class="bi bi-pencil-square"></i>
                </button>`
            }
        ],
        order: [[0, 'asc']]
    });

    // Event listener para editar equipos
    $('#equipmentTable').off('click', '.edit-btn').on('click', '.edit-btn', function() {
        const row = $(this).parents('tr');
        const data = tables.equipment.row(row).data();
        openEditEquipmentModal(data);
    });

    // ===== TABLA ASIGNACIONES =====
    if (tables.assignments) {
        tables.assignments.destroy();
    }
    
    tables.assignments = $('#assignmentsTable').DataTable({
        ...commonConfig,
        data: data.assignments,
        columns: [
            { data: 'assignment_id' },
            { data: 'employee_name' },
            { data: 'employee_cip' },
            { data: 'equipment_model' }, 
            { data: 'equipment_code' },
            { 
                data: 'assignment_date',
                render: (d) => new Date(d).toLocaleDateString('es-PE')
            },
            { data: 'department_name' },
            { data: 'location_name' },
            { 
                data: null,
                render: () => `<button class="btn btn-sm btn-primary edit-assignment-btn">
                    <i class="bi bi-pencil-square"></i>
                </button>`
            }
        ],
        order: [[0, 'desc']]
    });

    $('#assignmentsTable').off('click', '.edit-assignment-btn').on('click', '.edit-assignment-btn', function() {
        const row = $(this).parents('tr');
        const data = tables.assignments.row(row).data();
        openEditAssignmentModal(data);
    });

    // ===== TABLA DEPARTAMENTOS =====
    if (tables.departments) {
        tables.departments.destroy();
    }
    
    tables.departments = $('#departmentsTable').DataTable({
        ...commonConfig,
        data: data.departments,
        columns: [
            { data: 'id' },
            { data: 'department_name' },
            { data: 'division' },
            { data: 'subactivity' },
            { data: 'desc_ceo_4' },
            { 
                data: null,
                render: () => `<button class="btn btn-sm btn-primary edit-department-btn">
                    <i class="bi bi-pencil-square"></i>
                </button>`
            }
        ],
        order: [[1, 'asc']]
    });

    $('#departmentsTable').off('click', '.edit-department-btn').on('click', '.edit-department-btn', function() {
        const row = $(this).parents('tr');
        const data = tables.departments.row(row).data();
        openEditDepartmentModal(data);
    });

    // ===== TABLA UBICACIONES =====
    if (tables.locations) {
        tables.locations.destroy();
    }
    
    tables.locations = $('#locationsTable').DataTable({
        ...commonConfig,
        data: data.locations,
        columns: [
            { data: 'branch_office_id' },
            { data: 'location_name' },
            { data: 'city' },
            { data: 'state' },
            { data: 'address' },
            { data: 'phone' },
            { 
                data: null,
                render: () => `<button class="btn btn-sm btn-primary edit-location-btn">
                    <i class="bi bi-pencil-square"></i>
                </button>`
            }
        ],
        order: [[1, 'asc']]
    });

    $('#locationsTable').off('click', '.edit-location-btn').on('click', '.edit-location-btn', function() {
        const row = $(this).parents('tr');
        const data = tables.locations.row(row).data();
        openEditLocationModal(data);
    });
}


function clearSearch() {
    console.log('🧹 Limpiando búsqueda...');
    
    isSearchActive = false;
    
    // Limpiar input
    $('#globalSearch').val('');
    
    // Ocultar info de búsqueda
    $('#searchResultsInfo').removeClass('active');
    $('#btnClearSearch').hide();
    $('#searchStatus').text('Escribe para buscar...');
    $('#loadingInfo').show();
    
    // Resetear contadores a valores originales desde stats
    // Los stats se actualizarán cuando loadDashboardData termine
    
    // Recargar datos originales (con serverSide: true)
    loadDashboardData();
    
    console.log('✅ Búsqueda limpiada');
}


/**
 * 
 * 
 * Limpia la búsqueda y recarga los datos originales
 */
function updateCounts(data) {
    if (isSearchActive) {
        $('#countEmployees').text(data.employees.length);
        $('#countEquipment').text(data.equipment.length);
        $('#countAssignments').text(data.assignments.length);
        $('#countDepartments').text(data.departments.length);
        $('#countLocations').text(data.locations.length);
    }
}
// ============================================================================
// ACTUALIZACIÓN DE UI
// ============================================================================

/**
 * Actualiza las estadísticas en los badges superiores
 * @param {Object} stats - Objeto con las estadísticas
 */
function updateStats(stats) {
    $('#totalEmployees').text(stats.totalEmployees.toLocaleString());
    $('#totalEquipment').text(stats.totalEquipment.toLocaleString());
    $('#totalAssignments').text(stats.totalAssignments.toLocaleString());
    $('#totalDepartments').text(stats.totalDepartments.toLocaleString());
    $('#totalLocations').text(stats.totalLocations.toLocaleString());
    
    $('#countEmployees').text(stats.totalEmployees.toLocaleString());
    $('#countEquipment').text(stats.totalEquipment.toLocaleString());
    $('#countAssignments').text(stats.totalAssignments.toLocaleString());
    $('#countDepartments').text(stats.totalDepartments.toLocaleString());
    $('#countLocations').text(stats.totalLocations.toLocaleString());
}

/**
 * Actualiza las tablas con resultados de búsqueda
 * @param {Object} data - Objeto con los datos de búsqueda
 */
function updateTablesWithSearchResults(data) {
    if (data.employees && tables.employees) {
        tables.employees.clear().rows.add(data.employees).draw();
    }
    if (data.equipment && tables.equipment) {
        tables.equipment.clear().rows.add(data.equipment).draw();
    }
    if (data.assignments && tables.assignments) {
        tables.assignments.clear().rows.add(data.assignments).draw();
    }
    if (data.departments && tables.departments) {
        tables.departments.clear().rows.add(data.departments).draw();
    }
    if (data.locations && tables.locations) {
        tables.locations.clear().rows.add(data.locations).draw();
    }
    
    updateCounts(data);
}

/**
 * Actualiza los contadores de registros en las pestañas
 * @param {Object} data - Objeto con los datos
 */
function updateCounts(data) {
    if (isSearchActive) {
        $('#countEmployees').text(data.employees.length);
        $('#countEquipment').text(data.equipment.length);
        $('#countAssignments').text(data.assignments.length);
        $('#countDepartments').text(data.departments.length);
        $('#countLocations').text(data.locations.length);
    }
}

// ============================================================================
// INICIALIZACIÓN DE DATATABLES
// ============================================================================

/**
 * Inicializa o actualiza todas las DataTables
 * @param {Object} data - Objeto con los datos de todas las tablas
 */
function initTables(data) {
    const commonConfig = {
        language: { url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/es-ES.json' },
        pageLength: 25,
        dom: 'Bfrtip',
        buttons: []
    };

    // ===== TABLA EMPLEADOS =====
if (tables.employees) {
    tables.employees.clear().rows.add(data.employees).draw();
} else {
    tables.employees = $('#employeesTable').DataTable({
        language: { url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/es-ES.json' },
        pageLength: 25,
        dom: 'Bfrtip',
        buttons: [],
        
        // ⭐ HABILITAR SERVER-SIDE PROCESSING
        processing: true,
        serverSide: true,
        
        // ⭐ CONFIGURAR AJAX PARA BÚSQUEDAS
        ajax: {
            url: '${API_BASE_URL}/api/employees',
            type: 'GET',
            credentials: 'include',
            data: function(d) {
                // Mapear los parámetros de DataTables a tu API
                return {
                    page: Math.floor(d.start / d.length) + 1,
                    limit: d.length,
                    search: d.search.value || ''
                };
            },
            dataSrc: function(response) {
                // Actualizar info de paginación
                return response.data;
            }
        },
        
        columns: [
            { data: 'cip' },
            { data: 'full_name' },
            { data: 'national_id' },
            { 
                data: 'email', 
                render: (d) => d ? `<a href="mailto:${d}">${d}</a>` : '' 
            },
            { data: 'position_name' },
            { 
                data: 'category', 
                render: (d) => d ? `<span class="badge bg-primary">${d}</span>` : '' 
            },
            { data: 'supervisor_name' },
            { data: 'branch_office_id' }
        ],
        order: [[1, 'asc']]
    });
}

    // ===== TABLA EQUIPOS =====
if (tables.equipment) {
    tables.equipment.clear().rows.add(data.equipment).draw();
} else {
    tables.equipment = $('#equipmentTable').DataTable({
        language: { url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/es-ES.json' },
        pageLength: 25,
        dom: 'Bfrtip',
        buttons: [],
        
        // ⭐ HABILITAR SERVER-SIDE PROCESSING
        processing: true,
        serverSide: true,
        
        // ⭐ CONFIGURAR AJAX PARA BÚSQUEDAS
        ajax: {
            url: '${API_BASE_URL}/api/equipment',
            type: 'GET',
            credentials: 'include',
            data: function(d) {
                return {
                    page: Math.floor(d.start / d.length) + 1,
                    limit: d.length,
                    search: d.search.value || ''
                };
            },
            dataSrc: function(response) {
                return response.data;
            }
        },
        
        columns: [
            { data: 'device_code' },
            { data: 'serial_number' },
            { data: 'equipment_type' },
            { data: 'brand' },
            { data: 'model' },
            { data: 'ram_memory' },
            { data: 'disk_capacity' },
            { 
                data: 'status',
                render: (d) => {
                    const colors = { 
                        'Asignado': 'success', 
                        'Disponible': 'info', 
                        'Mantenimiento': 'warning', 
                        'Obsoleto': 'danger' 
                    };
                    return `<span class="badge bg-${colors[d] || 'secondary'}">${d}</span>`;
                }
            },
            { 
                data: null,
                orderable: false,
                render: () => `
                    <button class="btn btn-sm btn-primary edit-btn">
                        <i class="bi bi-pencil-square"></i> Editar
                    </button>
                `
            }
        ],
        order: [[0, 'asc']]
    });

    // Event listener para editar equipos
    $('#equipmentTable').off('click', '.edit-btn').on('click', '.edit-btn', function() {
        const row = $(this).parents('tr');
        const data = tables.equipment.row(row).data();
        openEditEquipmentModal(data);
    });
}
    // ===== TABLA ASIGNACIONES =====
    if (tables.assignments) {
        tables.assignments.clear().rows.add(data.assignments).draw();
    } else {
        tables.assignments = $('#assignmentsTable').DataTable({
            ...commonConfig,
            data: data.assignments,
            columns: [
                { data: 'assignment_id' },
                { data: 'employee_name' },
                { data: 'employee_cip' },
                { data: 'equipment_model' }, 
                { data: 'equipment_code' },
                { 
                    data: 'assignment_date',
                    render: (d) => new Date(d).toLocaleDateString('es-PE')
                },
                { data: 'department_name' },
                { data: 'location_name' },
                { 
                    data: null,
                    render: () => `
                        <button class="btn btn-sm btn-primary edit-assignment-btn">
                            <i class="bi bi-pencil-square"></i> Editar
                        </button>
                    `
                }
            ],
            order: [[0, 'desc']]
        });

        // Event listener para editar asignaciones
        $('#assignmentsTable').off('click', '.edit-assignment-btn').on('click', '.edit-assignment-btn', function() {
            const row = $(this).parents('tr');
            const data = tables.assignments.row(row).data();
            openEditAssignmentModal(data);
        });
    }

    // ===== TABLA DEPARTAMENTOS ===== 
    // 🔧 CORRECCIÓN: Usar data.departments en lugar de data
    if (tables.departments) {
        tables.departments.clear().rows.add(data.departments).draw(); // ✅ CORREGIDO
    } else {
        tables.departments = $('#departmentsTable').DataTable({
            ...commonConfig,
            data: data.departments, // ✅ CORREGIDO
            columns: [
                { data: 'id' },
                { data: 'department_name' },
                { data: 'division' },
                { data: 'subactivity' },
                { data: 'desc_ceo_4' },
                { 
                    data: null,
                    render: () => `
                        <button class="btn btn-sm btn-primary edit-department-btn">
                            <i class="bi bi-pencil-square"></i> Editar
                        </button>
                    `
                }
            ],
            order: [[1, 'asc']]
        });

        // Event listener para editar departamentos
        $('#departmentsTable').off('click', '.edit-department-btn').on('click', '.edit-department-btn', function() {
            const row = $(this).parents('tr');
            const rowData = tables.departments.row(row).data();
            
            // Convertir a objeto plano JavaScript
            const data = {
                id: rowData.id,
                department_name: rowData.department_name,
                division: rowData.division,
                subactivity: rowData.subactivity,
                desc_ceo: rowData.desc_ceo,
                desc_ceo_1: rowData.desc_ceo_1,
                desc_ceo_2: rowData.desc_ceo_2,
                desc_ceo_3: rowData.desc_ceo_3,
                desc_ceo_4: rowData.desc_ceo_4,
                desc_ceo_5: rowData.desc_ceo_5,
                desc_ceo_6: rowData.desc_ceo_6,
                desc_ceo_7: rowData.desc_ceo_7,
                is_active: rowData.is_active
            };
            
            openEditDepartmentModal(data);
        });
    }

    // ===== TABLA UBICACIONES =====
    if (tables.locations) {
        tables.locations.clear().rows.add(data.locations).draw();
    } else {
        tables.locations = $('#locationsTable').DataTable({
            ...commonConfig,
            data: data.locations,
            columns: [
                { data: 'branch_office_id' },
                { data: 'location_name' },
                { data: 'city' },
                { data: 'state' },
                { data: 'address' },
                { data: 'phone' },
                { 
                    data: null,
                    render: () => `
                        <button class="btn btn-sm btn-primary edit-location-btn">
                            <i class="bi bi-pencil-square"></i> Editar
                        </button>
                    `
                }
            ],
            order: [[1, 'asc']]
        });

        // Event listener para editar ubicaciones
        $('#locationsTable').off('click', '.edit-location-btn').on('click', '.edit-location-btn', function() {
            const row = $(this).parents('tr');
            const data = tables.locations.row(row).data();
            openEditLocationModal(data);
        });
    }
}

// ============================================================================
// MODALES DE EDICIÓN - EQUIPOS
// ============================================================================

/**
 * Carga las opciones de status disponibles para equipos
 */
async function loadStatusOptions() {
    try {
        const response = await fetch('${API_BASE_URL}/api/equipment/status-options');
        const result = await response.json();
        
        if (result.success && result.options) {
            const select = $('#editStatus');
            select.empty();
            select.append('<option value="">-- Seleccionar --</option>');
            
            result.options.forEach(option => {
                select.append(`<option value="${option}">${option}</option>`);
            });
        }
    } catch (error) {
        console.error('Error cargando opciones de status:', error);
    }
}

/**
 * Abre el modal de edición de equipos
 * @param {Object} data - Datos del equipo
 */
function openEditEquipmentModal(data) {
    console.log('📝 Editando equipo:', data);
    
    $('#editDeviceCode').val(data.device_code);
    $('#editSerialNumber').val(data.serial_number || '');
    $('#editEquipmentType').val(data.equipment_type || '');
    $('#editBrand').val(data.brand || '');
    $('#editModel').val(data.model || '');
    $('#editRam').val(data.ram_memory || '');
    $('#editDisk').val(data.disk_capacity || '');
    
    const currentStatus = (data.status || '').trim();
    $('#editStatus').val(currentStatus);
    $('#currentStatus').text(currentStatus);
    
    $('#editEquipmentModal').modal('show');
}

/**
 * Guarda los cambios del equipo editado
 */
function openEditEquipmentModal(data) {
    console.log('📝 Editando equipo:', data);
    
    // ⭐ GUARDAR DATOS ORIGINALES EN EL MODAL
    $('#editEquipmentModal').data('originalData', data);
    
    // Cargar valores en el formulario
    $('#editDeviceCode').val(data.device_code);
    $('#editSerialNumber').val(data.serial_number || '');
    $('#editEquipmentType').val(data.equipment_type || '');
    $('#editBrand').val(data.brand || '');
    $('#editModel').val(data.model || '');
    $('#editRam').val(data.ram_memory || '');
    $('#editDisk').val(data.disk_capacity || '');
    
    const currentStatus = (data.status || '').trim();
    $('#editStatus').val(currentStatus);
    $('#currentStatus').text(currentStatus);
    
    $('#editEquipmentModal').modal('show');
}

// ============================================================================
// REEMPLAZAR FUNCIÓN: saveEquipmentChanges (Event Listener)
// ============================================================================

// ============================================================================
// REEMPLAZAR FUNCIÓN: saveEquipmentChanges (Event Listener)
// ============================================================================

$('#saveEquipmentChanges').off('click').on('click', async function() {
    const button = $(this);
    const spinner = $('#saveSpinner');
    const buttonText = $('#saveButtonText');
    
    const selectedStatus = $('#editStatus').val();
    if (!selectedStatus) {
        alert('⚠️ Debes seleccionar un estado');
        $('#editStatus').focus();
        return;
    }

    // Obtener datos originales
    const originalData = $('#editEquipmentModal').data('originalData');
    
    if (!originalData) {
        alert('⚠️ Error: No se encontraron los datos originales del equipo');
        return;
    }

    // Deshabilitar botón
    button.prop('disabled', true);
    spinner.removeClass('d-none');
    buttonText.text('Guardando...');

    // Construir objeto con todos los datos
    const updatedData = {
        device_code: $('#editDeviceCode').val().trim(),
        serial_number: $('#editSerialNumber').val().trim() || originalData.serial_number,
        equipment_type: $('#editEquipmentType').val().trim() || originalData.equipment_type,
        brand: $('#editBrand').val().trim() || originalData.brand,
        model: $('#editModel').val().trim() || originalData.model,
        ram_memory: $('#editRam').val().trim() || originalData.ram_memory,
        disk_capacity: $('#editDisk').val().trim() || originalData.disk_capacity,
        status: selectedStatus.trim(),
        processor: originalData.processor,
        operating_system: originalData.operating_system,
        ip_address: originalData.ip_address,
        hostname: originalData.hostname,
        location_id: originalData.location_id,
        department_id: originalData.department_id,
        supplier: originalData.supplier,
        warranty_months: originalData.warranty_months,
        acquisition_date: originalData.acquisition_date,
        purchase_price: originalData.purchase_price,
        acquisition_type: originalData.acquisition_type,
        notes: originalData.notes,
        is_active: originalData.is_active
    };

    console.log('📤 Enviando datos completos:', updatedData);

    try {
        const response = await fetch('${API_BASE_URL}/api/equipment/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });

        const result = await response.json();
        console.log('📥 Respuesta del servidor:', result);

        if (result.success) {
            $('#editEquipmentModal').modal('hide');
            
            // ⭐ CLAVE: Detectar si hay búsqueda activa
            if (isSearchActive) {
                console.log('🔄 Recargando con búsqueda activa...');
                // Si hay búsqueda, volver a ejecutar la búsqueda
                const currentSearch = $('#globalSearch').val().trim();
                if (currentSearch) {
                    await performGlobalSearch(currentSearch);
                } else {
                    // Si no hay término de búsqueda pero isSearchActive está en true,
                    // limpiar búsqueda
                    clearSearch();
                }
            } else {
                console.log('🔄 Recargando en modo normal...');
                // Sin búsqueda, recargar normalmente
                if (tables.equipment && tables.equipment.ajax) {
                    tables.equipment.ajax.reload(null, false);
                } else {
                    await loadDashboardData();
                }
            }
            
            // Mostrar notificación de éxito
            showSuccessNotification(`✅ Equipo "${updatedData.device_code}" actualizado correctamente`);
        } else {
            alert(`❌ Error: ${result.message}`);
        }
    } catch (error) {
        console.error('❌ Error al actualizar:', error);
        alert('❌ Error de conexión: ' + error.message);
    } finally {
        button.prop('disabled', false);
        spinner.addClass('d-none');
        buttonText.text('Guardar cambios');
    }
});

// ============================================================================
// FUNCIÓN AUXILIAR: Mostrar notificaciones de éxito
// ============================================================================

function showSuccessNotification(message) {
    const notification = $(`
        <div class="position-fixed top-0 end-0 p-3" style="z-index: 9999;">
            <div class="toast show align-items-center text-white bg-success border-0" role="alert">
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="bi bi-check-circle-fill me-2"></i>
                        ${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" 
                            onclick="this.closest('.toast').remove()"></button>
                </div>
            </div>
        </div>
    `);
    
    $('body').append(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 4000);
}

// ============================================================================
// LIMPIAR DATOS AL CERRAR MODAL
// ============================================================================

$('#editEquipmentModal').on('hidden.bs.modal', function() {
    // Limpiar datos guardados
    $(this).removeData('originalData');
    $('#editEquipmentForm')[0].reset();
    $('#debugInfo').hide();
});

console.log('✅ Corrección de actualización de equipos aplicada');
// ============================================================================
// MODALES DE EDICIÓN - ASIGNACIONES
// ============================================================================

/**
 * Abre el modal de edición de asignaciones
 * @param {Object} data - Datos de la asignación
 */
function openEditAssignmentModal(data) {
    console.log('📝 Editando asignación:', data);
    
    $('#editAssignmentId').val(data.assignment_id || '');
    $('#editEmployeeName').val(data.employee_name || '');
    $('#editEmployeeCip').val(data.employee_cip || '');
    $('#editEquipmentCode').val(data.equipment_code || '');
    $('#editEquipmentModel').val(data.equipment_model || '');
    
    // ⭐ NUEVO: Cargar departamento y ubicación
    $('#editDepartmentName').val(data.department_name || '');
    $('#editDepartmentId').val(data.department_id || '');
    $('#editLocationName').val(data.location_name || '');
    $('#editLocationId').val(data.location_id || '');
    
    // Ocultar mensajes
    $('#cipUpdateMessage, #equipmentUpdateMessage, #departmentUpdateMessage, #locationUpdateMessage').hide();
    $('#employeeSearchResults, #equipmentSearchResults, #departmentSearchResults, #locationSearchResults').hide();
    
    // Formatear fecha
    if (data.assignment_date) {
        const date = new Date(data.assignment_date);
        const formatted = date.toISOString().split('T')[0];
        $('#editAssignmentDate').val(formatted);
    }
    
    $('#editAssignmentModal').modal('show');
}

// ===== Búsqueda de empleados =====
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
            const response = await fetch(`${API_BASE_URL}/api/employees/search?q=${encodeURIComponent(searchTerm)}`);
            const result = await response.json();
            
            if (result.success && result.data.length > 0) {
                displayEmployeeResults(result.data);
                $('#employeeSearchStatus').text(`${result.data.length} empleado(s) encontrado(s)`);
            } else {
                $('#employeeSearchResults').html('<div class="no-results">No se encontraron empleados</div>').show();
                $('#employeeSearchStatus').text('Sin resultados');
            }
        } catch (error) {
            console.error('Error buscando empleados:', error);
            $('#employeeSearchStatus').text('Error en la búsqueda');
        }
    }, 500);
});

/**
 * Muestra los resultados de búsqueda de empleados
 * @param {Array} employees - Lista de empleados
 */
/**
 * Muestra los resultados de búsqueda de empleados
 * @param {Array} employees - Lista de empleados
 */
/**
 * Muestra los resultados de búsqueda de empleados
 * @param {Array} employees - Lista de empleados
 */
function displayEmployeeResults(employees) {
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
            const selectedCip = $(this).data('cip');
            const selectedName = $(this).data('name');
            const selectedDepartment = $(this).data('department');
            const selectedDepartmentId = $(this).data('department-id');
            
            // Actualizar empleado
            $('#editEmployeeName').val(selectedName);
            $('#editEmployeeCip').val(selectedCip);
            
            // ⭐ NUEVO: Actualizar departamento automáticamente
            if (selectedDepartment) {
                $('#editDepartmentName').val(selectedDepartment);
                $('#editDepartmentId').val(selectedDepartmentId);
                
                // Mostrar mensaje de actualización
                $('#departmentUpdateMessage').fadeIn();
                setTimeout(() => $('#departmentUpdateMessage').fadeOut(), 3000);
            } else {
                $('#editDepartmentName').val('Sin departamento');
                $('#editDepartmentId').val('');
            }
            
            $('#cipUpdateMessage').fadeIn();
            setTimeout(() => $('#cipUpdateMessage').fadeOut(), 3000);
            
            resultsContainer.hide();
            $('#employeeSearchStatus').text('Empleado seleccionado');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

// ===== Búsqueda de equipos =====
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
            const response = await fetch(`${API_BASE_URL}/api/equipment/search?term=${encodeURIComponent(searchTerm)}`);
            const result = await response.json();
            
            if (result.success && result.data.length > 0) {
                displayEquipmentResults(result.data);
                $('#equipmentSearchStatus').text(`${result.data.length} equipo(s) encontrado(s)`);
            } else {
                $('#equipmentSearchResults').html('<div class="no-results">No se encontraron equipos</div>').show();
                $('#equipmentSearchStatus').text('Sin resultados');
            }
        } catch (error) {
            console.error('Error buscando equipos:', error);
            $('#equipmentSearchStatus').text('Error en la búsqueda');
        }
    }, 500);
});

/**
 * Muestra los resultados de búsqueda de equipos
 * @param {Array} equipment - Lista de equipos
 */
function displayEquipmentResults(equipment) {
    const resultsContainer = $('#equipmentSearchResults');
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
            const selectedCode = $(this).data('code');
            const selectedModel = $(this).data('model');
            const selectedBrand = $(this).data('brand');
            
            $('#editEquipmentCode').val(selectedCode);
            $('#editEquipmentModel').val(`${selectedBrand} ${selectedModel}`.trim());
            
            $('#equipmentUpdateMessage').fadeIn();
            setTimeout(() => $('#equipmentUpdateMessage').fadeOut(), 3000);
            
            resultsContainer.hide();
            $('#equipmentSearchStatus').text('Equipo seleccionado');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

// ===== Búsqueda de departamentos =====
$('#editDepartmentName').on('input', function() {
    const searchTerm = $(this).val().trim();
    clearTimeout(departmentSearchTimeout);
    
    // Si está vacío, limpiar el ID
    if (searchTerm.length === 0) {
        $('#editDepartmentId').val('');
        $('#departmentSearchResults').hide();
        $('#departmentSearchStatus').text('Opcional - Escribe para buscar...');
        return;
    }
    
    if (searchTerm.length < 3) {
        $('#departmentSearchResults').hide();
        $('#departmentSearchStatus').text('Escribe al menos 3 caracteres...');
        return;
    }
    
    $('#departmentSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
    
    departmentSearchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/departments/search?term=${encodeURIComponent(searchTerm)}`);
            const result = await response.json();
            
            if (result.success && result.data.length > 0) {
                displayDepartmentResults(result.data);
                $('#departmentSearchStatus').text(`${result.data.length} departamento(s) encontrado(s)`);
            } else {
                $('#departmentSearchResults').html('<div class="no-results p-2 text-muted">No se encontraron departamentos</div>').show();
                $('#departmentSearchStatus').text('Sin resultados');
            }
        } catch (error) {
            console.error('Error buscando departamentos:', error);
            $('#departmentSearchStatus').text('Error en la búsqueda');
        }
    }, 500);
});

// ===== Búsqueda de ubicaciones =====
$('#editLocationName').on('input', function() {
    const searchTerm = $(this).val().trim();
    clearTimeout(locationSearchTimeout);
    
    // Si está vacío, limpiar el ID
    if (searchTerm.length === 0) {
        $('#editLocationId').val('');
        $('#locationSearchResults').hide();
        $('#locationSearchStatus').text('Opcional - Escribe para buscar...');
        return;
    }
    
    if (searchTerm.length < 3) {
        $('#locationSearchResults').hide();
        $('#locationSearchStatus').text('Escribe al menos 3 caracteres...');
        return;
    }
    
    $('#locationSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
    
    locationSearchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/locations/search?term=${encodeURIComponent(searchTerm)}`);
            const result = await response.json();
            
            if (result.success && result.data.length > 0) {
                displayLocationResults(result.data);
                $('#locationSearchStatus').text(`${result.data.length} ubicación(es) encontrada(s)`);
            } else {
                $('#locationSearchResults').html('<div class="no-results p-2 text-muted">No se encontraron ubicaciones</div>').show();
                $('#locationSearchStatus').text('Sin resultados');
            }
        } catch (error) {
            console.error('Error buscando ubicaciones:', error);
            $('#locationSearchStatus').text('Error en la búsqueda');
        }
    }, 500);
});

/**
 * Muestra los resultados de búsqueda de ubicaciones
 * @param {Array} locations - Lista de ubicaciones
 */
function displayLocationResults(locations) {
    const resultsContainer = $('#locationSearchResults');
    resultsContainer.empty();
    
    locations.forEach(loc => {
        const item = $(`
            <div class="location-search-item" data-id="${loc.id}" data-name="${loc.location_name}">
                <span class="location-name">${loc.location_name}</span>
                <div class="location-details">
                    ID: ${loc.id} | ${loc.city || ''}, ${loc.state || ''} | Sucursal: ${loc.branch_office_id || ''}
                </div>
            </div>
        `);
        
        item.on('click', function() {
            $('#editLocationName').val($(this).data('name'));
            $('#editLocationId').val($(this).data('id'));
            $('#locationUpdateMessage').fadeIn();
            setTimeout(() => $('#locationUpdateMessage').fadeOut(), 3000);
            resultsContainer.hide();
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}
/**
 * Muestra los resultados de búsqueda de departamentos
 */
function displayDepartmentResults(departments) {
    const resultsContainer = $('#departmentSearchResults');
    resultsContainer.empty();
    
    departments.forEach(dept => {
        const item = $(`
            <div class="search-item p-2 border-bottom" data-id="${dept.id}" data-name="${dept.department_name}" style="cursor: pointer;">
                <div class="fw-bold">${dept.department_name}</div>
                <small class="text-muted">
                    ID: ${dept.id} | ${dept.division || 'Sin división'} | ${dept.subactivity || 'Sin subactividad'}
                </small>
            </div>
        `);
        
        item.on('click', function() {
            $('#editDepartmentName').val($(this).data('name'));
            $('#editDepartmentId').val($(this).data('id'));
            $('#departmentUpdateMessage').fadeIn();
            setTimeout(() => $('#departmentUpdateMessage').fadeOut(), 3000);
            resultsContainer.hide();
            $('#departmentSearchStatus').text('Departamento seleccionado');
        });
        
        item.on('mouseenter', function() {
            $(this).addClass('bg-light');
        }).on('mouseleave', function() {
            $(this).removeClass('bg-light');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

/**
 * Muestra los resultados de búsqueda de ubicaciones
 */
function displayLocationResults(locations) {
    const resultsContainer = $('#locationSearchResults');
    resultsContainer.empty();
    
    locations.forEach(loc => {
        const item = $(`
            <div class="search-item p-2 border-bottom" data-id="${loc.id}" data-name="${loc.location_name}" style="cursor: pointer;">
                <div class="fw-bold">${loc.location_name}</div>
                <small class="text-muted">
                    ID: ${loc.id} | ${loc.city || ''}, ${loc.state || ''} | Sucursal: ${loc.branch_office_id || ''}
                </small>
            </div>
        `);
        
        item.on('click', function() {
            $('#editLocationName').val($(this).data('name'));
            $('#editLocationId').val($(this).data('id'));
            $('#locationUpdateMessage').fadeIn();
            setTimeout(() => $('#locationUpdateMessage').fadeOut(), 3000);
            resultsContainer.hide();
            $('#locationSearchStatus').text('Ubicación seleccionada');
        });
        
        item.on('mouseenter', function() {
            $(this).addClass('bg-light');
        }).on('mouseleave', function() {
            $(this).removeClass('bg-light');
        });
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}
// ===== Cerrar resultados al hacer clic fuera =====
$(document).on('click', function(e) {
    if (!$(e.target).closest('#editEmployeeName, #employeeSearchResults').length) {
        $('#employeeSearchResults').hide();
    }
    if (!$(e.target).closest('#editEquipmentCode, #equipmentSearchResults').length) {
        $('#equipmentSearchResults').hide();
    }
    if (!$(e.target).closest('#editDepartmentName, #departmentSearchResults').length) {
        $('#departmentSearchResults').hide();
    }
    if (!$(e.target).closest('#editLocationName, #locationSearchResults').length) {
        $('#locationSearchResults').hide();
    }
});

/**
 * Guarda los cambios de la asignación editada
 */
$('#saveAssignmentChanges').off('click').on('click', async function() {
    const assignmentId = $('#editAssignmentId').val();
    const employeeName = $('#editEmployeeName').val();
    const employeeCip = $('#editEmployeeCip').val();
    const equipmentCode = $('#editEquipmentCode').val();
    const departmentId = $('#editDepartmentId').val();
    const locationId = $('#editLocationId').val();
    const assignmentDate = $('#editAssignmentDate').val();
    
    console.log('🔍 DEBUG - Valores capturados:', {
        assignmentId, employeeName, employeeCip,
        equipmentCode, departmentId, locationId, assignmentDate
    });
    
    // Validaciones
    if (!employeeName || employeeName.trim() === '') {
        alert('⚠️ El nombre del empleado es obligatorio');
        $('#editEmployeeName').focus();
        return;
    }
    
    if (!employeeCip || employeeCip.trim() === '') {
        alert('⚠️ No se pudo obtener el CIP del empleado. Selecciona un empleado de la lista.');
        $('#editEmployeeName').focus();
        return;
    }
    
    if (!equipmentCode || equipmentCode.trim() === '') {
        alert('⚠️ El código del equipo es obligatorio. Selecciona un equipo de la lista.');
        $('#editEquipmentCode').focus();
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

    console.log('📤 Enviando datos de asignación:', updatedData);

    try {
        const response = await fetch('${API_BASE_URL}/api/assignments/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });

        const result = await response.json();
        console.log('📥 Respuesta del servidor:', result);

        if (result.success) {
            $('#editAssignmentModal').modal('hide');
            await loadDashboardData();
            alert(`✅ ${result.message}`);
        } else {
            alert(`❌ Error: ${result.message}`);
        }
    } catch (error) {
        console.error('❌ Error:', error);
        alert('❌ Error de conexión: ' + error.message);
    }
});

// ============================================================================
// MODALES DE EDICIÓN - DEPARTAMENTOS
// ============================================================================

/**
 * Abre el modal de edición de departamentos
 * @param {Object} data - Datos del departamento
 */
function openEditDepartmentModal(data) {
    console.log('📝 Editando departamento:', data);
    
    $('#editDeptId').val(data.id);
    $('#editDeptName').val(data.department_name);
    $('#editDivision').val(data.division || '');
    $('#editSubactivity').val(data.subactivity || '');
    $('#editDescCeo').val(data.desc_ceo || '');
    $('#editDescCeo4').val(data.desc_ceo_4 || '');
    
    $('#editDepartmentModal').modal('show');
}

/**
 * Guarda los cambios del departamento editado
 */
$('#saveDepartmentChanges').off('click').on('click', async function() {
    const button = $(this);
    const spinner = $('#saveDeptSpinner');
    const buttonText = $('#saveDeptButtonText');
    
    const deptName = $('#editDeptName').val().trim();
    if (!deptName) {
        alert('⚠️ El nombre del departamento es obligatorio');
        $('#editDeptName').focus();
        return;
    }

    // Deshabilitar botón
    button.prop('disabled', true);
    spinner.removeClass('d-none');
    buttonText.text('Guardando...');

    const updatedData = {
        id: $('#editDeptId').val(),
        department_name: deptName,
        division: $('#editDivision').val().trim() || null,
        subactivity: $('#editSubactivity').val().trim() || null,
        desc_ceo: $('#editDescCeo').val().trim() || null,
        desc_ceo_1: null,
        desc_ceo_2: null,
        desc_ceo_3: null,
        desc_ceo_4: $('#editDescCeo4').val().trim() || null,
        desc_ceo_5: null,
        desc_ceo_6: null,
        desc_ceo_7: null
    };

    console.log('📤 Enviando datos departamento:', updatedData);

    try {
        const response = await fetch('${API_BASE_URL}/api/departments/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });

        const result = await response.json();
        console.log('📥 Respuesta:', result);

        if (result.success) {
            $('#editDepartmentModal').modal('hide');
            await loadDashboardData();
            alert(`✅ ${result.message}`);
        } else {
            alert(`❌ Error: ${result.message}`);
        }
    } catch (error) {
        console.error('❌ Error:', error);
        alert('❌ Error de conexión: ' + error.message);
    } finally {
        button.prop('disabled', false);
        spinner.addClass('d-none');
        buttonText.text('Guardar cambios');
    }
});

// ============================================================================
// MODALES DE EDICIÓN - UBICACIONES
// ============================================================================

/**
 * Abre el modal de edición de ubicaciones
 * @param {Object} data - Datos de la ubicación
 */
function openEditLocationModal(data) {
    console.log('📝 Editando ubicación:', data);
    
    $('#editLocId').val(data.id);
    $('#editBranchOfficeId').val(data.branch_office_id);
    $('#editLocationName').val(data.location_name);
    $('#editCity').val(data.city);
    $('#editState').val(data.state);
    $('#editCountry').val(data.country || 'Perú');
    $('#editAddress').val(data.address || '');
    $('#editPhone').val(data.phone || '');
    
    $('#editLocationModal').modal('show');
}

/**
 * Guarda los cambios de la ubicación editada
 */
$('#saveLocationChanges').off('click').on('click', async function() {
    const branchId = $('#editBranchOfficeId').val().trim();
    const locName = $('#editLocationName').val().trim();
    const city = $('#editCity').val().trim();
    const state = $('#editState').val().trim();

    if (!branchId || !locName || !city || !state) {
        alert('⚠️ Los campos marcados con * son obligatorios');
        return;
    }

    const updatedData = {
        id: $('#editLocId').val(),
        branch_office_id: branchId,
        location_name: locName,
        city: city,
        state: state,
        country: $('#editCountry').val().trim() || 'Perú',
        address: $('#editAddress').val().trim() || null,
        phone: $('#editPhone').val().trim() || null
    };

    console.log('📤 Enviando datos ubicación:', updatedData);

    try {
        const response = await fetch('${API_BASE_URL}/api/locations/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });

        const result = await response.json();

        if (result.success) {
            $('#editLocationModal').modal('hide');
            await loadDashboardData();
            alert(`✅ ${result.message}`);
        } else {
            alert(`❌ Error: ${result.message}`);
        }
    } catch (error) {
        console.error('❌ Error:', error);
        alert('❌ Error de conexión: ' + error.message);
    }
});

// ============================================================================
// FUNCIONES DE EXPORTACIÓN
// ============================================================================

/**
 * Exporta la tabla activa en el formato especificado
 * @param {string} format - Formato de exportación ('excel', 'csv', 'pdf')
 */
async function exportTable(format) {
    try {
        const table = tables[currentActiveTable];
        if (!table) {
            alert('No hay tabla activa para exportar');
            return;
        }

        showLoading('Exportando...', `Preparando archivo ${format.toUpperCase()}`);

        // Si hay búsqueda activa, exportar datos filtrados
        if (isSearchActive) {
            exportFilteredData(format);
            hideLoading();
            return;
        }

        // Exportar todos los datos
        const response = await fetch(`${API_BASE}/export/${currentActiveTable}`);
        if (!response.ok) throw new Error('Error al exportar');
        
        const result = await response.json();
        
        if (format === 'excel') {
            exportToExcel(result.data, result.filename);
        } else if (format === 'csv') {
            exportToCSV(result.data, result.filename);
        } else if (format === 'pdf') {
            exportToPDF(result.data, result.filename);
        }

        hideLoading();
    } catch (error) {
        console.error('Error:', error);
        hideLoading();
        alert('Error al exportar: ' + error.message);
    }
}

/**
 * Exporta los datos filtrados de la tabla actual
 * @param {string} format - Formato de exportación
 */
function exportFilteredData(format) {
    const table = tables[currentActiveTable];
    const data = table.rows({ search: 'applied' }).data().toArray();
    const filename = `${currentActiveTable}_filtrado_${new Date().toISOString().split('T')[0]}`;

    if (format === 'excel') {
        exportToExcel(data, filename);
    } else if (format === 'csv') {
        exportToCSV(data, filename);
    } else if (format === 'pdf') {
        exportToPDF(data, filename);
    }
}

/**
 * Exporta datos a formato Excel
 * @param {Array} data - Datos a exportar
 * @param {string} filename - Nombre del archivo
 */
function exportToExcel(data, filename) {
    const ws_data = [Object.keys(data[0]), ...data.map(obj => Object.values(obj))];
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * Exporta datos a formato CSV
 * @param {Array} data - Datos a exportar
 * @param {string} filename - Nombre del archivo
 */
function exportToCSV(data, filename) {
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => 
            headers.map(h => {
                const value = row[h] || '';
                return `"${String(value).replace(/"/g, '""')}"`;
            }).join(',')
        )
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
}

/**
 * Exporta datos a formato PDF
 * @param {Array} data - Datos a exportar
 * @param {string} filename - Nombre del archivo
 */
function exportToPDF(data, filename) {
    if (!data.length) {
        alert('No hay datos para exportar');
        return;
    }

    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(h => String(row[h] || '')));

    const docDefinition = {
        pageOrientation: 'landscape',
        content: [
            { text: filename.toUpperCase(), style: 'header' },
            { text: `Generado: ${new Date().toLocaleString('es-PE')}`, style: 'subheader' },
            {
                table: {
                    headerRows: 1,
                    widths: Array(headers.length).fill('auto'),
                    body: [headers, ...rows]
                },
                layout: 'lightHorizontalLines'
            }
        ],
        styles: {
            header: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
            subheader: { fontSize: 10, margin: [0, 0, 0, 15] }
        }
    };

    pdfMake.createPdf(docDefinition).download(`${filename}.pdf`);
}

// ============================================================================
// FUNCIONES DE UTILIDAD
// ============================================================================

/**
 * Muestra el overlay de carga
 * @param {string} title - Título del mensaje
 * @param {string} subtitle - Subtítulo del mensaje
 */
function showLoading(title, subtitle) {
    $('#loadingText').text(title);
    $('#loadingSubtext').text(subtitle);
    $('#loadingOverlay').fadeIn(200);
}

/**
 * Oculta el overlay de carga
 */
function hideLoading() {
    $('#loadingOverlay').fadeOut(200);
}

// ==================== MOBILE SCROLL HELPER ====================
// Agregar este código al final de tu functions.js o como archivo separado

(function() {
    'use strict';
    
    // Función para agregar indicadores de scroll en tablas
    function addScrollIndicators() {
        const tableContainers = document.querySelectorAll('.table-container');
        
        tableContainers.forEach(container => {
            // Verificar si hay scroll horizontal
            if (container.scrollWidth > container.clientWidth) {
                container.classList.add('has-scroll');
                
                // Agregar evento de scroll para ocultar el indicador
                container.addEventListener('scroll', function() {
                    const scrollLeft = this.scrollLeft;
                    const maxScroll = this.scrollWidth - this.clientWidth;
                    
                    // Si llegó al final, ocultar el indicador
                    if (scrollLeft >= maxScroll - 10) {
                        this.classList.add('scrolled-to-end');
                    } else {
                        this.classList.remove('scrolled-to-end');
                    }
                    
                    // Si está al inicio
                    if (scrollLeft <= 10) {
                        this.classList.add('scrolled-to-start');
                    } else {
                        this.classList.remove('scrolled-to-start');
                    }
                });
            }
        });
    }
    
    // Función para detectar si es dispositivo móvil
    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
            || window.innerWidth <= 768;
    }
    
    // Mejorar la experiencia táctil en tablas
    function enhanceTouchScrolling() {
        if (!isMobileDevice()) return;
        
        const tableContainers = document.querySelectorAll('.table-container');
        
        tableContainers.forEach(container => {
            let isScrolling = false;
            let startX;
            let scrollLeft;
            
            container.addEventListener('touchstart', (e) => {
                isScrolling = true;
                startX = e.touches[0].pageX - container.offsetLeft;
                scrollLeft = container.scrollLeft;
            }, { passive: true });
            
            container.addEventListener('touchmove', (e) => {
                if (!isScrolling) return;
                const x = e.touches[0].pageX - container.offsetLeft;
                const walk = (x - startX) * 2; // Multiplicador para velocidad
                container.scrollLeft = scrollLeft - walk;
            }, { passive: true });
            
            container.addEventListener('touchend', () => {
                isScrolling = false;
            });
        });
    }
    
    // Agregar sombras laterales cuando hay más contenido
    function addScrollShadows() {
        const style = document.createElement('style');
        style.textContent = `
            .table-container.has-scroll {
                position: relative;
            }
            
            .table-container.has-scroll::before,
            .table-container.has-scroll::after {
                content: '';
                position: absolute;
                top: 0;
                bottom: 20px;
                width: 20px;
                pointer-events: none;
                z-index: 10;
                transition: opacity 0.3s;
            }
            
            .table-container.has-scroll::before {
                left: 0;
                background: linear-gradient(to right, var(--bg-card), transparent);
                opacity: 0;
            }
            
            .table-container.has-scroll::after {
                right: 0;
                background: linear-gradient(to left, var(--bg-card), transparent);
                opacity: 1;
            }
            
            .table-container.has-scroll.scrolled-to-start::before {
                opacity: 0;
            }
            
            .table-container.has-scroll:not(.scrolled-to-start)::before {
                opacity: 1;
            }
            
            .table-container.has-scroll.scrolled-to-end::after {
                opacity: 0;
            }
            
            /* Indicador visual más prominente en móvil */
            @media (max-width: 768px) {
                .table-container.has-scroll::after {
                    width: 30px;
                    background: linear-gradient(to left, 
                        var(--bg-card) 0%, 
                        rgba(13, 110, 253, 0.1) 50%, 
                        transparent 100%);
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Función para forzar la visibilidad del scrollbar en móviles
    function forceScrollbarVisibility() {
        if (isMobileDevice()) {
            const style = document.createElement('style');
            style.textContent = `
                @media (max-width: 768px) {
                    .table-container {
                        /* Asegurar padding para el scrollbar */
                        padding-bottom: 15px !important;
                    }
                    
                    /* Para navegadores basados en WebKit (Chrome, Safari) */
                    .table-container::-webkit-scrollbar {
                        -webkit-appearance: none;
                        height: 14px !important;
                        display: block !important;
                    }
                    
                    .table-container::-webkit-scrollbar-track {
                        background-color: var(--border-color);
                        border-radius: 8px;
                        margin: 0 10px;
                    }
                    
                    .table-container::-webkit-scrollbar-thumb {
                        background-color: var(--accent-blue);
                        border-radius: 8px;
                        border: 2px solid var(--bg-card);
                        min-width: 50px;
                    }
                    
                    .table-container::-webkit-scrollbar-thumb:hover {
                        background-color: #0a58ca;
                    }
                    
                    /* Para Firefox */
                    .table-container {
                        scrollbar-width: auto !important;
                        scrollbar-color: var(--accent-blue) var(--border-color) !important;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    // Inicializar todo cuando el DOM esté listo
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                setTimeout(() => {
                    addScrollShadows();
                    forceScrollbarVisibility();
                    addScrollIndicators();
                    enhanceTouchScrolling();
                }, 500);
            });
        } else {
            setTimeout(() => {
                addScrollShadows();
                forceScrollbarVisibility();
                addScrollIndicators();
                enhanceTouchScrolling();
            }, 500);
        }
        
        // Re-inicializar cuando cambie el tamaño de ventana
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                addScrollIndicators();
            }, 250);
        });
        
        // Re-inicializar cuando cambien las pestañas
        const tabLinks = document.querySelectorAll('[data-bs-toggle="tab"]');
        tabLinks.forEach(link => {
            link.addEventListener('shown.bs.tab', () => {
                setTimeout(() => {
                    addScrollIndicators();
                }, 100);
            });
        });
    }
    
    init();
    
    console.log('📱 Mobile Scroll Helper Initialized');
})();

// ============================================================================
// AÑADIR ESTE CÓDIGO AL FINAL DE functions.js
// ============================================================================

// ===== Variables para timeouts de búsqueda del modal AÑADIR =====
let addEmployeeSearchTimeout = null;
let addEquipmentSearchTimeout = null;
let addDepartmentSearchTimeout = null;
let addLocationSearchTimeout = null;

// ===== Abrir modal de añadir asignación =====
$('#btnAddAssignment').on('click', function() {
    // Limpiar formulario
    $('#addAssignmentForm')[0].reset();
    $('#addEmployeeCip').val('');
    $('#addEquipmentModel').val('');
    $('#addDepartmentId').val('');
    $('#addLocationId').val('');
    
    // Ocultar mensajes
    $('#addCipUpdateMessage, #addEquipmentUpdateMessage, #addDepartmentUpdateMessage, #addLocationUpdateMessage').hide();
    $('#addEmployeeSearchResults, #addEquipmentSearchResults, #addDepartmentSearchResults, #addLocationSearchResults').hide();
    
    // Establecer fecha actual
    const today = new Date().toISOString().split('T')[0];
    $('#addAssignmentDate').val(today);
    
    // Abrir modal
    $('#addAssignmentModal').modal('show');
});

// ===== Búsqueda de empleados (AÑADIR) =====
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
            const response = await fetch(`${API_BASE_URL}/api/employees/search?q=${encodeURIComponent(searchTerm)}`);
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
            
            // Auto-completar departamento si existe
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

// ===== Búsqueda de equipos (AÑADIR) =====
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
            const response = await fetch(`${API_BASE_URL}/api/equipment/search?term=${encodeURIComponent(searchTerm)}`);
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

// ===== Búsqueda de departamentos (AÑADIR) =====
$('#addDepartmentName').on('input', function() {
    const searchTerm = $(this).val().trim();
    clearTimeout(addDepartmentSearchTimeout);
    
    if (searchTerm.length === 0) {
        $('#addDepartmentId').val('');
        $('#addDepartmentSearchResults').hide();
        $('#addDepartmentSearchStatus').text('Opcional - Escribe para buscar...');
        return;
    }
    
    if (searchTerm.length < 3) {
        $('#addDepartmentSearchResults').hide();
        $('#addDepartmentSearchStatus').text('Escribe al menos 3 caracteres...');
        return;
    }
    
    $('#addDepartmentSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
    
    addDepartmentSearchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/departments/search?term=${encodeURIComponent(searchTerm)}`);
            const result = await response.json();
            
            if (result.success && result.data.length > 0) {
                displayAddDepartmentResults(result.data);
                $('#addDepartmentSearchStatus').text(`${result.data.length} departamento(s)`);
            } else {
                $('#addDepartmentSearchResults').html('<div class="no-results p-2">No se encontraron departamentos</div>').show();
                $('#addDepartmentSearchStatus').text('Sin resultados');
            }
        } catch (error) {
            console.error('Error:', error);
            $('#addDepartmentSearchStatus').text('Error en la búsqueda');
        }
    }, 500);
});

function displayAddDepartmentResults(departments) {
    const resultsContainer = $('#addDepartmentSearchResults');
    resultsContainer.empty();
    
    departments.forEach(dept => {
        const item = $(`
            <div class="search-item p-2 border-bottom" data-id="${dept.id}" data-name="${dept.department_name}" style="cursor: pointer;">
                <div class="fw-bold">${dept.department_name}</div>
                <small class="text-muted">ID: ${dept.id} | ${dept.division || ''}</small>
            </div>
        `);
        
        item.on('click', function() {
            $('#addDepartmentName').val($(this).data('name'));
            $('#addDepartmentId').val($(this).data('id'));
            $('#addDepartmentUpdateMessage').fadeIn().delay(3000).fadeOut();
            resultsContainer.hide();
        }).hover(
            function() { $(this).addClass('bg-light'); },
            function() { $(this).removeClass('bg-light'); }
        );
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

// ===== Búsqueda de ubicaciones (AÑADIR) =====
$('#addLocationName').on('input', function() {
    const searchTerm = $(this).val().trim();
    clearTimeout(addLocationSearchTimeout);
    
    if (searchTerm.length === 0) {
        $('#addLocationId').val('');
        $('#addLocationSearchResults').hide();
        $('#addLocationSearchStatus').text('Opcional - Escribe para buscar...');
        return;
    }
    
    if (searchTerm.length < 3) {
        $('#addLocationSearchResults').hide();
        $('#addLocationSearchStatus').text('Escribe al menos 3 caracteres...');
        return;
    }
    
    $('#addLocationSearchStatus').html('<span class="spinner-border spinner-border-sm"></span> Buscando...');
    
    addLocationSearchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/locations/search?term=${encodeURIComponent(searchTerm)}`);
            const result = await response.json();
            
            if (result.success && result.data.length > 0) {
                displayAddLocationResults(result.data);
                $('#addLocationSearchStatus').text(`${result.data.length} ubicación(es)`);
            } else {
                $('#addLocationSearchResults').html('<div class="no-results p-2">No se encontraron ubicaciones</div>').show();
                $('#addLocationSearchStatus').text('Sin resultados');
            }
        } catch (error) {
            console.error('Error:', error);
            $('#addLocationSearchStatus').text('Error en la búsqueda');
        }
    }, 500);
});

function displayAddLocationResults(locations) {
    const resultsContainer = $('#addLocationSearchResults');
    resultsContainer.empty();
    
    locations.forEach(loc => {
        const item = $(`
            <div class="search-item p-2 border-bottom" data-id="${loc.id}" data-name="${loc.location_name}" style="cursor: pointer;">
                <div class="fw-bold">${loc.location_name}</div>
                <small class="text-muted">ID: ${loc.id} | ${loc.city || ''}, ${loc.state || ''}</small>
            </div>
        `);
        
        item.on('click', function() {
            $('#addLocationName').val($(this).data('name'));
            $('#addLocationId').val($(this).data('id'));
            $('#addLocationUpdateMessage').fadeIn().delay(3000).fadeOut();
            resultsContainer.hide();
        }).hover(
            function() { $(this).addClass('bg-light'); },
            function() { $(this).removeClass('bg-light'); }
        );
        
        resultsContainer.append(item);
    });
    
    resultsContainer.show();
}

// ===== Cerrar resultados al hacer clic fuera (AÑADIR) =====
$(document).on('click', function(e) {
    if (!$(e.target).closest('#addEmployeeName, #addEmployeeSearchResults').length) {
        $('#addEmployeeSearchResults').hide();
    }
    if (!$(e.target).closest('#addEquipmentCode, #addEquipmentSearchResults').length) {
        $('#addEquipmentSearchResults').hide();
    }
    if (!$(e.target).closest('#addDepartmentName, #addDepartmentSearchResults').length) {
        $('#addDepartmentSearchResults').hide();
    }
    if (!$(e.target).closest('#addLocationName, #addLocationSearchResults').length) {
        $('#addLocationSearchResults').hide();
    }
});

// ===== Guardar nueva asignación =====
$('#saveNewAssignment').on('click', async function() {
    const button = $(this);
    const spinner = $('#saveNewSpinner');
    const buttonText = $('#saveNewButtonText');
    
    // Obtener valores
    const employeeName = $('#addEmployeeName').val().trim();
    const employeeCip = $('#addEmployeeCip').val().trim();
    const equipmentCode = $('#addEquipmentCode').val().trim();
    const departmentId = $('#addDepartmentId').val();
    const locationId = $('#addLocationId').val();
    const assignmentDate = $('#addAssignmentDate').val();
    
    // Validaciones
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
    
    // Deshabilitar botón
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
        const response = await fetch('${API_BASE_URL}/api/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newAssignment)
        });
        
        const result = await response.json();
        console.log('📥 Respuesta:', result);
        
        if (result.success) {
            $('#addAssignmentModal').modal('hide');
            await loadDashboardData();
            alert(`✅ ${result.message || 'Asignación creada exitosamente'}`);
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
});

console.log('✅ Módulo Añadir Asignación cargado');

  // Cargar ubicaciones y departamentos al abrir el modal


    // Cargar ubicaciones
    async function loadLocations() {
        try {
            const response = await fetch('/api/locations', {
                credentials: 'include'
            });
            const data = await response.json();
            
            if (data.success && data.data) {
                const select = document.getElementById('location_id');
                select.innerHTML = '<option value="">Seleccionar ubicación...</option>';
                
                data.data.forEach(location => {
                    const option = document.createElement('option');
                    option.value = location.id;
                    option.textContent = location.location_name;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error cargando ubicaciones:', error);
        }
    }

    // Cargar departamentos
    async function loadDepartments() {
        try {
            const response = await fetch('/api/departments', {
                credentials: 'include'
            });
            const data = await response.json();
            
            if (data.success && data.data) {
                const select = document.getElementById('department_id');
                select.innerHTML = '<option value="">Seleccionar departamento...</option>';
                
                data.data.forEach(dept => {
                    const option = document.createElement('option');
                    option.value = dept.id;
                    option.textContent = dept.department_name;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error cargando departamentos:', error);
        }
    }

    // Manejar envío del formulario
    document.getElementById('addEquipmentForm')?.addEventListener('submit', async function(e) {
        e.preventDefault();

        const submitBtn = document.getElementById('submitEquipmentBtn');
        const alertDiv = document.getElementById('equipmentFormAlert');
        
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');
        alertDiv.classList.add('d-none');

        // Recoger datos del formulario
        const formData = {
            device_code: document.getElementById('device_code').value.trim(),
            equipment_type: document.getElementById('equipment_type').value,
            brand: document.getElementById('brand').value.trim(),
            model: document.getElementById('model').value.trim(),
            serial_number: document.getElementById('serial_number').value.trim(),
            status: document.getElementById('status').value,
            acquisition_date: document.getElementById('acquisition_date').value || null,
            purchase_price: document.getElementById('purchase_price').value || null,
            processor: document.getElementById('processor').value.trim() || null,
            ram: document.getElementById('ram').value.trim() || null,
            storage: document.getElementById('storage').value.trim() || null,
            operating_system: document.getElementById('operating_system').value || null,
            ip_address: document.getElementById('ip_address').value.trim() || null,
            hostname: document.getElementById('hostname').value.trim() || null,
            location_id: document.getElementById('location_id').value || null,
            department_id: document.getElementById('department_id').value || null,
            supplier: document.getElementById('supplier').value.trim() || null,
            warranty_months: document.getElementById('warranty_months').value || null,
            notes: document.getElementById('notes').value.trim() || null
        };

        try {
            const response = await fetch('/api/equipment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                showNotification('success', `Equipo "${formData.device_code}" creado exitosamente`);
                
                const modal = bootstrap.Modal.getInstance(document.getElementById('addEquipmentModal'));
                modal.hide();
                
                document.getElementById('addEquipmentForm').reset();
                
                await loadDashboardData();

            } else {
                throw new Error(data.error || 'Error al crear equipo');
            }

        } catch (error) {
            console.error('Error:', error);
            alertDiv.textContent = error.message;
            alertDiv.classList.remove('d-none');
            document.querySelector('.modal-body').scrollTop = 0;

        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
        }
    });

    function showNotification(type, message) {
        const alertClass = type === 'success' ? 'alert-success' : 'alert-danger';
        const icon = type === 'success' ? 'check-circle-fill' : 'exclamation-circle-fill';
        
        const notificationHTML = `
            <div class="alert ${alertClass} alert-dismissible fade show position-fixed top-0 end-0 m-3" 
                 role="alert" 
                 style="z-index: 9999; min-width: 300px;">
                <i class="bi bi-${icon} me-2"></i>
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', notificationHTML);

        setTimeout(() => {
            document.querySelector('.alert')?.remove();
        }, 4000);
    }

    // Limpiar al cerrar modal
    document.getElementById('addEquipmentModal')?.addEventListener('hidden.bs.modal', function() {
        document.getElementById('equipmentFormAlert').classList.add('d-none');
        document.getElementById('addEquipmentForm').reset();
        // Volver al primer tab
        document.getElementById('basic-tab').click();
    });


      // Cargar departamentos al abrir el modal
    document.getElementById('addEmployeeModal')?.addEventListener('shown.bs.modal', async function() {
        await loadDepartments();
    });

    // Función para cargar departamentos
    async function loadDepartments() {
        try {
            const response = await fetch('/api/departments', {
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('Error al cargar departamentos');
            }

            const data = await response.json();
            
            if (data.success && data.data) {
                const select = document.getElementById('department_id');
                select.innerHTML = '<option value="">Sin departamento</option>';
                
                data.data.forEach(dept => {
                    const option = document.createElement('option');
                    option.value = dept.id;
                    option.textContent = dept.department_name || dept.name;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error cargando departamentos:', error);
            // No es crítico, el usuario puede continuar sin seleccionar departamento
        }
    }

    // Manejar el envío del formulario
    document.getElementById('addEmployeeForm')?.addEventListener('submit', async function(e) {
        e.preventDefault();

        const submitBtn = document.getElementById('submitEmployeeBtn');
        const alertDiv = document.getElementById('employeeFormAlert');
        const originalBtnText = submitBtn.innerHTML;
        
        // Deshabilitar botón y mostrar loading
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando...';
        alertDiv.classList.add('d-none');

        // Recoger datos del formulario
        const formData = {
            full_name: document.getElementById('full_name').value.trim(),
            email: document.getElementById('email').value.trim(),
            cip: document.getElementById('cip').value.trim() || null,
            department_id: document.getElementById('department_id').value || null,
            position: document.getElementById('position').value.trim() || null,
            is_active: document.getElementById('is_active').checked
        };

        console.log('📤 Enviando datos del empleado:', formData);

        try {
            const response = await fetch('/api/employees', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Mostrar notificación de éxito
                showNotification('success', `✅ Empleado "${formData.full_name}" agregado correctamente`);
                
                // Cerrar modal
                const modal = bootstrap.Modal.getInstance(document.getElementById('addEmployeeModal'));
                modal.hide();
                
                // Limpiar formulario
                document.getElementById('addEmployeeForm').reset();
                
                // Recargar la página para ver el nuevo empleado
await loadDashboardData();

            } else {
                throw new Error(data.error || data.message || 'Error al crear empleado');
            }

        } catch (error) {
            console.error('❌ Error:', error);
            
            // Mostrar error en el modal
            alertDiv.innerHTML = `
                <strong><i class="bi bi-exclamation-triangle-fill"></i> Error:</strong> 
                ${error.message}
            `;
            alertDiv.classList.remove('d-none');
            
            // Scroll al inicio del modal para ver el error
            document.querySelector('.modal-body').scrollTop = 0;

        } finally {
            // Rehabilitar botón
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
            submitBtn.innerHTML = originalBtnText;
        }
    });

    // Función para mostrar notificaciones
    function showNotification(type, message) {
        const bgColor = type === 'success' ? '#28a745' : '#dc3545';
        const icon = type === 'success' ? 'check-circle-fill' : 'exclamation-circle-fill';
        
        const notificationHTML = `
            <div class="position-fixed top-0 end-0 p-3" style="z-index: 9999;">
                <div class="toast show align-items-center text-white border-0" 
                     style="background-color: ${bgColor};" 
                     role="alert">
                    <div class="d-flex">
                        <div class="toast-body">
                            <i class="bi bi-${icon} me-2"></i>
                            ${message}
                        </div>
                        <button type="button" class="btn-close btn-close-white me-2 m-auto" 
                                onclick="this.closest('.toast').remove()"></button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', notificationHTML);

        // Auto-remover después de 4 segundos
        setTimeout(() => {
            document.querySelector('.toast')?.remove();
        }, 4000);
    }

    // Limpiar alertas al cerrar el modal
    document.getElementById('addEmployeeModal')?.addEventListener('hidden.bs.modal', function() {
        document.getElementById('employeeFormAlert').classList.add('d-none');
        document.getElementById('addEmployeeForm').reset();
    });

    // Validación de email en tiempo real
    document.getElementById('email')?.addEventListener('blur', function() {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (this.value && !emailRegex.test(this.value)) {
            this.classList.add('is-invalid');
            if (!this.nextElementSibling?.classList.contains('invalid-feedback')) {
                const feedback = document.createElement('div');
                feedback.className = 'invalid-feedback';
                feedback.textContent = 'Por favor, ingresa un email válido';
                this.parentNode.appendChild(feedback);
            }
        } else {
            this.classList.remove('is-invalid');
            this.nextElementSibling?.remove();
        }
    });


    // ============================================================================
// REEMPLAZAR EL CÓDIGO DE EMPLEADO AL FINAL DE functions.js
// (Desde la línea que dice "Cargar departamentos al abrir el modal")
// ============================================================================

// ===== Modal: Añadir Empleado =====
// Cargar departamentos al abrir el modal de empleado
$('#addEmployeeModal').on('show.bs.modal', async function() {
    console.log('📋 Modal Empleado abierto - Cargando departamentos...');
    
    try {
        const response = await fetch('${API_BASE_URL}/api/departments', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Error al cargar departamentos');
        }

        const data = await response.json();
        
        if (data.success && data.data) {
            const select = $('#department_id'); // jQuery selector
            select.empty();
            select.append('<option value="">Sin departamento</option>');
            
            data.data.forEach(dept => {
                select.append(`<option value="${dept.id}">${dept.department_name || dept.name}</option>`);
            });
            
            console.log(`✅ ${data.data.length} departamentos cargados en modal empleado`);
        }
    } catch (error) {
        console.error('❌ Error cargando departamentos:', error);
        // No es crítico, el usuario puede continuar sin seleccionar departamento
    }
});

// Limpiar al cerrar modal de empleado
$('#addEmployeeModal').on('hidden.bs.modal', function() {
    $('#employeeFormAlert').addClass('d-none');
    $('#addEmployeeForm')[0].reset();
});

// Manejar el envío del formulario de empleado
$('#addEmployeeForm').on('submit', async function(e) {
    e.preventDefault();

    const submitBtn = $('#submitEmployeeBtn');
    const alertDiv = $('#employeeFormAlert');
    const originalBtnText = submitBtn.html();
    
    // Deshabilitar botón y mostrar loading
    submitBtn.prop('disabled', true);
    submitBtn.addClass('loading');
    submitBtn.html('<span class="spinner-border spinner-border-sm me-2"></span>Guardando...');
    alertDiv.addClass('d-none');

    // Recoger datos del formulario
    const formData = {
        full_name: $('#full_name').val().trim(),
        email: $('#email').val().trim(),
        cip: $('#cip').val().trim() || null,
        department_id: $('#department_id').val() || null,
        position: $('#position').val().trim() || null,
        is_active: $('#is_active').is(':checked')
    };

    console.log('📤 Enviando datos del empleado:', formData);

    try {
        const response = await fetch('${API_BASE_URL}/api/employees', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(formData)
        });

        const data = await response.json();
        
        console.log('📥 Respuesta del servidor:', data);

        if (response.ok && data.success) {
            // Mostrar notificación de éxito
            showEmployeeNotification('success', `✅ Empleado "${formData.full_name}" agregado correctamente`);
            
            // Cerrar modal
            $('#addEmployeeModal').modal('hide');
            
            // Limpiar formulario
            $('#addEmployeeForm')[0].reset();
            
            // Recargar tabla de empleados
            await loadDashboardData();

        } else {
            throw new Error(data.error || data.message || 'Error al crear empleado');
        }

    } catch (error) {
        console.error('❌ Error:', error);
        
        // Mostrar error en el modal
        alertDiv.html(`
            <strong><i class="bi bi-exclamation-triangle-fill"></i> Error:</strong> 
            ${error.message}
        `);
        alertDiv.removeClass('d-none');
        
        // Scroll al inicio del modal para ver el error
        $('.modal-body').scrollTop(0);

    } finally {
        // Rehabilitar botón
        submitBtn.prop('disabled', false);
        submitBtn.removeClass('loading');
        submitBtn.html(originalBtnText);
    }
});

// Función para mostrar notificaciones de empleado
function showEmployeeNotification(type, message) {
    const bgColor = type === 'success' ? '#28a745' : '#dc3545';
    const icon = type === 'success' ? 'check-circle-fill' : 'exclamation-circle-fill';
    
    const notificationHTML = `
        <div class="position-fixed top-0 end-0 p-3" style="z-index: 9999;">
            <div class="toast show align-items-center text-white border-0" 
                 style="background-color: ${bgColor};" 
                 role="alert">
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="bi bi-${icon} me-2"></i>
                        ${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" 
                            onclick="this.closest('.toast').remove()"></button>
                </div>
            </div>
        </div>
    `;
    
    $('body').append(notificationHTML);

    // Auto-remover después de 4 segundos
    setTimeout(() => {
        $('.toast').remove();
    }, 4000);
}

// Validación de email en tiempo real
$('#email').on('blur', function() {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emailVal = $(this).val();
    
    if (emailVal && !emailRegex.test(emailVal)) {
        $(this).addClass('is-invalid');
        
        if (!$(this).next('.invalid-feedback').length) {
            $(this).after('<div class="invalid-feedback">Por favor, ingresa un email válido</div>');
        }
    } else {
        $(this).removeClass('is-invalid');
        $(this).next('.invalid-feedback').remove();
    }
});

console.log('✅ Módulo Añadir Empleado cargado');


// ============================================================================
// AGREGAR AL FINAL DE functions.js - DESPUÉS DEL CÓDIGO DE EMPLEADOS
// ============================================================================

// ===== Modal: Añadir Equipo =====
console.log('📦 Inicializando módulo de Equipos...');

// Limpiar al cerrar modal de equipo
$('#addEquipmentModal').on('hidden.bs.modal', function() {
    $('#equipmentFormAlert').addClass('d-none');
    $('#addEquipmentForm')[0].reset();
    
    // ⭐ Limpiar validaciones visuales
    $('#device_code, #serial_number, #ip_address').removeClass('is-invalid');
    $('.invalid-feedback').remove();
    
    // Volver al primer tab
    $('#basic-tab').click();
});

// Manejar el envío del formulario de equipo
$('#addEquipmentForm').on('submit', async function(e) {
    e.preventDefault();

    const submitBtn = $('#submitEquipmentBtn');
    const alertDiv = $('#equipmentFormAlert');
    const originalBtnText = submitBtn.html();
    
    // Deshabilitar botón y mostrar loading
    submitBtn.prop('disabled', true);
    submitBtn.addClass('loading');
    submitBtn.html('<span class="spinner-border spinner-border-sm me-2"></span>Creando...');
    alertDiv.addClass('d-none');

    // ⭐ Recoger SOLO los campos obligatorios + opcionales
    const formData = {
        // OBLIGATORIOS
        device_code: $('#device_code').val().trim(),
        serial_number: $('#serial_number').val().trim(),
        equipment_type: $('#equipment_type').val(),
        brand: $('#brand').val().trim(),
        model: $('#model').val().trim(),
        
        // OPCIONALES - Tab 1
        status: $('#status').val() || 'Disponible',
        acquisition_date: $('#acquisition_date').val() || null,
        purchase_price: $('#purchase_price').val() || null,
        
        // OPCIONALES - Tab 2 (Especificaciones)
        processor: $('#processor').val().trim() || null,
        ram_memory: $('#ram').val().trim() || null,
        disk_capacity: $('#storage').val().trim() || null,
        operating_system: $('#operating_system').val() || null,
        ip_address: $('#ip_address').val().trim() || null,
        hostname: $('#hostname').val().trim() || null,
        
        // OPCIONALES - Tab 3 (Ubicación)
        location_id: $('#location_id').val() || null,
        department_id: $('#department_id').val() || null,
        supplier: $('#supplier').val().trim() || null,
        warranty_months: $('#warranty_months').val() || null,
        notes: $('#notes').val().trim() || null,
        
        // Campo por defecto
        acquisition_type: 'Propio' // Siempre Propio por defecto
    };

    console.log('📤 Enviando datos del equipo:', formData);

    try {
        const response = await fetch('${API_BASE_URL}/api/equipment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(formData)
        });

        const data = await response.json();
        
        console.log('📥 Respuesta del servidor:', {
            status: response.status,
            ok: response.ok,
            data: data
        });

        if (response.ok && data.success) {
            // Mostrar notificación de éxito
            showEquipmentNotification('success', `✅ Equipo "${formData.device_code}" agregado correctamente`);
            
            // Cerrar modal
            $('#addEquipmentModal').modal('hide');
            
            // Limpiar formulario
            $('#addEquipmentForm')[0].reset();
            
            // Recargar tabla de equipos
            await loadDashboardData();

        } else {
            // ⭐ Manejo específico de errores
            let errorMessage = data.error || data.message || 'Error al crear equipo';
            
            // Si es un error 409 (Conflict), resaltar el campo
            if (response.status === 409 && data.field) {
                if (data.field === 'device_code') {
                    $('#device_code').addClass('is-invalid');
                } else if (data.field === 'serial_number') {
                    $('#serial_number').addClass('is-invalid');
                }
            }
            
            throw new Error(errorMessage);
        }

    } catch (error) {
        console.error('❌ Error:', error);
        
        // Mostrar error en el modal
        alertDiv.html(`
            <strong><i class="bi bi-exclamation-triangle-fill"></i> Error:</strong> 
            ${error.message}
        `);
        alertDiv.removeClass('d-none');
        
        // Scroll al inicio del modal para ver el error
        $('.modal-body').scrollTop(0);

    } finally {
        // Rehabilitar botón
        submitBtn.prop('disabled', false);
        submitBtn.removeClass('loading');
        submitBtn.html(originalBtnText);
    }
});

// Función para mostrar notificaciones de equipo
function showEquipmentNotification(type, message) {
    const bgColor = type === 'success' ? '#28a745' : '#dc3545';
    const icon = type === 'success' ? 'check-circle-fill' : 'exclamation-circle-fill';
    
    const notificationHTML = `
        <div class="position-fixed top-0 end-0 p-3" style="z-index: 9999;">
            <div class="toast show align-items-center text-white border-0" 
                 style="background-color: ${bgColor};" 
                 role="alert">
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="bi bi-${icon} me-2"></i>
                        ${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" 
                            onclick="this.closest('.toast').remove()"></button>
                </div>
            </div>
        </div>
    `;
    
    $('body').append(notificationHTML);

    // Auto-remover después de 4 segundos
    setTimeout(() => {
        $('.toast').first().remove();
    }, 4000);
}

// Validación en tiempo real del código de dispositivo
$('#device_code').on('blur', async function() {
    const code = $(this).val().trim();
    
    if (!code) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/equipment/search?term=${encodeURIComponent(code)}`, {
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success && result.data.length > 0) {
            // Buscar coincidencia exacta
            const exists = result.data.find(eq => eq.device_code === code);
            
            if (exists) {
                $(this).addClass('is-invalid');
                
                if (!$(this).next('.invalid-feedback').length) {
                    $(this).after('<div class="invalid-feedback">⚠️ Este código ya está registrado</div>');
                }
            } else {
                $(this).removeClass('is-invalid');
                $(this).next('.invalid-feedback').remove();
            }
        } else {
            $(this).removeClass('is-invalid');
            $(this).next('.invalid-feedback').remove();
        }
    } catch (error) {
        console.error('Error validando código:', error);
    }
});

// Validación en tiempo real del número de serie
$('#serial_number').on('blur', async function() {
    const serial = $(this).val().trim();
    
    if (!serial) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/equipment/search?term=${encodeURIComponent(serial)}`, {
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (result.success && result.data.length > 0) {
            // Buscar coincidencia exacta
            const exists = result.data.find(eq => eq.serial_number === serial);
            
            if (exists) {
                $(this).addClass('is-invalid');
                
                if (!$(this).next('.invalid-feedback').length) {
                    $(this).after('<div class="invalid-feedback">⚠️ Este número de serie ya está registrado</div>');
                }
            } else {
                $(this).removeClass('is-invalid');
                $(this).next('.invalid-feedback').remove();
            }
        } else {
            $(this).removeClass('is-invalid');
            $(this).next('.invalid-feedback').remove();
        }
    } catch (error) {
        console.error('Error validando serie:', error);
    }
});

// Validación del formato de IP
$('#ip_address').on('blur', function() {
    const ip = $(this).val().trim();
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    
    if (ip && !ipRegex.test(ip)) {
        $(this).addClass('is-invalid');
        
        if (!$(this).next('.invalid-feedback').length) {
            $(this).after('<div class="invalid-feedback">Formato de IP inválido (Ej: 192.168.1.100)</div>');
        }
    } else {
        $(this).removeClass('is-invalid');
        $(this).next('.invalid-feedback').remove();
    }
});

console.log('✅ Módulo Añadir Equipo cargado');
