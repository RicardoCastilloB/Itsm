const winston = require('winston');
const path    = require('path');

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Formato personalizado
const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
});

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
    ),
    transports: [
        // Consola
        new winston.transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                errors({ stack: true }),
                logFormat
            ),
        }),
        // Archivo errores
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/error.log'),
            level:    'error',
        }),
        // Archivo general
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/combined.log'),
        }),
    ],
});

module.exports = logger;