# Guía de Despliegue — Azure App Service

## Stack de producción
- Node.js 20 LTS en Azure App Service (Linux)
- MySQL remoto externo (Sequelize ORM)
- Sesiones en MySQL via connect-session-sequelize
- Colas en MySQL via MysqlQueue (polling 2s)
- Cache in-memory (sin Redis)
- Auth: JWT local + Microsoft SSO (MSAL)

---

## Variables de entorno requeridas en Azure

Configúralas en: **Portal Azure → App Service → Configuración → Configuración de la aplicación**

### CRÍTICAS (app no arranca sin estas)

| Variable | Descripción |
|---|---|
| `NODE_ENV` | `production` |
| `EQUIPMENT_HOST` | Host del servidor MySQL |
| `EQUIPMENT_USER` | Usuario MySQL |
| `EQUIPMENT_PASSWORD` | Contraseña MySQL |
| `EQUIPMENT_DATABASE` | Nombre de la base de datos |
| `JWT_SECRET` | Mínimo 32 chars aleatorios |
| `JWT_REFRESH_SECRET` | Diferente al JWT_SECRET, mínimo 32 chars |
| `SESSION_SECRET` | Mínimo 32 chars aleatorios |

> Generar secrets seguros: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### IMPORTANTES (funcionalidad reducida sin estas)

| Variable | Descripción |
|---|---|
| `APP_URL` | `https://[nombre].azurewebsites.net` (sin trailing slash) |
| `ALLOWED_ORIGINS` | Igual que APP_URL para CORS |
| `MS_CLIENT_ID` | Client ID del App Registration en Azure AD |
| `MS_TENANT_ID` | Tenant ID de tu organización Azure AD |
| `MS_CLIENT_SECRET` | Secreto generado en Azure AD |

### OPCIONALES

| Variable | Descripción | Default |
|---|---|---|
| `PORT` | Puerto (Azure lo asigna automáticamente) | 8080 |
| `EQUIPMENT_PORT` | Puerto MySQL | 3306 |
| `DB_POOL_MAX` | Máx conexiones en pool | 10 |
| `SMTP_HOST` | Servidor SMTP para emails | — |
| `SMTP_USER` | Usuario SMTP | — |
| `SMTP_PASS` | Contraseña SMTP | — |
| `SMTP_FROM` | Dirección remitente | — |
| `MAIL_FROM_NAME` | Nombre remitente | — |
| `GROQ_API_KEY` | Para funciones de IA | — |
| `JIRA_HOST` | Integración Jira | — |
| `JIRA_EMAIL` | Auth Jira | — |
| `JIRA_API_TOKEN` | Token Jira | — |
| `SLACK_BOT_TOKEN` | Notificaciones Slack | — |
| `METRICS_TOKEN` | Protege /metrics | — |

---

## Azure AD App Registration

1. Portal Azure → **Azure Active Directory → Registros de aplicaciones → Nueva registro**
2. Nombre: `ITSM Platform`
3. Tipos de cuenta: **Solo cuentas de este directorio organizativo (Single tenant)**
4. URI de redirección: Plataforma **Web** → `https://[nombre].azurewebsites.net/api/auth/microsoft/callback`
5. Registrar → copiar **Client ID** y **Tenant ID**
6. **Certificados y secretos → Nuevo secreto de cliente** → Descripción: `production` → Expira: 24 meses → Copiar valor inmediatamente
7. **Permisos de API → Agregar permiso → Microsoft Graph → Permisos delegados:**
   - `openid`, `profile`, `email`, `User.Read`
   - Clic en **Conceder consentimiento de administrador**

---

## Crear App Service

```
Portal Azure → Crear recurso → App Service

Configuración:
- Nombre: [nombre-único] (quedará [nombre].azurewebsites.net)
- Publicar: Código
- Pila en tiempo de ejecución: Node 20 LTS
- Sistema operativo: Linux
- Región: East US 2 (o la más cercana a tu MySQL)
- Plan: B1 Basic (~13 USD/mes) o F1 Free (para staging)
```

---

## Conectar GitHub (Deployment Center)

1. App Service → **Centro de implementación**
2. Origen: **GitHub**
3. Autorizar con tu cuenta de GitHub
4. Organización / Repositorio / Rama: `main` (producción) o `develop` (staging)
5. Tipo de compilación: **GitHub Actions**
6. Guardar → verificar el primer deploy en la pestaña **Registros**

El workflow quedará en `.github/workflows/main_[nombre].yml`

---

## Verificar primer deploy

### Logs en tiempo real
```bash
az webapp log tail --name [nombre-app] --resource-group [grupo]
```

### Endpoints de salud
```
GET https://[nombre].azurewebsites.net/health       → { "status": "OK" }
GET https://[nombre].azurewebsites.net/health/live  → { "alive": true }
GET https://[nombre].azurewebsites.net/health/ready → { "ready": true }
```

### Qué buscar en los logs al arrancar
```
✅ Todas las variables requeridas están presentes.
✅ Conexión exitosa a Equipment Management (Sequelize)
🚀 EQUIPMENT MANAGEMENT SYSTEM — SERVER STARTED
```

---

## Staging gratuito

```
Crear segundo App Service:
- Nombre: [nombre]-staging
- Plan: F1 Free
- Rama GitHub: develop
- Mismas variables pero:
    EQUIPMENT_DATABASE=[base_de_datos_test]
    APP_URL=https://[nombre]-staging.azurewebsites.net
    ALLOWED_ORIGINS=https://[nombre]-staging.azurewebsites.net
```

Registrar también el redirect URI del staging en Azure AD:
`https://[nombre]-staging.azurewebsites.net/api/auth/microsoft/callback`

---

## Flujo de trabajo Git

### Desarrollo diario
```bash
git checkout develop
# ... hacer cambios ...
git add [archivos]
git commit -m "feat: descripción"
git push origin develop
# → Auto-deploy en staging
```

### Llevar a producción
```bash
# Verificar que staging funciona OK
git checkout main
git merge develop
git push origin main
# → Auto-deploy en producción
```

### Hotfix urgente
```bash
git checkout main
git checkout -b hotfix/descripcion
# ... corregir ...
git commit -m "fix: descripcion"
git checkout main
git merge hotfix/descripcion
git push origin main           # → producción
git checkout develop
git merge main
git push origin develop        # → sincronizar staging
git branch -d hotfix/descripcion
```

### Migraciones manuales (si es necesario)
```bash
# Desde tu máquina local con las vars de producción en .env.production:
NODE_ENV=production dotenv -e .env.production -- npm run migrate
```

---

## Solución de problemas comunes

| Error en log | Causa | Solución |
|---|---|---|
| `ECONNREFUSED` MySQL | IP no en whitelist | Agregar IPs salientes de Azure al firewall MySQL |
| `Application Error` | Variable requerida faltante | Revisar output de check-env en logs |
| Login Microsoft falla `AADSTS50011` | Redirect URI no coincide | Verificar APP_URL + URI registrado en Azure AD |
| `Sessions` table missing | Primera ejecución | sessionStore.sync() corre automáticamente al arrancar |
| `ETIMEDOUT` MySQL | Firewall bloqueando | Habilitar "Allow Azure Services" en MySQL server |

---

## IPs salientes de Azure (para whitelist MySQL)

Portal Azure → App Service → **Propiedades → Direcciones IP de salida**

Agregar todas esas IPs al firewall de tu servidor MySQL.
Alternativa más simple: permitir `0.0.0.0/0` en MySQL con SSL requerido (`require_secure_transport=ON`).
