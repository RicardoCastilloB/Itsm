// ============================================================================
// routes/licenses.js — Portal de Licenciamiento M365
// DB-backed cache + Background sync + Cost analytics + Recommendations
// ============================================================================

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { authenticateToken } = require('../middleware/auth');
const { equipmentPool, executeQuery } = require('../config/database');

// ── DB helper ─────────────────────────────────────────────────────────────────
// Sequelize QueryTypes.RAW rechaza undefined — convertir a null
function safeParams(arr) {
    return arr.map(v => (v === undefined ? null : v));
}
async function dbQuery(sql, params = []) {
    return executeQuery(equipmentPool, sql, safeParams(params));
}

// ── MSAL ─────────────────────────────────────────────────────────────────────
const msalClient = new ConfidentialClientApplication({
    auth: {
        clientId:     process.env.MS_CLIENT_ID,
        authority:    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
        clientSecret: process.env.MS_CLIENT_SECRET,
    }
});
let _tokenCache = { token: null, exp: 0 };
async function getToken() {
    if (_tokenCache.token && Date.now() < _tokenCache.exp - 60000) return _tokenCache.token;
    const r = await msalClient.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
    _tokenCache = { token: r.accessToken, exp: r.expiresOn?.getTime() || (Date.now() + 3600000) };
    return _tokenCache.token;
}

// ── Graph fetch (axios) ───────────────────────────────────────────────────────
async function graph(path, token, raw = false) {
    const res = await axios.get(`https://graph.microsoft.com/v1.0${path}`, {
        headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
        responseType: raw ? 'text' : 'json',
        timeout: 60000,
    });
    return res.data;
}

