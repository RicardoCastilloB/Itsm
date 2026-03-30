// ============================================================
// routes/outlook-sync.js
// FIX PRINCIPAL: findEmailAndAllCsvs() descarga TODOS los CSVs
// del mismo correo — no busca HW y SEC en correos separados
// ============================================================
const express = require('express');
const router  = express.Router();
const { executeQuery: execQuery, equipmentPool } = require('../config/database');

let msal, fetch;
try {
    msal  = require('@azure/msal-node');
    fetch = (...a) => import('node-fetch').then(m => m.default(...a));
} catch (e) { console.warn('Falta: npm install @azure/msal-node node-fetch'); }

function CFG() {
    return {
        clientId:     process.env.MS_CLIENT_ID,
        tenantId:     process.env.MS_TENANT_ID,
        clientSecret: process.env.MS_CLIENT_SECRET,
        mailbox:      process.env.MS_USER_EMAIL
    };
}

const FROM_SENDER = 'stefanini.com';

async function getToken() {
    const c = CFG();
    if (!c.clientId || !c.tenantId || !c.clientSecret)
        throw new Error('Faltan MS_CLIENT_ID / MS_TENANT_ID / MS_CLIENT_SECRET en .env');
    const cca = new msal.ConfidentialClientApplication({
        auth: { clientId: c.clientId, authority: `https://login.microsoftonline.com/${c.tenantId}`, clientSecret: c.clientSecret }
    });
    const r = await cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
    if (!r?.accessToken) throw new Error('No se pudo obtener token Azure AD');
    return r.accessToken;
}

async function gGet(token, url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
    return res.json();
}

function decodeCsvBuffer(base64str) {
    const buf = Buffer.from(base64str, 'base64');
    if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
    if (buf[0] === 0xFE && buf[1] === 0xFF) return buf.slice(2).swap16().toString('utf16le');
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf-8');
    return buf.toString('utf-8');
}

function parseTsvText(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];
    const firstLine = lines[0];
    const tabCount  = firstLine.split('\t').length;
    const semiCount = firstLine.split(';').length;
    const delim     = tabCount >= semiCount ? '\t' : ';';
    const headers   = firstLine.split(delim).map(h => h.trim().replace(/^\uFEFF/, ''));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = lines[i].split(delim);
        const row = {};
        headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
        rows.push(row);
    }
    return rows;
}

function detectCsvTypeByName(filename) {
    if (!filename) return 'unknown';
    const f = filename.toLowerCase();
    if (f.includes('hardware') || f.includes('inventario')) return 'hardware';
    if (f.startsWith('equipos') || f.includes('security') || f.includes('seguridad')) return 'security';
    return 'unknown';
}

function detectCsvTypeByHeaders(headers) {
    const h = headers.map(x => x.toLowerCase().replace(/^\uFEFF/, '').trim());
    const isHw  = h.some(x => x === 'memoria') || h.some(x => x === 'cpu-1') ||
                  h.some(x => x.includes('bios')) || h.some(x => x.includes('tpm'));
    const isSec = h.some(x => x.includes('ip p') && x.includes('blica')) ||
                  h.some(x => x === 'licencias') ||
                  h.some(x => x.includes('estado de aislamiento')) ||
                  h.some(x => x.includes('ltimo usuario') || x.includes('ltimo usuario'));
    if (isHw)  return 'hardware';
    if (isSec) return 'security';
    return 'unknown';
}

function parseDate(s) {
    if (!s?.trim()) return null;
    const v  = s.trim();
    const m2 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m2) return new Date(`${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}T${(m2[4]||'0').padStart(2,'0')}:${m2[5]||'00'}:00`);
    const m1 = v.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (m1) return new Date(`${m1[1]}-${m1[2]}-${m1[3]}T${m1[4]}:${m1[5]}:${m1[6]}`);
    return null;
}
function parseBool(v) {
    return ['verdadero','true','1'].includes((v||'').toLowerCase().trim()) ? 1 : 0;
}

