// services/importService.js — INICIO DEL ARCHIVO
const { equipmentPool, executeTransaction } = require('../config/db');

// Helper: normaliza vacíos a null
const n = v => (v && String(v).trim() !== '' ? String(v).trim() : null);

function safeEnum(val, allowed, def) {
    return allowed.includes((val || '').trim()) ? val.trim() : def;
}
function parseObsolescence(val) {
    const m = String(val || '').match(/\d+/);
    return m ? parseInt(m[0]) : null;
}
function parseWarrantyMonths(dateStr) {
    if (!dateStr || !dateStr.trim()) return null;
    const [day, month, year] = dateStr.trim().split('/');
    const target = new Date(`${year}-${month}-${day}`);
    if (isNaN(target)) return null;
    const months = (target.getFullYear() - new Date().getFullYear()) * 12
                 + (target.getMonth() - new Date().getMonth());
    return months < 0 ? 0 : months;
}
function mapEquipmentStatus(val) {
    const map = {
        'almacen':'Disponible','almacén':'Disponible','disponible':'Disponible',
        'en reparación':'En Reparación','dado de baja':'Dado de Baja',
        'en tránsito':'En Tránsito','asignado':'Asignado'
    };
    return map[(val||'').toLowerCase().trim()] || 'Disponible';
}

// ── Las funciones upsert usan conn.execute() en lugar de conn.query() ──

