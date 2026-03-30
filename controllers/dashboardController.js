// Controlador de dashboard
const db = require('../config/database');

exports.getStats = async (req, res, next) => {
  try {
    const [employees] = await db.query('SELECT COUNT(*) as total FROM employees');
    const [equipment] = await db.query('SELECT COUNT(*) as total FROM equipment');
    const [activos] = await db.query('SELECT COUNT(*) as total FROM activos');
    
    res.json({
      employees: employees[0].total,
      equipment: equipment[0].total,
      activos: activos[0].total
    });
  } catch (error) {
    next(error);
  }
};

exports.getRecent = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM assignments ORDER BY created_at DESC LIMIT 10'
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
};
