# Hosting (free o low‑cost)

Este proyecto corre bien en Docker Compose (un único host). Para opciones 100% gratuitas siempre‑on hay pocos proveedores; a continuación listamos alternativas free/low‑cost y cómo desplegar.

Importante: un bot de Discord no necesita puertos públicos (solo salida a Internet). Exponer los `/health`/`/metrics` es opcional.

## 1) VPS gratuito o Always‑Free (recomendado)

Ejemplos: Oracle Cloud Free Tier, Fly.io Machines con cuota gratuita, algún proveedor con créditos iniciales.

Pasos generales (Ubuntu 22.04):
```
sudo apt-get update -y
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

git clone <tu-repo>
cd <tu-repo>
cp .env.example .env  # rellena tokens y credenciales
make prod-reset       # baja/borra volúmenes, migra y levanta todo
```

Servicios: `postgres`, `redis`, `lavalink`, `audio`, `gateway`, `api`, `worker`.

Si querés publicar métricas/health, abre puertos 3000–3003 y 2333 (opcional). El bot funciona sin exponer nada.

## 2) Fly.io (cuota gratuita limitada)

Fly permite correr contenedores. La opción más simple es un único VM que ejecute Docker Compose:

1. Crea una VM (App de Machines) con Ubuntu, instala Docker (como en la sección 1) y corre `make prod-reset`.
2. Alternativa avanzada: desplegar cada servicio como app separada. Requiere más configuración de redes internas/volúmenes.

## 3) Otros (Render/Railway/Koyeb/Replit)

Muchos proveedores han cambiado sus planes gratuitos. Revisa términos actuales:

- Si soportan Docker por servicio, deberás crear 4–6 servicios (API, gateway, audio, worker, postgres, redis) y configurar redes/envs entre ellos.
- En setups con SUs limitadas, el enfoque de un solo VM con Docker Compose suele ser más simple y barato.

## Notas de operación

- Autoplay: persiste por guild en DB (`FeatureFlag`).
- Bases de datos: Postgres y Redis deben persistir (usa volúmenes de Docker).
- Observabilidad: `GET /metrics` en cada servicio. Puedes scrapearlos con Prometheus si expones puertos.

## Troubleshooting rápido

- Lavalink sin plugins: `curl -H 'Authorization: youshallnotpass' http://localhost:2333/v4/info` debe listar `youtube` en `sourceManagers` y `lavasrc` en `plugins`.
- Comandos no aparecen: usa `DISCORD_GUILD_ID` en `.env` en desarrollo para registro instantáneo por guild.
- P2021 (tabla no existe): ejecuta migraciones (`make migrate-deploy` o `pnpm --filter @discord-bot/database prisma:migrate`).


- Migraciones Prisma: el servicio pi corre prisma migrate deploy autom�ticamente al iniciar (no necesitas correrlo manualmente).
- P2021 (tabla no existe): si usas un entorno sin Compose o pi fuera de orquestaci�n, aplica migraciones con pnpm --filter @discord-bot/database prisma:migrate o 
px prisma migrate deploy.