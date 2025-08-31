# Guía de configuración del bot (local y producción)

Esta guía te lleva desde crear la app en Discord hasta correr el bot con Docker o localmente.

## 1) Crear la aplicación y el bot en Discord
- Ir a https://discord.com/developers/applications y presionar "New Application".
- Elegir un nombre y crear.
- Copiar el Application ID (Client ID). Lo usarás como `DISCORD_APPLICATION_ID`.
- En la sección "Bot":
  - Crear el bot ("Add Bot").
  - Habilitar intents necesarios: "SERVER MEMBERS INTENT" opcional, y al menos "MESSAGE CONTENT" no es necesario para slash commands; sí necesitarás voice events más adelante, pero dependen del gateway.
  - Resetear y copiar el Token del bot. Lo usarás como `DISCORD_TOKEN`.
- En "OAuth2 > URL Generator":
  - Scopes: `bot` y `applications.commands`.
  - Bot Permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`, `Connect`, `Speak`.
  - Copiar la URL y agregar el bot a tu servidor de pruebas.

## 2) Variables de entorno
Crear `.env` en la raíz (o usar `deploy/values.example.yaml` si vas a Kubernetes).

Ejemplo `.env`:

```
DISCORD_TOKEN=tu-token
DISCORD_APPLICATION_ID=tu-app-id
# Opcional en dev para que los comandos se actualicen al instante
DISCORD_GUILD_ID=tu-guild-id

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/discord
LAVALINK_HOST=localhost
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
GATEWAY_HTTP_PORT=3001
AUDIO_HTTP_PORT=3002
WORKER_HTTP_PORT=3003
DJ_ROLE_NAME=DJ
```

Notas:
- Si `DISCORD_GUILD_ID` está seteado, el gateway registra comandos de forma local en ese guild (propagación inmediata). Si no, los registra globalmente (puede demorar hasta 1h).

## 3) Dependencias y build
```
corepack enable pnpm
pnpm install
pnpm -r build
```

## 4) Correr servicios

Opción A — Docker Compose (recomendado):
```
docker-compose up --build
```
Servicios: `postgres`, `lavalink`, `gateway`, `api`, `audio`, `worker`.
- La API expone `GET http://localhost:3000/health`.
- El gateway registra `/ping`, `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/volume`, `/nowplaying`, `/queue`.
- Los mensajes de `/play` incluyen botones (Pause/Resume/Skip/Stop) para control rápido.
  - Añadidos botones extra: Loop y Vol+/Vol-.
- Bridge Redis: el gateway publica eventos RAW a `audio` y éste responde enviando payloads al gateway. Asegúrate de que `REDIS_URL` apunte a tu Redis.

Opción B — Local con pnpm:
1. Asegurate de tener PostgreSQL y Lavalink corriendo:
   - Postgres rápido con Docker: `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=discord -e POSTGRES_USER=postgres postgres:15`
   - Lavalink con Docker: `docker run -p 2333:2333 -e SERVER_PORT=2333 -e LAVALINK_SERVER_PASSWORD=youshallnotpass ghcr.io/lavalink-devs/lavalink:3.7`
2. Arranca Redis y Lavalink (si no usás compose):
   - Redis rápido con Docker: `docker run -p 6379:6379 redis:7`
3. Exporta el entorno del `.env` en tu shell y levanta todo en paralelo:
   - macOS/Linux: `set -a; source .env; set +a; pnpm dev:all`
   - Alternativa con dotenv-cli: `pnpm dlx dotenv -e .env -- pnpm dev:all`

## 5) Base de datos (Prisma)
- El paquete `@discord-bot/database` genera Prisma Client automáticamente en `postinstall`.
- Para crear/migrar el esquema localmente:
```
pnpm --filter @discord-bot/database prisma:migrate
```
- Seed de ejemplo:
```
pnpm --filter @discord-bot/database ts-node packages/database/prisma/seed.ts
```

Nota: El modelo Queue persiste voiceChannelId y textChannelId para resuming automático. Ejecutá `pnpm --filter @discord-bot/database prisma:migrate` tras actualizar el esquema.

## 6) Verificación rápida
- API: `curl http://localhost:3000/health` -> `{ "ok": true }`.
- Discord: en tu servidor de pruebas, ejecutar `/ping` y obtener “Pong!”. Luego `/play never gonna give you up` en un canal de voz.
- Logs: ver que `audio` conecte a Lavalink: `Node main connected`.
 - Métricas: `curl http://localhost:3001/metrics` (gateway), `http://localhost:3002/metrics` (audio), `http://localhost:3000/metrics` (api).

## 7) Observabilidad (métricas + tracing)
- Métricas Prometheus expuestas en `/metrics` en cada servicio (API, gateway, audio, worker). Llevan métricas de proceso + contadores de comandos/eventos clave.
- Tracing OpenTelemetry opcional: define `OTEL_EXPORTER_OTLP_ENDPOINT` apuntando al collector (HTTP/OTLP) y se auto‑instrumentarán HTTP/Redis/etc.
  - Ejemplo: `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces`.

## 8) Despliegue
- GitHub Actions:
  - CI (`.github/workflows/ci.yml`): lint, test y build.
  - CD (`.github/workflows/cd.yml`): build y push de imagen a GHCR en tags `v*`.
- Kubernetes/Helm: usar `deploy/values.example.yaml` como base para configurar `env` y `image`.

## 9) Problemas comunes
- Comandos no aparecen: usa `DISCORD_GUILD_ID` en dev para registro por guild (instantáneo). Global puede demorar hasta 1h.
- `EADDRINUSE: 3000`: otro proceso ocupa el puerto; cierra el proceso previo o cambia `PORT`.
- Lavalink no conecta: valida `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD` y que el contenedor esté levantado.
- Prisma warning: asegúrate de que `postinstall` corrió y/o ejecuta `pnpm --filter @discord-bot/database prisma:generate`.

## 10) Próximos pasos (premium)
- Implementar el puente `sendToShard` entre `audio` y el gateway para enviar eventos de voz a Discord (por ejemplo exponiendo el `client` vía IPC o un proceso único).
- Agregar intents `GuildVoiceStates` (ya habilitado en el gateway) y permisos en el bot si se requieren más capacidades.
 - Embeds enriquecidos (portada, progreso), controles adicionales (loop, volumen +/- como botones dedicados), persistencia de colas, sharding.
