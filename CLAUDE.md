# ITSM Platform — Contexto del proyecto

## Stack
- Node.js + Express, EJS views, Socket.io
- Redis (sesiones + Bull queues), PostgreSQL/MySQL
- Passport.js, Casbin (RBAC), Helmet
- Bull Board en /admin/queues

## Estructura de rutas
- /routes/views.js — todas las vistas centralizadas
- /routes/*.js — APIs REST bajo /api/
- /middleware/ — auth, casbin, passport
- /src/queues/ — emailWorker, slaWorker, reportsWorker
- /src/jobs/ — cron jobs

## Reglas
- No agregar rutas de vistas en app.js
- Siempre usar authenticateToken en rutas protegidas
- Errores: JSON si /api/, HTML si vista
- Multi-tenant: pendiente (Fase 3)

## Objetivo del producto
ITSM SaaS B2B. Módulos activos: tickets, CMDB, SLA, portal, knowledge base, cambios, problemas.