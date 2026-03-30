// ============================================================
// routes/jira.js
// Jira Service Management - Portal 23, RequestType 213
// Dominio: integratelperu.atlassian.net
// ============================================================

const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const multer   = require('multer');
const FormData = require('form-data');
const { equipmentPool, executeQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ── Config ────────────────────────────────────────────────
const JIRA_HOST  = process.env.JIRA_HOST   || 'https://integratelperu.atlassian.net';
const JIRA_EMAIL = process.env.JIRA_EMAIL  || 'rabasurco@stefanini.com';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN;
const SD_ID      = '23';
const RT_ID      = '213';

const auth = { username: JIRA_EMAIL, password: JIRA_TOKEN };

// ── Multer (upload en memoria) ─────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 }
});

// ── Helper Jira API ────────────────────────────────────────
async function jira(method, path, data = null) {
    const res = await axios({
        method,
        url:    `${JIRA_HOST}${path}`,
        auth,
        headers: {
            'Accept':            'application/json',
            'Content-Type':      'application/json',
            'X-ExperimentalApi': 'opt-in',
            'X-Atlassian-Token': 'no-check',
            'User-Agent':        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Origin':            'https://integratelperu.atlassian.net',
            'Referer':           'https://integratelperu.atlassian.net/servicedesk/customer/portal/23',
        },
        data,
        timeout: 15000
    });
    return res.data;
}

// ── Helper MySQL ───────────────────────────────────────────
async function dbQuery(sql, params = []) {
    return executeQuery(equipmentPool, sql, params);
}

// ── Etiquetas legibles ────────────────────────────────────
const IMPACT_LABELS = {
    '618437': 'De 1 a 5 usuarios afectados',
    '618438': 'De 6 a 19 usuarios afectados',
    '618439': 'De 20 a más usuarios afectados'
};
const URGENCY_LABELS = {
    '618440': 'Inconvenientes con formato de aplicación',
    '618441': 'El error no me impide trabajar',
    '618442': 'No puedo trabajar por este error'
};

// ── Etiquetas de componentes/items/tipologías ─────────────
const COMPONENT_LABELS = {
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11277': 'Workplace',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11278': 'Red',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11279': 'Software'
};
const APP_LABELS = {
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11280': 'Equipo Corporativo',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11281': 'Sistema ERP',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11282': 'Correo Corporativo',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11283': 'VPN',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11284': 'Impresora'
};
const TIPOLOGIA_LABELS = {
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11378': 'Almacenamiento - Disco D lleno',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11379': 'Sin acceso al sistema',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11380': 'Pantalla azul / crash',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11381': 'Sin conexión a internet',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11382': 'Problema de impresión',
    'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11383': 'Equipo lento'
};

// ============================================================
// VIEW: GET /tickets
// ============================================================


router.get('/ticket-detail/:key', authenticateToken, async (req, res) => {
    try {
        const data = await jira('GET', 
            `/rest/servicedeskapi/request/${req.params.key}?expand=requestFieldValues`
        );
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error consultando ticket:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            message: error.response?.data?.errorMessage || error.message 
        });
    }
});
router.get('/', authenticateToken, (req, res) => {
    res.render('tickets', { title: 'Tickets de Incidencias' });
});

// ============================================================
// API: GET /api/jira/tickets  — Lee desde MySQL
// ============================================================
router.get('/tickets', authenticateToken, async (req, res) => {
    try {
        const tickets = await dbQuery(
            `SELECT * FROM jira_tickets ORDER BY created_at DESC LIMIT 200`
        );

        const data = tickets.map(t => ({
            key:           t.ticket_key,
            summary:       t.summary,
            status:        t.status,
            reporter:      t.reporter,
            urgency:       t.urgency,
            urgency_level: t.urgency_level,
            impact:        t.impact,
            component:     t.component,
            app_item:      t.app_item,
            tipologia:     t.tipologia,
            created:       t.created_at,
            closed_at:     t.closed_at,
            url:           t.jira_url
        }));

        res.json({ success: true, data });

    } catch (error) {
        console.error('Error listando tickets:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// API: POST /api/jira/attachment — Subir adjunto temporal
// ============================================================
router.post('/attachment', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No se recibió archivo' });
        }

        const fd = new FormData();
        fd.append('file', req.file.buffer, {
            filename:    req.file.originalname,
            contentType: req.file.mimetype
        });

        const uploadRes = await axios.post(
            `${JIRA_HOST}/rest/servicedeskapi/servicedesk/${SD_ID}/attachTemporaryFile`,
            fd,
            {
                auth,
                headers: {
                    ...fd.getHeaders(),
                    'X-Atlassian-Token': 'no-check',
                    'X-ExperimentalApi': 'opt-in',
                    'User-Agent':        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Origin':            'https://integratelperu.atlassian.net',
                    'Referer':           'https://integratelperu.atlassian.net/servicedesk/customer/portal/23',
                },
                timeout: 30000
            }
        );

        const attachmentId = uploadRes.data?.temporaryAttachments?.[0]?.temporaryAttachmentId;
        if (!attachmentId) throw new Error('No se obtuvo el ID del adjunto');

        res.json({ success: true, attachmentId });

    } catch (error) {
        console.error('Error subiendo adjunto:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: error.response?.data?.errorMessage || error.message
        });
    }
});

