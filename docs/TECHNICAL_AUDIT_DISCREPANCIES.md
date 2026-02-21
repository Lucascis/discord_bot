# 🔍 Auditoría Técnica: Discrepancias Documentación vs Código

**Fecha**: 15 de febrero de 2025  
**Alcance**: gateway/, audio/, api/, packages/  
**Regla aplicada**: El código manda sobre la documentación.

## ✅ Cambios Aplicados (15 feb 2025)

- **ARCHITECTURE.md**: Reescrito con Redis Streams + Pub/Sub, guildMutex, puertos reales
- **README.md**: DISCORD_TOKEN corregido
- **DEVELOPMENT_GUIDE.md**: Estructura corregida, guildMutex documentado
- **DEPLOYMENT_GUIDE.md**: DISCORD_TOKEN en lugar de DISCORD_BOT_TOKEN
- **service-communication.md**: Diagrama actualizado con Streams y voice-events
- **data-flow.md**: Flujos actualizados
- **Gateway**: stop por voice disconnect ahora usa Redis Streams
- **Gateway**: autoplay settings usa settingsService directamente (sin discord-bot:commands)

---

## 1. DISCREPANCIAS CRÍTICAS

### 1.1 Redis: Streams vs Pub/Sub — Arquitectura Dual No Documentada

**Documentación actual** (ARCHITECTURE.md, service-communication.md, data-flow.md):
- Solo menciona canales Pub/Sub: `discord-bot:commands`, `discord-bot:to-audio`, etc.
- Diagramas muestran "Gateway → Redis Publish → discord-bot:commands → Audio"

**Realidad en código**:
- **Redis Streams** (canal principal para comandos de música):
  - `discord-bot:audio-commands` — play, queue, shuffle, clear, remove, move, seek, etc.
  - `discord-bot:audio-controls` — toggle, pause, resume, skip, volume, loop, mute, filters (prioridad alta)
  - `discord-bot:audio-responses` — respuestas síncronas (ej. queue con paginación)
- **Pub/Sub** (legacy + casos específicos):
  - `discord-bot:commands` — stop (voice disconnect), autoplay (desde UI), y posiblemente play legacy
  - `discord-bot:to-audio` — VOICE_CREDENTIALS, search, play (DiscordAudioService)
  - `discord-bot:voice-events` — **crítico**: raw VOICE_STATE_UPDATE, VOICE_SERVER_UPDATE para Lavalink

**Impacto**: La documentación ignora Redis Streams. Los diagramas de flujo son incorrectos para el 90% de los comandos.

---

### 1.2 Canal `discord-bot:voice-events` Ausente en Docs

**Documentación**: Menciona que voice events van por `discord-bot:to-audio`.

**Código** (gateway/main.ts:1060, audio/index.ts:1674):
- Gateway publica raw events en `discord-bot:voice-events`
- Audio se suscribe a `discord-bot:voice-events` y reenvía a `manager.sendRawData()`
- `discord-bot:to-audio` se usa para VOICE_CREDENTIALS estructurados y comandos de DiscordAudioService

**Corrección**: Documentar ambos canales con sus roles exactos.

---

### 1.3 Variable de Entorno: DISCORD_BOT_TOKEN vs DISCORD_TOKEN

**README.md, DEPLOYMENT_GUIDE.md**:
```env
DISCORD_BOT_TOKEN=your_bot_token_here
```

**Código** (packages/config/src/index.ts:21):
```typescript
DISCORD_TOKEN: z.string().min(...)
```

**Evidencia**: `.env.example` usa `DISCORD_TOKEN`. El código nunca lee `DISCORD_BOT_TOKEN`.

---

### 1.4 Evento Discord: `raw` vs `Events.Raw`

**ARCHITECTURE.md** (ejemplo de código):
```typescript
this.discordClient.on('raw', async (data: any) => { ... });
```

**Código real** (gateway/main.ts:1019):
```typescript
client.on(Events.Raw, (d) => { ... });
```

**Nota**: Funcionalmente equivalente, pero la documentación usa API antigua (string) en lugar de la enum de discord.js v14.

---

### 1.5 guildMutex No Documentado

**Documentación**: No menciona el patrón de concurrencia por guild.

