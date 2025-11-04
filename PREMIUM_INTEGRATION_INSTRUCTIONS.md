# Premium Controller Integration Instructions

## 📝 Pasos para Integrar el Controlador Premium

### 1. Agregar Import en main.ts

**Ubicación**: Después de la línea 43 (`import { MusicUIBuilder }...`)

```typescript
// Premium Controller
import { PremiumController } from './presentation/controllers/premium-controller.js';
```

### 2. Agregar Property en GatewayApplication Class

**Ubicación**: Después de la línea 78 (`private voteSkipService!: VoteSkipService;`)

```typescript
private premiumController!: PremiumController;
```

### 3. Inicializar el Controlador en setupDiscordClient()

**Ubicación**: Buscar el método `setupDiscordClient()` y agregar después de inicializar otros controladores

```typescript
// Initialize Premium Controller
this.premiumController = new PremiumController();
```

### 4. Agregar Case en el Command Router

**Ubicación**: En el evento `interactionCreate`, línea ~2280, agregar antes del `default`:

```typescript
case 'premium':
  await this.premiumController.handleCommand(interaction);
  break;
```

### 5. Reemplazar los TODOs de subscription y upgrade

**Reemplazar estas líneas (2280-2287)**:

```typescript
// ANTES:
case 'subscription':
  // TODO: Implement subscription management
  await interaction.reply({ content: 'Subscription management coming soon!', flags: MessageFlags.Ephemeral });
  break;
case 'upgrade':
  // TODO: Implement upgrade system
  await interaction.reply({ content: 'Upgrade system coming soon!', flags: MessageFlags.Ephemeral });
  break;

// DESPUÉS:
case 'premium':
  await this.premiumController.handleCommand(interaction);
  break;
```

### 6. Registrar Comandos Premium en Discord

El comando `/premium` con todos sus subcomandos debe ser registrado usando el Discord Developer Portal o mediante un deploy script.

**Comando a registrar**:
```json
{
  "name": "premium",
  "description": "Manage your premium subscription",
  "options": [
    {
      "name": "status",
      "description": "Check your current subscription status",
      "type": 1
    },
    {
      "name": "plans",
      "description": "View available subscription plans",
      "type": 1
    },
    {
      "name": "upgrade",
      "description": "Upgrade your subscription",
      "type": 1,
      "options": [
        {
          "name": "tier",
          "description": "Subscription tier to upgrade to",
          "type": 3,
          "required": true,
          "choices": [
            {"name": "Basic - $4.99/month", "value": "BASIC"},
            {"name": "Premium - $9.99/month", "value": "PREMIUM"},
            {"name": "Enterprise - Contact Sales", "value": "ENTERPRISE"}
          ]
        }
      ]
    },
    {
      "name": "features",
      "description": "View premium features for your plan",
      "type": 1
    },
    {
      "name": "usage",
      "description": "Check your usage statistics",
      "type": 1
    },
    {
      "name": "cancel",
      "description": "Cancel your subscription",
      "type": 1
    }
  ]
}
```

### 7. Actualizar Deploy Scripts

Si existe un script para registrar comandos (`scripts/deploy-commands.ts`), agregar el comando premium:

```typescript
import { PremiumController } from '../gateway/src/presentation/controllers/premium-controller.js';

const premiumController = new PremiumController();
const premiumCommands = premiumController.getCommands();

// Agregar a la lista de comandos a registrar
commands.push(...premiumCommands);
```

---

## 🔧 Ejemplo de Uso del Middleware en Comandos Existentes

### Opción A: Usando Decorators (Recomendado)

```typescript
import { RequireFeature, RequireLimit } from '../middleware/subscription-middleware.js';

class MusicController {
  @RequireFeature('advanced_commands')
  @RequireLimit('queue_size', 1)
  async handleAdvancedCommand(interaction: CommandInteraction) {
    // Solo se ejecuta si pasa las validaciones
  }
}
```

### Opción B: Validación Manual

