// ============================================================
// routes/outlook-sync.js
// ============================================================
const express = require('express');
const router  = express.Router();
const { executeQuery: execQuery, equipmentPool } = require('../config/database');

let msal, fetch, Papa;
try {
    msal  = require('@azure/msal-node');
    fetch = (...a) => import('node-fetch').then(m => m.default(...a));
    Papa  = require('papaparse');
} catch (e) {
    console.warn('⚠️  outlook-sync: npm install @azure/msal-node node-fetch papaparse');
}

const MAILBOX        = () => process.env.MS_USER_EMAIL;
const FROM_FILTER    = 'rabasurco@stefanini.com';
const SUBJECT_FILTER = 'SCCM';

const msalConfig = {
    auth: {
        clientId:     process.env.MS_CLIENT_ID,
        authority:    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
        clientSecret: process.env.MS_CLIENT_SECRET
    }
};

async function getToken() {
    const cca = new msal.ConfidentialClientApplication(msalConfig);
    const r   = await cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
    if (!r?.accessToken) throw new Error('No se pudo obtener token de Azure AD');
    return r.accessToken;
}

async function findSccmEmail(token) {
    const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX()}/messages?$orderby=receivedDateTime desc&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Graph messages: ${res.status} ${await res.text()}`);
    const all = (await res.json()).value || [];
    console.log(`📬 Mensajes: ${all.length}`);
    const matches = all.filter(m =>
        (m.from?.emailAddress?.address||'').toLowerCase().includes(FROM_FILTER.toLowerCase()) &&
        (m.subject||'').toLowerCase().includes(SUBJECT_FILTER.toLowerCase()) &&
        m.hasAttachments === true
    );
    if (!matches.length) return null;
    matches.sort((a,b) => new Date(b.receivedDateTime)-new Date(a.receivedDateTime));
    console.log(`✅ Correo SCCM: "${matches[0].subject}" (${matches[0].receivedDateTime})`);
    return matches[0];
}

// Lista adjuntos CSV — SOLO metadata, sin contentBytes
async function listCsvAttachments(token, messageId) {
    const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX()}/messages/${messageId}/attachments?$top=25&$select=id,name,size,contentType`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Adjuntos error: ${res.status} ${await res.text()}`);
    const all  = (await res.json()).value || [];
    const csvs = all.filter(a => (a.name||'').toLowerCase().endsWith('.csv'));
    console.log(`📎 Adjuntos totales: ${all.length} | CSVs: ${csvs.length} → [${csvs.map(a=>a.name).join(', ')}]`);
    return csvs;
}

// Descarga un adjunto por su ID — devuelve string UTF-8
async function downloadAttachment(token, messageId, attachmentId) {
    const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX()}/messages/${messageId}/attachments/${attachmentId}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Descarga ${attachmentId}: ${res.status}`);
    const data = await res.json();
    if (!data.contentBytes) throw new Error(`contentBytes vacío para ${attachmentId}`);
    return Buffer.from(data.contentBytes, 'base64').toString('utf-8');
}

// Detecta tipo por nombre de archivo (para preview sin descargar)
function detectTypeByFilename(filename) {
    const f = (filename||'').toLowerCase();
    if (f.includes('hardware') || f.includes('inventario')) return 'hardware';
    if (f.includes('equipo')   || f.includes('security'))   return 'security';
    return 'unknown';
}

// Detecta tipo por headers — robusto contra BOM y variaciones
function detectType(rawHeaders, filename) {
    const headers = rawHeaders.map(h => h.replace(/^\uFEFF/,'').trim().toLowerCase());

    const isHw  = headers.some(h => h==='memoria') ||
                  headers.some(h => h==='cpu-1') ||
                  headers.some(h => h.includes('disco-1 capacidad')) ||
                  headers.some(h => h.includes('bios')) ||
                  headers.some(h => h.includes('tpm'));

    const isSec = headers.some(h => h.includes('dirección ip pública') || h.includes('direccion ip publica')) ||
                  headers.some(h => h.includes('último usuario') || h.includes('ultimo usuario')) ||
                  headers.some(h => h==='licencias') ||
                  headers.some(h => h.includes('estado de aislamiento')) ||
                  headers.some(h => h.includes('versión de la protección') || h.includes('version de la proteccion'));

    console.log(`   detectType headers[0..4]: ${headers.slice(0,5).join(' | ')} → HW:${isHw} SEC:${isSec}`);

    if (isHw)  return 'hardware';
    if (isSec) return 'security';
    return detectTypeByFilename(filename);
}

