// ============================================================================
// app.js — Servidor principal
// Equipment Management System
// ============================================================================

const express        = require('express');
const cors           = require('cors');
const helmet         = require('helmet');
const morgan         = require('morgan');
const compression    = require('compression');
const rateLimit      = require('express-rate-limit');
const cookieParser   = require('cookie-parser');
const session        = require('express-session');
const path           = require('path');
const methodOverride = require('method-override');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;


// ============================================================================
// MOTOR DE VISTAS — EJS
// ============================================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(methodOverride('_method'));

// Middleware para exponer APP_URL a todas las vistas
app.use((req, res, next) => {
    res.locals.APP_URL = process.env.APP_URL;
    next();
});
// ============================================================================
// MIDDLEWARES GLOBALES
// ============================================================================

// Cookies y sesión
app.use(cookieParser());
app.use(session({
    secret:            process.env.SESSION_SECRET || 'cambiar_este_secreto',
    resave:            false,
    saveUninitialized: false,
    cookie: {
        secure:   process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge:   8 * 60 * 60 * 1000, // 8 horas
    },
}));

// Seguridad
app.use(helmet({ contentSecurityPolicy: false }));


app.use(cors({
    origin: function(origin, callback) {
        // Permite cualquier origen (o puedes poner una lista)
        callback(null, origin || '*');
    },
    credentials: true  // ← esto es lo clave
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


// ============================================================================
// RATE LIMITING
// ============================================================================

// Límite general para todas las rutas /api/
const apiLimiter = rateLimit({
    windowMs:        (process.env.RATE_LIMIT_WINDOW || 3000) * 12000 * 200000,
    max:             process.env.RATE_LIMIT_MAX_REQUESTS || 45000,
    message:         'Demasiadas peticiones desde esta IP, intenta de nuevo más tarde',
    standardHeaders: true,
    legacyHeaders:   false,
});
app.use('/api/', apiLimiter);

// Límite estricto solo para login (5 intentos por 15 min)
const loginLimiter = rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             5,
    message:         'Demasiados intentos de login. Intenta de nuevo en 15 minutos.',
    standardHeaders: true,
    legacyHeaders:   false,
});


// ============================================================================
// MIDDLEWARES DE AUTENTICACIÓN Y PERMISOS
// ============================================================================
const { authenticateToken, optionalAuth, logout } = require('./middleware/auth');
const { adminOnly } = require('./middleware/permissions');


// ============================================================================
// IMPORTS DE RUTAS — VISTAS
// ============================================================================
const viewsRoutes = require('./routes/views');
// ⚠️  views.js maneja TODAS las rutas de vistas del sistema.
//     No agregar rutas de vistas aquí en app.js para evitar conflictos
//     con las rutas comodín (/employees/:id, /equipment/:id).


// ============================================================================
// IMPORTS DE RUTAS — APIs
// ============================================================================
const authRoutes            = require('./routes/auth');
const permissionsRoutes     = require('./routes/permissions');
const employeesRoutes       = require('./routes/employees');
const equipmentRoutes       = require('./routes/equipment');
const assignmentsRoutes     = require('./routes/assignments');
const dashboardRoutes       = require('./routes/dashboard');
const dashboardStatsRouter  = require('./routes/dashboard-stats');
const dashboardGraphsRouter = require('./routes/dashboard-graphs');
const locationsRoutes       = require('./routes/locations');
const departmentsRoutes     = require('./routes/departments');
const indicatorsRouter      = require('./routes/indicators');
const warrantyRouter        = require('./routes/warranty');
const jiraRoutes            = require('./routes/jira');
const outlookSyncRouter     = require('./routes/outlook-sync');
const recoveriesRouter      = require('./routes/recoveries');
const adRouter              = require('./routes/ad');
const soporteRouter    = require('./routes/soporte');
const almacenRouter         = require('./routes/almacen');



// ============================================================================
// REGISTRO DE RUTAS — AUTENTICACIÓN (pública, con rate limit de login)
// ============================================================================
app.use('/api/auth', loginLimiter, authRoutes);


// ============================================================================
// REGISTRO DE RUTAS — VISTAS
// Debe ir antes que las APIs para que las rutas de página se resuelvan primero.
// TODAS las vistas están centralizadas en routes/views.js
// ============================================================================
app.use('/', viewsRoutes);


// ============================================================================
// RUTAS UTILITARIAS
// ============================================================================
const printQueue = require('./routes/print-queue');
app.use('/api/print-queue', printQueue);
// Logout
app.get('/logout', logout);

// Health check — monitoreo del servidor
app.get('/health', (req, res) => {
    res.json({
        status:      'OK',
        timestamp:   new Date().toISOString(),
        uptime:      process.uptime(),
        environment: process.env.NODE_ENV || 'development',
    });
});

// Info general de la API
app.get('/api', optionalAuth, (req, res) => {
    res.json({
        message:       'API REST - Equipment Management System',
        version:       '1.0.0',
        authenticated: !!req.user,
        endpoints: {
            auth:        '/api/auth',
            employees:   '/api/employees',
            equipment:   '/api/equipment',
            assignments: '/api/assignments',
            dashboard:   '/api/dashboard',
            locations:   '/api/locations',
            departments: '/api/departments',
            recoveries:  '/api/recoveries',
            almacen:     '/api/almacen',
            ad:          '/api/ad',
            soporte:      '/api/soporte',
            sccm:        '/api/outlook-sync',
        },
    });
});

// Configuración del cliente
app.get('/api/config', (req, res) => {
    res.json({
        apiUrl:   process.env.API_BASE_URL || `http://localhost:${PORT}`,
        version:  '1.0.0',
        features: { authentication: true, roleBasedAccess: true, auditLog: true },
    });
});


// ============================================================================
// REGISTRO DE RUTAS — APIs DE DATOS
// ============================================================================
// Import (junto a los otros requires de rutas)
const reportsRouter = require('./routes/reports');
const reportListsRouter = require('./routes/report-lists');
app.use('/api/report-lists', reportListsRouter);
// Registro (junto a los app.use de las APIs)
app.use('/api/reports', reportsRouter);   // GET /api/reports/:id
app.use('/api/mailer',  reportsRouter);   // POST /api/mailer/send
// Permisos de usuario
app.use('/api/permissions',  permissionsRoutes);

// Entidades principales
app.use('/api/employees',    employeesRoutes);
app.use('/api/equipment',    equipmentRoutes);
app.use('/api/locations',    locationsRoutes);
app.use('/api/departments',  departmentsRoutes);
app.use('/api/assignments',  assignmentsRoutes);

// Dashboard (tres routers separados, todos bajo /api/dashboard)
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/dashboard',    dashboardStatsRouter);
app.use('/api/dashboard',    dashboardGraphsRouter);

// Módulos adicionales
app.use('/api/indicators',   indicatorsRouter);
app.use('/api/warranty',     warrantyRouter);
app.use('/api/recoveries',   recoveriesRouter);
app.use('/api/almacen',      almacenRouter);
app.use('/api/ad',           adRouter);
app.use('/api/soporte',           soporteRouter);

// Integraciones externas
app.use('/api/jira',         jiraRoutes);
app.use('/tickets',          jiraRoutes);
app.use('/api/outlook-sync', outlookSyncRouter);


// ============================================================================
// MANEJO DE ERRORES — SIEMPRE AL FINAL
// ============================================================================

// 404 — Ruta no encontrada
app.use((req, res) => {
    // APIs devuelven JSON
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            success:            false,
            error:              'Endpoint no encontrado',
            path:               req.originalUrl,
            availableEndpoints: '/api',
        });
    }
    // Vistas devuelven HTML
    res.status(404).render('error', {
        title: '404 - Página no encontrada',
        error: 'La página que buscas no existe',
        user:  req.user || null,
    });
});

