// ============================================================================
// middleware/passport.js — Passport.js con estrategia local (email + password)
//
// Se integra con el flujo JWT existente:
//   1. Passport valida credenciales con la BD
//   2. routes/auth.js emite el JWT access token
// ============================================================================

const passport      = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt        = require('bcrypt');
const { equipmentPool, executeQuery } = require('../config/database');
const logger = require('../utils/logger');

// ============================================================================
// ESTRATEGIA LOCAL — email + password
// ============================================================================
passport.use('local', new LocalStrategy(
    {
        usernameField: 'email',
        passwordField: 'password',
        passReqToCallback: false,
    },
    async (email, password, done) => {
        try {
            const rows = await executeQuery(
                equipmentPool,
                'SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
                [email.toLowerCase().trim()]
            );

            if (!rows || rows.length === 0) {
                logger.warn(`Intento de login fallido: email no encontrado (${email})`);
                return done(null, false, { message: 'Credenciales incorrectas' });
            }

            const user = rows[0];
            const passwordValida = await bcrypt.compare(password, user.password);

            if (!passwordValida) {
                logger.warn(`Intento de login fallido: password incorrecto para ${email}`);
                return done(null, false, { message: 'Credenciales incorrectas' });
            }

            logger.info(`Autenticación Passport exitosa: ${user.username}`);
            return done(null, user);

        } catch (error) {
            logger.error('Error en Passport LocalStrategy:', error);
            return done(error);
        }
    }
));

// ============================================================================
// SERIALIZACIÓN — para sesiones (respaldo, auth principal es JWT)
// ============================================================================
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const rows = await executeQuery(
            equipmentPool,
            'SELECT id, username, email, full_name, role, is_active, is_verified FROM users WHERE id = ? AND is_active = 1 LIMIT 1',
            [id]
        );
        done(null, rows[0] || null);
    } catch (error) {
        done(error, null);
    }
});

module.exports = passport;
