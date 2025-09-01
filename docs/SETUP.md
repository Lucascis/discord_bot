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
- El gateway registra comandos: `/ping`, `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/volume`, `/loop`, `/nowplaying`, `/queue`, `/seek`, `/shuffle`, `/remove`, `/clear`, `/move`.
- Los mensajes de `/play` incluyen botones (Pause/Resume/Skip/Stop/Loop/Vol-/Vol+/Queue) para control rápido.
- Bridge Redis: el gateway publica eventos RAW a `audio` y éste responde enviando payloads al gateway. Asegúrate de que `REDIS_URL` apunte a tu Redis.

Opción B — Local con pnpm:
1. Asegurate de tener PostgreSQL y Lavalink corriendo:
   - Postgres rápido con Docker: `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=discord -e POSTGRES_USER=postgres postgres:15`
   - Lavalink v4 con Docker: `docker run -p 2333:2333 -e SERVER_PORT=2333 -e LAVALINK_SERVER_PASSWORD=youshallnotpass ghcr.io/lavalink-devs/lavalink:4`
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

## 6) Lavalink v4: YouTube + LavaSrc

Lavalink v4 ya no trae YouTube nativo. Necesitás plugins:

- YouTube v4: `dev.lavalink.youtube:youtube-plugin:1.13.5` (repo: `https://maven.lavalink.dev/releases`)
- LavaSrc (Spotify/Deezer/Apple/etc.): `com.github.topi314.lavasrc:lavasrc-plugin:4.8.0` (repo: `https://maven.lavalink.dev/releases`)

Este repo usa descarga remota por defecto: `lavalink/application.yml` incluye `lavalink.plugins` para que Lavalink baje y cargue los plugins automáticamente en el arranque. Además, `plugins.youtube` está configurado para usar clientes que no requieren inicio de sesión.

Verificación rápida:

- Info de Lavalink: `curl -H 'Authorization: youshallnotpass' http://localhost:2333/v4/info`
  - Debe listar `youtube` en `sourceManagers` y `lavasrc` en `plugins`.
- Probar carga directa (Spotify):
  - `curl -G -H 'Authorization: youshallnotpass' --data-urlencode "identifier=https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" http://localhost:2333/v4/loadtracks`
  - Debe devolver un objeto con `loadType` distinto de `error/no_matches` y al menos 1 track resuelto (mirroring a YouTube).

Orden de arranque y errores comunes con LavaSrc/Spotify:

- Si ves en `audio` el error: `Query / Link Provided for this Source but Lavalink Node has not 'spotify' enabled`:
  - Es porque `audio` conectó antes de que Lavalink terminara de cargar plugins y cacheó que Spotify estaba deshabilitado.
  - Solución: `docker-compose restart audio` para que refresque `/v4/info` y las fuentes disponibles.
- Si ves `No available Node was found` en `audio` tras reiniciar `lavalink`:
  - `audio` perdió la conexión con el WebSocket de Lavalink y no reconectó aún.
  - Solución: `docker-compose restart audio`.

YouTube “Please sign in” durante reproducción:
- Ya se configuró `plugins.youtube.clients` para evitar clientes que requieren login (TV). Si persiste en algún tema concreto:
  - Activá Deezer para playback directo: `.env` → `DEEZER_ENABLED=true` y `DEEZER_ARL=<cookie arl>`.
  - (Avanzado) Usar `yt-dlp` como backend: requiere instalar el binario en la imagen de Lavalink y habilitar `plugins.lavasrc.ytdlp`.

## 7) UI/UX: Now Playing y Controles

- Now Playing en vivo:
  - Lavalink envía `playerUpdate` cada 1s (configurado en `lavalink/application.yml` → `lavalink.server.playerUpdateInterval: 1`).
  - El bot edita el mensaje como máximo cada `NOWPLAYING_UPDATE_MS` (clamp 1000–60000). Setealo en `.env`.
  - Durante pausa no se edita; al reanudar vuelve a actualizar.
- Controles dinámicos:
  - Play/Pause, Seek ±10s, Skip, Stop, Shuffle, Queue, Clear, Loop, Autoplay.
  - Se pintan/deshabilitan según estado (cola vacía, stream sin seek, loop activo, autoplay activo, etc.).
  - Autoplay ON fuerza Loop OFF para evitar conflictos.

