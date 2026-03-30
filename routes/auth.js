const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { equipmentPool, executeQuery } = require('../config/database');
const router = express.Router();

// Verificar variables de entorno
console.log('🔍 Verificando variables de entorno en auth.js:');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '✅ Definido' : '❌ NO definido');
console.log('JWT_REFRESH_SECRET:', process.env.JWT_REFRESH_SECRET ? '✅ Definido' : '❌ NO definido');

// Constantes para tokens (DEBEN estar al inicio)
const jwtExpirySeconds = 8 * 60 * 60; // 8 horas
const jwtRefreshExpirySeconds = 7 * 24 * 60 * 60; // 7 días

// Secrets con valores por defecto (SOLO PARA DESARROLLO)
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret_dev_only';

// Funciones para generar tokens
function generateAccessToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: user.role
        },
        JWT_SECRET,
        { expiresIn: jwtExpirySeconds }
    );
}

function generateRefreshToken(user) {
    return jwt.sign(
        {
            id: user.id
        },
        JWT_REFRESH_SECRET,
        { expiresIn: jwtRefreshExpirySeconds }
    );
}
function authenticateToken  (req, res, next) {
  const token = req.cookies.token; // Asumiendo que el token se guarda en una cookie

  if (!token) {
    return res.redirect('/login'); // Redirigir a login si no hay token
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
    if (err) {
      return res.redirect('/login'); // Redirigir a login si el token no es válido
    }
    req.user = user; // Guardar información del usuario en la solicitud
    next(); // Continuar a la siguiente función middleware o ruta
  });
};

// GET /login -> Renderizar vista
router.get('/login', (req, res) => {
    return res.render('login', { error: null });
});

// POST /login -> Validar credenciales
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validación de datos de entrada
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Usuario y contraseña son requeridos'
            });
        }

        console.log(`🔍 Intentando login para: ${username}`);

        // Buscar usuario por username o email
        const query = 'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1';
        const results = await executeQuery(equipmentPool, query, [username, username]);

        // Validar si el usuario existe
        if (!results || results.length === 0) {
            console.log(`❌ Usuario no encontrado: ${username}`);
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        const userData = results[0];
        console.log(`✅ Usuario encontrado: ${userData.username} (ID: ${userData.id})`);

        // Verificar si la cuenta está activa
        if (!userData.is_active) {
            console.log(`⚠️ Cuenta inactiva: ${userData.username}`);
            return res.status(403).json({
                success: false,
                error: 'Cuenta inactiva. Contacta al administrador.'
            });
        }

        // Comparar contraseña con el hash almacenado
        const isPasswordValid = await bcrypt.compare(password, userData.password_hash);
        
        if (!isPasswordValid) {
            console.log(`❌ Contraseña inválida para: ${userData.username}`);
            
            // Registrar intento fallido
            await executeQuery(
                equipmentPool,
                'INSERT INTO login_attempts (user_id, ip_address, status) VALUES (?, ?, ?)',
                [userData.id, req.ip || req.connection.remoteAddress || 'unknown', 'failed']
            );

            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas'
            });
        }

        console.log(`✅ Contraseña válida para: ${userData.username}`);

        // Actualizar último login
        await executeQuery(
            equipmentPool,
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [userData.id]
        );

        // Registrar intento exitoso
        await executeQuery(
            equipmentPool,
            'INSERT INTO login_attempts (user_id, ip_address, status) VALUES (?, ?, ?)',
            [userData.id, req.ip || req.connection.remoteAddress || 'unknown', 'success']
        );

        // Generar tokens
        const accessToken = generateAccessToken(userData);
        const refreshToken = generateRefreshToken(userData);

        // Guardar refresh token en la base de datos
        await executeQuery(
            equipmentPool,
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
            [userData.id, refreshToken, jwtRefreshExpirySeconds]
        );

        // Configurar cookies con los tokens
        res.cookie('accessToken', accessToken, {
            maxAge: jwtExpirySeconds * 1000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        res.cookie('refreshToken', refreshToken, {
            maxAge: jwtRefreshExpirySeconds * 1000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        console.log(`✅ Usuario ${username} inició sesión exitosamente`);

        // Almacenar información en la sesión (si usas express-session)
        if (req.session) {
            req.session.loggedin = true;
            req.session.userId = userData.id;
            req.session.username = userData.username;
            req.session.full_name = userData.full_name;
            req.session.role = userData.role;
        }

        // Respuesta exitosa con datos del usuario (sin información sensible)
        return res.status(200).json({
            success: true,
            message: 'Inicio de sesión exitoso',
            accessToken,
            refreshToken,
            user: {
                id: userData.id,
                username: userData.username,
                email: userData.email,
                full_name: userData.full_name,
                role: userData.role,
                employee_cip: userData.employee_cip,
                is_verified: userData.is_verified
            }
        });

    } catch (error) {
        console.error('❌ Error en login:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// POST /logout -> Cerrar sesión
router.post('/logout', async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        
        if (refreshToken) {
            // Eliminar refresh token de la base de datos
            await executeQuery(
                equipmentPool,
                'DELETE FROM refresh_tokens WHERE token = ?',
                [refreshToken]
            );
        }

        // Limpiar cookies
        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');

        // Destruir sesión si existe
        if (req.session) {
            req.session.destroy();
        }

        return res.status(200).json({
            success: true,
            message: 'Sesión cerrada correctamente'
        });
    } catch (error) {
        console.error('❌ Error en logout:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al cerrar sesión'
        });
    }
});

module.exports = router;