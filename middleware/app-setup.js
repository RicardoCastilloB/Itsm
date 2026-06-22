const cors           = require('cors');
const helmet         = require('helmet');
const morgan         = require('morgan');
const compression    = require('compression');
const express        = require('express');
const cookieParser   = require('cookie-parser');
const session        = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const sequelize      = require('../src/config/database');
const rateLimit      = require('express-rate-limit');
const passport       = require('./passport');

module.exports = function configureApp(app) {
    // Cookies y sesión
    app.use(cookieParser());

    const sessionStore = new SequelizeStore({ db: sequelize });
    sessionStore.sync(); // crea la tabla Sessions si no existe

    app.use(session({
        store:             sessionStore,
        secret:            process.env.SESSION_SECRET || 'cambiar_este_secreto',
        resave:            false,
        saveUninitialized: false,
        cookie: {
            secure:   process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge:   8 * 60 * 60 * 1000,
        },
    }));

    // Passport (inicializar después de session)
    app.use(passport.initialize());
    app.use(passport.session());

    // Seguridad
    app.use(helmet({ contentSecurityPolicy: false }));

    const PORT = process.env.PORT || 3000;
    app.use(cors({
        origin: function (origin, callback) {
            if (!origin) return callback(null, true);

            // Leer en cada request para que cambios de .env no requieran reiniciar
            const _appUrl      = (process.env.APP_URL || '').replace(/\/$/, '');
            const _extraList   = (process.env.ALLOWED_ORIGINS || '')
                .split(',').map(s => s.trim()).filter(Boolean);

            const allowed = new Set([
                `http://localhost:${PORT}`,
                `https://localhost:${PORT}`,
                'http://localhost:3000',
                'https://localhost:3000',
                ...(_appUrl ? [_appUrl] : []),
                ..._extraList,
            ]);

            if (allowed.has(origin)) return callback(null, true);
            callback(new Error('No permitido por CORS'));
        },
        credentials: true
    }));

    // Body parsing
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    app.use(compression());

    // Logging HTTP
    if (process.env.NODE_ENV === 'development') {
        app.use(morgan('dev'));
    } else {
        app.use(morgan('combined'));
    }

    // Rate Limiting general para la API (desactivado en development)
    if (process.env.NODE_ENV !== 'development') {
        const apiLimiter = rateLimit({
            windowMs:        parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000,
            max:             parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500,
            message:         { success: false, error: 'Demasiadas peticiones desde esta IP, intenta de nuevo más tarde' },
            standardHeaders: true,
            legacyHeaders:   false,
        });
        app.use('/api/', apiLimiter);
    }
};