const HW_MAP = {
    'Cliente':'cliente','Tipo de equipo':'tipo_equipo','Equipo':'hostname',
    'Descripción':'descripcion','Dirección IP':'ip_local','Dominio':'dominio',
    'Grupo':'grupo','Versión del agente':'version_agente','Última conexión':'ultima_conexion',
    'Plataforma':'plataforma','Sistema operativo':'sistema_operativo','Sistema':'sistema_modelo',
    'CPU-1':'cpu_1','CPU-1 Número de núcleos':'cpu_1_nucleos',
    'CPU-1 Número de procesadores lógicos':'cpu_1_procesadores',
    'CPU-2':'cpu_2','CPU-2 Número de núcleos':'cpu_2_nucleos',
    'CPU-2 Número de procesadores lógicos':'cpu_2_procesadores',
    'Memoria':'memoria_ram',
    'Disco-1 Capacidad':'disco_1_capacidad','Disco-1 Particiones':'disco_1_particiones',
    'Disco-2 Capacidad':'disco_2_capacidad','Disco-2 Particiones':'disco_2_particiones',
    'Disco-3 Capacidad':'disco_3_capacidad','Disco-3 Particiones':'disco_3_particiones',
    'Disco-4 Capacidad':'disco_4_capacidad','Disco-4 Particiones':'disco_4_particiones',
    'Versión de especificación del TPM':'tpm_version','BIOS-Número de serie':'bios_serial'
};

const SEC_MAP = {
    'Cliente':'cliente','Tipo de equipo':'tipo_equipo','Equipo':'hostname',
    'Dirección IP':'ip_local','Dirección IP pública':'ip_publica',
    'Direcciones físicas (MAC)':'mac_address','Dominio':'dominio',
    'Directorio activo':'directorio_activo','Grupo':'grupo',
    'Versión del agente':'version_agente',
    'Fecha arranque del sistema':'fecha_arranque','Fecha de instalación':'fecha_instalacion',
    'Fecha de última conexión':'ultima_conexion','Plataforma':'plataforma',
    'Sistema operativo':'sistema_operativo','Máquina virtual':'es_virtual',
    'Es equipo no persistente':'es_no_persistente','Servidor Exchange':'servidor_exchange',
    'Versión de la protección':'version_proteccion',
    'Fecha de última actualización':'fecha_ultima_actualizacion','Licencias':'licencias',
    'Estado de aislamiento':'estado_aislamiento','Último usuario logueado':'ultimo_usuario',
    'Acción solicitada':'accion_solicitada','Último proxy utilizado por agente':'ultimo_proxy',
    'Shadow Copies':'shadow_copies','Última copia realizada':'ultima_copia'
};

const DATE_FIELDS = new Set(['fecha_arranque','fecha_instalacion','ultima_conexion','fecha_ultima_actualizacion','ultima_copia']);
const BOOL_FIELDS = new Set(['es_virtual','es_no_persistente']);
const INT_FIELDS  = new Set(['cpu_1_nucleos','cpu_1_procesadores','cpu_2_nucleos','cpu_2_procesadores']);
const HW_ONLY     = new Set(['sistema_modelo','cpu_1','cpu_1_nucleos','cpu_1_procesadores','cpu_2','cpu_2_nucleos','cpu_2_procesadores','memoria_ram','disco_1_capacidad','disco_1_particiones','disco_2_capacidad','disco_2_particiones','disco_3_capacidad','disco_3_particiones','disco_4_capacidad','disco_4_particiones','tpm_version','bios_serial']);

function mapRow(raw, colMap) {
    const out  = {};
    const norm = {};
    for (const [k,v] of Object.entries(raw)) norm[k.replace(/^\uFEFF/,'').trim()] = v;
    for (const [col, field] of Object.entries(colMap)) {
        const v = (norm[col] ?? '').toString().trim();
        if (!v) { out[field] = null; continue; }
        if (BOOL_FIELDS.has(field))      out[field] = parseBool(v);
        else if (DATE_FIELDS.has(field)) out[field] = parseDate(v);
        else if (INT_FIELDS.has(field))  out[field] = parseInt(v) || null;
        else                             out[field] = v;
    }
    return out;
}

