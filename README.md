# Discord Music Bot

Bot de música para Discord construido en TypeScript con pnpm workspaces. Arquitectura por servicios: gateway (discord.js), audio (Lavalink v4), API REST y worker. Persistencia con PostgreSQL y Redis.

Documentación ampliada en `docs/SETUP.md` y `docs/HOSTING.md`.

## Requisitos
- Node.js 20+
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

## Docker
```bash
docker-compose up --build
```

Para orquestación completa con healthchecks, métricas y migraciones, ver `make prod-reset` y `scripts/prod.sh`.

## Autoplay (resumen)
- Desactivado por defecto (persistente por guild en DB). Al activarlo, se mantiene entre reinicios.
- Si está activo y la cola queda vacía al finalizar una canción, se añade un tema relacionado y se rellena la cola si está corta.
- Si está activo y presionás Skip con cola vacía, se arranca un tema relacionado al anterior.
- Si Autoplay está apagado y termina la reproducción (o hacés Skip con cola vacía), la UI muestra "Nada reproduciéndose" y permite activar Autoplay con un click.

## Observabilidad
- Métricas Prometheus expuestas en cada servicio (`/metrics`).
- Botones y publicaciones a Redis contadas; eventos de Lavalink instrumentados.

## Licencia
MIT
