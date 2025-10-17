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