function parseDate(str) {
    if (!str?.trim()) return null;
    const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    const dt = new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T${(m[4]||'00').padStart(2,'0')}:${m[5]||'00'}:00`);
    return isNaN(dt) ? null : dt;
}
function parseBool(v) { return (v||'').trim().toLowerCase()==='verdadero' ? 1 : 0; }

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
    'Equipo':'hostname','Dirección IP':'ip_local','Dirección IP pública':'ip_publica',
    'Direcciones físicas (MAC)':'mac_address','Dominio':'dominio',
    'Directorio activo':'directorio_activo','Fecha arranque del sistema':'fecha_arranque',
    'Fecha de instalación':'fecha_instalacion','Fecha de última conexión':'ultima_conexion',
    'Máquina virtual':'es_virtual','Es equipo no persistente':'es_no_persistente',
    'Servidor Exchange':'servidor_exchange','Versión de la protección':'version_proteccion',
    'Fecha de última actualización':'fecha_ultima_actualizacion','Licencias':'licencias',
    'Último usuario logueado':'ultimo_usuario','Estado de aislamiento':'estado_aislamiento',
    'Acción solicitada':'accion_solicitada','Shadow Copies':'shadow_copies',
    'Última copia realizada':'ultima_copia','Último proxy utilizado por agente':'ultimo_proxy'
};

const DATE_FIELDS = new Set(['fecha_arranque','fecha_instalacion','ultima_conexion','fecha_ultima_actualizacion','ultima_copia']);
const BOOL_FIELDS = new Set(['es_virtual','es_no_persistente']);
const INT_FIELDS  = new Set(['cpu_1_nucleos','cpu_1_procesadores','cpu_2_nucleos','cpu_2_procesadores']);

function mapRow(raw, colMap) {
    const out = {};
    // Normalizar keys del raw (quitar BOM y trim)
    const norm = {};
    for (const [k,v] of Object.entries(raw)) norm[k.replace(/^\uFEFF/,'').trim()] = v;
    for (const [col, field] of Object.entries(colMap)) {
        const v = (norm[col]??'').toString().trim();
        if (!v) { out[field]=null; continue; }
        if (BOOL_FIELDS.has(field))      out[field] = parseBool(v);
        else if (DATE_FIELDS.has(field)) out[field] = parseDate(v);
        else if (INT_FIELDS.has(field))  out[field] = parseInt(v)||null;
        else out[field] = v;
    }
    return out;
}

function parseCsvContent(content, filename) {
    const clean = content.replace(/^\uFEFF/,'');
    // Intentar tab
    let result = Papa.parse(clean, { header:true, skipEmptyLines:true, delimiter:'\t' });
    const tabCols = Object.keys(result.data[0]||{}).length;
    // Intentar semicolon
    const r2 = Papa.parse(clean, { header:true, skipEmptyLines:true, delimiter:';' });
    if (Object.keys(r2.data[0]||{}).length > tabCols) result = r2;
    // Si sigue mal, auto
    if (Object.keys(result.data[0]||{}).length < 3)
        result = Papa.parse(clean, { header:true, skipEmptyLines:true });

    const headers = (result.meta?.fields||[]).map(h => h.replace(/^\uFEFF/,'').trim());
    const type    = detectType(headers, filename);
    console.log(`📄 ${filename}: ${result.data.length} filas | delim="${result.meta?.delimiter}" | tipo=${type}`);
    return { rows: result.data, headers, type };
}

// ── UPSERT
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
const UPD_FIELDS = DB_FIELDS.filter(f => f!=='hostname');

async function upsertAll(hwRows, secRows) {
    const merged = new Map();
    for (const r of hwRows) { if (r.hostname) merged.set(r.hostname, {...r, sync_source:'hardware'}); }
    for (const r of secRows) {
        if (!r.hostname) continue;
        const prev = merged.get(r.hostname);
        if (prev) {
            const m = {...prev};
            for (const [k,v] of Object.entries(r)) { if (v!==null&&v!==undefined&&v!=='') m[k]=v; }
            m.sync_source = 'both';
            merged.set(r.hostname, m);
        } else {
            merged.set(r.hostname, {...r, sync_source:'security'});
        }
    }
    const records = [...merged.values()];
    if (!records.length) return { inserted:0, updated:0, total:0 };
    let inserted=0, updated=0;
    for (let i=0; i<records.length; i+=100) {
        const batch  = records.slice(i,i+100);
        const ph     = batch.map(()=>`(${DB_FIELDS.map(()=>'?').join(',')})`).join(',');
        const values = batch.flatMap(rec=>DB_FIELDS.map(f=>rec[f]??null));
        const upd    = UPD_FIELDS.map(f=>`${f}=VALUES(${f})`).join(',');
        const sql    = `INSERT INTO sccm_inventory (${DB_FIELDS.join(',')}) VALUES ${ph} ON DUPLICATE KEY UPDATE ${upd}, last_synced_at=CURRENT_TIMESTAMP`;
        const r = await execQuery(equipmentPool, sql, values);
        inserted += (r.affectedRows||0)-(r.changedRows||0);
        updated  += r.changedRows||0;
    }
    return { inserted, updated, total:records.size||records.length };
}

// ============================================================
// ENDPOINTS
// ============================================================

router.get('/debug', async (req,res) => {
    try {
        if (!msal) return res.status(500).json({ error:'Dependencias no instaladas' });
        const token = await getToken();
        const url   = `https://graph.microsoft.com/v1.0/users/${MAILBOX()}/messages?$orderby=receivedDateTime desc&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments`;
        const r     = await fetch(url, { headers:{ Authorization:`Bearer ${token}` }});
        const all   = (await r.json()).value||[];
        const messages = all.map(m => ({
            subject:m.subject, from:m.from?.emailAddress?.address,
            received:m.receivedDateTime, hasAttachments:m.hasAttachments,
            match_from:(m.from?.emailAddress?.address||'').toLowerCase().includes(FROM_FILTER.toLowerCase()),
            match_subject:(m.subject||'').toLowerCase().includes(SUBJECT_FILTER.toLowerCase())
        }));
        const details = [];
        for (const m of all.filter(x => messages.find(mm=>mm.subject===x.subject&&mm.match_from&&mm.match_subject&&mm.hasAttachments))) {
            const atts = await listCsvAttachments(token, m.id);
            details.push({ subject:m.subject, received:m.receivedDateTime, attachments:atts.map(a=>({name:a.name,size:a.size})) });
        }
        res.json({ success:true, mailbox:MAILBOX(), total_fetched:all.length, messages, details });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.get('/preview', async (req,res) => {
    try {
        if (!msal) return res.status(500).json({ error:'Dependencias no instaladas' });
        const token = await getToken();
        const msg   = await findSccmEmail(token);
        if (!msg) return res.json({ success:false, found:false, message:`No se encontró correo de ${FROM_FILTER} con asunto "${SUBJECT_FILTER}"` });
        const atts = await listCsvAttachments(token, msg.id);
        res.json({
            success:true, found:true,
            email: {
                id:msg.id, subject:msg.subject,
                from:msg.from?.emailAddress?.address,
                received:msg.receivedDateTime,
                attachments: atts.map(a => ({ id:a.id, name:a.name, size:a.size, type:detectTypeByFilename(a.name) }))
            }
        });
    } catch(err) { console.error('❌ /preview:',err); res.status(500).json({ success:false, error:err.message }); }
});

router.post('/sync', async (req,res) => {
    try {
        if (!msal) return res.status(500).json({ success:false, error:'npm install @azure/msal-node node-fetch papaparse' });
        console.log('\n🔄 ═══ SCCM Sync ═══');
        const token = await getToken();
        const msg   = await findSccmEmail(token);
        if (!msg) return res.json({ success:false, message:`No se encontró correo de ${FROM_FILTER} en ${MAILBOX()}` });

        const atts = await listCsvAttachments(token, msg.id);
        if (!atts.length) return res.json({ success:false, message:'Sin adjuntos CSV' });

        const hwRows=[], secRows=[], log=[];

        for (const att of atts) {
            console.log(`\n📥 ${att.name} (${(att.size/1024).toFixed(1)} KB)`);
            let content;
            try { content = await downloadAttachment(token, msg.id, att.id); }
            catch(e) { log.push({ file:att.name, type:'error', warning:e.message }); continue; }

            const { rows, type } = parseCsvContent(content, att.name);
            const entry = { file:att.name, rows:rows.length, type };

            if (type==='hardware') {
                rows.forEach(r => { const m=mapRow(r,HW_MAP); if (m.hostname) hwRows.push(m); });
                entry.mapped = hwRows.length;
            } else if (type==='security') {
                rows.forEach(r => { const m=mapRow(r,SEC_MAP); if (m.hostname) secRows.push(m); });
                entry.mapped = secRows.length;
            } else {
                entry.warning = 'Tipo CSV no reconocido';
                entry.sample_headers = Object.keys(rows[0]||{}).slice(0,8).map(h=>h.replace(/^\uFEFF/,'').trim());
                console.warn(`   ⚠️  Headers: ${entry.sample_headers.join(' | ')}`);
            }
            log.push(entry);
        }

        console.log(`📊 HW:${hwRows.length} | SEC:${secRows.length}`);
        const result = await upsertAll(hwRows, secRows);
        console.log(`✅ inserted:${result.inserted} updated:${result.updated} total:${result.total}`);

        execQuery(equipmentPool,
            `INSERT IGNORE INTO sccm_inventory_log (email_subject,email_from,email_received,files_processed,records_inserted,records_updated,total_records,sync_at) VALUES (?,?,?,?,?,?,?,NOW())`,
            [msg.subject, msg.from?.emailAddress?.address, msg.receivedDateTime, JSON.stringify(log), result.inserted, result.updated, result.total]
        ).catch(()=>{});

        res.json({ success:true, message:'Sincronización completada', email:{subject:msg.subject, from:msg.from?.emailAddress?.address, received:msg.receivedDateTime}, files:log, result });
    } catch(err) { console.error('❌ /sync:',err); res.status(500).json({ success:false, error:err.message }); }
});

router.get('/stats', async (req,res) => {
    try {
        const [kpis] = await execQuery(equipmentPool, `
            SELECT COUNT(*) AS total,
                SUM(tipo_equipo LIKE '%Portátil%' OR tipo_equipo LIKE '%Portatil%' OR tipo_equipo LIKE '%Laptop%') AS portatiles,
                SUM(tipo_equipo LIKE '%Sobremesa%' OR tipo_equipo LIKE '%Desktop%' OR tipo_equipo LIKE '%Estación%' OR tipo_equipo LIKE '%Estacion%') AS sobremesas,
                SUM(es_virtual=1) AS virtuales,
                SUM(ultima_conexion >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS online_24h,
                SUM(ultima_conexion >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND ultima_conexion < DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS online_7d,
                SUM(ultima_conexion < DATE_SUB(NOW(), INTERVAL 7 DAY)) AS offline_7d,
                SUM(sync_source='hardware') AS cnt_hw,
                SUM(sync_source='security') AS cnt_sec,
                SUM(sync_source='both') AS cnt_both,
                MAX(last_synced_at) AS ultima_sync
            FROM sccm_inventory`);
        res.json({ success:true, kpis });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.get('/data', async (req,res) => {
    try {
        const page   = Math.max(1, parseInt(req.query.page)||1);
        const limit  = Math.min(100, parseInt(req.query.limit)||50);
        const offset = (page-1)*limit;
        const search = req.query.search ? `%${req.query.search}%` : null;
        const tipo   = req.query.tipo||null;
        const online = req.query.online||null;
        let where='WHERE 1=1'; const params=[];
        if (search) { where+=' AND (hostname LIKE ? OR ip_local LIKE ? OR sistema_modelo LIKE ? OR ultimo_usuario LIKE ? OR dominio LIKE ?)'; params.push(search,search,search,search,search); }
        if (tipo)   { where+=' AND tipo_equipo LIKE ?'; params.push(`%${tipo}%`); }
        if (online==='online')  where+=' AND ultima_conexion >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
        if (online==='recent')  where+=' AND ultima_conexion >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND ultima_conexion < DATE_SUB(NOW(), INTERVAL 24 HOUR)';
        if (online==='offline') where+=' AND ultima_conexion < DATE_SUB(NOW(), INTERVAL 7 DAY)';
        const [{total}] = await execQuery(equipmentPool, `SELECT COUNT(*) AS total FROM sccm_inventory ${where}`, params);
        const rows = await execQuery(equipmentPool, `
            SELECT id,cliente,tipo_equipo,hostname,descripcion,ip_local,ip_publica,mac_address,dominio,
                   directorio_activo,plataforma,sistema_operativo,sistema_modelo,
                   cpu_1,cpu_1_nucleos,cpu_1_procesadores,cpu_2,cpu_2_nucleos,cpu_2_procesadores,
                   memoria_ram,disco_1_capacidad,disco_1_particiones,disco_2_capacidad,disco_2_particiones,
                   tpm_version,bios_serial,grupo,version_agente,
                   fecha_arranque,fecha_instalacion,ultima_conexion,fecha_ultima_actualizacion,
                   es_virtual,version_proteccion,licencias,ultimo_usuario,estado_aislamiento,
                   sync_source,last_synced_at
            FROM sccm_inventory ${where} ORDER BY ultima_conexion DESC LIMIT ? OFFSET ?`,
            [...params,limit,offset]);
        res.json({ success:true, data:rows, pagination:{ page,limit,total,pages:Math.ceil(total/limit) } });
    } catch(err) { console.error('❌ /data:',err); res.status(500).json({ success:false, error:err.message }); }
});

router.get('/os-distribution', async (req,res) => {
    try {
        const rows = await execQuery(equipmentPool, `SELECT CASE WHEN sistema_operativo LIKE '%Windows 11%' THEN 'Windows 11' WHEN sistema_operativo LIKE '%Windows 10%' THEN 'Windows 10' WHEN sistema_operativo LIKE '%Windows 7%' THEN 'Windows 7' WHEN sistema_operativo LIKE '%Windows%' THEN 'Windows (otro)' WHEN sistema_operativo LIKE '%Mac%' THEN 'macOS' WHEN sistema_operativo LIKE '%Linux%' THEN 'Linux' ELSE 'Otro' END AS os_group, COUNT(*) AS cantidad FROM sccm_inventory WHERE sistema_operativo IS NOT NULL GROUP BY os_group ORDER BY cantidad DESC`);
        res.json({ success:true, data:rows });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.get('/ram-distribution', async (req,res) => {
    try {
        const rows = await execQuery(equipmentPool, `SELECT memoria_ram AS ram, COUNT(*) AS cantidad FROM sccm_inventory WHERE memoria_ram IS NOT NULL GROUP BY memoria_ram ORDER BY cantidad DESC LIMIT 10`);
        res.json({ success:true, data:rows });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

router.get('/tipo-distribution', async (req,res) => {
    try {
        const rows = await execQuery(equipmentPool, `SELECT tipo_equipo, COUNT(*) AS cantidad FROM sccm_inventory WHERE tipo_equipo IS NOT NULL GROUP BY tipo_equipo ORDER BY cantidad DESC`);
        res.json({ success:true, data:rows });
    } catch(err) { res.status(500).json({ success:false, error:err.message }); }
});

console.log('✅ routes/outlook-sync.js listo | mailbox:', process.env.MS_USER_EMAIL||'(pendiente .env)');
module.exports = router;
