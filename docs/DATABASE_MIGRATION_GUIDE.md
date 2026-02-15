# 🗄️ Database Migration Guide - Billing System

**Status:** PENDING INTEGRATION
**Created:** November 5, 2025

---

## 📋 Overview

El sistema de billing empresarial está listo para integrarse en la base de datos. Los modelos están definidos en `packages/database/prisma/schema-billing.prisma` y necesitan ser fusionados con el schema principal.

---

## 🔍 Estado Actual

### Schema Actual (`schema.prisma`)
- **Líneas:** 575
- **Modelos existentes:** 20+ modelos
- **Incluye:**
  - ✅ Queue, QueueItem
  - ✅ FeatureSubscription (básico)
  - ✅ Invoice (básico)
  - ✅ SubscriptionTier
  - ❌ NO Customer
  - ❌ NO Payment
  - ❌ NO PaymentMethod
  - ❌ NO Refund
  - ❌ NO BillingHistory

### Schema Nuevo (`schema-billing.prisma`)
- **Líneas:** ~650
- **Modelos nuevos:** 12 modelos empresariales
- **Incluye:**
  - ✅ Customer (completo con Discord integration)
  - ✅ PaymentMethod
  - ✅ SubscriptionPlan
  - ✅ SubscriptionPrice
  - ✅ Subscription (mejorado)
  - ✅ Invoice (mejorado)
  - ✅ InvoiceLineItem
  - ✅ Payment
  - ✅ Refund
  - ✅ BillingHistory (audit trail)
  - ✅ BillingMetrics (analytics)
  - ✅ CustomerLifetimeValue

---

## 🚀 Pasos para Integración

### 1. Backup de Base de Datos

```bash
# Crear backup
docker exec discord_bot_postgres pg_dump -U postgres discord_bot > backup_$(date +%Y%m%d).sql

# Verificar backup
ls -lh backup_*.sql
```

### 2. Integrar Schemas

**Opción A: Fusión Manual (Recomendado)**

```bash
# 1. Abrir schema.prisma
code packages/database/prisma/schema.prisma

# 2. Agregar al final del archivo el contenido de schema-billing.prisma
# NOTA: Omitir modelos duplicados (Invoice, Subscription si existen)

# 3. Resolver conflictos:
#    - Si existe Invoice básico, reemplazar con versión mejorada
#    - Si existe Subscription, verificar compatibilidad
```

**Opción B: Reemplazo Completo (Más rápido)**

```bash
# 1. Renombrar schema actual
mv packages/database/prisma/schema.prisma packages/database/prisma/schema.backup.prisma

# 2. Copiar nuevo schema
cp packages/database/prisma/schema-billing.prisma packages/database/prisma/schema.prisma

# 3. Agregar modelos necesarios del backup que no están en billing
#    (GuildConfig, Queue, QueueItem, etc.)
```

### 3. Generar Migración

```bash
# Generar migración
pnpm --filter @discord-bot/database prisma migrate dev --name add-enterprise-billing

# Si hay errores, revisar y ajustar schema
```

### 4. Aplicar Migración

```bash
# Desarrollo
pnpm --filter @discord-bot/database prisma migrate dev

# Producción (cuando esté listo)
pnpm --filter @discord-bot/database prisma migrate deploy
```

### 5. Generar Cliente Prisma

```bash
pnpm --filter @discord-bot/database prisma:generate
```

### 6. Verificar

```bash
# Verificar migración exitosa
pnpm --filter @discord-bot/database prisma studio

# Verificar que todos los modelos están presentes
```

---

## 📊 Modelos a Integrar

### Nuevos Modelos (Agregar)

```prisma
model Customer {
  // Customer management con Discord integration
}

model PaymentMethod {
  // Métodos de pago (tarjetas, cuentas bancarias)
}

model SubscriptionPlan {
  // Definiciones de planes (Free, Plus, Pro)
}

model SubscriptionPrice {
  // Precios por provider y moneda
}

model Payment {
  // Transacciones de pago
}

model Refund {
  // Reembolsos con audit trail
}

model BillingHistory {
  // Historial completo de eventos de billing
}

model BillingMetrics {
  // Métricas diarias agregadas
}

model CustomerLifetimeValue {
  // Tracking de LTV por cliente
}

model InvoiceLineItem {
  // Líneas de factura
}
```

