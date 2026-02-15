# Enterprise Billing System - Implementation Guide

**Status:** Foundation Complete ✅
**Version:** 1.0.0
**Date:** November 5, 2025

---

## 📋 Executive Summary

This document provides a comprehensive guide to the Discord Music Bot's enterprise-grade billing system. The system powers our public plans (Free, Plus, Pro) and optionally proyectos custom de nivel enterprise. It is not a specification for un cuarto plan comercial, sino la base técnica sobre la que se construyen los planes existentes. The system is designed to support monetization through multiple payment providers (Stripe, MercadoPago, PayPal) with a fully modular, pluggable architecture.

### Key Features

✅ **Multi-Provider Support** - Stripe, MercadoPago, PayPal (pluggable architecture)
✅ **Regional Routing** - Automatic provider selection based on customer location
✅ **Customer Management** - Complete CRM with registration, profiles, and lifecycle tracking
✅ **Subscription Management** - Plans, pricing, billing cycles, trials
✅ **Payment Processing** - Payment intents, refunds, invoices
✅ **Analytics & Metrics** - Revenue tracking, cohort analysis, LTV calculation
✅ **Audit Trail** - Complete billing history for compliance
✅ **Fallback & Retry** - Automatic failover and retry logic

---

## 🏗️ Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Discord Music Bot                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │        Customer Management Service                   │  │
│  │  - Registration                                      │  │
│  │  - Profile Management                                │  │
│  │  - Subscription Lifecycle                            │  │
│  └─────────────────┬────────────────────────────────────┘  │
│                    │                                        │
│  ┌─────────────────▼────────────────────────────────────┐  │
│  │        Payment Provider Factory                      │  │
│  │  - Multi-provider support                            │  │
│  │  - Regional routing                                  │  │
│  │  - Fallback strategies                               │  │
│  └─────────────────┬────────────────────────────────────┘  │
│                    │                                        │
│       ┌────────────┼────────────┐                          │
│       │            │            │                          │
│  ┌────▼───┐  ┌────▼───┐  ┌────▼───┐                       │
│  │ Stripe │  │ MP     │  │ PayPal │                       │
│  │ Provider│  │Provider│  │Provider│                       │
│  └────────┘  └────────┘  └────────┘                       │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │        Billing Analytics Service                     │  │
│  │  - Revenue metrics                                   │  │
│  │  - Customer analytics                                │  │
│  │  - Cohort analysis                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │   PostgreSQL    │
                  │   Database      │
                  └─────────────────┘
```

### Regional Routing Strategy

The system automatically routes customers to the most appropriate payment provider based on their location:

- **Stripe**: US, Canada, UK, Germany, France, Spain, Italy
- **MercadoPago**: Argentina, Brazil, Mexico, Chile, Colombia, Peru, Uruguay
- **PayPal**: Fallback for other regions

---

## 📂 Project Structure

### New Files Created

```
discord_bot/
├── packages/database/prisma/
│   └── schema-billing.prisma         # Comprehensive billing data models
│
└── gateway/src/
    ├── infrastructure/payment/
    │   ├── payment-provider.interface.ts      # Payment provider contract
    │   ├── payment-provider-factory.ts        # Factory pattern implementation
    │   └── stub-payment-provider.ts           # Testing/dev implementation
    │
    └── domain/services/
        ├── customer-management-service.ts     # Customer CRM
        └── billing-analytics-service.ts       # Analytics & metrics
