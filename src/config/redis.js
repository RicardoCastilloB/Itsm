'use strict';

// In-memory TTL cache — drop-in replacement for ioredis
// Usado por FeatureFlagService y ViewResolver (cache de features/branding por tenant)
const _store = new Map();

const cache = {
    async get(key) {
        const entry = _store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.exp) { _store.delete(key); return null; }
        return entry.val;
    },
    async setex(key, ttlSeconds, value) {
        _store.set(key, { val: value, exp: Date.now() + ttlSeconds * 1000 });
    },
    async del(key) { _store.delete(key); },
};

module.exports = cache;
module.exports.redisConfig = {}; // conservado por si algún require lo desestructura
