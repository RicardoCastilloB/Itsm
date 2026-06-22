const express  = require('express');
const jwt      = require('jsonwebtoken');
const { Op }   = require('sequelize');
const { equipmentPool, executeQuery } = require('../config/database');
const { User } = require('../src/models');
// bcrypt ya no se usa directamente — User.verificarPassword() lo encapsula
const router = express.Router();
const { authenticateToken: requireAuth } = require('../middleware/auth');

// ── Auto-crear tablas auxiliares si no existen ───────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS login_attempts (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                user_id    VARCHAR(100),
                ip_address VARCHAR(100),
                status     ENUM('success','failed') NOT NULL,
                created_at DATETIME DEFAULT NOW(),
                INDEX idx_user (user_id),
                INDEX idx_ip   (ip_address)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                user_id    VARCHAR(100) NOT NULL,
                token      TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT NOW(),
                INDEX idx_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { console.error('auth tables migration:', e.message); }
})();

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

        // Buscar usuario por username o email (Sequelize ORM)
        const userData = await User.findOne({
            where: {
                [Op.or]: [{ username }, { email: username }],
                activo: true,
            },
        });

        if (!userData) {
            console.log(`❌ Usuario no encontrado: ${username}`);
            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        console.log(`✅ Usuario encontrado: ${userData.username} (ID: ${userData.id})`);

        // Comparar contraseña con el hash almacenado
        const isPasswordValid = await userData.verificarPassword(password);
        
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';

        if (!isPasswordValid) {
            console.log(`❌ Contraseña inválida para: ${userData.username}`);
            // fire-and-forget — no bloquea la respuesta
            executeQuery(equipmentPool,
                'INSERT INTO login_attempts (user_id, ip_address, status) VALUES (?, ?, ?)',
                [userData.id, ip, 'failed']
            ).catch(() => {});

            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        console.log(`✅ Contraseña válida para: ${userData.username}`);

        // Generar tokens primero para no demorar la respuesta
        const accessToken  = generateAccessToken(userData);
        const refreshToken = generateRefreshToken(userData);

        // Escrituras auxiliares en paralelo — fire-and-forget
        Promise.all([
            executeQuery(equipmentPool,
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
                [userData.id]),
            executeQuery(equipmentPool,
                'INSERT INTO login_attempts (user_id, ip_address, status) VALUES (?, ?, ?)',
                [userData.id, ip, 'success']),
            executeQuery(equipmentPool,
                'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
                [userData.id, refreshToken, jwtRefreshExpirySeconds]),
        ]).catch(() => {});

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
            req.session.loggedin  = true;
            req.session.userId    = userData.id;
            req.session.username  = userData.username;
            req.session.full_name = userData.nombre   || userData.full_name || '';
            req.session.role      = userData.rol      || userData.role      || '';
        }

        // Respuesta exitosa con datos del usuario (sin información sensible)
        return res.status(200).json({
            success: true,
            message: 'Inicio de sesión exitoso',
            accessToken,
            refreshToken,
            user: {
                id:           userData.id,
                username:     userData.username,
                email:        userData.email,
                full_name:    userData.nombre      || userData.full_name  || '',
                role:         userData.rol         || userData.role       || '',
                employee_cip: userData.employeeCip || userData.employee_cip || null,
                is_verified:  userData.isVerified  ?? userData.is_verified ?? false,
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

// ============================================================================
// GET /api/auth/perfil — Datos del usuario autenticado
// ============================================================================
router.get('/perfil', authenticateToken, async (req, res) => {
    try {
        const rows = await executeQuery(
            equipmentPool,
            `SELECT id, username, full_name, email, role, employee_cip,
                    is_active, is_verified, created_at
             FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
            [req.user.id]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        }

        return res.json({ success: true, data: rows[0] });

    } catch (error) {
        console.error('❌ Error en GET /perfil:', error);
        return res.status(500).json({ success: false, error: 'Error al obtener perfil' });
    }
});

// ============================================================================
// GET /api/auth/users — Listar todos los usuarios del sistema
// ============================================================================
router.get('/users', requireAuth, async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool,
            `SELECT id, username, full_name, email, role, is_active, created_at FROM users ORDER BY full_name ASC`
        );
        res.json({ success: true, data: rows });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// POST /api/auth/register — Crear nuevo usuario (solo admin)
// ============================================================================
router.post('/register', requireAuth, async (req, res) => {
    try {
        const { full_name, username, email, role = 'usuario', password } = req.body;
        if (!full_name || !email || !password)
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });

        const bcrypt = require('bcryptjs');
        const hash   = await bcrypt.hash(password, 10);
        const uname  = username || email.split('@')[0];

        const result = await executeQuery(equipmentPool,
            `INSERT INTO users (full_name, username, email, role, password_hash, is_active, is_verified, created_at)
             VALUES (?, ?, ?, ?, ?, 1, 1, NOW())`,
            [full_name, uname, email.toLowerCase(), role, hash]
        );
        res.status(201).json({ success: true, userId: result.insertId, message: 'Usuario creado' });
    } catch(err) {
        if (err.code === 'ER_DUP_ENTRY')
            return res.status(409).json({ success: false, error: 'El email o usuario ya existe' });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// PATCH /api/auth/users/:id/role — Cambiar rol de un usuario
// ============================================================================
router.patch('/users/:id/role', requireAuth, async (req, res) => {
    try {
        const { role } = req.body;
        const validRoles = ['usuario', 'visor', 'tecnico', 'agente', 'especialista', 'administrador'];
        if (!validRoles.includes(role))
            return res.status(400).json({ success: false, error: 'Rol no válido' });

        await executeQuery(equipmentPool,
            `UPDATE users SET role = ? WHERE id = ?`,
            [role, req.params.id]
        );
        res.json({ success: true, message: 'Rol actualizado' });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;