```typescript
import { subscriptionMiddleware } from '../middleware/subscription-middleware.js';

async handleCommand(interaction: CommandInteraction) {
  // Verificar feature
  const featureCheck = await subscriptionMiddleware.checkFeatureAccess(
    interaction,
    'premium_commands'
  );

  if (!featureCheck.allowed) {
    return; // Error message ya fue enviado
  }

  // Verificar límite
  const limitCheck = await subscriptionMiddleware.checkUsageLimit(
    interaction,
    'monthly_tracks',
    { incrementAmount: 1 }
  );

  if (!limitCheck.allowed) {
    return; // Error message ya fue enviado
  }

  // Ejecutar comando
  // ...
}
```

### Opción C: Validación Comprehensiva

```typescript
const check = await subscriptionMiddleware.checkSubscription(interaction, {
  featureKey: 'autoplay_advanced_modes',
  limitType: 'queue_size',
  incrementAmount: 1,
  showUpgradePrompt: true
});

if (!check.allowed) {
  return;
}
```

---

## 🎯 Features Disponibles para Validación

```typescript
// Playback
'concurrent_playbacks'
'autoplay_enabled'
'autoplay_advanced_modes'

// Commands
'advanced_commands'
'premium_commands'

// Audio Quality
'audio_quality'

// Customization
'custom_prefix'
'custom_branding'
'white_label'

// Support
'priority_support'
'24_7_support'
'dedicated_support'

// Analytics
'analytics_enabled'
'advanced_analytics'
```

---

## 📊 Límites Disponibles para Validación

```typescript
// Usage Limits
'concurrent_playbacks'  // Número de playbacks simultáneos
'monthly_tracks'        // Tracks por mes
'queue_size'            // Tamaño máximo de cola
'max_song_duration'     // Duración máxima de canción
'api_rate_limit'        // Requests por minuto
'daily_playback_hours'  // Horas de reproducción diarias
'max_guilds'            // Número de servidores
'playlist_size'         // Tamaño de playlist importada
```

---

## ✅ Checklist de Integración

- [ ] Agregar import de PremiumController
- [ ] Agregar property en la clase
- [ ] Inicializar en setupDiscordClient()
- [ ] Agregar case en el command router
- [ ] Eliminar TODOs de subscription/upgrade
- [ ] Registrar comando /premium en Discord
- [ ] Actualizar deploy scripts
- [ ] Compilar y probar
- [ ] Verificar que los subcomandos funcionen
- [ ] Probar upgrade prompts
- [ ] Verificar integración con Stripe (si está configurado)

---

## 🧪 Tests de Integración

```bash
# Compilar gateway
cd gateway
pnpm build

# Verificar que no haya errores de TypeScript
pnpm typecheck

# Ejecutar el bot localmente
pnpm start

# Probar comandos en Discord
/premium status
/premium plans
/premium features
/premium usage
```

---

## 📝 Notas Importantes

1. **Stripe Configuration**: Asegurarse de que las variables de entorno de Stripe estén configuradas antes de usar la funcionalidad de upgrade/checkout.

2. **Database Migration**: Ejecutar las migraciones de Prisma antes de usar el sistema de subscripciones:
   ```bash
   pnpm --filter @discord-bot/database prisma migrate dev
   ```

3. **Redis Connection**: El sistema de rate limiting requiere Redis. Verificar que `REDIS_URL` esté configurado.

4. **Error Handling**: Todos los errores son manejados por el middleware y no requieren manejo adicional en los comandos.

5. **Ephemeral Messages**: Todos los mensajes premium son efímeros (solo visible para el usuario) por privacidad.

---

## 🔗 Enlaces Relacionados

- **Premium Controller**: `gateway/src/presentation/controllers/premium-controller.ts`
- **Subscription Middleware**: `gateway/src/middleware/subscription-middleware.ts`
- **Subscription Service**: `packages/subscription/src/subscription-service.ts`
- **Plans Definition**: `packages/subscription/src/plans.ts`
- **Database Schema**: `packages/database/prisma/schema.prisma`

---

**Última Actualización**: 31 de Octubre, 2025
**Responsable**: Development Team