```

### Data Models

#### Core Entities

1. **Customer** - Customer records with Discord integration
2. **PaymentMethod** - Stored payment methods (cards, bank accounts)
3. **SubscriptionPlan** - Plan definitions (Free, Plus, Pro; extensible a proyectos custom de nivel enterprise)
4. **SubscriptionPrice** - Multi-currency pricing
5. **Subscription** - Active subscriptions
6. **Invoice** - Billing invoices
7. **InvoiceLineItem** - Invoice line items
8. **Payment** - Payment transactions
9. **Refund** - Refund records
10. **BillingHistory** - Complete audit trail
11. **BillingMetrics** - Daily aggregated metrics
12. **CustomerLifetimeValue** - LTV tracking

---

## 🚀 Implementation Guide

### Phase 1: Database Setup (NEXT STEP)

#### 1.1 Integrate Billing Schema

The billing schema needs to be integrated into the main Prisma schema:

```bash
# Location: packages/database/prisma/schema.prisma
```

**Action Required:**
- Merge `schema-billing.prisma` into main `schema.prisma`
- Run migration:
  ```bash
  pnpm --filter @discord-bot/database prisma migrate dev --name add-enterprise-billing
  pnpm --filter @discord-bot/database prisma generate
  ```

#### 1.2 Seed Subscription Plans

Create initial subscription plans using the same tier model que utiliza el runtime (`FREE`, `BASIC`, `PREMIUM`) que se muestran comercialmente como Free, Plus y Pro. Para proyectos custom podés extender estos planes con capacidades adicionales en lugar de definir un cuarto plan empaquetado.

### Phase 2: Stripe Integration (Priority 1)

#### 2.1 Install Stripe SDK

```bash
pnpm --filter gateway add stripe
```

#### 2.2 Create Stripe Payment Provider

```typescript
// gateway/src/infrastructure/payment/stripe-payment-provider.ts

import Stripe from 'stripe';
import { IPaymentProvider, PaymentProviderConfig, ... } from './payment-provider.interface.js';

export class StripePaymentProvider implements IPaymentProvider {
  private stripe: Stripe;
  readonly config: PaymentProviderConfig;
  readonly name = 'stripe';

  constructor(config: PaymentProviderConfig) {
    this.config = config;
    this.stripe = new Stripe(config.apiKey, {
      apiVersion: '2024-11-20.acacia', // Latest version
    });
  }

  async createCustomer(data: {
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<PaymentCustomer> {
    const customer = await this.stripe.customers.create({
      email: data.email,
      name: data.name,
      metadata: data.metadata,
    });

    return {
      id: customer.id,
      email: customer.email!,
      name: customer.name || undefined,
      metadata: customer.metadata,
      createdAt: new Date(customer.created * 1000),
    };
  }

  // Implement remaining methods...
}
```

#### 2.3 Configure Stripe in Factory

Update [payment-provider-factory.ts:77-79](gateway/src/infrastructure/payment/payment-provider-factory.ts#L77-L79):

```typescript
// BEFORE (commented out):
// if (this.config.providers.stripe) {
//   this.providers.set('stripe', new StripePaymentProvider(this.config.providers.stripe));
// }

// AFTER:
if (this.config.providers.stripe) {
  this.providers.set('stripe', new StripePaymentProvider(this.config.providers.stripe));
}
```

#### 2.4 Set Up Stripe Webhook Handler

```typescript
// gateway/src/presentation/controllers/stripe-webhook-controller.ts

export class StripeWebhookController {
  constructor(
    private paymentFactory: PaymentProviderFactory,
    private customerService: CustomerManagementService
  ) {}

  async handleWebhook(rawBody: string, signature: string): Promise<void> {
    const provider = this.paymentFactory.getProvider('stripe');

    // Verify signature
    if (!provider.verifyWebhookSignature(rawBody, signature)) {
      throw new Error('Invalid webhook signature');
    }

    // Parse event
    const event = provider.parseWebhookEvent(rawBody);

    // Handle event types
    switch (event.type) {
      case 'customer.subscription.created':
        await this.handleSubscriptionCreated(event);
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event);
        break;

      case 'invoice.paid':
        await this.handleInvoicePaid(event);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event);
        break;

      // Add more event handlers...
    }
  }
}
```

#### 2.5 Add Webhook Endpoint

```typescript
// gateway/src/presentation/routes/billing-routes.ts

import express from 'express';

const router = express.Router();

