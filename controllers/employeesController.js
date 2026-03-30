// Controlador de empleados
const db = require('../config/database');

exports.getAll = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM employees');
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM employees WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Empleado no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const [result] = await db.query('INSERT INTO employees SET ?', req.body);
    res.status(201).json({ id: result.insertId, ...req.body });
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    await db.query('UPDATE employees SET ? WHERE id = ?', [req.body, req.params.id]);
    res.json({ message: 'Empleado actualizado' });
  } catch (error) {
    next(error);
  }
};

exports.delete = async (req, res, next) => {
  try {
    await db.query('DELETE FROM employees WHERE id = ?', [req.params.id]);
    res.json({ message: 'Empleado eliminado' });
  } catch (error) {
    next(error);
  }
};

