# Launch Checklist

**Discord Music Bot – Production Launch**

Version: 1.0.0  
Last Updated: 2025-11-17

---

## 1. Environment & Secrets

- [ ] `.env` revisado con credenciales reales de Discord:
  - `DISCORD_TOKEN`
  - `DISCORD_APPLICATION_ID`
  - `DISCORD_GUILD_ID` (opcional, para servidor de pruebas / principal)
- [ ] `.env.production` generado a partir de `.env` y con:
  - `NODE_ENV=production`
  - mismos valores de Discord que `.env` (el bot de producción)
- [ ] Claves de panel y API definidas:
  - `API_KEY`
  - `NEXT_PUBLIC_PANEL_API_KEY` (igual al `API_KEY` configurado)
  - `NEXTAUTH_SECRET` (cadena larga y aleatoria)
- [ ] Credenciales de base de datos y Redis verificadas:
  - `DATABASE_URL`
  - `REDIS_URL`

> Nota: Para el primer lanzamiento, se puede usar la misma `.env` para desarrollo y producción mientras el servidor esté aislado. A medida que el tráfico crezca, separar `.env` por entorno.

---

## 2. Base de Datos

- [ ] Contenedor de PostgreSQL en marcha:
  - `docker ps` muestra el servicio `postgres`/`discord-bot-postgres` en estado `healthy`.
- [ ] Esquema aplicado:
  - Inicializar con `docker-compose -f docker-compose.production.yml up -d postgres redis`.
  - Ejecutar el servicio de migraciones (si se usa en producción):
    - `docker-compose -f docker-compose.production.yml up migrate`.
- [ ] RuntimeConfig inicial cargada en base:
  - Valores globales y por guild validados para el entorno objetivo.

---

## 3. Servicios de Backend

- [ ] Levantar el stack de producción:

```bash
docker-compose -f docker-compose.production.yml up -d
```

- [ ] Verificar que todos los servicios están `healthy`:

```bash
docker-compose -f docker-compose.production.yml ps
```

Servicios críticos:
- `discord-bot-gateway` (port 3001)
- `discord-bot-audio` (port 3002)
- `discord-bot-api` (port 3000)
- `discord-bot-worker` (port 3003)
- `discord-bot-lavalink` (port 2333)

- [ ] Health checks HTTP responden `healthy`:

```bash
curl http://localhost:3000/health   # API
curl http://localhost:3001/health   # Gateway
curl http://localhost:3002/health   # Audio
curl http://localhost:3003/health   # Worker
```

---

## 4. Discord & Comandos

- [ ] El bot aparece en línea en Discord en el servidor configurado en `DISCORD_GUILD_ID`.
- [ ] Probar manualmente:
  - `/play <tema>` → debe unirse al canal de voz y reproducir.
  - `/skip`, `/queue`, `/stop`.
  - Confirmar estado operativo desde panel/API (`/api/v1/health`, dashboard, queue).

Si algún comando falla:
- Revisar logs de `discord-bot-gateway` y `discord-bot-audio`:

```bash
docker logs -f discord-bot-gateway
docker logs -f discord-bot-audio
```

---

## 5. Panel Web (Opcional)

Si se despliega el panel (Next.js) junto con la API:

- [ ] `NEXT_PUBLIC_API_BASE_URL` apunta al dominio/host correcto del API.
- [ ] `NEXT_PUBLIC_PANEL_API_KEY` coincide con `API_KEY`.
- [ ] `AUTH_DISCORD_CLIENT_ID` / `AUTH_DISCORD_CLIENT_SECRET` pertenecen a la app de Discord usada para login del panel.
- [ ] Callback de OAuth de Discord configurado:
  - `https://<tu-dominio>/api/auth/callback/discord`

---

## 6. Monitoreo Inicial

- [ ] Prometheus y Grafana en marcha (si se usan):
  - Prometheus: `http://localhost:9090`
  - Grafana: `http://localhost:3300`
- [ ] `METRICS_IP_ALLOWLIST` incluye la subred/host donde se ejecuta Prometheus (para evitar 401 en `/metrics`).
- [ ] Dashboards básicos mostrando:
  - Uso de CPU/memoria de `gateway`, `audio`, `lavalink`.
  - Errores por minuto en API/Gateway.

Durante las primeras horas tras el lanzamiento:
- Vigilar:
  - Reinicios de contenedores (`docker ps` / `docker-compose logs`).
  - Latencia de `/health` de API/Gateway.
  - Cualquier `error` en logs de Gateway/Audio/Lavalink.

---

## 7. Estrategia de escalado (cuando crezca el tráfico)

Para las primeras centenas / ~1000 guilds:
- Un solo stack de `docker-compose.production.yml` es suficiente.

Cuando la carga aumente:
- Escalar horizontalmente Gateway y Audio:

```bash
docker-compose -f docker-compose.production.yml up -d --scale gateway=2 --scale audio=2
```

- Considerar añadir un segundo nodo Lavalink con la misma `application.yml` y distribuir guilds entre nodos.