router.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }), // Important: raw body for signature verification
  async (req, res) => {
    const signature = req.headers['stripe-signature'] as string;

    try {
      await stripeWebhookController.handleWebhook(
        req.body.toString(),
        signature
      );
      res.status(200).json({ received: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
);
```

### Phase 3: MercadoPago Integration (Priority 2)

#### 3.1 Install MercadoPago SDK

```bash
pnpm --filter gateway add mercadopago
```

#### 3.2 Create MercadoPago Provider

Similar structure to Stripe provider, implementing `IPaymentProvider` interface.

```typescript
// gateway/src/infrastructure/payment/mercadopago-payment-provider.ts

import mercadopago from 'mercadopago';
import { IPaymentProvider, ... } from './payment-provider.interface.js';

export class MercadoPagoPaymentProvider implements IPaymentProvider {
  readonly config: PaymentProviderConfig;
  readonly name = 'mercadopago';

  constructor(config: PaymentProviderConfig) {
    this.config = config;
    mercadopago.configure({
      access_token: config.apiKey,
    });
  }

  // Implement IPaymentProvider methods...
}
```

### Phase 4: Customer Management Integration

#### 4.1 Add Customer Registration to Discord Commands

```typescript
// gateway/src/presentation/controllers/premium-controller.ts

import { CustomerManagementService } from '../../domain/services/customer-management-service.js';

export class PremiumController {
  constructor(
    private customerService: CustomerManagementService
  ) {}

  async handlePremiumSignup(interaction: ChatInputCommandInteraction) {
    // Get user info
    const discordUserId = interaction.user.id;
    const email = interaction.options.getString('email', true);

    // Register customer
    const customer = await this.customerService.registerCustomer({
      discordUserId,
      discordUsername: interaction.user.username,
      discordDiscriminator: interaction.user.discriminator,
      email,
      // Detect country from Discord locale or user input
      country: this.detectCountry(interaction.locale),
    });

    // Create subscription
    const subscription = await this.customerService.createSubscription({
      customerId: customer.id,
      planId: 'premium',
      priceId: 'price_xxx', // Get from plan selection
      trialPeriodDays: 14,
    });

    await interaction.reply({
      content: `✅ Premium subscription activated!\n\n` +
               `Trial: 14 days\n` +
               `Subscription ID: ${subscription.id}`,
      ephemeral: true,
    });
  }
}
```

### Phase 5: Analytics Dashboard

#### 5.1 Create Analytics Endpoints

```typescript
// gateway/src/presentation/controllers/analytics-controller.ts

import { BillingAnalyticsService } from '../../domain/services/billing-analytics-service.js';

export class AnalyticsController {
  constructor(private analyticsService: BillingAnalyticsService) {}

  async getDashboard(req: Request, res: Response) {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);

    const summary = await this.analyticsService.generateAnalyticsSummary(
      startDate,
      endDate
    );

    res.json(summary);
  }

  async exportCSV(req: Request, res: Response) {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);

    const csv = await this.analyticsService.exportToCSV(startDate, endDate);

    res.header('Content-Type', 'text/csv');
    res.attachment(`analytics-${startDate.toISOString()}-${endDate.toISOString()}.csv`);
    res.send(csv);
  }
}
```

#### 5.2 Schedule Daily Metrics Collection

```typescript
// worker/src/jobs/daily-metrics-job.ts

import cron from 'node-cron';

// Run daily at midnight
cron.schedule('0 0 * * *', async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  await billingAnalyticsService.generateDailyMetricsSnapshot(yesterday);
});
```

---

## 🔧 Environment Configuration

Add to `.env`:

```env
# Payment Provider Selection
PAYMENT_PROVIDER=stripe  # or 'mercadopago', 'paypal', 'stub'

# Stripe Configuration
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# MercadoPago Configuration
MERCADOPAGO_ACCESS_TOKEN=APP_USR-xxx
MERCADOPAGO_WEBHOOK_SECRET=xxx

