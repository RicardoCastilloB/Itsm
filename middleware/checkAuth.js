// ============================================================================
// middleware/checkAuth.js - MIDDLEWARE PARA PROTEGER VISTAS (NO API)
// ============================================================================

/**
 * Middleware para proteger vistas HTML (no APIs)
 * Verifica si el usuario tiene un token válido en el cliente
 * Si no, redirige al login
 */
const checkAuthView = (req, res, next) => {
  // Esta verificación se hace en el cliente con JavaScript
  // Este middleware solo renderiza una página que verifica el token
  
  res.render('check-auth', {
    title: 'Verificando autenticación...',
    redirectTo: req.originalUrl
  });
};

/**
 * Middleware simple que solo verifica si hay usuario en sesión
 * Para usar con express-session si lo implementas
 */
const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  }
  res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
};

module.exports = {
  checkAuthView,
  requireAuth
};