// ── BUSCAR CORREO + DESCARGAR TODOS SUS CSVs ─────────────
// Toma el correo más reciente de stefanini con adjuntos CSV
// y descarga TODOS los archivos CSV de ese mismo mensaje.
async function findEmailAndAllCsvs(token) {
    const mb = CFG().mailbox;
    if (!mb) throw new Error('Falta MS_USER_EMAIL en .env');

    const data = await gGet(token,
        `https://graph.microsoft.com/v1.0/users/${mb}/messages?$orderby=receivedDateTime desc&$top=200&$select=id,subject,from,receivedDateTime,hasAttachments`
    );
    const all = data.value || [];
    console.log(`📬 Mensajes: ${all.length}`);

    const candidates = all.filter(m =>
        (m.from?.emailAddress?.address || '').toLowerCase().includes(FROM_SENDER) &&
        m.hasAttachments === true
    );
    console.log(`📧 Candidatos de ${FROM_SENDER}: ${candidates.length}`);

    for (const msg of candidates) {
        const attsData = await gGet(token,
            `https://graph.microsoft.com/v1.0/users/${mb}/messages/${msg.id}/attachments?$top=25&$select=id,name,size,contentType`
        );
        const csvAtts = (attsData.value || []).filter(a => (a.name||'').toLowerCase().endsWith('.csv'));
        console.log(`   📎 "${msg.subject}" → [${csvAtts.map(a=>a.name).join(', ')||'sin CSV'}]`);

        if (!csvAtts.length) continue;

        // Descargar TODOS los CSVs del mismo correo
        const downloaded = [];
        for (const att of csvAtts) {
            console.log(`   📥 Descargando: ${att.name} (${(att.size/1024).toFixed(1)} KB)`);
            const full = await gGet(token,
                `https://graph.microsoft.com/v1.0/users/${mb}/messages/${msg.id}/attachments/${att.id}`
            );
            const type = detectCsvTypeByName(att.name);
            console.log(`      tipo: ${type}`);
            downloaded.push({ name:att.name, size:att.size, contentBytes:full.contentBytes, type });
        }

        console.log(`   ✅ "${msg.subject}" | ${downloaded.length} CSV(s) descargados`);
        return { msg, csvs: downloaded };
    }
    return null;
}

const DB_FIELDS = [
    'cliente','tipo_equipo','hostname','descripcion','ip_local','ip_publica',
    'mac_address','dominio','directorio_activo','ultimo_proxy','plataforma',
    'sistema_operativo','sistema_modelo','cpu_1','cpu_1_nucleos','cpu_1_procesadores',
    'cpu_2','cpu_2_nucleos','cpu_2_procesadores','memoria_ram',
    'disco_1_capacidad','disco_1_particiones','disco_2_capacidad','disco_2_particiones',
    'disco_3_capacidad','disco_3_particiones','disco_4_capacidad','disco_4_particiones',
    'tpm_version','bios_serial','grupo','version_agente',
    'fecha_arranque','fecha_instalacion','ultima_conexion','es_virtual','es_no_persistente',
    'servidor_exchange','version_proteccion','fecha_ultima_actualizacion','licencias',
    'ultimo_usuario','estado_aislamiento','accion_solicitada','shadow_copies','ultima_copia',
    'sync_source'
];
const UPD_FIELDS = DB_FIELDS.filter(f => f !== 'hostname');

