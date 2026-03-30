
       // Variables para controlar el estado del sidebar
let sidebarOpen = false;

// Elementos del DOM
const mainToggleSidebar = document.getElementById('mainToggleSidebar');
const closeSidebar = document.getElementById('closeSidebar');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const navbar = document.getElementById('navbar'); // Añadido para el navbar

// Función para abrir el sidebar
function openSidebar() {
    sidebar.classList.add('active');
    sidebarOverlay.classList.add('active');
    sidebarOpen = true;
}

// Función para cerrar el sidebar
function closeSidebarFunc() {
    sidebar.classList.remove('active');
    sidebarOverlay.classList.remove('active');
    sidebarOpen = false;
}

// Función principal para toggle del sidebar
function toggleSidebarFunc() {
    if (sidebarOpen) {
        closeSidebarFunc();
    } else {
        openSidebar();
    }
}

// Event listeners
mainToggleSidebar.addEventListener('click', toggleSidebarFunc);
closeSidebar.addEventListener('click', closeSidebarFunc);
sidebarOverlay.addEventListener('click', closeSidebarFunc);

// NUEVA FUNCIONALIDAD: Toggle sidebar al hacer clic en el navbar (móvil y desktop)
if (navbar) {
    let touchStartTime = 0;
    
    // Para móvil - usar touchstart y touchend
    navbar.addEventListener('touchstart', function(e) {
        if (!e.target.closest('#mainToggleSidebar')) {
            touchStartTime = Date.now();
        }
    }, { passive: true });
    
    navbar.addEventListener('touchend', function(e) {
        if (!e.target.closest('#mainToggleSidebar')) {
            // Solo ejecutar si fue un toque rápido (no scroll)
            if (Date.now() - touchStartTime < 200) {
                e.preventDefault();
                e.stopPropagation();
                toggleSidebarFunc();
            }
        }
    });
    
    // Para desktop - click normal
    navbar.addEventListener('click', function(e) {
        if (!e.target.closest('#mainToggleSidebar') && touchStartTime === 0) {
            toggleSidebarFunc();
        }
        touchStartTime = 0; // Reset para evitar conflictos
    });
}

// Toggle submenu function
function toggleSubmenu(element) {
    const submenu = element.nextElementSibling;
    const indicator = element.querySelector('.collapse-indicator');
    
    // Close other open submenus
    const allSubmenus = document.querySelectorAll('.submenu');
    const allIndicators = document.querySelectorAll('.collapse-indicator');
    const allHeaders = document.querySelectorAll('.menu-header');
    
    allSubmenus.forEach((menu, index) => {
        if (menu !== submenu) {
            menu.classList.remove('expanded');
            // Solo rotar indicadores que existan
            const currentIndicator = allHeaders[index]?.querySelector('.collapse-indicator');
            if (currentIndicator) {
                currentIndicator.classList.remove('rotated');
            }
            allHeaders[index]?.classList.remove('active');
        }
    });
    
    // Toggle current submenu
    submenu.classList.toggle('expanded');
    indicator.classList.toggle('rotated');
    element.classList.toggle('active');
}

// Close sidebar when clicking on submenu items
document.querySelectorAll('.submenu-item').forEach(item => {
    item.addEventListener('click', closeSidebarFunc);
});

// Handle window resize
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        closeSidebarFunc();
    }
});

// Prevenir que el sidebar se cierre al tocar en móvil (mejorado)
document.addEventListener('touchstart', (e) => {
    // Solo cerrar si el sidebar está abierto y el toque no es en el sidebar ni en el navbar
    if (sidebarOpen && !sidebar.contains(e.target) && !navbar.contains(e.target)) {
        closeSidebarFunc();
    }
}, { passive: true });
   