**Código** (audio/src/guildMutex.ts, audio/src/index.ts:1910, 2706):
- `guildMutex.run(guildId, async () => { ... })` serializa mutaciones de queue/player por guild
- Usado en handlers de `discord-bot:commands` y lógica crítica de audio
- `.github/copilot-instructions.md` y `docs/DIRECTORY_STRUCTURE.md` sí lo mencionan

**Corrección**: ARCHITECTURE.md y DEVELOPMENT_GUIDE deben documentar guildMutex como requisito para operaciones de audio.

---

### 1.6 Validación Zod en Config

**Documentación**: Menciona "Zod schemas" de forma genérica.

**Código**: `packages/config` usa Zod para todas las variables de entorno. Es la fuente de verdad para tipos y validación. Debe quedar explícito en la documentación.

---

### 1.7 Paquete @discord-bot/commands — Uso Ambiguo

**Documentación**: Describe `packages/commands` como "Discord command system".

**Código**:
- Gateway **no** importa `@discord-bot/commands` directamente
- MusicController usa `AudioCommandService` (Redis Streams) para comandos de música
- `packages/commands` publica a `discord-bot:commands` (play, volume, loop, queue, etc.)
- Tests y algunos flujos usan `packages/commands`; el gateway principal usa su propio MusicController

**Conclusión**: Hay dos rutas de comandos (MusicController + AudioCommandService vs packages/commands + Pub/Sub). La documentación no aclara cuál es la ruta principal ni el propósito de cada una.

---

### 1.8 Puertos y Health

**Documentación**: Menciona `<gateway_port>`, `<audio_port>` como placeholders.

**Código** (packages/config):
- `GATEWAY_HTTP_PORT`: 3001
- `AUDIO_HTTP_PORT`: 3002
- `WORKER_HTTP_PORT`: 3003
- `PORT` (API): 3000

**Corrección**: Usar valores reales o referenciar `env.GATEWAY_HTTP_PORT` etc.

---

### 1.9 Lavalink Versión

**ARCHITECTURE.md**:
```yaml
Version: v4.1.1
Plugins: YouTube Plugin v1.13.5, LavaSrc v4.8.1, LavaSearch v1.0.0
```

**Código**: `lavalink-client` ^2.7.0. No hay versión hardcodeada de Lavalink en el repo; `lavalink/application.yml` existe pero la versión del JAR no está documentada en el código.

**Acción**: Verificar versión real del JAR en uso y alinear docs.

---

### 1.10 Estructura del Proyecto Duplicada/Inconsistente

**DEVELOPMENT_GUIDE.md** (líneas 99-118):
```
├── gateway/
├── audio/
├── api/
├── worker/
│   ├── audio/        ← DUPLICADO
│   ├── api/          ← DUPLICADO
│   └── worker/       ← DUPLICADO
```

**Corrección**: Eliminar duplicados en el árbol de directorios.

---

## 2. ARCHIVOS OBSOLETOS O REDUNDANTES

| Archivo | Motivo |
|---------|--------|
| `CLAUDE.md` | Ya eliminado (git status: D). Si existía, reemplazado por AGENTS.md. |
| `docs/architecture/diagrams/service-communication.md` | Diagrama incorrecto: falta `discord-bot:voice-events`, no menciona Redis Streams. |
| `docs/architecture/diagrams/data-flow.md` | Flujo de comandos vía `discord-bot:commands` obsoleto para la ruta principal. |

---

## 3. INFORMACIÓN CORRECTA A PRESERVAR

- **Discord.js v14**: Confirmado en gateway/package.json
- **Lavalink**: Integración vía lavalink-client
- **PostgreSQL + Prisma**: Correcto
- **Redis**: Correcto como bus de mensajería, pero falta Streams
- **Microservicios**: Gateway, Audio, API, Worker — correcto
- **Clean Architecture en Gateway**: domain, application, infrastructure, presentation — correcto

---

## 4. RESUMEN EJECUTIVO

| Categoría | Cantidad |
|-----------|----------|
| Discrepancias críticas | 10 |
| Archivos a actualizar | 5+ |
| Archivos a eliminar/revisar | 2-3 |

**Prioridad 1**: Corregir ARCHITECTURE.md con Redis Streams + Pub/Sub, canales reales, guildMutex, Zod.  
**Prioridad 2**: Unificar DISCORD_TOKEN en README y DEPLOYMENT_GUIDE.  
**Prioridad 3**: Actualizar diagramas en docs/architecture/diagrams/.  
**Prioridad 4**: Aclarar rol de packages/commands vs MusicController.