async function upsertAll(hwRows, secRows) {
    const merged = new Map();
    for (const r of hwRows) {
        if (r.hostname) merged.set(r.hostname, { ...r, sync_source:'hardware' });
    }
    for (const r of secRows) {
        if (!r.hostname) continue;
        const prev = merged.get(r.hostname);
        if (prev) {
            const combined = { ...prev };
            for (const [k,v] of Object.entries(r)) {
                if (HW_ONLY.has(k) && v === null) continue;
                if (v !== null) combined[k] = v;
            }
            if (r.ultima_conexion && prev.ultima_conexion && r.ultima_conexion > prev.ultima_conexion)
                combined.ultima_conexion = r.ultima_conexion;
            combined.sync_source = 'both';
            merged.set(r.hostname, combined);
        } else {
            merged.set(r.hostname, { ...r, sync_source:'security' });
        }
    }
    const records = [...merged.values()];
    console.log(`📊 Total a upsert: ${records.length}`);
    if (!records.length) return { inserted:0, updated:0, total:0 };
    let inserted=0, updated=0;
    for (let i=0; i<records.length; i+=100) {
        const batch = records.slice(i,i+100);
        const ph    = batch.map(()=>`(${DB_FIELDS.map(()=>'?').join(',')})`).join(',');
        const vals  = batch.flatMap(rec=>DB_FIELDS.map(f=>rec[f]??null));
        const upd   = UPD_FIELDS.map(f=>`${f}=VALUES(${f})`).join(',');
        const res   = await execQuery(equipmentPool,
            `INSERT INTO sccm_inventory (${DB_FIELDS.join(',')}) VALUES ${ph}
             ON DUPLICATE KEY UPDATE ${upd}, last_synced_at=CURRENT_TIMESTAMP`, vals);
        inserted += (res.affectedRows||0)-(res.changedRows||0);
        updated  += res.changedRows||0;
    }
    console.log(`✅ ${inserted} nuevos | ${updated} actualizados`);
    return { inserted, updated, total:records.length };
}

// ── ENDPOINTS ─────────────────────────────────────────────

