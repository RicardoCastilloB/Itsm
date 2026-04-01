// src/config/redis.js — Conexión Redis con ioredis
require('dotenv').config();
const Redis = require('ioredis');

const redisConfig = {
    host:           process.env.REDIS_HOST     || 'localhost',
    port:           parseInt(process.env.REDIS_PORT) || 6379,
    password:       process.env.REDIS_PASSWORD || undefined,
    db:             parseInt(process.env.REDIS_DB)   || 0,
    maxRetriesPerRequest: null,   // requerido por Bull
    enableReadyCheck:     false,  // requerido por Bull
    retryStrategy(times) {
        if (times > 10) return null;           // deja de reintentar
        return Math.min(times * 200, 3000);   // backoff
    },
};

const redis = new Redis(redisConfig);

redis.on('connect',  () => require('../../utils/logger').info('✅ Redis conectado'));
redis.on('error',    (err) => require('../../utils/logger').warn(`⚠️  Redis error: ${err.message}`));
redis.on('close',    () => require('../../utils/logger').warn('⚠️  Redis desconectado'));

module.exports = redis;
module.exports.redisConfig = redisConfig;
