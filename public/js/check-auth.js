// ============================================================================
// public/js/check-auth.js - VERIFICACIÓN DE AUTENTICACIÓN EN CLIENTE
// ============================================================================

/**
 * Verifica si el usuario está autenticado
 * Debe incluirse en todas las páginas protegidas
 */
(function() {
    'use strict';

    // Verificar si hay token de acceso
    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    const currentPath = window.location.pathname;

    // Rutas públicas que no requieren autenticación
    const publicRoutes = ['/login', '/register', '/forgot-password'];
    const isPublicRoute = publicRoutes.some(route => currentPath.startsWith(route));

    // Si estamos en ruta pública, no hacer nada
    if (isPublicRoute) {
        return;
    }

    // Si no hay token, redirigir al login
    if (!accessToken) {
        console.warn('⚠️  No hay token de acceso. Redirigiendo al login...');
        window.location.href = '/login?redirect=' + encodeURIComponent(currentPath);
        return;
    }

    // Verificar si el token es válido
    verifyToken(accessToken)
        .then(isValid => {
            if (!isValid) {
                console.warn('⚠️  Token inválido o expirado');
                
                // Intentar renovar con refresh token
                if (refreshToken) {
                    return renewToken(refreshToken);
                } else {
                    throw new Error('No hay refresh token');
                }
            }
            
            // Token válido - cargar información del usuario
            loadUserInfo();
        })
        .catch(error => {
            console.error('❌ Error de autenticación:', error);
            clearAuthData();
            window.location.href = '/login?redirect=' + encodeURIComponent(currentPath);
        });

    /**
     * Verifica si un token JWT es válido
     */
    async function verifyToken(token) {
        try {
            const response = await fetch('/api/auth/me', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            return response.ok;
        } catch (error) {
            console.error('Error verificando token:', error);
            return false;
        }
    }

    /**
     * Renueva el access token usando el refresh token
     */
    async function renewToken(refreshToken) {
        try {
            const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ refreshToken })
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('accessToken', data.accessToken);
                localStorage.setItem('user', JSON.stringify(data.user));
                console.log('✅ Token renovado exitosamente');
                loadUserInfo();
                return true;
            } else {
                throw new Error('No se pudo renovar el token');
            }
        } catch (error) {
            console.error('Error renovando token:', error);
            throw error;
        }
    }

    /**
     * Carga la información del usuario en la UI
     */
    function loadUserInfo() {
        const userDataStr = localStorage.getItem('user');
        
        if (!userDataStr) return;

        try {
            const userData = JSON.parse(userDataStr);
            
            // Actualizar elementos de UI con info del usuario
            const userNameElements = document.querySelectorAll('[data-user-name]');
            userNameElements.forEach(el => {
                el.textContent = userData.username || 'Usuario';
            });

            const userEmailElements = document.querySelectorAll('[data-user-email]');
            userEmailElements.forEach(el => {
                el.textContent = userData.email || '';
            });

            const userRoleElements = document.querySelectorAll('[data-user-role]');
            userRoleElements.forEach(el => {
                el.textContent = userData.role || 'user';
            });

            // Mostrar/ocultar elementos según rol
            if (userData.role === 'admin') {
                document.querySelectorAll('[data-admin-only]').forEach(el => {
                    el.style.display = 'block';
                });
            }

            console.log('✅ Usuario autenticado:', userData.username);
        } catch (error) {
            console.error('Error parseando datos de usuario:', error);
        }
    }

    /**
     * Limpia todos los datos de autenticación
     */
    function clearAuthData() {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
    }

    /**
     * Función global para cerrar sesión
     */
    window.logout = async function() {
        const refreshToken = localStorage.getItem('refreshToken');
        
        try {
            // Llamar a API de logout
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                },
                body: JSON.stringify({ refreshToken })
            });
        } catch (error) {
            console.error('Error al cerrar sesión:', error);
        } finally {
            clearAuthData();
            window.location.href = '/login';
        }
    };

    /**
     * Función global para obtener el token actual
     */
    window.getAuthToken = function() {
        return localStorage.getItem('accessToken');
    };

    /**
     * Función global para hacer peticiones autenticadas
     */
    window.authenticatedFetch = async function(url, options = {}) {
        const token = localStorage.getItem('accessToken');
        
        if (!token) {
            throw new Error('No hay token de autenticación');
        }

        const authOptions = {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await fetch(url, authOptions);

        // Si el token expiró, intentar renovar
        if (response.status === 401) {
            const refreshToken = localStorage.getItem('refreshToken');
            if (refreshToken) {
                const renewed = await renewToken(refreshToken);
                if (renewed) {
                    // Reintentar petición con nuevo token
                    authOptions.headers['Authorization'] = `Bearer ${localStorage.getItem('accessToken')}`;
                    return fetch(url, authOptions);
                }
            }
            throw new Error('Sesión expirada');
        }

        return response;
    };

    // Agregar event listener para botones de logout
    document.addEventListener('DOMContentLoaded', function() {
        const logoutButtons = document.querySelectorAll('[data-logout]');
        logoutButtons.forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                
                if (confirm('¿Estás seguro que deseas cerrar sesión?')) {
                    window.logout();
                }
            });
        });
    });

})();