# PayPal Configuration (future)
PAYPAL_CLIENT_ID=xxx
PAYPAL_CLIENT_SECRET=xxx
PAYPAL_WEBHOOK_ID=xxx
```

---

## 📊 Data Flow Diagrams

### Customer Registration Flow

```
User           Discord Bot       CustomerService    PaymentProvider    Database
  │                 │                  │                   │              │
  │──/premium──────>│                  │                   │              │
  │                 │─registerCustomer─>│                   │              │
  │                 │                  │──getProvider────>│              │
  │                 │                  │                   │              │
  │                 │                  │──createCustomer──>│              │
  │                 │                  │<─customerId───────│              │
  │                 │                  │                   │              │
  │                 │                  │──saveCustomer────────────────────>│
  │                 │                  │<─customer─────────────────────────│
  │                 │<─customer────────│                   │              │
  │<─confirmation───│                  │                   │              │
```

### Subscription Payment Flow

```
User           Discord Bot    SubscriptionService  PaymentProvider  Webhook   Database
  │                 │                 │                  │             │         │
  │──/subscribe────>│                 │                  │             │         │
  │                 │─createSubscription>                 │             │         │
  │                 │                 │─createSubscription>             │         │
  │                 │                 │<─subscription────│             │         │
  │                 │                 │─saveSubscription────────────────────────>│
  │<─confirmation───│                 │                  │             │         │
  │                 │                 │                  │             │         │
  │                 │                 │                  │────webhook──>         │
  │                 │                 │                  │             │─handle─>│
  │                 │<────notification─────────────────────────────────│         │
```

---

## 🧪 Testing Strategy

### Unit Tests

```typescript
// gateway/test/payment-provider-factory.test.ts

describe('PaymentProviderFactory', () => {
  it('should route US customers to Stripe', () => {
    const factory = new PaymentProviderFactory(config);
    const provider = factory.getProviderForCountry('US');
    expect(provider.name).toBe('stripe');
  });

  it('should route AR customers to MercadoPago', () => {
    const factory = new PaymentProviderFactory(config);
    const provider = factory.getProviderForCountry('AR');
    expect(provider.name).toBe('mercadopago');
  });

  it('should fallback to default provider if region provider unavailable', async () => {
    const factory = new PaymentProviderFactory({
      defaultProvider: 'stub',
      providers: {}, // No providers configured
      fallbackProvider: 'stub',
    });

    const provider = await factory.getProviderWithFallback('stripe');
    expect(provider.name).toBe('stub');
  });
});
```

### Integration Tests

```typescript
// gateway/test/customer-management.integration.test.ts

describe('Customer Management Integration', () => {
  it('should register customer and create Stripe customer', async () => {
    const customer = await customerService.registerCustomer({
      discordUserId: '123456',
      email: 'test@example.com',
      country: 'US',
    });

    expect(customer.stripeCustomerId).toBeDefined();
    expect(customer.stripeCustomerId).toMatch(/^cus_/);
  });

  it('should create subscription with trial period', async () => {
    const subscription = await customerService.createSubscription({
      customerId: customer.id,
      planId: 'premium',
      priceId: 'price_xxx',
      trialPeriodDays: 14,
    });

    expect(subscription.status).toBe('trialing');
    expect(subscription.trialEnd).toBeDefined();
  });
});
```

---

## 📈 Metrics & Monitoring

### Key Metrics to Track

1. **Revenue Metrics**
   - MRR (Monthly Recurring Revenue)
   - ARR (Annual Recurring Revenue)
   - Revenue growth rate

2. **Customer Metrics**
   - New customers
   - Churn rate
   - Customer LTV

3. **Subscription Metrics**
   - Active subscriptions
   - Conversion rate (trial → paid)
   - Upgrade/downgrade rates

4. **Payment Metrics**
   - Payment success rate
   - Failed payment recovery rate
   - Refund rate

### Prometheus Metrics

```typescript
// Add to gateway/src/infrastructure/metrics/billing-metrics.ts

const billing_revenue_total = new promClient.Counter({
  name: 'billing_revenue_total',
  help: 'Total revenue by provider and currency',
  labelNames: ['provider', 'currency', 'plan'],
});

