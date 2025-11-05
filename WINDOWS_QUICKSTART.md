# 🪟 Windows Quick Start Guide

Esta guía te ayudará a ejecutar el Discord Music Bot en Windows usando Docker Desktop en **menos de 5 minutos**.

## 📋 Requisitos Previos

1. **Docker Desktop para Windows** instalado y corriendo
   - Descarga: https://www.docker.com/products/docker-desktop/
   - Asegúrate que el ícono de Docker esté verde en la bandeja del sistema

2. **Git para Windows** (opcional, para clonar el repo)
   - Descarga: https://git-scm.com/download/win
   - O descarga el ZIP directamente desde GitHub

## 🚀 Pasos de Instalación

### 1. Obtener el Código

**Opción A - Con Git:**
```powershell
git clone https://github.com/Lucascis/discord_bot.git
cd discord_bot
```

**Opción B - Sin Git:**
1. Ve a https://github.com/Lucascis/discord_bot
2. Click en "Code" → "Download ZIP"
3. Descomprime el archivo
4. Abre PowerShell en esa carpeta

### 2. Configurar Variables de Entorno

```powershell
# Copiar el archivo de ejemplo
copy .env.example .env

# Abrir el archivo .env con Notepad
notepad .env
```

**Edita estas líneas en `.env`:**
```env
DISCORD_TOKEN=tu-token-del-bot-aqui
DISCORD_APPLICATION_ID=tu-application-id-aqui
```

> **¿Dónde obtengo estos valores?**
> 1. Ve a https://discord.com/developers/applications
> 2. Selecciona tu aplicación (o crea una nueva)
> 3. En "Bot" → Copia el token
> 4. En "General Information" → Copia el Application ID

Guarda y cierra el archivo.

### 3. Iniciar el Bot

```powershell
# Un solo comando inicia todo
docker compose up -d
```

Esto iniciará automáticamente:
- ✅ Base de datos PostgreSQL
- ✅ Cache Redis
- ✅ Servidor Lavalink de audio
- ✅ Bot de Discord (Gateway, Audio, API, Worker)

**Primera vez tomará 5-10 minutos** mientras descarga las imágenes.

### 4. Verificar que Funciona

```powershell
# Ver estado de los servicios
docker compose ps

# Ver logs en tiempo real
docker compose logs -f
```

Presiona `Ctrl+C` para salir de los logs (los servicios seguirán corriendo).

**Verificar en tu navegador:**
- http://localhost:3000/health (API)
- http://localhost:3001/health (Gateway)
- http://localhost:3002/health (Audio)
- http://localhost:3003/health (Worker)

**En Discord:**
- Tu bot debería aparecer **online** ✅
- Escribe `/play` para probar

## 🎮 Comandos Útiles

### Ver Logs de un Servicio Específico
```powershell
docker compose logs -f gateway    # Bot de Discord
docker compose logs -f audio      # Procesamiento de música
docker compose logs -f lavalink   # Servidor de audio
```

### Reiniciar un Servicio
```powershell
docker compose restart gateway
docker compose restart audio
```

### Detener Todo (Mantiene los Datos)
```powershell
docker compose down
```

### Iniciar Nuevamente
```powershell
docker compose up -d
```

### Reset Completo (Borra Base de Datos)
```powershell
docker compose down -v
docker compose up -d
```

### Actualizar a Última Versión
```powershell
# Obtener último código
git pull
# O descargar nuevo ZIP y reemplazar archivos

# Reconstruir e iniciar
docker compose down
docker compose up -d --build
```

## 🐛 Solución de Problemas

### "Docker is not running"
- Abre Docker Desktop
- Espera que el ícono se ponga verde
- Intenta nuevamente

### "Port already in use"
- Otro programa está usando el puerto
- Detén ese programa o cambia el puerto en `docker-compose.yml`

### Bot no se conecta a Discord
1. Verifica tu `DISCORD_TOKEN` en `.env`
2. Asegúrate que el bot tenga los permisos correctos
3. Reinicia el gateway: `docker compose restart gateway`

### No hay sonido
1. Verifica que Lavalink esté corriendo: `docker compose logs lavalink`
2. Reinicia el servicio de audio: `docker compose restart audio`

### "Out of memory"
1. Abre Docker Desktop → Settings → Resources
2. Aumenta "Memory" a al menos 4GB
3. Click "Apply & Restart"

## 📊 Monitoreo

### Ver Uso de Recursos
```powershell
docker stats
```

### Ver Espacio en Disco
```powershell
docker system df
```

### Limpiar Imágenes No Usadas
```powershell
docker image prune -a
```

## 🎓 Testing Automatizado

Ejecuta el script de testing para validar todo:

```powershell
.\scripts\test-docker.ps1
```

Este script:
- ✅ Valida Docker Desktop
- ✅ Construye todas las imágenes
- ✅ Inicia todos los servicios
- ✅ Verifica health endpoints
- ✅ Muestra logs

---

## 💻 Desarrollo Local en Windows

Si quieres desarrollar y modificar el código en Windows con soporte completo de VSCode IntelliSense:

