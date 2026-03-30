// routes/import.js
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/import/csv  — recibe archivo CSV por multipart/form-data
// ─────────────────────────────────────────────────────────────────────────────

const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const { parse } = require('csv-parse/sync');
const fs        = require('fs');
const path      = require('path');

const { importCSVRows }     = require('../services/importService');
const { authenticateToken } = require('../middleware/auth');

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `csv_${Date.now()}_${file.originalname}`);
    },
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (!/\.(csv|tsv|txt)$/i.test(file.originalname)) {
            return cb(new Error('Solo archivos .csv / .tsv / .txt'));
        }
        cb(null, true);
    },
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ── Parser ────────────────────────────────────────────────────────────────────
function readAndParseCSV(filePath, delimiter = '\t') {
    const raw     = fs.readFileSync(filePath, { encoding: 'utf8' });
    const content = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw; // BOM

    return parse(content, {
        delimiter,
        columns           : true,
        skip_empty_lines  : true,
        trim              : true,
        relax_quotes      : true,
        relax_column_count: true,
    });
}

// ── POST /api/import/csv ──────────────────────────────────────────────────────
// Form-data: field "file"
// Query:     ?delimiter=tab | comma | semicolon   (default: tab)
router.post('/csv', authenticateToken, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No se recibió archivo' });
    }

    const delimMap  = { comma: ',', semicolon: ';', tab: '\t' };
    const delimiter = delimMap[req.query.delimiter] ?? '\t';
    const filePath  = req.file.path;

    try {
        const rows = readAndParseCSV(filePath, delimiter);

        if (!rows.length) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ success: false, error: 'El archivo está vacío' });
        }

        const results = await importCSVRows(rows);

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        return res.json({
            success     : true,
            message     : 'Importación completada',
            total       : rows.length,
            inserted    : results.success,
            skipped     : results.skipped,
            errors      : results.errors.length,
            errorDetails: results.errors,
        });

    } catch (err) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        console.error('❌ Error importación CSV:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/import/status ────────────────────────────────────────────────────
router.get('/status', authenticateToken, (req, res) => {
    res.json({ success: true, module: 'CSV Importer', status: 'ready' });
});

module.exports = router;