// ============================================================
// API: POST /api/jira/ticket — Crear ticket en Jira + MySQL
// ============================================================
router.post('/ticket', authenticateToken, async (req, res) => {
    const start = Date.now();
    try {
        const {
            summary, reporter, phone, description,
            component, app, tipologia,
            impact, urgency, attachmentId
        } = req.body;

        if (!summary || !reporter || !phone || !description) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
        }

        const payload = {
            serviceDeskId: SD_ID,
            requestTypeId: RT_ID,
            requestFieldValues: {
                summary,
                description,
customfield_14687: [{ id: component }],
customfield_13274: [{ id: app }],
customfield_13283: [{ id: tipologia }],
                customfield_10246: { id: impact },
                customfield_13269: { id: urgency },
                customfield_11795: phone
            },
            raiseOnBehalfOf: reporter
        };

        if (attachmentId) {
            payload.requestFieldValues.attachment = [attachmentId];
        }

        const result  = await jira('POST', '/rest/servicedeskapi/request', payload);
        const issueKey = result.issueKey;
        const elapsed  = Date.now() - start;

        console.log(`✅ Ticket Jira creado: ${issueKey} en ${elapsed}ms`);

        // Guardar en MySQL
        const urgencyLevel = urgency === '618442' ? 3 : urgency === '618441' ? 2 : 1;
await dbQuery(
    `INSERT INTO jira_tickets
        (ticket_key, summary, reporter, status, urgency, urgency_level,
         impact, component, app_item, tipologia, phone, description, impact_label, jira_url)
     VALUES (?, ?, ?, 'Abierto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
        issueKey,
        summary,
        reporter,
        URGENCY_LABELS[urgency]     || urgency,
        urgencyLevel,
        IMPACT_LABELS[impact]       || impact,
        COMPONENT_LABELS[component] || component,
        APP_LABELS[app]             || app,
        TIPOLOGIA_LABELS[tipologia] || tipologia,
        phone,
        description,
        IMPACT_LABELS[impact]       || impact,
        `${JIRA_HOST}/browse/${issueKey}`
    ]
);

        res.status(201).json({
            success: true,
            message: `Ticket ${issueKey} creado exitosamente`,
            data: {
                key:       issueKey,
                url:       `${JIRA_HOST}/browse/${issueKey}`,
                elapsedMs: elapsed
            }
        });

    } catch (error) {
        console.error('❌ Error creando ticket:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: error.response?.data?.errorMessage || error.message,
            details: error.response?.data
        });
    }
});

// ============================================================
// API: POST /api/jira/ticket/:key/close — Cerrar ticket
// ============================================================
router.get('/ticket-portal/:key', authenticateToken, async (req, res) => {
    try {
        const data = await jira('GET',
            `/rest/servicedeskapi/request/${req.params.key}?expand=requestFieldValues,participant,status`
        );
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error:', error.response?.status, error.response?.data?.errorMessage || error.message);
        res.status(500).json({
            success: false,
            message: error.response?.data?.errorMessage || error.message
        });
    }
});

router.get('/transitions/:key', authenticateToken, async (req, res) => {
    try {
        const data = await jira('GET', `/rest/api/3/issue/${req.params.key}/transitions`);
        res.json({ success: true, data: data.transitions.map(t => ({ id: t.id, name: t.name })) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.response?.data || error.message });
    }
});
router.post('/ticket/:key/close', authenticateToken, async (req, res) => {
    const { key }     = req.params;
    const { comment } = req.body;

    let jiraClosed = false;
    let jiraError  = null;

    // Usar servicedeskapi que SÍ funciona desde Node
try {
    // Intentar con transition del portal primero
    const transRes = await jira('POST', 
        `/rest/servicedeskapi/request/${key}/transition`,
        { id: 3 }  // probar transitionId 3
    );
    jiraClosed = true;
} catch (err1) {
    try {
        // Intentar transitionId 2
        await jira('POST',
            `/rest/servicedeskapi/request/${key}/transition`,
            { id: 2 }
        );
        jiraClosed = true;
    } catch (err2) {
        jiraError = err2.response?.data?.errorMessage || err2.message;
        console.log('JIRA FULL ERROR:', JSON.stringify(err2.response?.data, null, 2));
    }
}
    // Siempre actualizar MySQL
    try {
        await dbQuery(
            `UPDATE jira_tickets
             SET status = 'Resuelto', closed_at = NOW(),
                 closed_by = ?, close_comment = ?
             WHERE ticket_key = ?`,
            [req.user?.username || 'sistema', comment || null, key]
        );
    } catch (dbErr) {
        return res.status(500).json({ success: false, message: 'Error actualizando base de datos' });
    }

    res.json({
        success:    true,
        jiraClosed,
        message:    jiraClosed
            ? `✅ Ticket ${key} resuelto en Jira y sistema local`
            : `⚠️ Cerrado localmente. Jira: ${jiraError}`,
        data: { key, url: `${JIRA_HOST}/browse/${key}` }
    });
});

// ============================================================
// API: GET /api/jira/ticket/:key
// ============================================================
router.get('/ticket/:key', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(
            `SELECT * FROM jira_tickets WHERE ticket_key = ?`,
            [req.params.key]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
        }
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// NUEVAS RUTAS — Agregar a routes/jira.js
// Funcionalidades: Cola de tickets, filtro por assignee,
// tickets sin asignar, asignación desde la app
// ============================================================

// ── Labels helper (ya existe en tu archivo, no duplicar) ──

// ============================================================
// API: GET /api/jira/queue/unassigned
// Tickets sin asignar del proyecto INC
// ============================================================
router.get('/queue/unassigned', authenticateToken, async (req, res) => {
    try {
        const jql = encodeURIComponent(
            'project = INC AND assignee is EMPTY AND statusCategory != Done ORDER BY created DESC'
        );
        const data = await jira('GET',
            `/rest/api/3/search?jql=${jql}&maxResults=50&fields=summary,status,priority,created,reporter,assignee,customfield_10246,customfield_13269`
        );

        const issues = (data.issues || []).map(issue => ({
            key:      issue.key,
            summary:  issue.fields.summary,
            status:   issue.fields.status?.name,
            priority: issue.fields.priority?.name,
            reporter: issue.fields.reporter?.emailAddress || issue.fields.reporter?.displayName,
            assignee: issue.fields.assignee?.displayName || null,
            created:  issue.fields.created,
            url:      `${JIRA_HOST}/browse/${issue.key}`
        }));

        res.json({ success: true, data: issues, total: data.total });

    } catch (error) {
        console.error('Error obteniendo cola sin asignar:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.response?.data?.errorMessage || error.message });
    }
});

// ============================================================
// API: GET /api/jira/queue/assigned?email=xxx@yyy.com
// Tickets asignados a un usuario específico (por email)
// ============================================================
router.get('/queue/assigned', authenticateToken, async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ success: false, message: 'Falta parámetro email' });

        const jql = encodeURIComponent(
            `project = INC AND assignee = "${email}" AND statusCategory != Done ORDER BY created DESC`
        );
        const data = await jira('GET',
            `/rest/api/3/search?jql=${jql}&maxResults=50&fields=summary,status,priority,created,reporter,assignee`
        );

        const issues = (data.issues || []).map(issue => ({
            key:      issue.key,
            summary:  issue.fields.summary,
            status:   issue.fields.status?.name,
            priority: issue.fields.priority?.name,
            reporter: issue.fields.reporter?.emailAddress || issue.fields.reporter?.displayName,
            assignee: issue.fields.assignee?.displayName || null,
            created:  issue.fields.created,
            url:      `${JIRA_HOST}/browse/${issue.key}`
        }));

        res.json({ success: true, data: issues, total: data.total, email });

    } catch (error) {
        console.error('Error obteniendo tickets asignados:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.response?.data?.errorMessage || error.message });
    }
});

// ============================================================
// API: GET /api/jira/agents
// Lista de agentes del Service Desk (para el dropdown de asignación)
// ============================================================
router.get('/agents', authenticateToken, async (req, res) => {
    try {
        const data = await jira('GET',
            `/rest/servicedeskapi/servicedesk/${SD_ID}/agent?limit=100`
        );

        const agents = (data.values || []).map(a => ({
            accountId:   a.accountId,
            displayName: a.displayName,
            email:       a.emailAddress
        }));

        res.json({ success: true, data: agents });

    } catch (error) {
        console.error('Error obteniendo agentes:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.response?.data?.errorMessage || error.message });
    }
});

// ============================================================
// API: PUT /api/jira/ticket/:key/assign
// Asignar ticket a un agente
// Body: { accountId: "..." }  — para asignarse a sí mismo puede
// enviarse { accountId: null } para quitar asignación, o
// { selfAssign: true } para asignarse con el token configurado
// ============================================================
router.put('/ticket/:key/assign', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { accountId, selfAssign } = req.body;

    try {
        let resolvedAccountId = accountId;

        // Si selfAssign=true, obtenemos el accountId del usuario autenticado en Jira
        if (selfAssign) {
            const me = await jira('GET', '/rest/api/3/myself');
            resolvedAccountId = me.accountId;
        }

        await jira('PUT', `/rest/api/3/issue/${key}/assignee`, {
            accountId: resolvedAccountId || null
        });

        // Actualizar assignee en MySQL si existe el ticket localmente
        try {
            if (resolvedAccountId) {
                // Obtener nombre del agente para guardar en DB
                const issueData = await jira('GET', `/rest/api/3/issue/${key}?fields=assignee`);
                const assigneeName = issueData.fields?.assignee?.displayName || resolvedAccountId;
                await dbQuery(
                    `UPDATE jira_tickets SET assignee = ? WHERE ticket_key = ?`,
                    [assigneeName, key]
                );
            } else {
                await dbQuery(
                    `UPDATE jira_tickets SET assignee = NULL WHERE ticket_key = ?`,
                    [key]
                );
            }
        } catch (_) { /* DB update opcional, no falla el request */ }

        res.json({
            success: true,
            message: resolvedAccountId
                ? `✅ Ticket ${key} asignado correctamente`
                : `✅ Asignación removida de ${key}`,
            data: { key, accountId: resolvedAccountId }
        });

    } catch (error) {
        console.error('Error asignando ticket:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.response?.data?.errorMessage || error.message });
    }
});

// ============================================================
// API: GET /api/jira/ticket/:key/detail
// Detalle completo de un ticket desde Jira (no solo DB local)
// Incluye assignee actual
// ============================================================
router.get('/ticket/:key/jira-detail', authenticateToken, async (req, res) => {
    try {
        const data = await jira('GET',
            `/rest/api/3/issue/${req.params.key}?fields=summary,status,priority,assignee,reporter,created,description,comment`
        );

        res.json({
            success: true,
            data: {
                key:        data.key,
                summary:    data.fields.summary,
                status:     data.fields.status?.name,
                priority:   data.fields.priority?.name,
                assignee:   data.fields.assignee ? {
                    accountId:   data.fields.assignee.accountId,
                    displayName: data.fields.assignee.displayName,
                    email:       data.fields.assignee.emailAddress
                } : null,
                reporter:   data.fields.reporter?.emailAddress || data.fields.reporter?.displayName,
                created:    data.fields.created,
                url:        `${JIRA_HOST}/browse/${data.key}`
            }
        });

    } catch (error) {
        console.error('Error obteniendo detalle Jira:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.response?.data?.errorMessage || error.message });
    }
});


// ============================================================
// NOTA: También debes agregar la columna `assignee` a tu tabla
// MySQL si aún no existe:
//
// ALTER TABLE jira_tickets ADD COLUMN assignee VARCHAR(200) NULL;
//
// ============================================================


module.exports = router;