const billing_subscriptions_active = new promClient.Gauge({
  name: 'billing_subscriptions_active',
  help: 'Number of active subscriptions by plan',
  labelNames: ['plan', 'status'],
});

const billing_payment_success_rate = new promClient.Histogram({
  name: 'billing_payment_success_rate',
  help: 'Payment success rate by provider',
  labelNames: ['provider'],
  buckets: [0.8, 0.9, 0.95, 0.99, 1.0],
});
```

---

## 🔐 Security Considerations

### PCI Compliance

- **Never store card details** - Use provider tokens only
- **Use HTTPS** for all payment endpoints
- **Validate webhook signatures** to prevent fraud
- **Implement rate limiting** on payment endpoints

### Data Protection

- **Encrypt sensitive data** in database (tax IDs, addresses)
- **Implement GDPR compliance** for customer data
- **Audit trail** for all billing operations
- **Regular security audits**

### Access Control

- **Role-based access** for admin operations
- **2FA for admin accounts**
- **IP whitelisting** for webhook endpoints
- **API key rotation** policy

---

## 📝 Admin Operations

### Refund Process

```typescript
// Example admin refund command
await customerService.processRefund(
  customerId,
  paymentIntentId,
  5000, // Partial refund amount (in cents)
  'SERVICE_NOT_PROVIDED' // Reason for audit trail
);
```

### Subscription Management

```typescript
// Cancel subscription
await customerService.cancelSubscription(
  customerId,
  subscriptionId,
  false, // Don't cancel immediately, end at period end
  'Customer requested cancellation'
);

// Force immediate cancellation
await customerService.cancelSubscription(
  customerId,
  subscriptionId,
  true, // Cancel immediately
  'Terms of service violation'
);
```

---

## 🚦 Rollout Plan

### Stage 1: Internal Testing (Week 1)
- Use stub provider for all development
- Test UI flows and user experience
- Validate data models

### Stage 2: Stripe Beta (Week 2-3)
- Enable Stripe for test users only
- Monitor payment success rates
- Gather user feedback

### Stage 3: MercadoPago Beta (Week 4)
- Enable MercadoPago for LATAM users
- Test regional routing
- Validate currency conversions

### Stage 4: General Availability (Week 5+)
- Full rollout to all users
- Enable all payment providers
- Monitor metrics and analytics

---

## 📚 Additional Resources

### Stripe Documentation
- [Stripe API Reference](https://stripe.com/docs/api)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)
- [Stripe Subscriptions](https://stripe.com/docs/billing/subscriptions/overview)

### MercadoPago Documentation
- [MercadoPago API Reference](https://www.mercadopago.com.ar/developers/en/reference)
- [MercadoPago Subscriptions](https://www.mercadopago.com.ar/developers/en/guides/subscriptions/introduction)

### Business Resources
- [SaaS Metrics Guide](https://www.forentrepreneurs.com/saas-metrics-2/)
- [Cohort Analysis Best Practices](https://www.geckoboard.com/best-practice/kpi-examples/cohort-analysis/)

---

## ✅ Implementation Checklist

### Foundation (Completed)
- [x] Payment provider interface
- [x] Payment provider factory
- [x] Stub payment provider
- [x] Customer management service
- [x] Billing analytics service
- [x] Comprehensive data models
- [x] Documentation

### Next Steps (To Do)
- [ ] Integrate billing schema into main Prisma schema
- [ ] Run database migrations
- [ ] Implement Stripe payment provider
- [ ] Set up Stripe webhook handler
- [ ] Add customer registration to Discord commands
- [ ] Create subscription management commands
- [ ] Implement MercadoPago provider
- [ ] Set up analytics dashboard
- [ ] Add daily metrics collection job
- [ ] Write comprehensive tests
- [ ] Deploy to staging environment
- [ ] Conduct beta testing
- [ ] Production rollout

---

**Document Version:** 1.0.0
**Last Updated:** November 5, 2025
**Status:** Ready for Implementation 🚀