### Modelos a Mejorar (Reemplazar)

**Invoice:** El modelo actual es básico. El nuevo incluye:
- Line items
- Provider details
- PDF URLs
- Period dates

**Subscription:** Si existe modelo básico, mejorar con:
- Payment method association
- Trial period tracking
- Cancel settings

---

## ⚠️ Consideraciones Importantes

### Compatibilidad con Datos Existentes

Si ya hay datos de subscripciones:

1. **Migrar datos existentes:**
```sql
-- Ejemplo: Migrar de FeatureSubscription a Subscription
INSERT INTO Subscription (id, customerId, planId, status, ...)
SELECT id, userId AS customerId, tier AS planId, status, ...
FROM FeatureSubscription;
```

2. **Mantener modelos legacy** temporalmente con nuevo nombre:
```prisma
model FeatureSubscriptionLegacy {
  // Datos antiguos para referencia
}
```

### Relaciones con Modelos Existentes

El nuevo schema tiene relaciones con:
- `Customer.discordUserId` → Link con usuarios de Discord
- `Subscription.customerId` → Link con Customer
- `Payment.customerId` → Link con Customer

---

## 🧪 Testing

### 1. Test de Migración en Desarrollo

```bash
# Reset database
pnpm --filter @discord-bot/database prisma migrate reset

# Aplicar migraciones
pnpm --filter @discord-bot/database prisma migrate dev

# Seed data
pnpm db:seed
```

### 2. Test de Servicios

```bash
# Verificar que servicios compilan
pnpm typecheck

# Verificar que tests pasan
pnpm test
```

### 3. Test de Integración

```bash
# Iniciar servicios
docker-compose up -d

# Verificar customer management
curl http://localhost:3001/health

# Verificar Prisma Studio
pnpm --filter @discord-bot/database prisma studio
```

---

## 📝 Checklist de Integración

- [ ] Backup de base de datos creado
- [ ] Schema billing revisado
- [ ] Modelos duplicados identificados
- [ ] Schema fusionado o reemplazado
- [ ] Migración generada
- [ ] Migración aplicada en desarrollo
- [ ] Prisma client regenerado
- [ ] Tests ejecutados y pasando
- [ ] Servicios compilan sin errores
- [ ] Verificado en Prisma Studio
- [ ] Documentación actualizada

---

## 🔄 Rollback Plan

Si algo sale mal:

```bash
# 1. Restaurar schema
cp packages/database/prisma/schema.backup.prisma packages/database/prisma/schema.prisma

# 2. Resetear migraciones
pnpm --filter @discord-bot/database prisma migrate reset

# 3. Restaurar backup de base de datos
docker exec -i discord_bot_postgres psql -U postgres discord_bot < backup_YYYYMMDD.sql

# 4. Regenerar client
pnpm --filter @discord-bot/database prisma:generate
```

---

## 📚 Siguiente Pasos Después de Integración

1. **Actualizar servicios** para usar nuevos modelos
2. **Implementar Stripe provider** (`stripe-payment-provider.ts`)
3. **Conectar CustomerManagementService** con Prisma
4. **Agregar endpoints** de billing al API
5. **Crear comandos Discord** (`/premium`, `/billing`)
6. **Setup webhooks** de Stripe/MercadoPago
7. **Implementar analytics** con BillingAnalyticsService

---

## 🆘 Troubleshooting

### Error: "The required connected records were not found"

Causa: Relaciones con modelos que no existen
Solución: Verificar que todos los modelos relacionados están en el schema

### Error: "Unique constraint failed"

Causa: Datos duplicados en campos únicos
Solución: Limpiar datos o ajustar constraints

### Error: "Foreign key constraint failed"

Causa: Referencias a IDs que no existen
Solución: Verificar orden de inserción en seeds

---

**Última Actualización:** Noviembre 5, 2025
**Status:** ⚠️ PENDING - Requiere integración manual
**Prioridad:** Alta (necesario para monetización)