// 500 — Error global (4 parámetros obligatorios para que Express lo reconozca)
app.use((err, req, res, next) => {
    console.error('❌ Error global:', err);
    const statusCode = err.statusCode || 500;
    const message    = err.message    || 'Error interno del servidor';

    if (req.path.startsWith('/api/')) {
        return res.status(statusCode).json({
            success: false,
            error:   message,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack, details: err }),
        });
    }
    res.status(statusCode).render('error', {
        title: 'Error del servidor',
        error: message,
        user:  req.user || null,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});


// ============================================================================
// INICIAR SERVIDOR
// ============================================================================
const server = app.listen(PORT, () => {
    console.log('═'.repeat(75));
    console.log('🚀 EQUIPMENT MANAGEMENT SYSTEM — SERVER STARTED');
    console.log('═'.repeat(75));
    console.log(`📡 Entorno:   ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 Servidor:  http://localhost:${PORT}`);
    console.log(`📊 Health:    http://localhost:${PORT}/health`);
    console.log(`📚 API:       http://localhost:${PORT}/api`);
    console.log(`♻️  Recuperos: http://localhost:${PORT}/recoveries`);
    console.log(`📦 Almacén:   http://localhost:${PORT}/almacen`);
    console.log(`🔷 AD:        http://localhost:${PORT}/ad`);
        console.log(`🔷 SOPORTE:        http://localhost:${PORT}/soporte`);
    console.log('═'.repeat(75));
    console.log('✅ Servidor listo\n');
});


// ============================================================================
// MANEJO DE SEÑALES — Cierre limpio del proceso
// ============================================================================
process.on('SIGTERM', () => {
    server.close(() => { console.log('✅ Servidor cerrado (SIGTERM)'); process.exit(0); });
});
process.on('SIGINT', () => {
    server.close(() => { console.log('✅ Servidor cerrado (SIGINT)');  process.exit(0); });
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

module.exports = app;