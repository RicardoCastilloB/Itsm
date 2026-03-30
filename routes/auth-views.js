// ============================================================================
// routes/auth-views.js - RUTAS PARA LAS VISTAS DE AUTENTICACIÓN
// ============================================================================

const express = require('express');
const router = express.Router();

// ============================================================================
// GET /login - Mostrar página de login
// ============================================================================
router.get('/login', (req, res) => {
  res.render('login', {
    title: 'Iniciar Sesión - Equipment Management'
  });
});

// ============================================================================
// GET /register - Mostrar página de registro
// ============================================================================
router.get('/register', (req, res) => {
  res.render('register', {
    title: 'Crear Cuenta - Equipment Management'
  });
});

// ============================================================================
// GET /logout - Cerrar sesión (vista)
// ============================================================================
router.get('/logout', (req, res) => {
  // En el cliente se limpiará localStorage
  res.redirect('/login');
});

// ============================================================================
// GET /forgot-password - Recuperar contraseña (placeholder)
// ============================================================================
router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', {
    title: 'Recuperar Contraseña - Equipment Management'
  });
});

module.exports = router;