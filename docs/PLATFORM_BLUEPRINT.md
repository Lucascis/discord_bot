# 📘 Blueprint de Plataforma: Arquitectura, Estructura y Roadmap

Este documento redefine la visión, arquitectura y estructura del proyecto para evolucionar de un bot de música de Discord a una plataforma modular y multiplataforma con enfoque en escalabilidad, mantenibilidad por IA y comercialización por suscripciones.

Estado: Propuesta inicial aprobable para ejecución por fases.

---

## 1) Visión y Principios

### Visión
Construir una plataforma modular de integraciones en tiempo real, donde Discord es la primera integración (bot de música con Lavalink), pero el core permite agregar rápidamente nuevas superficies (Web, Slack, Telegram, etc.), ofrecer planes por suscripción, personalizaciones y métricas avanzadas.

### Principios
- Modularidad estricta y contratos tipados entre módulos (TypeScript en todo el stack).
- Arquitectura orientada a eventos con límites claros (Domain/Core separado de Adapters).
- Observabilidad profunda desde el día 1 (tracing, logs, métricas y auditoría).
- Escalabilidad horizontal pragmática (Redis/Streams/Kafka evolutivo; Postgres con Prisma).
- Diseñado para ser mantenido por IA (nombres claros, ADRs, convenciones, documentación viva).
- Seguridad por defecto (secrets, RBAC, idempotencia, auditoría, DLP de tokens).

---

## 2) Gap Analysis del estado actual (docs)

Basado en la documentación vigente:

- Foco actual: bot de música para Discord en microservicios (Gateway/Audio/API/Worker) con Redis pub/sub, Postgres+Prisma, Lavalink v4.
- Faltantes para la nueva visión:
  - Ausencia de un Core de dominio desacoplado del canal Discord.
  - No existe un SDK de Integraciones para otras plataformas (Slack/Telegram/WebSockets App).
  - Falta un servicio de Billing/Entitlements (planes, límites, upgrades/downgrades, Stripe webhook).
  - Portal Web para usuarios y panel de administración (gestión de guilds, planes, personalizaciones).
  - Diseño de multitenencia y modelo de datos para features/flags/entitlements por tenant/guild.
  - Estándares de eventos y contratos compartidos (versionados, esquemas, compatibilidad).
  - Observabilidad de negocio (métricas de uso, conversión, retención, LTV) y de producto.
  - Runbooks/SLOs/operabilidad a nivel plataforma y no sólo por servicio.

Conclusión: la base técnica es sólida para Discord, pero falta la capa de plataforma (core + billing + web + integración multiplataforma + gobernanza de contratos).

---

## 3) Arquitectura Propuesta (alto nivel)

Patrón: Hexagonal/Ports & Adapters + Event-Driven. Monorepo TypeScript con pnpm + Turborepo.

Servicios (apps):
- gateway-discord: Adaptador Discord (discord.js v14), slash commands, mapping a comandos de dominio.
- audio: Integración con Lavalink, colas y efectos; escala horizontal con múltiples nodos Lavalink.
- platform-api: API para Web/Integraciones (REST/HTTP + Webhooks; opcional GraphQL o tRPC más adelante).
- worker: Jobs (BullMQ), programaciones, envío de emails/notifs.
- billing: Integración con Stripe (checkout, portal, webhooks), cálculo de entitlements.
- web: Portal de usuario (Next.js), login con Discord, gestión de guilds, subscripciones y paneles.
- admin: Consola interna (Next.js) con admin y soporte.

Paquetes (packages):
- core: dominio, casos de uso, entidades, políticas y validaciones; independiente de Discord/Web.
- integration-sdk: contratos/ports para implementar nuevos adaptadores (Discord/Slack/Telegram/WebSocket-client).
- events: definición de eventos, esquemas y versionado (zod), publicadores/suscriptores genéricos.
- database: Prisma Client, migraciones, repositorios; modelos multi-tenant.
- config: carga/validación de env con zod; perfiles dev/prod.
- logger: pino + formato; bindings de request.
- feature-flags: flags y gates; OpenFeature-ready; caché de entitlements.
- commands-discord: catálogo y tipado de slash commands; parseo y ayudas.
- billing-shared: contratos de planes, límites, entitlements y helpers de pricing.