router.get('/debug', async (req,res) => {
    try {
        if (!msal) return res.status(500).json({ error:'Dependencias no instaladas' });
        const c   = CFG();
        const env = { MS_CLIENT_ID:c.clientId?'✅':'❌', MS_TENANT_ID:c.tenantId?'✅':'❌', MS_CLIENT_SECRET:c.clientSecret?'✅':'❌', MS_USER_EMAIL:c.mailbox?`✅ ${c.mailbox}`:'❌' };
        const token = await getToken();
        const data  = await gGet(token, `https://graph.microsoft.com/v1.0/users/${c.mailbox}/messages?$orderby=receivedDateTime desc&$top=200&$select=id,subject,from,receivedDateTime,hasAttachments`);
        const msgs  = (data.value||[]).map(m=>({ subject:m.subject, from:m.from?.emailAddress?.address, received:m.receivedDateTime, hasAttachments:m.hasAttachments, is_candidate:(m.from?.emailAddress?.address||'').toLowerCase().includes(FROM_SENDER)&&m.hasAttachments }));
        res.json({ success:true, env, total:msgs.length, candidates:msgs.filter(m=>m.is_candidate), messages:msgs });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.get('/preview', async (req,res) => {
    try {
        if (!msal) return res.status(500).json({ error:'Dependencias no instaladas' });
        const token  = await getToken();
        const result = await findEmailAndAllCsvs(token);
        if (!result) return res.json({ success:false, found:false, message:`No se encontraron CSVs de ${FROM_SENDER}` });
        res.json({ success:true, found:true, email:{ subject:result.msg.subject, from:result.msg.from?.emailAddress?.address, received:result.msg.receivedDateTime, attachments:result.csvs.map(a=>({ name:a.name, size:a.size, type:a.type })) } });
    } catch(err) { console.error('❌ /preview:',err); res.status(500).json({ success:false, error:err.message }); }
});

router.post('/sync', async (req,res) => {
    try {
        if (!msal) return res.status(500).json({ success:false, error:'npm install @azure/msal-node node-fetch' });
        console.log('\n🔄 SYNC START');
        const token  = await getToken();
        const result = await findEmailAndAllCsvs(token);
        if (!result) return res.json({ success:false, message:`No se encontraron CSVs de ${FROM_SENDER}` });

        const hwRows=[], secRows=[], log=[];

        for (const csv of result.csvs) {
            console.log(`\n📄 Procesando: ${csv.name} | tipo: ${csv.type}`);
            if (!csv.contentBytes) {
                log.push({ file:csv.name, type:csv.type, warning:'Sin contentBytes' });
                continue;
            }
            let text, rows;
            try {
                text = decodeCsvBuffer(csv.contentBytes);
                rows = parseTsvText(text);
                console.log(`   Filas: ${rows.length} | Cols[0..4]: ${Object.keys(rows[0]||{}).slice(0,5).join(' | ')}`);
            } catch(e) {
                log.push({ file:csv.name, type:csv.type, error:e.message });
                continue;
            }

            let type = csv.type;
            if (type === 'unknown' && rows.length > 0) {
                type = detectCsvTypeByHeaders(Object.keys(rows[0]));
                console.log(`   tipo por headers: ${type}`);
            }

            if (type === 'hardware') {
                rows.forEach(r => { const m=mapRow(r,HW_MAP); if (m.hostname) hwRows.push(m); });
                log.push({ file:csv.name, rows:rows.length, mapped:hwRows.length, type:'hardware' });
                console.log(`   ✅ Hardware: ${hwRows.length} equipos`);
            } else if (type === 'security') {
                rows.forEach(r => { const m=mapRow(r,SEC_MAP); if (m.hostname) secRows.push(m); });
                log.push({ file:csv.name, rows:rows.length, mapped:secRows.length, type:'security' });
                console.log(`   ✅ Security: ${secRows.length} equipos`);
            } else {
                const sh = Object.keys(rows[0]||{}).slice(0,8);
                log.push({ file:csv.name, rows:rows.length, type:'unknown', warning:'Tipo no reconocido', sample_headers:sh });
                console.warn(`   ⚠️ Desconocido. Headers: ${sh.join(' | ')}`);
            }
        }

        console.log(`\n📊 HW: ${hwRows.length} | SEC: ${secRows.length}`);
        if (!hwRows.length && !secRows.length)
            return res.json({ success:false, message:'No se parsearon registros', files:log });

        const upsertResult = await upsertAll(hwRows, secRows);
        execQuery(equipmentPool,
            `INSERT INTO sccm_inventory_log (email_subject,email_from,email_received,files_processed,records_inserted,records_updated,total_records) VALUES (?,?,?,?,?,?,?)`,
            [result.msg.subject, result.msg.from?.emailAddress?.address, result.msg.receivedDateTime, JSON.stringify(log), upsertResult.inserted, upsertResult.updated, upsertResult.total]
        ).catch(e=>console.warn('Log:',e.message));

        console.log('🔄 SYNC END\n');
        res.json({ success:true, message:'Sincronización completada', email:{ subject:result.msg.subject, from:result.msg.from?.emailAddress?.address, received:result.msg.receivedDateTime }, files:log, result:upsertResult });
    } catch(err) { console.error('❌ /sync:',err); res.status(500).json({ success:false, error:err.message }); }
});

router.get('/stats', async (req,res) => {
    try {
        const [k] = await execQuery(equipmentPool, `
            SELECT COUNT(*) AS total,
                SUM(CONVERT(tipo_equipo USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%Portátil%' OR CONVERT(tipo_equipo USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%Laptop%') AS portatiles,
                SUM(CONVERT(tipo_equipo USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%Estación%' OR CONVERT(tipo_equipo USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%Estacion%' OR CONVERT(tipo_equipo USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE '%Sobremesa%') AS sobremesas,
                SUM(es_virtual=1) AS virtuales,
                SUM(ultima_conexion >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS online_24h,
                SUM(ultima_conexion >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND ultima_conexion < DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS online_7d,
                SUM(ultima_conexion IS NOT NULL AND ultima_conexion < DATE_SUB(NOW(), INTERVAL 7 DAY)) AS offline_7d,
                SUM(sync_source='hardware') AS cnt_hw,
                SUM(sync_source='security') AS cnt_sec,
                SUM(sync_source='both') AS cnt_both,
                MAX(last_synced_at) AS ultima_sync
            FROM sccm_inventory`);
        res.json({ success:true, kpis:k });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.get('/data', async (req,res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page)||1);
        const limit  = Math.min(200, parseInt(req.query.limit)||50);
        const offset = (page-1)*limit;
        const search = req.query.search ? `%${req.query.search}%` : null;
        const tipo   = req.query.tipo||null;
        const source = req.query.source||null;
        const online = req.query.online||null;
        const SORT_ALLOW = new Set(['hostname','tipo_equipo','sistema_operativo','memoria_ram','ip_local','ultimo_usuario','ultima_conexion','sync_source']);
        const sortField  = SORT_ALLOW.has(req.query.sort) ? req.query.sort : 'ultima_conexion';
        const sortDir    = req.query.dir==='asc' ? 'ASC' : 'DESC';
        let where='WHERE 1=1'; const p=[];
        if (search) { where+=' AND (hostname LIKE ? OR ip_local LIKE ? OR ip_publica LIKE ? OR sistema_modelo LIKE ? OR ultimo_usuario LIKE ? OR mac_address LIKE ?)'; p.push(search,search,search,search,search,search); }
        if (tipo)   { where+=' AND CONVERT(tipo_equipo USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE ?'; p.push(`%${tipo}%`); }
        if (source) { where+=' AND sync_source=?'; p.push(source); }
        if (online==='online')  where+=' AND ultima_conexion >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
        if (online==='recent')  where+=' AND ultima_conexion >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND ultima_conexion < DATE_SUB(NOW(), INTERVAL 24 HOUR)';
        if (online==='offline') where+=' AND (ultima_conexion IS NULL OR ultima_conexion < DATE_SUB(NOW(), INTERVAL 7 DAY))';
        const [{total}] = await execQuery(equipmentPool, `SELECT COUNT(*) AS total FROM sccm_inventory ${where}`, p);
        const rows = await execQuery(equipmentPool, `
            SELECT id,cliente,tipo_equipo,hostname,ip_local,ip_publica,mac_address,
                   dominio,directorio_activo,sistema_operativo,sistema_modelo,
                   cpu_1,cpu_1_nucleos,cpu_1_procesadores,
                   memoria_ram,disco_1_capacidad,disco_1_particiones,
                   tpm_version,bios_serial,version_agente,
                   ultima_conexion,ultimo_usuario,estado_aislamiento,
                   licencias,version_proteccion,fecha_ultima_actualizacion,
                   es_virtual,sync_source,last_synced_at,
                   grupo,fecha_arranque,fecha_instalacion
            FROM sccm_inventory ${where}
            ORDER BY ${sortField} ${sortDir}
            LIMIT ? OFFSET ?`, [...p,limit,offset]);
        res.json({ success:true, data:rows, pagination:{ page,limit,total,pages:Math.ceil(total/limit) } });
    } catch(err) { console.error('❌ /data:',err); res.status(500).json({ success:false, error:err.message }); }
});

router.get('/os-distribution', async (req,res) => {
    try {
        const rows = await execQuery(equipmentPool, `SELECT CASE WHEN sistema_operativo LIKE '%Windows 11%' THEN 'Windows 11' WHEN sistema_operativo LIKE '%Windows 10%' THEN 'Windows 10' WHEN sistema_operativo LIKE '%Windows 7%' THEN 'Windows 7' WHEN sistema_operativo LIKE '%Windows%' THEN 'Windows (otro)' WHEN sistema_operativo LIKE '%Mac%' THEN 'macOS' WHEN sistema_operativo LIKE '%Linux%' THEN 'Linux' ELSE 'Otro' END AS os_group, COUNT(*) AS cantidad FROM sccm_inventory WHERE sistema_operativo IS NOT NULL AND TRIM(sistema_operativo)!='' GROUP BY os_group ORDER BY cantidad DESC LIMIT 10`);
        res.json({ success:true, data:rows });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.get('/tipo-distribution', async (req,res) => {
    try {
        const rows = await execQuery(equipmentPool, `SELECT COALESCE(NULLIF(TRIM(CONVERT(tipo_equipo USING utf8mb4)),''),'Sin tipo') AS tipo_equipo, COUNT(*) AS cantidad FROM sccm_inventory GROUP BY tipo_equipo ORDER BY cantidad DESC`);
        res.json({ success:true, data:rows });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.get('/ram-distribution', async (req,res) => {
    try {
        const rows = await execQuery(equipmentPool, `SELECT memoria_ram AS ram, COUNT(*) AS cantidad FROM sccm_inventory WHERE memoria_ram IS NOT NULL AND TRIM(memoria_ram)!='' GROUP BY memoria_ram ORDER BY cantidad DESC LIMIT 15`);
        res.json({ success:true, data:rows });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

console.log(`✅ outlook-sync.js listo | mailbox: ${process.env.MS_USER_EMAIL||'(pendiente .env)'}`);
module.exports = router;