### Requisitos Adicionales
- **Node.js 18+** ([Descargar](https://nodejs.org/))
- **pnpm** (Instalador: `npm install -g pnpm`)
- **VSCode** (opcional pero recomendado)

### Setup de Desarrollo

```powershell
# 1. Instalar dependencias
pnpm install

# 2. Compilar todos los paquetes (IMPORTANTE)
pnpm build

# 3. Abrir en VSCode
code .
```

### ¿Por qué necesito compilar?

TypeScript necesita archivos `.d.ts` compilados para que VSCode pueda:
- ✅ Mostrar autocomplete correcto
- ✅ Detectar errores en tiempo real
- ✅ Permitir "Go to Definition"
- ✅ Ofrecer refactoring automático

### Workflow de Desarrollo

```powershell
# Después de modificar código en un paquete
pnpm --filter @discord-bot/<paquete> build

# Ejemplos:
pnpm --filter @discord-bot/logger build
pnpm --filter @discord-bot/database build

# Compilar todo
pnpm build

# Type checking (sin compilar)
pnpm typecheck

# Linting
pnpm lint

# Tests
pnpm test
```

### Correr Servicios Durante Desarrollo

Opción 1: **Docker (Recomendado)**
```powershell
# Los servicios corren en Docker, tú editas código localmente
docker-compose up -d

# Ver logs
docker-compose logs -f gateway audio

# Después de cambios, rebuild
docker-compose build gateway
docker-compose restart gateway
```

Opción 2: **Local (Avanzado)**
```powershell
# Iniciar solo infraestructura en Docker
docker-compose up -d postgres redis lavalink

# Correr servicios localmente (requiere todas las dependencias)
pnpm dev           # Gateway en dev mode
pnpm dev:all       # Todos los servicios en paralelo
```

### Estructura del Proyecto

```
discord_bot/
├── packages/           # Paquetes compartidos
│   ├── config/        # Configuración con Zod
│   ├── database/      # Prisma ORM
│   ├── logger/        # Logging con Sentry
│   ├── cache/         # Redis client
│   ├── commands/      # Sistema de comandos
│   ├── subscription/  # Sistema de premium
│   └── ...
├── gateway/           # Servicio principal de Discord
├── audio/             # Servicio de música y Lavalink
├── api/               # API REST
├── worker/            # Trabajos en background
└── tsconfig.json      # Configuración de paths para VSCode
```

### Configuración TypeScript en Windows

El proyecto está configurado para desarrollo multi-plataforma:

**`tsconfig.json` (root)** - Para VSCode IntelliSense
```json
{
  "paths": {
    "@discord-bot/logger": ["./packages/logger/src"],
    // ... todos los paquetes apuntan a src
  }
}
```

**`gateway/tsconfig.json`** - Para compilación
```json
{
  // Sin paths - usa archivos compilados de node_modules
}
```

Esta configuración permite que:
- ✅ VSCode resuelva tipos desde código fuente (mejor experiencia)
- ✅ Compilación use archivos .d.ts de node_modules (correcto para build)

### Solución de Problemas de Desarrollo

#### "Cannot find module '@discord-bot/xxx'"

**En VSCode:**
1. Asegúrate que ejecutaste `pnpm build`
2. Recarga VSCode: `Ctrl+Shift+P` → "Reload Window"

**En compilación:**
```powershell
# Limpiar y recompilar todo
pnpm -r clean     # Si existe script clean
pnpm build
```

#### Errores de TypeScript al compilar

```powershell
# Ver errores detallados
pnpm typecheck

# Compilar paquete específico con logs
pnpm --filter @discord-bot/<paquete> build
```

#### VSCode lento o no responde

El proyecto tiene 15 paquetes + 4 servicios. Para mejor rendimiento:
1. Abrir solo la carpeta que necesitas editar
2. Excluir `dist/` y `node_modules/` de búsqueda
3. Usar búsqueda global solo cuando sea necesario

### Scripts Útiles

```powershell
# Build
pnpm build                                    # Todo
pnpm --filter gateway build                   # Solo gateway
pnpm --filter @discord-bot/logger build       # Solo logger

# Desarrollo
pnpm dev                                      # Gateway en dev
pnpm dev:all                                  # Todos los servicios

# Calidad de código
pnpm typecheck                                # Verificar tipos
pnpm lint                                     # ESLint
pnpm lint --fix                               # Auto-fix

# Testing
pnpm test                                     # Todos los tests
pnpm test:coverage                            # Con coverage
pnpm --filter api test                        # Tests de API

# Base de datos
pnpm db:migrate                               # Migrar DB
pnpm db:seed                                  # Seed inicial
pnpm --filter @discord-bot/database prisma:generate  # Regenerar client
```

### Documentación de Desarrollo

- **Arquitectura**: [CLAUDE.md](CLAUDE.md) - Guía completa para Claude Code
- **Correcciones TypeScript**: [FIXES_APPLIED.md](FIXES_APPLIED.md) - Soluciones a problemas comunes
- **Estado del Proyecto**: [PROJECT_STATUS.md](PROJECT_STATUS.md) - Métricas y status

---

## 📚 Documentación Adicional

- **Guía Completa**: Ver [DOCKER_README.md](./DOCKER_README.md)
- **Arquitectura**: Ver [CLAUDE.md](./CLAUDE.md)
- **Contribuir**: Ver [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)

## 🆘 Soporte

Si tienes problemas:
1. Revisa los logs: `docker compose logs -f`
2. Verifica tu `.env`
3. Prueba reset completo: `docker compose down -v && docker compose up -d`
4. Abre un issue en GitHub con los logs

## ✅ Checklist Rápido

- [ ] Docker Desktop instalado y corriendo (ícono verde)
- [ ] Repositorio clonado o descargado
- [ ] Archivo `.env` creado y editado con tus credenciales
- [ ] `docker compose up -d` ejecutado
- [ ] Servicios verificados con `docker compose ps`
- [ ] Bot aparece online en Discord
- [ ] `/play` funciona correctamente

---

**¡Disfruta tu bot de música! 🎵**

Si todo funcionó, tu bot ya está online y listo para reproducir música en Discord.