Variables relevantes en `.env`:

```
# Intervalo mínimo entre ediciones del Now Playing (ms). Recomendado: 1000–5000
NOWPLAYING_UPDATE_MS=3000

# Limpieza de comandos en el arranque (una vez, opcional)
COMMANDS_CLEANUP_ON_START=false
```

## 8) Deploy / Producción

- Desde cero (limpia volúmenes, reconstruye, migra y arranca):

```
make prod-reset
```

- Migraciones en entorno existente:

```
make migrate-deploy
```

- Notas comandos:
  - Si usás `DISCORD_GUILD_ID`, el gateway registra por guild y limpia comandos globales para evitar duplicados.
  - Si en el preview ves “Integración desconocida”, es otra app/bot en el servidor: quitá la integración vieja en Discord → Server Settings → Integrations.

Base de datos (errores Prisma P2021):
- Si aparece `PrismaClientKnownRequestError P2021` (tabla Queue no existe), corré migraciones:
  - Local: `pnpm --filter @discord-bot/database prisma:migrate`
  - Docker: `docker compose exec api pnpm --filter @discord-bot/database prisma:migrate`

Credenciales para LavaSrc:

- Spotify (https://developer.spotify.com/dashboard)
  - Crea una app → copia `Client ID` y `Client Secret`.
  - `.env`:
    - `SPOTIFY_CLIENT_ID=...`
    - `SPOTIFY_CLIENT_SECRET=...`
  - `application.yml` (ya configurado bajo `plugins.lavasrc.spotify` via `${...}`):
    - `clientId: ${SPOTIFY_CLIENT_ID}`
    - `clientSecret: ${SPOTIFY_CLIENT_SECRET}`

- Deezer (ARL)
  - Inicia sesión en https://www.deezer.com → DevTools → Storage → Cookies → copia cookie `arl`.
  - `.env`: `DEEZER_ARL=...`
  - `application.yml`: `plugins.lavasrc.deezer.arl: ${DEEZER_ARL}`

- Apple Music (Media API Token)
  - Crea key en Apple Developer (Team ID, Key ID, Private Key `.p8`).
  - Genera un JWT (RS256) con expiración adecuada (p.ej., 180 días).
  - `.env`: `APPLE_MUSIC_MEDIA_TOKEN=eyJ...`
  - `application.yml`: `plugins.lavasrc.applemusic.mediaAPIToken: ${APPLE_MUSIC_MEDIA_TOKEN}`

## 7) Verificación rápida
- API: `curl http://localhost:3000/health` -> `{ "ok": true }`.
- Discord: en tu servidor de pruebas, ejecutar `/ping` y obtener “Pong!”. Luego `/play never gonna give you up` en un canal de voz.
- Logs: ver que `audio` conecte a Lavalink: `Node main connected`.
 - Métricas: `curl http://localhost:3001/metrics` (gateway), `http://localhost:3002/metrics` (audio), `http://localhost:3000/metrics` (api).
 - Lavalink info: `curl -H 'Authorization: youshallnotpass' http://localhost:2333/v4/info` → `sourceManagers` incluye `youtube`.

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

---

## Anexo A — Autoplay, cola relacionada y rebuild sin caché

- Autoplay:
  - En el primer `/play`, se siembran automáticamente hasta 10 temas relacionados en la cola.
  - Si la cola se queda corta (< 3) al dispararse el autoplay, se vuelven a agregar hasta 10 relacionados para mantener reproducción continua.
  - Al usar `Skip` con autoplay y cola vacía, se arranca un tema relacionado al anterior.

- Now Playing:
  - Si no existe el mensaje, el gateway lo crea al recibir el primer push de estado desde `audio` o tras un reintento de ~1.2s luego de `/play`.
  - Se edita siempre el mismo mensaje; no se recrea por cada track.

- Rebuild sin caché (tras cambios en el código):
```
docker compose build --no-cache gateway audio
docker compose up -d
```

- Tests:
```
pnpm -w -r build && pnpm -w test
```
