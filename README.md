# Discord Music Bot 🎵

Bot de música para Discord especializado en música electrónica, construido en TypeScript con pnpm workspaces. Arquitectura por microservicios: gateway (Discord.js), audio (Lavalink v4), API REST y worker. Persistencia con PostgreSQL y Redis.

**🎉 PRODUCTION READY** - Aplicación completamente funcional con Docker, tests automatizados y monitoreo completo.

**✨ Características Principales**:
- 🎛️ **Autoplay Inteligente**: Modos por artista, género, similares y mixto
- 🎵 **Soporte Electrónico**: Detección de géneros, soporte para remixes oficiales
- 🔊 **Audio de Alta Calidad**: Lavalink v4 con plugins avanzados y optimizaciones
- 🛡️ **Anti-Spam**: Sistema avanzado de filtros contra canales agregadores
- ⚡ **Performance**: Múltiples clientes YouTube, SponsorBlock para sets largos
- 📊 **Monitoreo**: Integración Sentry para error tracking y observabilidad
- 🔒 **Seguridad**: Dependabot, security policies y workflows automatizados

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

## 🚀 Quick Start (Docker)

### 1. Setup
```bash
git clone <repository-url>
cd discord_bot
cp .env.example .env.docker
# Edit .env.docker with your Discord bot token
```

### 2. Deploy
```bash
./scripts/start.sh
```

### 3. Verify
- Bot online in Discord ✓
- Health: http://localhost:3000/health
- Monitoring: http://localhost:3300 (admin/admin)

**📖 Full deployment guide**: `docs/DEPLOYMENT.md`

## Requisitos
- Docker & Docker Compose
- Discord bot token
- 2GB+ RAM
- Node.js 22+ (para desarrollo local)

## Comandos principales
- `/play <query|url>`: reproduce o encola; en la primera reproducción, si Autoplay está activado, se siembran hasta 10 relacionados.
- `/pause`, `/resume`, `/skip`, `/stop`
- `/volume <0-200>`, `/loop <off|track|queue>`, `/seek <segundos>`
- `/queue`, `/shuffle`, `/remove <n>`, `/clear`, `/move <from> <to>`

### UI Controls (Reorganizada en Fase 2)
El mensaje "Now Playing" incluye controles organizados en 3 filas:

**Fila 1**: ⏯️ Play/Pause | ⏪ -10s | ⏩ +10s | ⏭️ Skip  
**Fila 2**: 🔊 Vol + | 🔉 Vol - | 🔁 Loop | ⏹️ Stop  
**Fila 3**: 🔀 Shuffle | 🗒️ Queue | 🧹 Clear | ▶️ Autoplay

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

## 🐳 Docker (Recomendado para Producción)

### Quick Start con Docker

```bash
# 1. Copiar configuración
cp .env.example .env

# 2. Editar .env con tus credenciales de Discord
# DISCORD_TOKEN=tu-token-aqui
# DISCORD_APPLICATION_ID=tu-app-id-aqui

# 3. Iniciar todos los servicios
docker compose up -d

# 4. Verificar estado
docker compose ps
docker compose logs -f
```

### Servicios Incluidos
- **PostgreSQL 15**: Base de datos principal
- **Redis 7**: Cache y pub/sub para comunicación entre servicios
- **Lavalink 4**: Servidor de audio con plugins avanzados
- **Gateway**: Servicio de Discord.js (puerto 3001)
- **Audio**: Procesamiento de música y autoplay (puerto 3002)
- **API**: REST API (puerto 3000)
- **Worker**: Tareas en segundo plano (puerto 3003)

### Scripts de Testing

**macOS/Linux:**
```bash
./scripts/test-docker.sh
```

**Windows PowerShell:**
```powershell
.\scripts\test-docker.ps1
```

### Documentación Completa
Ver **[DOCKER_README.md](./DOCKER_README.md)** para:
- Guía detallada de deployment multi-plataforma (Windows/macOS/Linux)
- Troubleshooting común
- Comandos de mantenimiento
- Configuración avanzada
- Testing y validación

### Comandos Útiles
```bash
# Ver logs de un servicio específico
docker compose logs -f gateway

# Reiniciar un servicio
docker compose restart audio

# Detener todo (mantiene datos)
docker compose down

# Resetear completamente (borra todo)
docker compose down -v

# Reconstruir después de cambios en el código
docker compose up -d --build
```

## Sistema Autoplay Avanzado (Fase 2)

### Modos de Recomendación
- **🎵 Similar** (predeterminado) - Tracks similares al tema actual
- **👨‍🎤 Artist** - Más temas del mismo artista  
- **🎛️ Genre** - Tracks del mismo género detectado automáticamente
- **🔀 Mixed** - Combinación inteligente: 40% artista + 40% género + 20% similares

### Soporte para Música Electrónica
- **Detección automática de géneros**: house, techno, trance, dubstep, drum & bass, ambient, synthwave, hardstyle
- **Soporte para remixes**: Permite remixes oficiales, filtra covers y bootlegs de baja calidad
- **Anti-agregadores**: Sistema de lista negra contra canales "Metadata" y contenido auto-generado

### Comportamiento
- Desactivado por defecto (persistente por guild en DB)
- Al activar/desactivar, el estado se mantiene entre reinicios
- Si está activo y la cola queda vacía: añade tema relacionado según el modo seleccionado
- Si está apagado: la UI permite activarlo con un click

## Observabilidad
- Métricas Prometheus expuestas en cada servicio (`/metrics`).
- Botones y publicaciones a Redis contadas; eventos de Lavalink instrumentados.

## CI/CD y Seguridad

**Workflows automatizados**:
- **CI** (`.github/workflows/ci.yml`): Node 22 + pnpm 8, tests, linting, build y typecheck
- **CD** (`.github/workflows/cd.yml`): Buildx y push a GHCR con tags semánticas
- **Security** (`.github/workflows/security.yml`): Análisis de dependencias y vulnerabilidades

**Mantenimiento automático**:
- **Dependabot** (`.github/dependabot.yml`): Updates automáticos de npm y GitHub Actions
- **Security Policy** (`.github/SECURITY.md`): Proceso de reporte de vulnerabilidades

**Monitoreo y Observabilidad**:
- **Sentry Integration**: Error tracking y performance monitoring en todos los servicios
- **Health Checks**: Endpoints dedicados con validación de dependencias
- **Logging estructurado**: Pino logger con contexto enriquecido

## Licencia
MIT
