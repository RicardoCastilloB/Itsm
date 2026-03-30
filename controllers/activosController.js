// Controlador de activos CMDB
const db = require('../config/database');

exports.getAll = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM activos');
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM activos WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Activo no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const [result] = await db.query('INSERT INTO activos SET ?', req.body);
    res.status(201).json({ id: result.insertId, ...req.body });
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    await db.query('UPDATE activos SET ? WHERE id = ?', [req.body, req.params.id]);
    res.json({ message: 'Activo actualizado' });
  } catch (error) {
    next(error);
  }
};

exports.delete = async (req, res, next) => {
  try {
    await db.query('DELETE FROM activos WHERE id = ?', [req.params.id]);
    res.json({ message: 'Activo eliminado' });
  } catch (error) {
    next(error);
  }
};
