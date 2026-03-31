// ============================================================================
// reset_and_inject.js — Limpia tablas y reinyecta CSV desde cero
// Uso: node reset_and_inject.js ./Asignacion.csv
// ============================================================================

const fs        = require('fs');
const path      = require('path');
const { parse } = require('csv-parse/sync');
const mysql     = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host    : process.env.EQUIPMENT_HOST     || 'localhost',
    user    : process.env.EQUIPMENT_USER     || 'ricardo',
    password: process.env.EQUIPMENT_PASSWORD || 'Misbubus6',
    database: process.env.EQUIPMENT_DATABASE || 'equipment_management',
    port    : process.env.EQUIPMENT_PORT     || 3306,
    waitForConnections: true,
    connectionLimit   : 5,
});

// ============================================================================
// HELPERS
// ============================================================================
const n = v => (v !== undefined && v !== null && String(v).trim() !== '' ? String(v).trim() : null);
const safeEnum   = (val, allowed, def) => allowed.includes((val||'').trim()) ? val.trim() : def;
const mapAcqType = val => ({'propio':'Propio','arrendado':'Arrendado','renting':'Arrendado','leasing':'Leasing','donado':'Donado'})[(val||'').toLowerCase().trim()] || 'Arrendado';
const parseObs   = val => { const m = String(val||'').match(/\d+/); return m ? parseInt(m[0]) : null; };
const parseWarranty = dateStr => {
    if (!n(dateStr)) return null;
    const p = String(dateStr).trim().split('/');
    if (p.length !== 3) return null;
    const t = new Date(`${p[2]}-${p[1]}-${p[0]}`);
    if (isNaN(t)) return null;
    const months = (t.getFullYear() - new Date().getFullYear()) * 12 + (t.getMonth() - new Date().getMonth());
    return months < 0 ? 0 : months;
};
const mapStatus = val => ({'almacen':'Disponible','almacén':'Disponible','disponible':'Disponible','en reparación':'En Reparación','en reparacion':'En Reparación','dado de baja':'Dado de Baja','en tránsito':'En Tránsito','en transito':'En Tránsito','asignado':'Asignado'})[(val||'').toLowerCase().trim()] || 'Disponible';

// ============================================================================
// LEER CSV — detecta encoding y separador automáticamente
// ============================================================================
function readCSV(filePath) {
    const buf = fs.readFileSync(filePath);
    let content;

    if      (buf[0]===0xFF && buf[1]===0xFE) { content = buf.toString('utf16le').replace(/^\uFEFF/,''); }
    else if (buf[0]===0xFE && buf[1]===0xFF) {
        for (let i=0;i<buf.length-1;i+=2){const t=buf[i];buf[i]=buf[i+1];buf[i+1]=t;}
        content = buf.toString('utf16le').replace(/^\uFEFF/,'');
    }
    else if (buf[0]===0xEF && buf[1]===0xBB && buf[2]===0xBF) { content = buf.toString('utf8').slice(1); }
    else { content = buf.toString('utf8'); }

    content = content.replace(/\r\n/g,'\n').replace(/\r/g,'\n');

    const firstLine = content.split('\n')[0] || '';
    const counts = {
        '\t': (firstLine.match(/\t/g)||[]).length,
        ';' : (firstLine.match(/;/g) ||[]).length,
        ',' : (firstLine.match(/,/g) ||[]).length,
    };
    const delimiter = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
    const encName   = buf[0]===0xFF?'UTF-16 LE':buf[0]===0xFE?'UTF-16 BE':buf[0]===0xEF?'UTF-8 BOM':'UTF-8';
    const delName   = delimiter==='\t'?'Tabulador (\\t)':`"${delimiter}"`;

    console.log(`🔍  Encoding  : ${encName}`);
    console.log(`🔍  Separador : ${delName}  (\\t=${counts['\t']} ;=${counts[';']} ,=${counts[',']})`);
    console.log(`🔍  Columnas  : ${counts[delimiter]+1}`);

    // Forzar el separador detectado — deshabilitar relax_quotes
    // para evitar que csv-parse interprete mal columnas con caracteres especiales
    const rows = parse(content, {
        delimiter,
        columns           : true,
        skip_empty_lines  : true,
        trim              : true,
        relax_quotes      : false,  // <-- fix clave
        relax_column_count: true,
        quote             : false,  // no interpretar comillas como delimitador de campo
    });

    if (rows.length > 0) {
        console.log(`✅  Serie ej.     : "${rows[0]['Serie']      || '(vacío fila 1)'}"`);
        console.log(`✅  Empleado ej.  : "${rows[0]['Value.full_name'] || '(vacío fila 1)'}"`);

        // Contar cuántas filas tienen Serie y cuántas tienen empleado
        const conSerie    = rows.filter(r => n(r['Serie'])).length;
        const conEmpleado = rows.filter(r => n(r['Value.full_name'])).length;
        const conAmbos    = rows.filter(r => n(r['Serie']) && n(r['Value.full_name'])).length;
        const soloSerie   = rows.filter(r => n(r['Serie']) && !n(r['Value.full_name'])).length;
        const soloEmp     = rows.filter(r => !n(r['Serie']) && n(r['Value.full_name'])).length;
        const vacias      = rows.filter(r => !n(r['Serie']) && !n(r['Value.full_name'])).length;

        console.log('\n📊  Análisis del CSV:');
        console.log(`    Con serie + empleado : ${conAmbos}`);
        console.log(`    Solo serie (almacén) : ${soloSerie}`);
        console.log(`    Solo empleado        : ${soloEmp}`);
        console.log(`    Filas vacías         : ${vacias}`);
        console.log(`    Total con serie      : ${conSerie}`);
        console.log(`    Total con empleado   : ${conEmpleado}`);
    }

    return rows;
}

