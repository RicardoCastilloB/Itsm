# Vistas del Sistema — URIs de Páginas

> Todas las rutas requieren sesión autenticada salvo que se indique lo contrario.
> La autenticación se gestiona mediante JWT almacenado en `localStorage` (token Bearer).

---

## Leyenda de acceso

| Símbolo | Significado |
|---------|-------------|
| 🔓 | Pública — no requiere login |
| 🔐 | Requiere `authenticateToken` |
| ✅ | Requiere además `requireVerified` |
| 🛡️ | Solo rol `administrador` |

---

## General

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/` | Redirect → `/index` o `/api/auth/login` | 🔐 | — |
| `/home` | Inicio | 🔓 | `views/home.ejs` |
| `/login` | Iniciar sesión | 🔓 | `views/login.ejs` |
| `/logout` | Cerrar sesión | 🔐 | — (redirect) |

---

## Dashboard & Indicadores

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/index` | Dashboard principal | ✅ | `views/index.ejs` |
| `/dashboard` | Dashboard con estadísticas | ✅ | `views/dashboard.ejs` |
| `/analytics` | Analytics Dashboard | ✅ | `views/analytics.ejs` |
| `/indicators` | Indicadores y Reportes | ✅ | `views/indicators.ejs` |

---

## Equipos (CMDB)

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/equipment` | Lista de equipos | 🔐 | `views/equipment.ejs` |
| `/equipment/:id` | Detalle de equipo | 🔐 | `views/equipment/view.ejs` |
| `/sccm` | Panda / SCCM | 🔓 | `views/sccm.ejs` |
| `/import-csv` | Importar equipos CSV | 🔐 | `views/import-csv.ejs` |

---

## Empleados

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/employees` | Lista de empleados | 🔐 | `views/employees.ejs` |
| `/employees/:id` | Detalle de empleado | 🔐 | `views/employees/view.ejs` |
| `/empleados/perfil` | Mi perfil de empleado | 🔐 | `views/employees-profile.ejs` |
| `/profile` | Mi perfil de usuario | 🔐 | `views/profile.ejs` |
| `/permissions` | Mis permisos | 🔐 | `views/permissions.ejs` |

---

## Asignaciones & Almacén

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/assignments` | Asignaciones activas | 🔐 | `views/assignments/listee.ejs` |
| `/recoveries` | Recupero de equipos | 🔐 | `views/recoveries.ejs` |
| `/almacen` | Almacén de equipos | 🔐 | `views/almacen.ejs` |
| `/warranty` | Garantías | 🔐 | `views/warranty.ejs` |

---

## Reportes

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/reports` | Reportes generales | 🔐 | `views/reports/index.ejs` |
| `/report-lists` | Listas de distribución | 🔐 | `views/report-lists.ejs` |
| `/reports-distribution` | Distribución de reportes | 🔓 | `views/reports-distribution.ejs` |
| `/send-reports` | Envío de reportes | 🔐 | `views/send-reports.ejs` |
| `/print-queue` | Cola de impresión | 🔓 | `views/print-queue.ejs` |

---

## Active Directory

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/ad` | Reporte Active Directory | 🔐 | `views/ad.ejs` |
| `/soporte` | Soporte Técnico — AD | 🔐 | `views/soporte.ejs` |

---

## ITSM — Gestión de Servicio

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/incidencias` | Gestión de Tickets | ✅ | `views/incidencias.ejs` |
| `/solicitudes` | Solicitudes de Servicio | ✅ | `views/solicitudes.ejs` |
| `/cambios` | Gestión de Cambios | ✅ | `views/cambios.ejs` |
| `/problemas` | Gestión de Problemas | ✅ | `views/problemas.ejs` |
| `/catalogo` | Catálogo de Servicios | ✅ | `views/catalogo.ejs` |
| `/cmdb` | CMDB — Inventario CI | ✅ | `views/cmdb.ejs` |

---

## Reportes ITSM & Conocimiento

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/agent-dashboard` | Mi Dashboard (agente) | ✅ | `views/agent-dashboard.ejs` |
| `/admin-dashboard` | Dashboard Administrador | 🛡️ | `views/admin-dashboard.ejs` |
| `/reports-itsm` | Reportes ITSM | ✅ | `views/reports-itsm.ejs` |
| `/knowledge-base` | Base de Conocimiento | ✅ | `views/knowledge-base.ejs` |
| `/csi` | Mejora Continua (CSI) | ✅ | `views/csi.ejs` |

---

## Portal de Autoservicio

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/portal` | Portal — Inicio | ✅ | `views/user/portal.ejs` |
| `/portal/tickets` | Mis Tickets | ✅ | `views/user/portal.ejs` |
| `/portal/ticket/:id` | Detalle de mi Ticket | ✅ | `views/user/mi-ticket.ejs` |

---

## Administración

| URI | Título | Acceso | Vista EJS |
|-----|--------|--------|-----------|
| `/admin` | Panel de Administración | 🛡️ | `views/admin/index.ejs` |
| `/admin/reglas` | Motor de Reglas de Negocio | 🛡️ | `views/admin/reglas.ejs` |
| `/admin/queues` | Bull Board — Monitor de colas | — | Bull Board (built-in) |

---

## Utilidades del sistema

| URI | Descripción |
|-----|-------------|
| `/health` | Health check del servidor (JSON) |
| `/api` | Info general de la API (JSON) |

---

## Notas

- El prefijo `APP_URL` configura la base de todas las URLs (`.env → APP_URL`).
- Las rutas con parámetros (`:id`) capturan UUIDs o integers según el módulo.
- `/almacen` tiene dos manejadores registrados; el segundo sobreescribe el primero y renderiza `almacen_recoveries.ejs`.
- Las rutas de vista siempre preceden a las rutas API en el orden de carga de Express.
