# Discord Music Bot

Bot de música para Discord construido en TypeScript con pnpm workspaces. Arquitectura por servicios: gateway (discord.js), audio (Lavalink v4), API REST y worker. Persistencia con PostgreSQL y Redis.

**🎉 FASE 1 Completada** - Gateway service modernizado con arquitectura modular, sistema unificado de comandos, decoradores TypeScript y cero issues de ESLint.

Documentación ampliada en `docs/SETUP.md` y `docs/HOSTING.md`.

## Sistema de Comandos Unificado

Desde la Fase 1.3, los slash commands se implementan como clases tipadas en el paquete `@discord-bot/commands`.

- Base y middleware: `packages/commands/src/base/*`, `packages/commands/src/middleware/*`
- Runtime de gateway: `packages/commands/src/runtime.ts` (publish/subscribe, rate limiting, permisos, validadores)
- Implementaciones:
  - Música: `impl/music/play.ts`, `impl/music/basic.ts` (skip/pause/resume/stop)
  - Cola: `impl/queue/queue.ts`
  - Ajustes: `impl/settings/settings.ts`

En `gateway/src/index.ts`:
- Se construye el JSON de registro de slash commands a partir de `buildSlashCommand()` de cada clase.
- En ejecución, se instancia un `MusicRuntime` real (Redis, validadores, permisos) y se enrutan interacciones con `cmd.run(interaction)`.

Agregar un comando nuevo:
1. Crear una clase que extienda `BaseCommand` e implemente `buildSlashCommand()` y `execute()`.
2. Añadir la clase al arreglo `commandInstances` en `gateway/src/index.ts`.
3. (Opcional) Añadir tests de unidad para la clase y/o su middleware.

## Requisitos
- Node.js 22+
- pnpm 8+
- Docker (para entorno de desarrollo)

## Comandos principales
- `/play <query|url>`: reproduce o encola; en la primera reproducción, si Autoplay está activado, se siembran hasta 10 relacionados.
- `/pause`, `/resume`, `/skip`, `/stop`
- `/volume <0-200>`, `/loop <off|track|queue>`, `/seek <segundos>`
- `/queue`, `/shuffle`, `/remove <n>`, `/clear`, `/move <from> <to>`

Además, el mensaje “Now Playing” trae controles (Play/Pause, Seek ±10s, Skip, Stop, Shuffle, Queue, Clear, Vol ±, Loop, Autoplay).

## Desarrollo
```bash
pnpm install
pnpm dev
```

- Guía de contribución y checklist previa al commit: `docs/CONTRIBUTING.md`.

### Tests
```bash
pnpm test
```
- Los tests no requieren build previo: `vitest.config.ts` aliasa los paquetes del workspace a sus fuentes (`@discord-bot/database`, `@discord-bot/logger`, `@discord-bot/config`).
- También existen tests básicos del paquete `@discord-bot/commands` para decoradores y middleware.
- Si agregás un nuevo paquete del workspace que se importe en código testeado, recordá añadir su alias en `vitest.config.ts` para evitar fallas en CI por falta de `dist/`.

## Docker
```bash
docker-compose up --build
```

Para orquestación completa con healthchecks, métricas y migraciones, ver `make prod-reset` y `scripts/prod.sh`.

Build de la imagen monolítica (multi-stage):
```bash
DOCKER_BUILDKIT=1 docker build -t discord-bot:latest .
```

La imagen incluye los 4 servicios (gateway/audio/api/worker). El entrypoint por defecto imprime ayuda; usá docker-compose para iniciar cada servicio con su comando.

## Autoplay (resumen)
- Desactivado por defecto (persistente por guild en DB). Al activarlo, se mantiene entre reinicios.
- Si está activo y la cola queda vacía al finalizar una canción, se añade un tema relacionado y se rellena la cola si está corta.
- Si está activo y presionás Skip con cola vacía, se arranca un tema relacionado al anterior.
- Si Autoplay está apagado y termina la reproducción (o hacés Skip con cola vacía), la UI muestra "Nada reproduciéndose" y permite activar Autoplay con un click.

## Observabilidad
- Métricas Prometheus expuestas en cada servicio (`/metrics`).
- Botones y publicaciones a Redis contadas; eventos de Lavalink instrumentados.

## CI/CD

CI (`.github/workflows/ci.yml`):
- Node 22 + pnpm 8, `pnpm install`, `pnpm test`, `pnpm build`.

CD (`.github/workflows/cd.yml`):
- Buildx y push a GHCR: `docker build` y `docker push` con tag `v*` (tags semánticas).

## Licencia
MIT
