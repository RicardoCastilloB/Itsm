# Guía de migración a PostgreSQL

Este proyecto usa MySQL actualmente. Gracias a Sequelize como capa de abstracción,
migrar a PostgreSQL requiere cambios mínimos y controlados.

---

## Paso 1 — Cambiar el dialect en `src/config/database.js`

```js
// Antes
dialect: 'mysql',

// Después
dialect: 'postgres',
```

Instalar el driver de PostgreSQL:

```bash
npm install pg pg-hstore
npm uninstall mysql2
```

---

## Paso 2 — Ajustar tipos de datos en los modelos

| MySQL                        | PostgreSQL equivalente        | Modelos afectados         |
|------------------------------|-------------------------------|---------------------------|
| `DataTypes.UUID`             | Sin cambio                    | User                      |
| `DataTypes.BOOLEAN`          | Sin cambio                    | User, Role                |
| `DataTypes.DATE`             | Sin cambio                    | AuditLog, User            |
| `ENUM('a','b')`              | Crear tipo con `CREATE TYPE`  | User (campo `rol`)        |
| `DataTypes.TEXT`             | Sin cambio                    | AuditLog                  |
| Funciones: `NOW()`           | Sin cambio                    | Queries raw               |
| Funciones: `DATE_ADD()`      | Usar `NOW() + INTERVAL`       | auth.js refresh_tokens    |
| `CURDATE()`                  | `CURRENT_DATE`                | dashboard.js              |
| Auto-increment `INTEGER`     | `DataTypes.INTEGER` + serial  | Role, Permission, AuditLog|

### ENUM en PostgreSQL

En PostgreSQL los ENUM son tipos personalizados. Sequelize los maneja automáticamente,
pero si tienes migraciones manuales necesitas:

```sql
CREATE TYPE enum_users_rol AS ENUM ('admin', 'agente', 'usuario', 'supervisor');
```

---

## Paso 3 — Revisar queries raw con sintaxis MySQL-específica

Buscar y reemplazar en `/routes/`:

```bash
# Funciones de fecha
grep -rn "DATE_ADD\|CURDATE\|DATE_FORMAT\|STR_TO_DATE" routes/
```

| MySQL                                        | PostgreSQL                                      |
|----------------------------------------------|-------------------------------------------------|
| `DATE_ADD(NOW(), INTERVAL ? SECOND)`         | `NOW() + INTERVAL '? seconds'`                  |
| `DATE_FORMAT(col, '%Y-%m')`                  | `TO_CHAR(col, 'YYYY-MM')`                       |
| `STR_TO_DATE(?, '%Y-%m-%d')`                 | `TO_DATE(?, 'YYYY-MM-DD')`                      |
| `CURDATE()`                                  | `CURRENT_DATE`                                  |
| `LIMIT ?, ?` (offset)                        | `LIMIT ? OFFSET ?`                              |
| `INSERT IGNORE INTO`                         | `INSERT INTO ... ON CONFLICT DO NOTHING`        |

---

## Paso 4 — Stored Procedures

PostgreSQL no tiene Stored Procedures de la misma forma que MySQL.
Reemplazar cada `CALL sp_nombre(?)` por una función PostgreSQL o mover
la lógica a la capa de aplicación (Node.js).

Stored procedures en uso actualmente:

```bash
grep -rn "callStoredProcedure\|CALL sp_" routes/
```

---

## Paso 5 — Crear la base de datos y ejecutar migraciones

```bash
# Crear BD en PostgreSQL
psql -U postgres -c "CREATE DATABASE equipment_management;"

# Actualizar .env
DB_DIALECT=postgres
EQUIPMENT_HOST=localhost
EQUIPMENT_PORT=5432
EQUIPMENT_DATABASE=equipment_management
EQUIPMENT_USER=postgres
EQUIPMENT_PASSWORD=tu_password

# Ejecutar migraciones desde cero
npm run migrate
npm run seed
```

---

## Paso 6 — Verificar

```bash
npm run dev
# Revisar logs de conexión — debe aparecer:
# ✅ Conexión exitosa a Equipment Management (Sequelize)
```

Probar endpoints críticos:
- `POST /api/auth/login`
- `GET /api/equipment`
- `GET /api/dashboard`
- `GET /api/assignments`

---

## Notas adicionales

- Redis no cambia — es independiente de la BD.
- Las sesiones y JWT no cambian.
- Los archivos en `/uploads/` no se ven afectados.
- El `.env` debe actualizarse en producción antes del deploy.
