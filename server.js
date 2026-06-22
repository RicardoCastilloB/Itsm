// ============================================================================
// server.js — Servidor principal
// Equipment Management System
// ============================================================================

const express        = require('express');
const path           = require('path');
const methodOverride = require('method-override');
const http           = require('http');
const https          = require('https');
const fs             = require('fs');
const { Server: SocketIO } = require('socket.io');
require('dotenv').config();

const { initCasbin } = require('./middleware/casbin');
const configureApp   = require('./middleware/app-setup');
const setupErrorHandlers = require('./middleware/error-handler');
const setupBullBoard = require('./config/bull-board');
const logger         = require('./utils/logger');
const { logout }     = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1); // necesario para X-Forwarded-Proto con proxies

// ── SSL: si existen los archivos usa HTTPS, sino HTTP ─────────────────────────
const SSL_KEY  = path.join(__dirname, 'ssl', 'portal.key');
const SSL_CERT = path.join(__dirname, 'ssl', 'portal.crt');
const useHttps = fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT);

const server = useHttps
    ? https.createServer({ key: fs.readFileSync(SSL_KEY), cert: fs.readFileSync(SSL_CERT) }, app)
    : http.createServer(app);

const io = new SocketIO(server, {
    cors: { origin: process.env.ALLOWED_ORIGINS?.split(',') || '*', credentials: true },
});
app.set('io', io);
const PORT = process.env.PORT || (useHttps ? 443 : 3000);

// ============================================================================
// MOTOR DE VISTAS — EJS
// ============================================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('view cache', false);
app.use(express.static(path.join(__dirname, 'public')));
app.use(methodOverride('_method'));

// Middleware para exponer APP_URL a todas las vistas
app.use((req, res, next) => {
    res.locals.APP_URL = process.env.APP_URL;
    next();
});

// ============================================================================
// CONFIGURACIÓN DE MIDDLEWARES Y BULL BOARD
// ============================================================================
setupBullBoard(app);
configureApp(app);

const { tenantMiddleware }  = require('./src/middlewares');
const responseHelper        = require('./src/middlewares/responseHelper');
const requestLogger         = require('./src/middlewares/requestLogger');
const httpMetrics            = require('./src/middlewares/metrics/httpMetrics');
const rateLimitByTenant     = require('./src/middlewares/tenant/rateLimitByTenant');
const envConfig             = require('./config/env');

app.use(tenantMiddleware);
app.use(requestLogger);
app.use(httpMetrics);
app.use(responseHelper);

// Per-tenant rate limit — reads req.tenant set by tenantMiddleware above
if (envConfig.rateLimitEnabled) {
    app.use('/api/', rateLimitByTenant());
}

// ============================================================================
// REGISTRO DE RUTAS
// ============================================================================
const viewsRoutes = require('./routes/views');
const apiRoutes   = require('./routes/api');
const jiraRoutes  = require('./routes/jira');

// Las vistas deben registrarse antes para que capturen rutas específicas
app.use('/', viewsRoutes);
app.use('/api', apiRoutes);

// Admin: feature flags, custom fields y branding por tenant
app.use('/api/admin/tenants', require('./src/modules/tenant/routes'));

// Workflow engine: templates, instancias, aprobaciones
app.use('/api/workflow', require('./src/modules/workflow/routes'));

// IA: clasificación, KB semántica, chatbot ARIA
app.use('/api/ai', require('./src/modules/ai/routes'));

// Utilidades y rutas adicionales montadas en raíz
app.get('/logout', logout);
app.use('/api/events', require('./routes/events'));
app.use('/tickets', jiraRoutes);
app.use('/uploads/tickets', express.static(path.join(__dirname, 'uploads/tickets')));
app.use('/public/reports', express.static(path.join(__dirname, 'public/reports')));

// ── Prometheus metrics scrape endpoint ───────────────────────────────────────
const { registry } = require('./src/core/metrics/MetricsRegistry');

app.get('/metrics', async (req, res) => {
    // Protección opcional: si METRICS_TOKEN está definido, exigirlo
    const token = process.env.METRICS_TOKEN;
    if (token) {
        const auth = req.headers.authorization || '';
        if (auth !== `Bearer ${token}`) {
            return res.status(401).send('Unauthorized');
        }
    }
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
});

