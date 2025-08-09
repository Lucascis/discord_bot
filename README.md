# Discord Music Bot

Monorepo de ejemplo para un bot de música de Discord construido con TypeScript y pnpm workspaces.
Incluye servicios para el gateway de Discord, cliente de audio con Lavalink, API REST y worker de jobs.

## Requisitos
- Node.js 20+
- pnpm 8+
- Docker (para entorno de desarrollo)

## Comandos
| Comando | Descripción |
| --- | --- |
| `/play <query>` | Cola una canción o playlist |
| `/pause`, `/resume` | Control de reproducción |
| `/queue` | Muestra la cola |

## Desarrollo
```bash
pnpm install
pnpm dev
```

## Docker
```bash
docker-compose up --build
```

## Licencia
MIT