Infra base:
- Postgres (Aurora/Neon/Cockroach opcional) para transaccional; Prisma.
- Redis (Cluster) para caché, rate limits, sesiones y pub/sub inicial.
- Event Bus: Redis Streams en Fase 1; evolucionable a NATS/Kafka en Fase 3.
- Observabilidad: OpenTelemetry → OTEL Collector → Prometheus + Tempo + Loki + Grafana.

Seguridad:
- Secret management (SOPS/1Password/Vault), rotación de tokens, scoping de permisos.
- Idempotencia en webhooks y comandos críticos; auditoría en `AuditLog`.

---

## 4) Modelo de Datos (resumen)

Entidades principales (Prisma):
- Account(User), Identity(Discord), Organization/Tenant (opcional), Guild, Member
- Plan, Subscription, Entitlement, FeatureFlag
- PlayerSession, Queue, QueueItem, PlaybackMetrics
- PanelConfig (personalizaciones UI), WebhookEndpoint
- AuditLog, ApiKey, RateLimit, QuotaUsage

Claves:
- Multi-tenant por `guildId` (Discord) y/o `tenantId`.
- `Entitlement` materializado y cacheado en Redis para gating de features.
- Métricas de reproducción en tabla optimizada + export a TSDB (ClickHouse/Timescale si escala).

---

## 5) Sistema de Planes (Premium)

Tiers propuestos (ejemplo):
- Free: 3 instancia por guild, bitrate estándar, cola limitada, sin filtros avanzados. Sin UI, sólo comandos y mensajes básicos de nowplaying.
- Pro: 4–5 instancias, mejor calidad (según límites de Discord), filtros y autoplay avanzado. UI con botones
- Elite: 5+ instancias, crossfade, filtros premium, prioridad de cola, paneles avanzados.

Gating por entitlement:
- Calidad/bitrate (respetando límites efectivos de Discord por boost del servidor).
- Concurrencia de players por guild y límite de cola.
- Filtros (eq, timescale, nightcore, karaoke), crossfade, normalización, autoplay ML.
- Personalización de paneles (themes, layouts, embeds persistentes).

Billing:
- Stripe Checkout + Customer Portal.
- Webhooks idempotentes (`billing` service) → `Entitlement.update`.
- Prorrateos, upgrades/downgrades, trials y cupones.

---

## 6) Flujos Clave

Slash command → dominio → audio:
1) Usuario ejecuta `/play <query>` en Discord.
2) gateway-discord mapea a `Core.playRequest` (comando dominio) y agrega metadata de contexto (guild, user).
3) core valida entitlements/quotas; publica `music.play.requested`.
4) audio consume evento, resuelve fuente (LavaSrc), encola en Lavalink y emite `music.play.started`.
5) gateway actualiza UI (mensajes/embeds) y métricas.

Stripe webhook → entitlement:
1) `billing` recibe `checkout.session.completed`/`invoice.paid`.
2) Verifica firma, idempotencia y customer ↔ guild mapping.
3) Actualiza `Subscription` + `Entitlement`; invalida caché Redis.

Web portal → gestión de guild:
1) Usuario inicia sesión con Discord (OAuth).
2) Visualiza guilds administrables, estado del plan y personalizaciones.
3) Cambios se aplican vía `platform-api` y se reflejan en gateway.

---

## 7) Nueva Estructura de Repositorio (monorepo)

```text
.
├─ apps/
│  ├─ gateway-discord/
│  ├─ audio/
│  ├─ platform-api/
│  ├─ worker/
│  ├─ billing/
│  ├─ web/            # Next.js (usuario)
│  └─ admin/          # Next.js (interno)
├─ packages/
│  ├─ core/
│  ├─ integration-sdk/
│  ├─ events/
│  ├─ database/
│  ├─ config/
│  ├─ logger/
│  ├─ feature-flags/
│  ├─ commands-discord/
│  └─ billing-shared/
├─ infra/
│  ├─ docker/
│  ├─ k8s/
│  └─ terraform/      # opcional
└─ docs/
   ├─ INDEX.md
   ├─ ARCHITECTURE.md
   ├─ ADR/
   └─ PLATFORM_BLUEPRINT.md  # este documento
```

Convenciones:
- pnpm workspaces + Turborepo para orquestar builds/test/lint por paquete.
- Path aliases controlados por tsconfig base.
- Changesets para versionado de packages y CHANGELOG automático.