// Kubernetes liveness probe — solo verifica que el proceso responde
app.get('/health/live', (req, res) => res.json({ alive: true, ts: new Date().toISOString() }));

// Kubernetes readiness probe — verifica que la app puede atender requests
app.get('/health/ready', async (req, res) => {
    try {
        const { equipmentPool, executeQuery } = require('./config/database');
        await executeQuery(equipmentPool, 'SELECT 1');
        res.json({ ready: true, ts: new Date().toISOString() });
    } catch {
        res.status(503).json({ ready: false, ts: new Date().toISOString() });
    }
});

app.get('/health', async (req, res) => {
    const checks = { db: 'ok' };
    let healthy   = true;

    // DB check
    try {
        const { equipmentPool, executeQuery } = require('./config/database');
        await executeQuery(equipmentPool, 'SELECT 1');
    } catch {
        checks.db = 'error';
        healthy   = false;
    }

    res.status(healthy ? 200 : 503).json({
        status:      healthy ? 'OK' : 'DEGRADED',
        timestamp:   new Date().toISOString(),
        uptime:      Math.round(process.uptime()),
        environment: process.env.NODE_ENV || 'development',
        checks,
    });
});

// ============================================================================
// MANEJO DE ERRORES — SIEMPRE AL FINAL
// ============================================================================
setupErrorHandlers(app);

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================
// SLA job
require('./src/services/service-management/slaJob');

// Workers de colas
require('./src/queues/emailWorker');
require('./src/queues/slaWorker');
require('./src/queues/reportsWorker');

// Event Bus — registrar listeners antes de los jobs
const { registerListeners } = require('./src/core/events');
registerListeners();

// Jobs programados
const { startJobs } = require('./src/jobs/index');
startJobs();

// Socket.io
io.on('connection', (socket) => {
    socket.on('join', (userId) => {
        if (userId) socket.join(`user:${userId}`);
    });
    // Room para todos los agentes ITSM y para el dashboard TV
    socket.on('joinAgents', () => {
        socket.join('jira:agents');
        socket.join('tv:dashboard');
    });
    socket.on('disconnect', () => {});
});

server.listen(PORT, '0.0.0.0', async () => {
    await initCasbin();
    // Abrir puerto en Windows Firewall para acceso en red
    if (process.platform === 'win32') {
        const { exec } = require('child_process');
        exec(`netsh advfirewall firewall add rule name="ITSM-App-${PORT}" dir=in action=allow protocol=TCP localport=${PORT}`, () => {});
    }
    const proto = useHttps ? 'https' : 'http';
    const appUrl = process.env.APP_URL || `${proto}://localhost:${PORT}`;
    console.log('═'.repeat(75));
    console.log('🚀 EQUIPMENT MANAGEMENT SYSTEM — SERVER STARTED');
    console.log('═'.repeat(75));
    console.log(`📡 Entorno:   ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 Protocolo: ${useHttps ? 'HTTPS (SSL activo)' : 'HTTP'}`);
    console.log(`🌐 Servidor:  ${appUrl}`);
    console.log(`📊 Health:    ${appUrl}/health`);
    console.log(`📚 API:       ${appUrl}/api`);
    if (useHttps) {
        console.log(`🔑 Callback:  ${appUrl}/api/auth/microsoft/callback`);
    }
    console.log('═'.repeat(75));
    logger.info('✅ Servidor listo');
});

// ============================================================================
// MANEJO DE SEÑALES
// ============================================================================
function gracefulShutdown(signal) {
    logger.info(`shutdown_initiated`, { signal });
    server.close(() => {
        logger.info('shutdown_complete', { signal });
        process.exit(0);
    });
    // Force exit if connections don't drain in 10 s
    setTimeout(() => {
        logger.error('shutdown_timeout', { signal });
        process.exit(1);
    }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', { reason: String(reason) });
});
process.on('uncaughtException', (error) => {
    logger.error('uncaught_exception', { message: error.message, stack: error.stack });
    process.exit(1);
});

module.exports = app;