// ============================================================================
// LIMPIAR TABLAS
// ============================================================================
async function cleanTables(conn) {
    console.log('\n🗑️  Limpiando tablas...');
    await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['assignments','equipment','employees','departments','locations']) {
        await conn.execute(`TRUNCATE TABLE \`${t}\``);
        console.log(`   ✅ ${t} → vacía`);
    }
    await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
    console.log('🔑  FK checks restaurados');
}

// ============================================================================
// CACHE en memoria
// ============================================================================
const deptCache = new Map();
const locCache  = new Map();
const empCache  = new Map();

async function insertDepartment(conn, row) {
    const name = n(row['Value.department_name']);
    if (!name) return null;
    if (deptCache.has(name)) return deptCache.get(name);
    const [r] = await conn.execute(
        `INSERT INTO departments
            (department_name,division,subactivity,
             desc_ceo,desc_ceo_1,desc_ceo_2,desc_ceo_3,
             desc_ceo_4,desc_ceo_5,desc_ceo_6,desc_ceo_7,is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
        [name,
         n(row['Value.division']),   n(row['Value.subactivity']),
         n(row['Value.desc_ceo']),   n(row['Value.desc_ceo_1']),
         n(row['Value.desc_ceo_2']), n(row['Value.desc_ceo_3']),
         n(row['Value.desc_ceo_4']), n(row['Value.desc_ceo_5']),
         n(row['Value.desc_ceo_6']), n(row['Value.desc_ceo_7'])]
    );
    deptCache.set(name, r.insertId);
    return r.insertId;
}

async function insertLocation(conn, row) {
    const branchId = n(row['Value.branch_office_id']);
    if (!branchId) return null;
    if (locCache.has(branchId)) return locCache.get(branchId);
    const [r] = await conn.execute(
        `INSERT INTO locations (branch_office_id,location_name,city,state,country,is_active)
         VALUES (?,?,?,?,?,1)`,
        [branchId, branchId, n(row['Value.state'])||branchId, n(row['Value.state']), 'Perú']
    );
    locCache.set(branchId, r.insertId);
    return r.insertId;
}

async function insertEmployee(conn, row, deptId) {
    const cip      = n(row['Value.cip']);
    const natId    = n(row['Value.national_id']);
    const fullName = n(row['Value.full_name']);
    if (!fullName) return null;
    const key = cip || natId || fullName;
    if (empCache.has(key)) return empCache.get(key);
    const [r] = await conn.execute(
        `INSERT INTO employees
            (cip,national_id,document_type,full_name,email,
             department_id,position_name,category,employee_group,
             legal_entity,branch_office_id,state,network_account,supervisor_name,is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [cip||'', natId||'',
         safeEnum(row['Value.document_type'],['DNI','CE','PASAPORTE','RUC'],'DNI'),
         fullName, n(row['Value.email'])||'',
         deptId,
         n(row['Value.position_name']), n(row['Value.category']),
         safeEnum(row['Value.employee_group'],['EMP','EJC','OTROS'],'EMP'),
         n(row['Value.legal_entity'])||'T. PERU',
         n(row['Value.branch_office_id']), n(row['Value.state']),
         n(row['Cta de red']), n(row['Value.supervisor_name'])]
    );
    empCache.set(key, r.insertId);
    return r.insertId;
}

async function insertEquipment(conn, row) {
    const serial = n(row['Serie']);
    if (!serial) return null;
    const [r] = await conn.execute(
        `INSERT INTO equipment
            (device_code,serial_number,equipment_type,brand,model,
             processor,operating_system,disk_capacity,ram_memory,
             acquisition_type,obsolescence_years,warranty_months,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [n(row['Equipo Asignado'])||'', serial,
         safeEnum(row['TIPO'],['Laptop','Desktop','Tablet','Smartphone','Monitor','Otro'],'Laptop'),
         n(row['Marca'])||'', n(row['Modelo'])||'',
         n(row['Procesador']), n(row['Sistema Operaivo']),
         n(row['DISCO']), n(row['MEMORIA']),
         mapAcqType(row['Tipo de Adquisicion']),
         parseObs(row['OBSOLECENCIA']),
         parseWarranty(row['Fecha de vencimiento']),
         mapStatus(row['Estado'])]
    );
    return r.insertId;
}

async function insertAssignment(conn, empId, eqId, deptId, locId, row) {
    if (!empId || !eqId) return null;
    const [r] = await conn.execute(
        `INSERT INTO assignments
            (employee_id,equipment_id,department_id,location_id,
             period,assignment_date,status,relation_type)
         VALUES (?,?,?,?,?,CURDATE(),'Activo',?)`,
        [empId, eqId, deptId, locId,
         n(row['Value.period'])||'202512',
         n(row['Tipo de Relacion'])||'Equipo Unico']
    );
    await conn.execute(`UPDATE equipment SET status='Asignado' WHERE id=?`,[eqId]);
    return r.insertId;
}

// ============================================================================
// INSERTAR FILAS
// ============================================================================
async function insertRows(rows) {
    const stats = {
        total        : rows.length,
        con_ambos    : 0,   // equipo + empleado + assignment
        solo_equipo  : 0,   // equipo sin empleado (almacén)
        solo_empleado: 0,   // empleado sin equipo
        skipped      : 0,   // fila sin nada útil
        errors       : [],
    };
    const conn = await pool.getConnection();

    for (let i = 0; i < rows.length; i++) {
        const row    = rows[i];
        const rowNum = i + 2;
        try {
            await conn.beginTransaction();

            const deptId = await insertDepartment(conn, row);
            const locId  = await insertLocation(conn, row);
            const empId  = await insertEmployee(conn, row, deptId);
            const eqId   = await insertEquipment(conn, row);

            // Nada útil → skip
            if (!eqId && !empId) {
                await conn.rollback();
                stats.skipped++;
                continue;
            }

            if (eqId && empId) {
                // Equipo + empleado → assignment
                await insertAssignment(conn, empId, eqId, deptId, locId, row);
                stats.con_ambos++;
            } else if (eqId) {
                // Solo equipo (en almacén, sin asignar)
                stats.solo_equipo++;
            } else {
                // Solo empleado
                stats.solo_empleado++;
            }

            await conn.commit();

            const done = stats.con_ambos + stats.solo_equipo + stats.solo_empleado;
            if (done % 100 === 0) process.stdout.write(`  ⏳ ${done}/${stats.total}\r`);

        } catch (err) {
            await conn.rollback();
            stats.errors.push({ row: rowNum, serie: row['Serie']||'—', error: err.message });
        }
    }

    conn.release();
    return stats;
}

// ============================================================================
// CONFIRMACIÓN
// ============================================================================
function askConfirmation(q) {
    return new Promise(resolve => {
        process.stdout.write(q);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', d => { process.stdin.pause(); resolve(d.trim().toLowerCase()); });
    });
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
    const csvPath = process.argv[2];
    if (!csvPath)                { console.error('\n❌  Uso: node reset_and_inject.js ./Asignacion.csv\n'); process.exit(1); }
    if (!fs.existsSync(csvPath)) { console.error(`\n❌  Archivo no encontrado: ${csvPath}\n`); process.exit(1); }

    console.log('\n' + '═'.repeat(62));
    console.log('⚠️   RESET + INYECCIÓN CSV → equipment_management');
    console.log('═'.repeat(62));
    console.log(`📄  Archivo: ${path.resolve(csvPath)}\n`);

    // 1. Leer CSV primero — si falla, no borramos nada
    let rows;
    try {
        rows = readCSV(csvPath);
        console.log(`\n📊  Total filas: ${rows.length}`);
    } catch (e) {
        console.error('❌  Error leyendo CSV:', e.message);
        process.exit(1);
    }

    if (rows.length === 0) { console.error('\n❌  CSV vacío.\n'); process.exit(1); }
    if (rows[0]['Serie'] === undefined) {
        console.error('\n❌  Columna "Serie" no encontrada. Revisa el archivo.\n');
        process.exit(1);
    }

    // 2. Confirmar antes de borrar
    console.log('\n⚠️  Se borrarán: assignments, equipment, employees, departments, locations\n');
    const ans = await askConfirmation('¿Confirmas? Escribe "si" para continuar: ');
    if (ans !== 'si') { console.log('\n❌  Cancelado. DB intacta.\n'); process.exit(0); }

    // 3. Conectar
    try {
        const c = await pool.getConnection();
        console.log('\n✅  Conexión DB: OK');
        c.release();
    } catch (e) { console.error('❌  No se pudo conectar:', e.message); process.exit(1); }

    // 4. Limpiar
    const cleanConn = await pool.getConnection();
    await cleanTables(cleanConn);
    cleanConn.release();

    // 5. Insertar
    console.log('\n⏳  Insertando...\n');
    const start = Date.now();

    // Limpiar caches por si se reutiliza
    deptCache.clear(); locCache.clear(); empCache.clear();

    const stats = await insertRows(rows);
    const secs  = ((Date.now() - start) / 1000).toFixed(1);

    const total = stats.con_ambos + stats.solo_equipo + stats.solo_empleado;

    console.log('\n' + '═'.repeat(62));
    console.log('📋  RESULTADO FINAL');
    console.log('═'.repeat(62));
    console.log(`✅  Equipo + empleado + assign : ${stats.con_ambos}`);
    console.log(`📦  Solo equipo (almacén)      : ${stats.solo_equipo}`);
    console.log(`👤  Solo empleado              : ${stats.solo_empleado}`);
    console.log(`⏭️   Filas vacías omitidas      : ${stats.skipped}`);
    console.log(`❌  Errores                    : ${stats.errors.length}`);
    console.log(`📊  Total insertados           : ${total}`);
    console.log(`⏱️   Tiempo                     : ${secs}s`);

    if (stats.errors.length) {
        console.log('\n⚠️  PRIMEROS 20 ERRORES:');
        console.log('─'.repeat(62));
        stats.errors.slice(0,20).forEach(e =>
            console.log(`  Fila ${String(e.row).padStart(4)} │ ${String(e.serie).padEnd(15)} │ ${e.error}`)
        );
        if (stats.errors.length > 20) console.log(`  ... y ${stats.errors.length-20} más`);
    }

    console.log('\n' + '═'.repeat(62) + '\n');
    await pool.end();
}

main().catch(err => { console.error('\n❌ Error fatal:', err.message); process.exit(1); });
