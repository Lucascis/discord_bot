# Discord Music Bot Market Research

This snapshot compares the current project with other high-volume Discord music bots using the publicly documented feature sets from their official sites at the time of writing.

| Bot | Source | Key Capabilities | Monetization | Notable Technical Notes |
| --- | --- | --- | --- | --- |
| **Hydra** | [hydra.bot](https://hydra.bot/) | Slash-command driven playback, per-guild DJ roles, web dashboard, powered by a proprietary audio cluster. | Paid premium tier unlocks 24/7 mode, global volume, audio filters. | Runs a multi-region Lavalink cluster; REST dashboard exposes queue management. |
| **FredBoat** | [fredboat.com](https://fredboat.com/) | Stable playback for YouTube/SoundCloud/Bandcamp, playlist support, permission system. | Free with optional Patreon priority support. | Open-source (Java/Kotlin) with in-process audio player rather than a separate Lavalink tier. |
| **Green-Bot** | [green-bot.app](https://green-bot.app/) | Advanced audio filters, lyrics lookup, per-server dashboard, Spotify/Deezer links via LavaSrc. | Subscription unlocks higher quality audio, dedicated nodes, automation rules. | Ships managed Lavalink nodes plus a CDN for artwork/lyrics. |
| **Chip Bot** | [chipbot.gg](https://chipbot.gg/) | Multi-source playback with waveform filters, persistent autoplay queues, uptime guarantees published on a public status page. | Premium unlocks lossless mode, priority nodes, merch bundles. | Provides customer-facing SLA + transparent incident postmortems; emphasises SOC2-compliant payment flows. |

## Insights

1. **Dashboard-first experiences dominate.** Hydra and Green-Bot provide rich dashboards for queue management, scheduling, and subscription upgrades. Our REST API should be aligned with this expectation (stable endpoints for queue/search, predictable errors).
2. **Multi-source playback is a minimum requirement.** Every competitor advertises Spotify/SoundCloud plus YouTube. Maintaining up-to-date LavaSrc configuration (client IDs, scopes) is critical for parity.
3. **Transparent monetization messaging matters.** Hydra and Green-Bot clearly describe which features move behind premium tiers. Our README now explicitly states that only a stub payment provider is wired until Stripe/MercadoPago are provisioned, avoiding mismatched expectations.
4. **Operational excellence is a differentiator.** Competitors highlight 24/7 nodes, geographic routing, and failover. The fixes in this iteration (accurate health checks, Prisma tuning, deterministic API behavior) directly contribute to the same reliability story.

Continually reviewing these official resources ensures the roadmap tackles real gaps (e.g., dashboard functionality, multi-region playback, clearly switched-on payment providers) instead of speculative features.

## Actionable Opportunities vs. Competition

1. **Operational transparency.** Chip Bot’s public status page and incident write-ups underline how critical clear communications are for premium customers. Our monitoring stack (Prometheus + OTEL) should feed a lightweight `/status` surface and the deployment guide now emphasises alert routing so that outages are observable.
2. **Upgrade UX.** Competitors push upgrade CTAs directly in the dashboard. Because plans now load strictly from the database, we can model campaign experiments (intro pricing, seasonal limits) without redeploying code. Adding a “plan overrides” admin panel is the next logical UX task.
3. **Payments readiness.** Every competitor highlights PCI-compliant processors. The new payment service backed by `subscription_prices` ensures API/gateway layers read the same Stripe price IDs the CLI uses when seeding, keeping us aligned with Stripe/MercadoPago documentation.
4. **Playback fidelity.** Hydra/Chip advertise multi-region, low-latency nodes. Our gateway now fails fast when plans aren’t hydrated; the follow-up is to extend the Lavalink provisioning scripts so regional clusters can be toggled per plan directly from the DB.

Tracking these deltas keeps the bot focused on user-facing wins (dashboards, stability, billing clarity) rather than feature sprawl.

## Web & Panel Experience Strategy

### Visual/Landing Inspiration
- **Hydra** apuesta por un landing hero oscuro con ilustraciones sintéticas, destaca botones primarios brillantes y cards con “Unlock Premium” muy visibles. La navegación es mínima (Home / Commands / Premium / Status) y cada sección muestra capturas del panel.
- **FredBoat** mantiene una estética “trustworthy open-source”: bloques claros, tipografía limpia, documentación primero. Ideal para comunicar transparencia técnica.
- **Green-Bot** mezcla gradients vibrantes con componentes de dashboard (widgets para filtros, lyrics, etc.). El CTA “Try for Free” se repite en cabecera y footer.
- **Chip Bot** refuerza la confiabilidad con tarjetas SLA, barras de disponibilidad y una sección “Status” enlazada en el header.

**Dirección para nuestro sitio/panel:** usar un tema oscuro neon (morado/azul) que evoque música en vivo, hero con visualización de onda y CTA dual (“Probar gratis” / “Panel Premium”). Incluir badges de desempeño (“99.99% uptime”, “Lavalink regional”) y screenshots reales del dashboard.

### Funcionalidades del Panel Administrativo
| Área | Debe Tener | Extras Diferenciadores |
|------|------------|------------------------|
| **Control de planes** | Listado de `subscription_plans`/`subscription_prices`, filtros por proveedor, edición inline y recarga (`/api/v1/plans`, `/runtime`, `/reload`). | **Experimentos**: banderas para campañas (ej. “Black Friday price id”), vista previa de landing (cómo se ve cada plan público). |
| **Gestión de guilds premium** | Estado de suscripción por servidor, límites consumidos (tracks, queue), logs de facturación. | **Playbooks automáticos**: sugerencias basadas en uso (p.ej. “este guild llega al límite de filtros, upsell a Premium + Filtros”). |
| **Soporte/Reembolsos** | Acción rápida para pausar/cancelar plan, ver historial de pagos. | **Botón “Compensar tiempo”** que ajusta billing metadata con presets (1 semana, 1 mes). |
| **Monitoring compacto** | Widgets de salud (Lavalink, Redis, Worker) y enlaces a panel Prometheus/Sentry. | **Timeline visual** sincronizado con anuncios (“push notifications” o banner en landing en caso de incidentes). |
| **Experiencia de usuario final** | Portal de cuenta con login vía Discord OAuth, sección de comandos favoritos, historial de colas. | **“Studio Mode”**: builder visual que permite configurar panel in-guild (logos, CTA custom) diferenciándonos de Hydra. |

### Flujo y Estilo del Sitio
1. **Hero** – headline claro (“Música premium para Discord sin fricción”), CTA dual, badge de uptime y slider de logos.
2. **Demostración interactiva** – mock del panel mostrando queue analytics, toggles de features.
3. **Planes** – cards animadas conectadas a la DB (usar `/api/v1/plans/runtime`). Botón “Ver detalles” abre modal con limits real-time.
4. **Comparativa** – tabla vs Hydra/FredBoat/Green-Bot resaltando extras (“Studio Mode”, “Control centralizado en DB”, “MercadoPago-ready”).
5. **Status & Trust** – sección con embed del status page (Chip Bot style) + testimonios.
6. **FAQ + CTA final** – preguntas sobre seeds de planes, integración Stripe/MercadoPago, flows de guilds grandes.

### Diferenciadores UX
- **Control centralizado 100% DB**: ningún fallback en código; el panel puede programar promociones temporales sin redeploy. Mostrarlo como “Plan Engine”.
- **Studio Mode para brand-aware guilds**: editor visual para configurar UI del bot (colores, auto responses) no ofrecido por Hydra/FredBoat.
- **Insights accionables**: recomendaciones basadas en métricas internas (tracks consumidos, fallos) que sugieren upgrades automáticos.
- **MercadoPago/Stripe híbrido**: wizard que elige gateway según país, ventaja clave para LATAM (competencia se enfoca en Stripe).

### Próximos pasos
1. Wireframe del dashboard (Figma) siguiendo esquema hero + cards + monitoring widgets.
2. Implementar front-end (Next.js/React) consumiendo `/api/v1/plans` y endpoints de guilds/analytics ya expuestos.
3. Integrar Discord OAuth para el portal de clientes y RBAC para el panel interno.
4. Añadir módulo de experimentos (feature flags) ligado a metadata de `subscription_plans`.

Estos lineamientos garantizan un sitio atractivo para usuarios target (comunidades que buscan calidad) y un panel robusto para el equipo comercial.

---

## Implementación Propuesta del Panel Web

### Arquitectura Técnica
- **Stack recomendado:** Next.js 15 + React 18, TailwindCSS para prototipado rápido y Radix UI para componentes accesibles. Autenticación con Discord OAuth2 (PKCE) para clientes y JWT interno para staff (RBAC).
- **State management:** React Query (TanStack) para consumir `/api/v1/plans`, `/api/v1/guilds`, `/api/v1/analytics`, conservando cache normalizado. Feature flags via ConfigCat o LaunchDarkly para campañas.
- **Gráficas y widgets:** Recharts (analytics), Tremor o Nivo para dashboards en cards reutilizables. Modo oscuro por defecto con soporte light toggle.
- **Deployment:** app separada en `apps/panel` con Vercel/Cloudflare Pages, tras build se sirve detrás de la misma CDN que la landing para coherencia de dominio.

### Arquitectura de Información & Páginas
1. **Landing pública**
   - Hero con CTA dual (Empezar Gratis / Ver Panel), badge de uptime.
   - Showcase interactivo (video o carrusel) del panel.
   - Tabla de planes conectada a `/api/v1/plans/runtime`.
   - Comparativa vs competencia y timeline de status/SLAs.
2. **Portal de usuarios premium**
   - Dashboard de guild actual (consumo de límites, colas recientes).
   - Configuración de Studio Mode: colores, branding, mensajes automáticos.
   - Gestión de facturación (Stripe/MercadoPago) embebiendo customer portal si existe.
3. **Panel interno (staff)**
   - Plan Engine (CRUD + experiments) → `/api/v1/plans`, `/reload`.
   - Guild Premium Monitor: lista de guilds con KPI, eventos de facturación.
   - Health & incident board (enlaces a Prometheus/Sentry y timeline).

### Componentes Clave
| Componente | Datos | Acciones |
|------------|-------|----------|
| `PlanCard` | `GET /plans/runtime` | CTA upgrade, detalla limits/features. |
| `PlanEditorModal` | `GET/POST /plans` | Edita nombres, features, IDs de precios; guarda cambios y dispara `/reload`. |
| `GuildUsageChart` | `GET /analytics/guilds/:id` | Visualiza consumo (queue size, filtros, watchers). |
| `HealthWidget` | Gateway/worker `/health` | Muestra estado de Redis, Lavalink, Jobs. |
| `StudioModeBuilder` | Config local + API `PUT /guilds/:id/settings` | Guarda presets visuales, genera preview de UI in-guild. |
| `ExperimentToggle` | Metadatos en `subscription_plans.features.experiments` | Activa campañas de precio/beneficios. |

### Seguridad & Compliance
- Autenticación vía Discord OAuth (scope `identify`, `guilds`) → token de sesión con duración corta y refresh server-side.
- RBAC: roles `customer`, `admin`, `support`. Solo `admin` accede a `/plans` mutate y experiment toggles.
- Todas las llamadas usan `X-API-Key` + JWT; se debe montar API gateway que traduzca tokens del panel a las rutas existentes.
- Auditoría: guardar cambios de planes/guild settings en tabla `admin_audit_logs` (timestamp, actor, diff).

### Roadmap de Desarrollo
| Fase | Duración estimada | Entregables |
|------|-------------------|-------------|
| **Fase 0 – Setup** | 1 semana | Repo `apps/panel`, Next.js + Auth boilerplate, CI (lint/test). |
| **Fase 1 – Panel público** | 2 semanas | Landing con hero, comparativa, tabla de planes viva, enlaces a status. |
| **Fase 2 – Portal premium** | 3 semanas | Dashboard de guild, Studio Mode v1, integración OAuth y Stripe portal. |
| **Fase 3 – Panel interno** | 3 semanas | CRUD de planes, experiments, monitoreo health & incident timeline. |
| **Fase 4 – Experimentos & Insights** | 2 semanas | Motor de recomendaciones (Playbooks), wizard MercadoPago/Stripe. |

**KPIs a monitorear:** tasa de conversión landing→registro, upgrades desde el panel, tiempo medio de response del dashboard, uso de Studio Mode, incident response time visible en status timeline.

### Estado actual del Plan Engine (Fase 2)
- `/admin/plans` ya expone una capa Plan Engine inspirada en los paneles de Hydra/Green-Bot: lista la metadata viva desde PostgreSQL y ofrece edición inline de nombre, descripción, flags de experimentos y precios activos.
- Toda mutación reusa los endpoints oficiales (`PUT /api/v1/plans/:id`, `PUT /prices/:priceId`, `POST /prices`) documentados en el API, y el botón “Recargar runtime” dispara `POST /api/v1/plans/reload` para evitar reinicios.
- El acceso está protegido por Discord OAuth (NextAuth v5) y la lista de staff (`PANEL_STAFF_DISCORD_IDS`) replicando el patrón RBAC recomendado por [Discord OAuth2 docs](https://discord.com/developers/docs/topics/oauth2). Esto alinea el flujo administrativo con las prácticas de los bots comerciales líderes.
