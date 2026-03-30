// Controlador de equipos
const db = require('../config/database');

exports.getAll = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM equipment');
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM equipment WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Equipo no encontradoo' });
    }
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const [result] = await db.query('INSERT INTO equipment SET ?', req.body);
    res.status(201).json({ id: result.insertId, ...req.body });
  } catch (error) {
    next(error);
  }
};

exports.update = async (req, res, next) => {
  try {
    await db.query('UPDATE equipment SET ? WHERE id = ?', [req.body, req.params.id]);
    res.json({ message: 'Equipo actualizado' });
  } catch (error) {
    next(error);
  }
};

exports.delete = async (req, res, next) => {
  try {
    await db.query('DELETE FROM equipment WHERE id = ?', [req.params.id]);
    res.json({ message: 'Equipo eliminado' });
  } catch (error) {
    next(error);
  }
};