async function upsertDepartment(conn, row) {
    const name = n(row['Value.department_name']);
    if (!name) return null;
    const [found] = await conn.execute(
        'SELECT id FROM departments WHERE department_name = ? LIMIT 1', [name]
    );
    if (found.length) return found[0].id;
    const [r] = await conn.execute(
        `INSERT INTO departments
         (department_name,division,subactivity,desc_ceo,desc_ceo_1,
          desc_ceo_2,desc_ceo_3,desc_ceo_4,desc_ceo_5,desc_ceo_6,desc_ceo_7,is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
        [name,n(row['Value.division']),n(row['Value.subactivity']),
         n(row['Value.desc_ceo']),n(row['Value.desc_ceo_1']),n(row['Value.desc_ceo_2']),
         n(row['Value.desc_ceo_3']),n(row['Value.desc_ceo_4']),n(row['Value.desc_ceo_5']),
         n(row['Value.desc_ceo_6']),n(row['Value.desc_ceo_7'])]
    );
    return r.insertId;
}

async function upsertLocation(conn, row) {
    const branchId = n(row['Value.branch_office_id']);
    if (!branchId) return null;
    const [found] = await conn.execute(
        'SELECT id FROM locations WHERE branch_office_id = ? LIMIT 1', [branchId]
    );
    if (found.length) return found[0].id;
    const [r] = await conn.execute(
        `INSERT INTO locations (branch_office_id,location_name,city,state,country,is_active)
         VALUES (?,?,?,?,?,1)`,
        [branchId, branchId, n(row['Value.state'])||branchId,
         n(row['Value.state']), 'Perú']
    );
    return r.insertId;
}

async function upsertEmployee(conn, row, deptId) {
    const cip = n(row['Value.cip']), natId = n(row['Value.national_id']);
    const fullName = n(row['Value.full_name']);
    if (!fullName) return null;

    let empId = null;
    if (cip) {
        const [r] = await conn.execute(
            'SELECT id FROM employees WHERE cip = ? LIMIT 1', [cip]);
        if (r.length) empId = r[0].id;
    }
    if (!empId && natId) {
        const [r] = await conn.execute(
            'SELECT id FROM employees WHERE national_id = ? LIMIT 1', [natId]);
        if (r.length) empId = r[0].id;
    }
    if (empId) {
        await conn.execute(
            `UPDATE employees SET
             full_name=?,email=COALESCE(NULLIF(?,''),email),
             department_id=COALESCE(?,department_id),
             position_name=COALESCE(NULLIF(?,''),position_name),
             category=COALESCE(NULLIF(?,''),category),
             supervisor_name=COALESCE(NULLIF(?,''),supervisor_name),
             network_account=COALESCE(NULLIF(?,''),network_account),
             updated_at=NOW() WHERE id=?`,
            [fullName,n(row['Value.email']),deptId,
             n(row['Value.position_name']),n(row['Value.category']),
             n(row['Value.supervisor_name']),n(row['Cta de red']),empId]
        );
        return empId;
    }
    const [r] = await conn.execute(
        `INSERT INTO employees
         (cip,national_id,document_type,full_name,email,department_id,
          position_name,category,employee_group,legal_entity,
          branch_office_id,state,network_account,supervisor_name,is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [cip||'',natId||'',
         safeEnum(row['Value.document_type'],['DNI','CE','PASAPORTE','RUC'],'DNI'),
         fullName,n(row['Value.email'])||'',deptId,
         n(row['Value.position_name']),n(row['Value.category']),
         safeEnum(row['Value.employee_group'],['EMP','EJC','OTROS'],'EMP'),
         n(row['Value.legal_entity'])||'T. PERU',
         n(row['Value.branch_office_id']),n(row['Value.state']),
         n(row['Cta de red']),n(row['Value.supervisor_name'])]
    );
    return r.insertId;
}

async function upsertEquipment(conn, row) {
    const serial = n(row['Serie']);
    if (!serial) return null;
    const eqType  = safeEnum(row['TIPO'],['Laptop','Desktop','Tablet','Smartphone','Monitor','Otro'],'Laptop');
    const acqType = safeEnum(row['Tipo de Adquisicion'],['Propio','Arrendado','Leasing','Donado'],'Arrendado');
    const [found] = await conn.execute(
        'SELECT id FROM equipment WHERE serial_number = ? LIMIT 1', [serial]);
    if (found.length) {
        await conn.execute(
            `UPDATE equipment SET
             device_code=COALESCE(NULLIF(?,''),device_code),equipment_type=?,
             brand=COALESCE(NULLIF(?,''),brand),model=COALESCE(NULLIF(?,''),model),
             processor=COALESCE(NULLIF(?,''),processor),
             operating_system=COALESCE(NULLIF(?,''),operating_system),
             disk_capacity=COALESCE(NULLIF(?,''),disk_capacity),
             ram_memory=COALESCE(NULLIF(?,''),ram_memory),
             acquisition_type=?,obsolescence_years=COALESCE(?,obsolescence_years),
             warranty_months=COALESCE(?,warranty_months),updated_at=NOW()
             WHERE serial_number=?`,
            [n(row['Equipo Asignado']),eqType,n(row['Marca']),n(row['Modelo']),
             n(row['Procesador']),n(row['Sistema Operaivo']),
             n(row['DISCO']),n(row['MEMORIA']),acqType,
             parseObsolescence(row['OBSOLECENCIA']),
             parseWarrantyMonths(row['Fecha de vencimiento']),serial]
        );
        return found[0].id;
    }
    const [r] = await conn.execute(
        `INSERT INTO equipment
         (device_code,serial_number,equipment_type,brand,model,processor,
          operating_system,disk_capacity,ram_memory,acquisition_type,
          obsolescence_years,warranty_months,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [n(row['Equipo Asignado'])||'',serial,eqType,
         n(row['Marca'])||'',n(row['Modelo'])||'',
         n(row['Procesador']),n(row['Sistema Operaivo']),
         n(row['DISCO']),n(row['MEMORIA']),acqType,
         parseObsolescence(row['OBSOLECENCIA']),
         parseWarrantyMonths(row['Fecha de vencimiento']),
         mapEquipmentStatus(row['Estado'])]
    );
    return r.insertId;
}

async function createAssignment(conn, empId, eqId, deptId, locId, row) {
    if (!empId || !eqId) return null;
    const [ex] = await conn.execute(
        `SELECT id FROM assignments WHERE equipment_id=? AND status='Activo' LIMIT 1`,[eqId]);
    if (ex.length) return ex[0].id;
    const [r] = await conn.execute(
        `INSERT INTO assignments
         (employee_id,equipment_id,department_id,location_id,
          period,assignment_date,status,relation_type)
         VALUES (?,?,?,?,?,CURDATE(),'Activo',?)`,
        [empId,eqId,deptId,locId,
         n(row['Value.period'])||'202512',
         n(row['Tipo de Relacion'])||'Equipo Unico']
    );
    await conn.execute(`UPDATE equipment SET status='Asignado' WHERE id=?`,[eqId]);
    return r.insertId;
}

// ── FUNCIÓN PRINCIPAL ────────────────────────────────────────────────────────
async function importCSVRows(rows) {
    const results = { success: 0, skipped: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i], rowNum = i + 2;
        try {
            let skipped = false;
            await executeTransaction(equipmentPool, async (conn) => {
                const deptId = await upsertDepartment(conn, row);
                const locId  = await upsertLocation(conn, row);
                const empId  = await upsertEmployee(conn, row, deptId);
                const eqId   = await upsertEquipment(conn, row);
                if (!eqId) { skipped = true; return; }
                await createAssignment(conn, empId, eqId, deptId, locId, row);
            });
            skipped ? results.skipped++ : results.success++;
        } catch (err) {
            console.error(`❌ Fila ${rowNum}:`, err.message);
            results.errors.push({ row: rowNum, serie: row['Serie']||'—', error: err.message });
        }
    }
    return results;
}

module.exports = { importCSVRows };