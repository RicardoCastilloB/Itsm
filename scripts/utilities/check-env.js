#!/usr/bin/env node
/**
 * check-env.js — Validates required environment variables before app start.
 *
 * Usage (add to package.json scripts or Dockerfile CMD):
 *   node scripts/utilities/check-env.js
 *
 * Exits with code 1 if any REQUIRED variable is missing.
 * Warns (but continues) for RECOMMENDED variables.
 */
'use strict';

require('dotenv').config();

const REQUIRED = [
  'EQUIPMENT_HOST',
  'EQUIPMENT_USER',
  'EQUIPMENT_PASSWORD',
  'EQUIPMENT_DATABASE',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'SESSION_SECRET',
];

const RECOMMENDED = [
  'APP_URL',
  'ALLOWED_ORIGINS',
  'MS_CLIENT_ID',
  'MS_TENANT_ID',
  'MS_CLIENT_SECRET',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'GROQ_API_KEY',
  'METRICS_TOKEN',
];

const INSECURE_DEFAULTS = {
  JWT_SECRET:         'cambia_esto_en_produccion',
  JWT_REFRESH_SECRET: 'cambia_esto_en_produccion',
  SESSION_SECRET:     'cambia_esto_en_produccion',
};

const env  = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
let hasError = false;

console.log(`\n🔍  Verificando variables de entorno (NODE_ENV=${env})\n`);

// ── Required ──────────────────────────────────────────────────────────────────
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`  ❌  REQUERIDA faltante: ${key}`);
    hasError = true;
  } else if (isProd && INSECURE_DEFAULTS[key] && process.env[key] === INSECURE_DEFAULTS[key]) {
    console.error(`  ❌  ${key} usa el valor por defecto inseguro en producción. Cámbialo.`);
    hasError = true;
  } else {
    console.log(`  ✓   ${key}`);
  }
}

// ── Recommended ───────────────────────────────────────────────────────────────
console.log('');
for (const key of RECOMMENDED) {
  if (!process.env[key]) {
    console.warn(`  ⚠️   RECOMENDADA faltante: ${key} (funcionalidad reducida)`);
  } else {
    console.log(`  ✓   ${key}`);
  }
}

// ── JWT secret strength (production only) ─────────────────────────────────────
if (isProd) {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32) {
    console.error('\n  ❌  JWT_SECRET debe tener al menos 32 caracteres en producción.');
    hasError = true;
  }
}

console.log('');

if (hasError) {
  console.error('❌  Faltan variables requeridas. Corrige el entorno antes de iniciar.\n');
  process.exit(1);
} else {
  console.log('✅  Todas las variables requeridas están presentes.\n');
}