// ── CSV parser (Graph reports) ────────────────────────────────────────────────
function parseCsv(text) {
    const clean = (text || '').replace(/^\uFEFF/, '');
    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    return lines.slice(1).map(line => {
        const vals = []; let cur = '', inQ = false;
        for (const ch of line) {
            if (ch === '"') { inQ = !inQ; }
            else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
            else cur += ch;
        }
        vals.push(cur.trim());
        return Object.fromEntries(headers.map((h, i) => [h, (vals[i] || '').replace(/"/g, '')]));
    });
}

// ── Grupo → SKU mapping (para calcular costos) ────────────────────────────────
const GROUP_TO_SKU = {
    'M365 E1':            'STANDARDPACK',
    'M365 E3':            'ENTERPRISEPACK',
    'M365 E5':            'SPE_E5',
    'Power BI Pro':       'POWER_BI_PRO',
    'Power BI Premium':   'PBI_PREMIUM_PER_USER',
    'Visio P2':           'VISIOONLINE_PLAN2',
    'Project P3':         'PROJECTPREMIUM',
    'Power Apps Premium': 'POWERAPPS_PER_USER',
    'Power Automate':     'FLOW_PER_USER',
    'M365 EOP1':          'EOP_ENTERPRISE_PREMIUM_P1',
};

// ── Grupos monitoreados ───────────────────────────────────────────────────────
const LICENSE_GROUPS = [
    { name: 'ITG_Licencias_M365_E1',                 label: 'M365 E1',            color: '#3b82f6', icon: 'bi-microsoft' },
    { name: 'ITG_Licencias_M365_E3',                 label: 'M365 E3',            color: '#0052CC', icon: 'bi-microsoft' },
    { name: 'ITG_Licencias_M365_E5',                 label: 'M365 E5',            color: '#172B4D', icon: 'bi-microsoft' },
    { name: 'ITG_Licencias_PowerBIPro',              label: 'Power BI Pro',       color: '#F2C811', icon: 'bi-bar-chart-fill' },
    { name: 'ITG_Licencias_PowerBIPremium',          label: 'Power BI Premium',   color: '#e0a800', icon: 'bi-bar-chart-fill' },
    { name: 'ITG_Licencias_VisioP2',                 label: 'Visio P2',           color: '#106ebe', icon: 'bi-diagram-3-fill' },
    { name: 'ITG_Licencias_ProjectP3',               label: 'Project P3',         color: '#31752f', icon: 'bi-kanban-fill' },
    { name: 'ITG_Licencias_PowerAppsPremiumPerUser', label: 'Power Apps Premium', color: '#742774', icon: 'bi-lightning-fill' },
    { name: 'ITG_Licencias_PowerAutomatePerUser',    label: 'Power Automate',     color: '#0066FF', icon: 'bi-arrow-repeat' },
    { name: 'ITG_Licencias_M365_EOP1',               label: 'M365 EOP1',          color: '#5c2d91', icon: 'bi-shield-fill' },
];

// ── Sync state (in-memory) ───────────────────────────────────────────────────
const _sync = { running: false, progress: 0, message: '', error: null, lastRun: null, usersCount: 0 };

// ── DB Migration (startup) ────────────────────────────────────────────────────
(async () => {
    try {
        await dbQuery(`CREATE TABLE IF NOT EXISTS m365_license_costs (
            sku_name    VARCHAR(200) NOT NULL PRIMARY KEY,
            label       VARCHAR(200),
            cost_per_user DECIMAL(10,2) DEFAULT 0.00,
            currency    VARCHAR(10)  DEFAULT 'USD',
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS m365_license_snapshots (
            id           INT PRIMARY KEY AUTO_INCREMENT,
            snapshot_date DATE NOT NULL,
            sku_name     VARCHAR(200),
            sku_id       VARCHAR(100),
            label        VARCHAR(200),
            total        INT DEFAULT 0,
            consumed     INT DEFAULT 0,
            available    INT DEFAULT 0,
            cost_per_user DECIMAL(10,2) DEFAULT 0,
            cost_monthly  DECIMAL(12,2) DEFAULT 0,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_date (snapshot_date),
            INDEX idx_sku (sku_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS m365_user_licenses (
            id              INT PRIMARY KEY AUTO_INCREMENT,
            graph_id        VARCHAR(100),
            upn             VARCHAR(255) NOT NULL,
            display_name    VARCHAR(255),
            email           VARCHAR(255),
            department      VARCHAR(255),
            job_title       VARCHAR(255),
            account_enabled TINYINT(1) DEFAULT 1,
            license_groups  JSON,
            last_activity_date DATE,
            days_inactive   INT,
            activo_30d      TINYINT(1) DEFAULT 0,
            activo_60d      TINYINT(1) DEFAULT 0,
            activo_90d      TINYINT(1) DEFAULT 0,
            activity_status VARCHAR(30),
            synced_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uk_upn (upn),
            INDEX idx_dept   (department),
            INDEX idx_status (activity_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        await dbQuery(`CREATE TABLE IF NOT EXISTS m365_sync_log (
            id          INT PRIMARY KEY AUTO_INCREMENT,
            started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            finished_at DATETIME,
            status      VARCHAR(20) DEFAULT 'running',
            users_synced INT DEFAULT 0,
            error_message TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        // Seed default costs (INSERT IGNORE = no overwrite user edits)
        const defaultCosts = [
            ['STANDARDPACK',            'M365 E1',            10.00],
            ['ENTERPRISEPACK',          'M365 E3',            36.00],
            ['SPE_E5',                  'M365 E5',            57.00],
            ['POWER_BI_PRO',            'Power BI Pro',       10.00],
            ['PBI_PREMIUM_PER_USER',    'Power BI Premium',   20.00],
            ['VISIOONLINE_PLAN2',       'Visio P2',           28.00],
            ['PROJECTPREMIUM',          'Project P3',         55.00],
            ['POWERAPPS_PER_USER',      'Power Apps Premium', 20.00],
            ['FLOW_PER_USER',           'Power Automate',     15.00],
            ['EOP_ENTERPRISE_PREMIUM_P1','M365 EOP1',          1.00],
        ];
        for (const [sku, label, cost] of defaultCosts) {
            await dbQuery(`INSERT IGNORE INTO m365_license_costs (sku_name, label, cost_per_user) VALUES (?,?,?)`, [sku, label, cost]);
        }
        // Add direccion column if not exists (ALTER is safe to fail on dup)
        try {
            await dbQuery(`ALTER TABLE m365_user_licenses ADD COLUMN direccion VARCHAR(255) DEFAULT NULL`);
            await dbQuery(`ALTER TABLE m365_user_licenses ADD INDEX idx_dir (direccion)`);
        } catch (_) { /* ya existe */ }

        console.log('✅ [licenses] DB tables ready');
    } catch (e) { console.error('⚠️ [licenses] DB migration:', e.message); }
})();

// ── Background sync job ───────────────────────────────────────────────────────
async function runSync() {
    if (_sync.running) return;
    Object.assign(_sync, { running: true, progress: 2, message: 'Iniciando...', error: null });

    let logId = null;
    try {
        const log = await dbQuery(`INSERT INTO m365_sync_log (started_at, status) VALUES (NOW(),'running')`);
        logId = log.insertId;

        // 1. Token
        _sync.message = 'Obteniendo token Azure...'; _sync.progress = 5;
        const token = await getToken();

        // 2. Activity reports (30/60/90d)
        _sync.message = 'Descargando reportes de actividad M365...'; _sync.progress = 10;
        const actData = {};
        for (const dias of [30, 60, 90]) {
            try {
                const csv = await graph(`/reports/getM365AppUserDetail(period='D${dias}')`, token, true);
                actData[dias] = parseCsv(csv);
            } catch {
                try {
                    const csv = await graph(`/reports/getOffice365ActiveUserDetail(period='D${dias}')`, token, true);
                    actData[dias] = parseCsv(csv);
                } catch { actData[dias] = []; }
            }
            _sync.progress = 10 + dias / 3; // 10→40
        }

        // Build activity index: UPN → row
        const actIdx = {};
        for (const dias of [30, 60, 90]) {
            for (const row of (actData[dias] || [])) {
                const upn = (row['User Principal Name'] || row['UPN'] || '').toLowerCase();
                if (!upn) continue;
                if (!actIdx[upn]) actIdx[upn] = {};
                actIdx[upn][dias] = row;
            }
        }

        // 3. Group members
        _sync.message = 'Obteniendo miembros de grupos...'; _sync.progress = 42;
        const userMap = new Map(); // upn → userData

        for (let i = 0; i < LICENSE_GROUPS.length; i++) {
            const grp = LICENSE_GROUPS[i];
            _sync.progress = 42 + Math.round((i / LICENSE_GROUPS.length) * 30);
            _sync.message = `Grupo ${i + 1}/${LICENSE_GROUPS.length}: ${grp.label}`;
            try {
                const search = await graph(`/groups?$filter=displayName eq '${encodeURIComponent(grp.name)}'&$select=id`, token);
                const group = search.value?.[0];
                if (!group) continue;

                let url = `/groups/${group.id}/members?$select=id,displayName,mail,userPrincipalName,department,jobTitle,accountEnabled,onPremisesExtensionAttributes&$top=999`;
                while (url) {
                    const resp = await graph(url, token);
                    for (const m of (resp.value || [])) {
                        if (!m.userPrincipalName || !m.id) continue; // skip non-user objects
                        const key = m.userPrincipalName.toLowerCase();
                        if (!userMap.has(key)) {
                            userMap.set(key, {
                                graph_id: m.id || null,
                                upn: m.userPrincipalName,
                                display_name: m.displayName || null,
                                email: m.mail || null,
                                department: m.department || null,
                                job_title: m.jobTitle || null,
                                account_enabled: m.accountEnabled ? 1 : 0,
                                groups: [],
                                direccion: m.onPremisesExtensionAttributes?.extensionAttribute12 || null,
                            });
                        }
                        userMap.get(key).groups.push(grp.label);
                    }
                    url = resp['@odata.nextLink'] ? resp['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '') : null;
                }
            } catch { /* group not found */ }
        }

        // 4. Process & upsert users
        _sync.message = 'Procesando actividad de usuarios...'; _sync.progress = 75;
        const hoy = new Date();
        let usersSynced = 0;

        const findAct = (upn) => {
            const key = upn.toLowerCase();
            return { r30: actIdx[key]?.[30], r60: actIdx[key]?.[60], r90: actIdx[key]?.[90] };
        };

        for (const [, u] of userMap) {
            const { r30, r60, r90 } = findAct(u.upn);
            const row = r90 || r60 || r30;
            const actCol = row ? Object.keys(row).find(k => /last.?activity/i.test(k)) : null;
            const lastAct = (row && actCol && row[actCol] && row[actCol] !== '') ? row[actCol] : null;
            let daysInactive = null;
            if (lastAct) {
                try { daysInactive = Math.floor((hoy - new Date(lastAct)) / 86400000); } catch {}
            }
            const a30 = !!r30 ? 1 : 0, a60 = !!r60 ? 1 : 0, a90 = !!r90 ? 1 : 0;
            const status = a30 ? 'ACTIVO' : a60 ? 'BAJO USO' : a90 ? 'INACTIVO' : 'SIN USO';

            await dbQuery(`
                INSERT INTO m365_user_licenses
                    (graph_id,upn,display_name,email,department,job_title,account_enabled,direccion,
                     license_groups,last_activity_date,days_inactive,activo_30d,activo_60d,activo_90d,activity_status,synced_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
                ON DUPLICATE KEY UPDATE
                    display_name=VALUES(display_name), email=VALUES(email),
                    department=VALUES(department), job_title=VALUES(job_title),
                    account_enabled=VALUES(account_enabled), direccion=VALUES(direccion),
                    license_groups=VALUES(license_groups),
                    last_activity_date=VALUES(last_activity_date), days_inactive=VALUES(days_inactive),
                    activo_30d=VALUES(activo_30d), activo_60d=VALUES(activo_60d),
                    activo_90d=VALUES(activo_90d), activity_status=VALUES(activity_status),
                    synced_at=NOW()
            `, [
                u.graph_id, u.upn, u.display_name, u.email,
                u.department, u.job_title, u.account_enabled, u.direccion,
                JSON.stringify(u.groups),
                lastAct ? lastAct.split('T')[0] : null,
                daysInactive, a30, a60, a90, status
            ]);
            usersSynced++;
        }

        // 5. SKU snapshot
        _sync.message = 'Creando snapshot de SKUs...'; _sync.progress = 90;
        const today = hoy.toISOString().split('T')[0];
        const skuData = await graph('/subscribedSkus', token);
        const costs = await dbQuery(`SELECT sku_name, cost_per_user FROM m365_license_costs`);
        const costMap = Object.fromEntries(costs.map(c => [c.sku_name, parseFloat(c.cost_per_user) || 0]));

        await dbQuery(`DELETE FROM m365_license_snapshots WHERE snapshot_date = ?`, [today]);
        for (const sku of (skuData.value || [])) {
            const cost = costMap[sku.skuPartNumber] || 0;
            const consumed = sku.consumedUnits || 0;
            // Ensure new SKUs get added to cost config
            await dbQuery(`INSERT IGNORE INTO m365_license_costs (sku_name, label, cost_per_user) VALUES (?,?,0)`, [sku.skuPartNumber, sku.skuPartNumber]);
            await dbQuery(`
                INSERT INTO m365_license_snapshots
                    (snapshot_date,sku_name,sku_id,label,total,consumed,available,cost_per_user,cost_monthly)
                VALUES (?,?,?,?,?,?,?,?,?)
            `, [today, sku.skuPartNumber, sku.skuId, sku.skuPartNumber,
                sku.prepaidUnits?.enabled || 0, consumed,
                (sku.prepaidUnits?.enabled || 0) - consumed,
                cost, +(cost * consumed).toFixed(2)]);
        }

        await dbQuery(`UPDATE m365_sync_log SET finished_at=NOW(),status='completed',users_synced=? WHERE id=?`, [usersSynced, logId]);
        Object.assign(_sync, { running: false, progress: 100, message: `Completado: ${usersSynced} usuarios sincronizados`, usersCount: usersSynced, lastRun: new Date().toISOString() });

    } catch (e) {
        if (logId) await dbQuery(`UPDATE m365_sync_log SET finished_at=NOW(),status='failed',error_message=? WHERE id=?`, [e.message, logId]).catch(() => {});
        Object.assign(_sync, { running: false, progress: 0, message: e.message, error: e.message });
        console.error('[licenses] Sync error:', e.message);
    }
}

// ── In-memory cache for SharePoint (Graph-direct) ────────────────────────────
const _spCache = { data: null, ts: 0 };

// ============================================================
// POST /api/licenses/sync — Iniciar sync en background
// ============================================================
router.post('/sync', authenticateToken, (req, res) => {
    if (_sync.running) return res.json({ success: false, message: 'Sync ya en progreso', ..._sync });
    res.json({ success: true, message: 'Sync iniciado en background' });
    setImmediate(runSync);
});

// GET /api/licenses/sync-status
router.get('/sync-status', authenticateToken, async (req, res) => {
    const lastLog = await dbQuery(`SELECT * FROM m365_sync_log ORDER BY id DESC LIMIT 1`).catch(() => []);
    res.json({ success: true, sync: _sync, lastLog: lastLog[0] || null });
});

// ============================================================
// GET /api/licenses/overview — Costos desde DB snapshot
// ============================================================
router.get('/overview', authenticateToken, async (req, res) => {
    try {
        const snaps = await dbQuery(`
            SELECT s.sku_name, s.label, s.total, s.consumed, s.available,
                   c.cost_per_user, (s.consumed * COALESCE(c.cost_per_user,0)) AS cost_monthly
            FROM m365_license_snapshots s
            LEFT JOIN m365_license_costs c ON c.sku_name = s.sku_name
            WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM m365_license_snapshots)
        `);

        const costMap = Object.fromEntries(
            (await dbQuery(`SELECT sku_name, cost_per_user FROM m365_license_costs`)).map(c => [c.sku_name, parseFloat(c.cost_per_user) || 0])
        );

        // Count inactive users from DB
        const [inactive] = await dbQuery(`SELECT COUNT(*) AS cnt FROM m365_user_licenses WHERE activity_status IN ('SIN USO','INACTIVO') AND account_enabled=1`);
        const [total] = await dbQuery(`SELECT COUNT(*) AS cnt FROM m365_user_licenses WHERE account_enabled=1`);
        const lastSync = await dbQuery(`SELECT MAX(synced_at) AS t FROM m365_user_licenses`);

        // Calculate savings potential: inactive users cost per group
        const inactiveUsers = await dbQuery(`SELECT license_groups FROM m365_user_licenses WHERE activity_status IN ('SIN USO','INACTIVO') AND account_enabled=1`);
        let savingsPotential = 0;
        for (const u of inactiveUsers) {
            const groups = JSON.parse(u.license_groups || '[]');
            for (const grp of groups) {
                const sku = GROUP_TO_SKU[grp];
                savingsPotential += sku ? (costMap[sku] || 0) : 0;
            }
        }

        const totalMonthly = snaps.reduce((a, s) => a + (parseFloat(s.cost_monthly) || 0), 0);
        const totalConsumed  = snaps.reduce((a, s) => a + (s.consumed || 0), 0);
        const totalAvailable = snaps.reduce((a, s) => a + (s.available || 0), 0);
        const activeCount = (total?.cnt || 0) - (inactive?.cnt || 0);
        const costPerActive = activeCount > 0 ? +(totalMonthly / activeCount).toFixed(2) : 0;

        res.json({
            success: true, data: {
                skus: snaps, totalMonthly: +totalMonthly.toFixed(2),
                totalConsumed, totalAvailable,
                savingsPotential: +savingsPotential.toFixed(2),
                inactiveUsers: inactive?.cnt || 0,
                totalUsers: total?.cnt || 0, activeCount, costPerActive,
                lastSync: lastSync[0]?.t || null,
            }
        });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// GET /api/licenses/users — Lista usuarios con filtros
// ============================================================
router.get('/users', authenticateToken, async (req, res) => {
    try {
        const { dept, dir, group, status, q, inactive, page = 1, limit = 60 } = req.query;
        const conditions = ['1=1'];
        const params = [];

        if (dept)   { conditions.push('department = ?'); params.push(dept); }
        if (dir) {
            if (dir === 'Sin dirección') conditions.push('(direccion IS NULL OR direccion = "")');
            else { conditions.push('direccion = ?'); params.push(dir); }
        }
        if (status) { conditions.push('activity_status = ?'); params.push(status); }
        if (q)      { conditions.push('(display_name LIKE ? OR email LIKE ? OR upn LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
        if (inactive === '30') { conditions.push('(days_inactive > 30 OR days_inactive IS NULL)'); }
        if (inactive === '60') { conditions.push('(days_inactive > 60 OR days_inactive IS NULL)'); }
        if (inactive === '90') { conditions.push('(days_inactive > 90 OR days_inactive IS NULL)'); }

        const where = conditions.join(' AND ');
        const [{ total }] = await dbQuery(`SELECT COUNT(*) AS total FROM m365_user_licenses WHERE ${where}`, params);

        const offset = (parseInt(page) - 1) * parseInt(limit);
        let rows = await dbQuery(
            `SELECT graph_id,upn,display_name,email,department,direccion,job_title,account_enabled,
                    license_groups,last_activity_date,days_inactive,activo_30d,activo_60d,activo_90d,
                    activity_status,synced_at
             FROM m365_user_licenses WHERE ${where}
             ORDER BY FIELD(activity_status,'SIN USO','INACTIVO','BAJO USO','ACTIVO'), days_inactive DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        // Filter by group (JSON field) in JS
        if (group) {
            rows = rows.filter(r => {
                try { return JSON.parse(r.license_groups || '[]').includes(group); } catch { return false; }
            });
        }

        rows = rows.map(r => ({ ...r, license_groups: JSON.parse(r.license_groups || '[]') }));

        res.json({ success: true, data: rows, total: parseInt(total), page: parseInt(page), pages: Math.ceil(total / limit) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// GET /api/licenses/departments — Análisis por área
// ============================================================
router.get('/departments', authenticateToken, async (req, res) => {
    try {
        const costMap = Object.fromEntries(
            (await dbQuery(`SELECT sku_name, cost_per_user FROM m365_license_costs`)).map(c => [c.sku_name, parseFloat(c.cost_per_user) || 0])
        );

        const depts = await dbQuery(`
            SELECT COALESCE(department,'Sin departamento') AS dept,
                   COUNT(*) AS total,
                   SUM(CASE WHEN activity_status='ACTIVO'   THEN 1 ELSE 0 END) AS activos,
                   SUM(CASE WHEN activity_status='BAJO USO' THEN 1 ELSE 0 END) AS bajo_uso,
                   SUM(CASE WHEN activity_status='INACTIVO' THEN 1 ELSE 0 END) AS inactivos,
                   SUM(CASE WHEN activity_status='SIN USO'  THEN 1 ELSE 0 END) AS sin_uso,
                   COUNT(CASE WHEN account_enabled=1 THEN 1 END) AS habilitados
            FROM m365_user_licenses
            GROUP BY dept ORDER BY total DESC
        `);

        // Add cost per dept (rough: sum costs from groups for each user in dept)
        const usersByDept = await dbQuery(`SELECT department, license_groups FROM m365_user_licenses WHERE account_enabled=1`);
        const deptCostMap = {};
        for (const u of usersByDept) {
            const dept = u.department || 'Sin departamento';
            const groups = JSON.parse(u.license_groups || '[]');
            let cost = 0;
            for (const grp of groups) { cost += costMap[GROUP_TO_SKU[grp]] || 0; }
            deptCostMap[dept] = (deptCostMap[dept] || 0) + cost;
        }

        const result = depts.map(d => ({
            ...d,
            total: parseInt(d.total), activos: parseInt(d.activos), bajo_uso: parseInt(d.bajo_uso),
            inactivos: parseInt(d.inactivos), sin_uso: parseInt(d.sin_uso),
            uso_pct: d.total > 0 ? Math.round(parseInt(d.activos) / parseInt(d.total) * 100) : 0,
            cost_monthly: +(deptCostMap[d.dept] || 0).toFixed(2),
        }));

        res.json({ success: true, data: result });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// GET /api/licenses/direcciones — Análisis por Dirección
// ============================================================
router.get('/direcciones', authenticateToken, async (req, res) => {
    try {
        const costMap = Object.fromEntries(
            (await dbQuery(`SELECT sku_name, cost_per_user FROM m365_license_costs`)).map(c => [c.sku_name, parseFloat(c.cost_per_user) || 0])
        );
        const rows = await dbQuery(`
            SELECT COALESCE(NULLIF(TRIM(direccion),''),'Sin dirección') AS dir,
                   COUNT(*) AS total,
                   SUM(CASE WHEN activity_status='ACTIVO'   THEN 1 ELSE 0 END) AS activos,
                   SUM(CASE WHEN activity_status='BAJO USO' THEN 1 ELSE 0 END) AS bajo_uso,
                   SUM(CASE WHEN activity_status='INACTIVO' THEN 1 ELSE 0 END) AS inactivos,
                   SUM(CASE WHEN activity_status='SIN USO'  THEN 1 ELSE 0 END) AS sin_uso,
                   COUNT(DISTINCT COALESCE(NULLIF(TRIM(department),''),'Sin área')) AS areas_count
            FROM m365_user_licenses WHERE account_enabled=1
            GROUP BY dir ORDER BY total DESC
        `);
        const usersByDir = await dbQuery(`SELECT COALESCE(NULLIF(TRIM(direccion),''),'Sin dirección') AS dir, license_groups FROM m365_user_licenses WHERE account_enabled=1`);
        const dirCostMap = {};
        for (const u of usersByDir) {
            const groups = JSON.parse(u.license_groups || '[]');
            let cost = 0;
            for (const grp of groups) cost += costMap[GROUP_TO_SKU[grp]] || 0;
            dirCostMap[u.dir] = (dirCostMap[u.dir] || 0) + cost;
        }
        const result = rows.map(d => ({
            dir: d.dir,
            total: parseInt(d.total), activos: parseInt(d.activos),
            bajo_uso: parseInt(d.bajo_uso), inactivos: parseInt(d.inactivos),
            sin_uso: parseInt(d.sin_uso), areas_count: parseInt(d.areas_count),
            uso_pct: parseInt(d.total) > 0 ? Math.round(parseInt(d.activos) / parseInt(d.total) * 100) : 0,
            cost_monthly: +(dirCostMap[d.dir] || 0).toFixed(2),
        }));
        res.json({ success: true, data: result });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// GET /api/licenses/direccion-areas?dir=xxx — Áreas dentro de Dirección
// ============================================================
router.get('/direccion-areas', authenticateToken, async (req, res) => {
    try {
        const { dir } = req.query;
        const costMap = Object.fromEntries(
            (await dbQuery(`SELECT sku_name, cost_per_user FROM m365_license_costs`)).map(c => [c.sku_name, parseFloat(c.cost_per_user) || 0])
        );
        const isSin = !dir || dir === 'Sin dirección';
        const dirCond = isSin ? `(direccion IS NULL OR TRIM(direccion)='')` : `TRIM(direccion)=?`;
        const dirParam = isSin ? [] : [dir];

        const rows = await dbQuery(`
            SELECT COALESCE(NULLIF(TRIM(department),''),'Sin área') AS area,
                   COUNT(*) AS total,
                   SUM(CASE WHEN activity_status='ACTIVO'   THEN 1 ELSE 0 END) AS activos,
                   SUM(CASE WHEN activity_status='BAJO USO' THEN 1 ELSE 0 END) AS bajo_uso,
                   SUM(CASE WHEN activity_status='INACTIVO' THEN 1 ELSE 0 END) AS inactivos,
                   SUM(CASE WHEN activity_status='SIN USO'  THEN 1 ELSE 0 END) AS sin_uso
            FROM m365_user_licenses WHERE account_enabled=1 AND ${dirCond}
            GROUP BY area ORDER BY total DESC
        `, dirParam);
        const usersByArea = await dbQuery(`SELECT COALESCE(NULLIF(TRIM(department),''),'Sin área') AS area, license_groups FROM m365_user_licenses WHERE account_enabled=1 AND ${dirCond}`, dirParam);
        const areaCostMap = {};
        for (const u of usersByArea) {
            const groups = JSON.parse(u.license_groups || '[]');
            let cost = 0;
            for (const grp of groups) cost += costMap[GROUP_TO_SKU[grp]] || 0;
            areaCostMap[u.area] = (areaCostMap[u.area] || 0) + cost;
        }
        const result = rows.map(d => ({
            area: d.area, total: parseInt(d.total), activos: parseInt(d.activos),
            bajo_uso: parseInt(d.bajo_uso), inactivos: parseInt(d.inactivos), sin_uso: parseInt(d.sin_uso),
            uso_pct: parseInt(d.total) > 0 ? Math.round(parseInt(d.activos) / parseInt(d.total) * 100) : 0,
            cost_monthly: +(areaCostMap[d.area] || 0).toFixed(2),
        }));
        res.json({ success: true, data: result });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// GET /api/licenses/recommendations — Recomendaciones automáticas
// ============================================================
router.get('/recommendations', authenticateToken, async (req, res) => {
    try {
        const costMap = Object.fromEntries(
            (await dbQuery(`SELECT sku_name, cost_per_user FROM m365_license_costs`)).map(c => [c.sku_name, parseFloat(c.cost_per_user) || 0])
        );

        const inactiveUsers = await dbQuery(`
            SELECT upn, display_name, email, department, license_groups, days_inactive, activity_status, last_activity_date
            FROM m365_user_licenses
            WHERE activity_status IN ('SIN USO','INACTIVO') AND account_enabled=1
            ORDER BY days_inactive DESC
        `);

        // Group by license group
        const byGroup = {};
        for (const u of inactiveUsers) {
            const groups = JSON.parse(u.license_groups || '[]');
            for (const grp of groups) {
                if (!byGroup[grp]) byGroup[grp] = [];
                byGroup[grp].push({ ...u, license_groups: groups });
            }
        }

        const recommendations = [];

        // Rec 1: SIN USO >90d → remove license
        for (const [grp, users] of Object.entries(byGroup)) {
            const sinUso = users.filter(u => u.activity_status === 'SIN USO');
            if (!sinUso.length) continue;
            const sku = GROUP_TO_SKU[grp];
            const costUnit = costMap[sku] || 0;
            const savings = +(sinUso.length * costUnit).toFixed(2);
            recommendations.push({
                type: 'ELIMINAR',
                priority: costUnit >= 20 ? 'ALTA' : 'MEDIA',
                group: grp, count: sinUso.length, savings,
                message: `${sinUso.length} usuarios no usan ${grp} hace más de 90 días`,
                detail: `Ahorro potencial: $${savings.toFixed(2)}/mes eliminando licencias inactivas`,
                users: sinUso.slice(0, 10).map(u => ({ name: u.display_name, dept: u.department, days: u.days_inactive })),
            });
        }

        // Rec 2: E5 users inactive → downgrade to E3 (save ~$21/user)
        const e5Inactive = inactiveUsers.filter(u => JSON.parse(u.license_groups || '[]').includes('M365 E5'));
        if (e5Inactive.length) {
            const e5Cost = costMap['SPE_E5'] || 57;
            const e3Cost = costMap['ENTERPRISEPACK'] || 36;
            const savingsDown = +(e5Inactive.length * (e5Cost - e3Cost)).toFixed(2);
            recommendations.push({
                type: 'DEGRADAR', priority: 'ALTA', group: 'M365 E5',
                count: e5Inactive.length, savings: savingsDown,
                message: `${e5Inactive.length} usuarios con E5 sin actividad detectada`,
                detail: `Degradar a E3 ahorraría $${savingsDown.toFixed(2)}/mes ($${(e5Cost - e3Cost).toFixed(0)}/usuario)`,
                users: e5Inactive.slice(0, 10).map(u => ({ name: u.display_name, dept: u.department, days: u.days_inactive })),
            });
        }

        // Rec 3: Departments with <30% active users
        const deptRows = await dbQuery(`
            SELECT dept, total, activos FROM (
                SELECT COALESCE(department,'Sin departamento') AS dept,
                       COUNT(*) AS total,
                       SUM(CASE WHEN activity_status='ACTIVO' THEN 1 ELSE 0 END) AS activos
                FROM m365_user_licenses WHERE account_enabled=1
                GROUP BY COALESCE(department,'Sin departamento')
            ) t WHERE total >= 3 AND activos / total < 0.30
            ORDER BY activos / total ASC LIMIT 5
        `);
        for (const d of deptRows) {
            const pct = Math.round(parseInt(d.activos) / parseInt(d.total) * 100);
            recommendations.push({
                type: 'REVISAR', priority: 'MEDIA', group: d.dept,
                count: parseInt(d.total) - parseInt(d.activos), savings: 0,
                message: `${d.dept}: solo ${pct}% de usuarios activos (${d.activos}/${d.total})`,
                detail: `Revisar licencias asignadas en este departamento`,
                users: [],
            });
        }

        recommendations.sort((a, b) => b.savings - a.savings);
        const totalSavings = recommendations.reduce((s, r) => s + r.savings, 0);

        res.json({ success: true, data: recommendations, totalSavings: +totalSavings.toFixed(2) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// GET /api/licenses/history — Tendencia histórica (últimos 30 snapshots)
// ============================================================
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT snapshot_date, SUM(consumed) AS consumed, SUM(total) AS total,
                   SUM(cost_monthly) AS cost_monthly
            FROM m365_license_snapshots
            GROUP BY snapshot_date ORDER BY snapshot_date DESC LIMIT 30
        `);
        rows.reverse();

        // Per-SKU history for top 5 by consumed
        const topSkus = await dbQuery(`
            SELECT sku_name, label, SUM(consumed) AS total_consumed
            FROM m365_license_snapshots
            WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM m365_license_snapshots)
            GROUP BY sku_name, label ORDER BY total_consumed DESC LIMIT 5
        `);

        const perSku = {};
        for (const sku of topSkus) {
            const skuRows = await dbQuery(`
                SELECT snapshot_date, consumed FROM m365_license_snapshots
                WHERE sku_name=? ORDER BY snapshot_date ASC`, [sku.sku_name]
            );
            perSku[sku.label || sku.sku_name] = Object.fromEntries(skuRows.map(r => [r.snapshot_date?.toISOString?.()?.split('T')[0] || r.snapshot_date, r.consumed]));
        }

        const dates = rows.map(r => r.snapshot_date?.toISOString?.()?.split('T')[0] || r.snapshot_date);

        res.json({
            success: true, data: {
                dates,
                consumed: rows.map(r => parseInt(r.consumed) || 0),
                total:    rows.map(r => parseInt(r.total) || 0),
                cost:     rows.map(r => parseFloat(r.cost_monthly) || 0),
                perSku:   Object.fromEntries(Object.entries(perSku).map(([label, byDate]) => [label, dates.map(d => byDate[d] || 0)])),
                topSkuLabels: topSkus.map(s => s.label || s.sku_name),
            }
        });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// GET /api/licenses/cost-config — Configuración de costos
// ============================================================
router.get('/cost-config', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(`SELECT sku_name, label, cost_per_user, currency FROM m365_license_costs ORDER BY label`);
        res.json({ success: true, data: rows });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// PUT /api/licenses/cost-config — Actualizar costo de un SKU
router.put('/cost-config', authenticateToken, async (req, res) => {
    try {
        const { sku_name, cost_per_user } = req.body;
        if (!sku_name || cost_per_user === undefined) return res.status(400).json({ success: false, message: 'sku_name y cost_per_user requeridos' });
        await dbQuery(`UPDATE m365_license_costs SET cost_per_user=? WHERE sku_name=?`, [parseFloat(cost_per_user), sku_name]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// GET /api/licenses/departments-list — Lista única de departamentos
// ============================================================
router.get('/departments-list', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(`SELECT DISTINCT COALESCE(department,'Sin departamento') AS dept FROM m365_user_licenses ORDER BY dept`);
        res.json({ success: true, data: rows.map(r => r.dept) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// GET /api/licenses/sharepoint — Uso de SharePoint (Graph directo + caché 1h)
// ============================================================
router.get('/sharepoint', authenticateToken, async (req, res) => {
    try {
        const now = Date.now();
        if (_spCache.data && (now - _spCache.ts) < 3600000) return res.json({ success: true, data: _spCache.data });

        const token = await getToken();
        let sites = [];
        try {
            const csv = await graph(`/reports/getSharePointSiteUsageDetail(period='D30')`, token, true);
            const rows = parseCsv(csv);
            sites = rows.filter(r => r['Site URL'] || r['Site Id']).map(r => ({
                url:          r['Site URL'] || '',
                name:         r['Site URL'] ? r['Site URL'].split('/').filter(Boolean).pop() : r['Site Id'],
                owner:        r['Owner Display Name'] || r['Owner Principal Name'] || '—',
                storageUsed:  parseFloat(r['Storage Used (Byte)'] || 0),
                storageGB:    +(parseFloat(r['Storage Used (Byte)'] || 0) / 1e9).toFixed(2),
                storageAllocGB: +(parseFloat(r['Storage Allocated (Byte)'] || 0) / 1e9).toFixed(2),
                fileCount:    parseInt(r['File Count'] || 0),
                activeFiles:  parseInt(r['Active File Count'] || 0),
                lastActivity: r['Last Activity Date'] || null,
                isDeleted:    r['Is Deleted'] === 'True',
            })).filter(s => !s.isDeleted).sort((a, b) => b.storageUsed - a.storageUsed);
        } catch { sites = []; }

        const data = {
            sites,
            stats: {
                total: sites.length,
                activeSites: sites.filter(s => s.lastActivity).length,
                totalGB: +(sites.reduce((a, s) => a + s.storageUsed, 0) / 1e9).toFixed(2),
                totalFiles: sites.reduce((a, s) => a + s.fileCount, 0),
            },
            updatedAt: new Date().toISOString()
        };
        _spCache.data = data; _spCache.ts = now;
        res.json({ success: true, data });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// GET /api/licenses/export — CSV completo de usuarios
// ============================================================
router.get('/export', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT display_name,email,upn,department,job_title,
                   license_groups,last_activity_date,days_inactive,
                   activo_30d,activo_60d,activo_90d,activity_status,account_enabled,synced_at
            FROM m365_user_licenses ORDER BY activity_status, days_inactive DESC`
        );
        const costMap = Object.fromEntries(
            (await dbQuery(`SELECT sku_name, cost_per_user FROM m365_license_costs`)).map(c => [c.sku_name, parseFloat(c.cost_per_user) || 0])
        );

        const headers = ['Nombre','Email','UPN','Departamento','Cargo','Licencias','Ultima Actividad','Dias Inactivo','Activo 30d','Activo 60d','Activo 90d','Estado','Cuenta Activa','Costo Mensual USD'];
        const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [headers.map(escape).join(',')];

        for (const r of rows) {
            const groups = JSON.parse(r.license_groups || '[]');
            const cost = groups.reduce((s, grp) => s + (costMap[GROUP_TO_SKU[grp]] || 0), 0);
            lines.push([
                r.display_name, r.email, r.upn, r.department, r.job_title,
                groups.join(' | '), r.last_activity_date || '', r.days_inactive ?? '',
                r.activo_30d ? 'SI' : 'NO', r.activo_60d ? 'SI' : 'NO', r.activo_90d ? 'SI' : 'NO',
                r.activity_status, r.account_enabled ? 'SI' : 'NO', cost.toFixed(2),
            ].map(escape).join(','));
        }

        const date = new Date().toISOString().split('T')[0];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="licencias_m365_${date}.csv"`);
        res.send('\uFEFF' + lines.join('\n')); // BOM for Excel
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================
// DELETE /api/licenses/cache — Limpiar caché SharePoint
// ============================================================
router.delete('/cache', authenticateToken, (req, res) => {
    _spCache.data = null; _spCache.ts = 0;
    res.json({ success: true, message: 'Caché de SharePoint limpiado' });
});

module.exports = router;