---

## 8) Documentación: Estructura propuesta

- INDEX.md: mapa de navegación por perfiles (dev, ops, producto).
- PLATFORM_BLUEPRINT.md: visión, arquitectura y roadmap (este doc).
- ARCHITECTURE.md: diagrama de componentes + contratos/eventos.
- ADR/: decisiones de arquitectura (1 por decisión relevante).
- BILLING.md: planes, entitlements, flujos y webhooks.
- INTEGRATIONS/: guías de adapters (Discord, Web, Slack...).
- DATA_MODEL.md: entidades Prisma y ERD.
- RUNBOOKS/: procedimientos operativos y SLOs.
- SECURITY.md: secretos, RBAC, políticas y checklist.
- OBSERVABILITY.md: trazas, métricas, logs, dashboards y alertas.

Nota: Mantener docs con owners y fecha de última revisión al inicio.

---

## 9) Roadmap por Fases (6–10 semanas)

Fase 0 – Fundaciones (1 semana)
- Monorepo pnpm + Turborepo, lint/prettier/tsconfig base, CI mínima.
- Paquetes base: config, logger, events, database (schema bootstrap).
- ADR-000 sobre visión/arquitectura/eventos.

Fase 1 – Discord + Audio (2–3 semanas)
- gateway-discord con catálogo de slash commands y mapping a core.
- audio con Lavalink + LavaSrc; colas y efectos básicos; métricas.
- core: casos de uso de reproducción, colas y validación de entitlements.
- Observabilidad básica (OTEL traces + logs estructurados).

Fase 2 – Billing + Entitlements (1–2 semanas)
- Servicio billing con Stripe (checkout, portal) y webhooks idempotentes.
- Modelo `Subscription`/`Entitlement`; caché Redis; gates en core.
- Rate limits/quotas por guild.

Fase 3 – Web Portal (2 semanas)
- Next.js (web) con login Discord, gestión de guilds, vista de plan.
- Ajustes de paneles (themes, layouts); endpoints en platform-api.

Fase 4 – Operabilidad y Escala (1–2 semanas)
- Runbooks, dashboards, alertas, SLOs.
- Hardening de seguridad y costos; autoscaling y nodos Lavalink múltiples.

---

## 10) Decisiones Técnicas Recomendadas

- API: REST JSON primero (OpenAPI) para simplicidad; considerar tRPC/GraphQL luego.
- Event Bus: Redis Streams con contratos en `packages/events` (zod) y versionado.
- DB: Postgres 15 + Prisma; métricas de alto volumen a ClickHouse/Timescale si es necesario.
- Caché: Redis Cluster con TTL por `Entitlement`/`Feature` y locks para idempotencia.
- Tests: unitarios (vitest), integración por servicio (docker compose), contract tests (pact) para adapters.
- Seguridad: Helmet/CSRF en web, firma HMAC en webhooks, rotación de secrets.

---

## 11) Próximos Pasos Accionables

1) Aprobar esta arquitectura y estructura de monorepo.
2) Crear packages base (`config`, `logger`, `events`, `database`) y bootstrap de `core`.
3) Scaffolding de `gateway-discord` y `audio` con pipeline mínimo y OTEL.
4) Definir esquema inicial Prisma (Guild, Queue, QueueItem, User, AuditLog, Plan/Subscription/Entitlement).
5) Preparar `infra/docker-compose.dev.yml` con Postgres, Redis y Lavalink.
6) ADR-001: Contratos de eventos iniciales + versionado.

---

## 12) Riesgos y Mitigaciones

- Complejidad por microservicios tempranos → iniciar con límites claros y tooling de monorepo (Turbo) y evolucionar servicios sólo cuando agreguen valor.
- Costos de infraestructura → foco en ambientes dev/preview baratos y autoscaling por demanda.
- Límite real de calidad en Discord → comunicar niveles reales según boosts y usar mejoras percibidas (filtros, normalización, crossfade) en planes premium.

---

## 13) Glosario

- Entitlement: Derecho efectivo a una capacidad/feature según plan.
- Adapter: Implementación de un port para una plataforma específica.
- Core: Lógica de dominio independiente de la plataforma.
- ADR: Architecture Decision Record.

