-- CreateEnum
CREATE TYPE "public"."CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "public"."PaymentMethodType" AS ENUM ('CARD', 'BANK_ACCOUNT', 'WALLET', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PaymentMethodStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'FAILED', 'REMOVED');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "public"."RefundReason" AS ENUM ('DUPLICATE', 'FRAUDULENT', 'REQUESTED_BY_CUSTOMER', 'SERVICE_NOT_PROVIDED', 'TECHNICAL_ISSUE', 'BILLING_ERROR', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."BillingInterval" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "public"."BillingEventType" AS ENUM ('CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CUSTOMER_DELETED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_STARTED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_UPGRADED', 'SUBSCRIPTION_DOWNGRADED', 'SUBSCRIPTION_PAUSED', 'SUBSCRIPTION_RESUMED', 'SUBSCRIPTION_CANCELED', 'SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_TRIAL_STARTED', 'SUBSCRIPTION_TRIAL_ENDED', 'PAYMENT_METHOD_ADDED', 'PAYMENT_METHOD_UPDATED', 'PAYMENT_METHOD_REMOVED', 'PAYMENT_METHOD_FAILED', 'INVOICE_CREATED', 'INVOICE_FINALIZED', 'INVOICE_SENT', 'INVOICE_PAID', 'INVOICE_PAYMENT_FAILED', 'INVOICE_VOIDED', 'PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'REFUND_REQUESTED', 'REFUND_PROCESSED', 'REFUND_FAILED', 'CREDIT_APPLIED', 'DISPUTE_CREATED', 'DISPUTE_RESOLVED');

-- AlterEnum
BEGIN;
CREATE TYPE "public"."InvoiceStatus_new" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');
ALTER TABLE "public"."Invoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."invoices" ALTER COLUMN "status" TYPE "public"."InvoiceStatus_new" USING ("status"::text::"public"."InvoiceStatus_new");
ALTER TYPE "public"."InvoiceStatus" RENAME TO "InvoiceStatus_old";
ALTER TYPE "public"."InvoiceStatus_new" RENAME TO "InvoiceStatus";
DROP TYPE "public"."InvoiceStatus_old";
COMMIT;

-- AlterEnum
ALTER TYPE "public"."SubscriptionStatus" ADD VALUE 'PAUSED';

-- DropForeignKey
ALTER TABLE "public"."Invoice" DROP CONSTRAINT "Invoice_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."UsageLimit" DROP CONSTRAINT "UsageLimit_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "public"."UsageTracking" DROP CONSTRAINT "UsageTracking_subscriptionId_fkey";

-- DropTable
DROP TABLE "public"."Invoice";

-- DropTable
DROP TABLE "public"."Subscription";

-- DropEnum
DROP TYPE "public"."BillingCycle";

-- CreateTable
CREATE TABLE "public"."customers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "discordUsername" TEXT,
    "discordDiscriminator" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "address" JSONB,
    "taxId" TEXT,
    "taxIdType" TEXT,
    "country" TEXT,
    "stripeCustomerId" TEXT,
    "mercadopagoCustomerId" TEXT,
    "paypalCustomerId" TEXT,
    "metadata" JSONB,
    "status" "public"."CustomerStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payment_methods" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentMethodId" TEXT NOT NULL,
    "type" "public"."PaymentMethodType" NOT NULL,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "cardExpMonth" INTEGER,
    "cardExpYear" INTEGER,
    "bankName" TEXT,
    "bankLast4" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."PaymentMethodStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscription_plans" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "features" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscription_prices" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPriceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "interval" "public"."BillingInterval" NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "trialPeriodDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "subscription_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscriptions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "priceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubscriptionId" TEXT NOT NULL,
    "paymentMethodId" TEXT,
    "status" "public"."SubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "metadata" JSONB,
    "usageTrackingId" TEXT,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoices" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "provider" TEXT NOT NULL,
    "providerInvoiceId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "amountDue" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "public"."InvoiceStatus" NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "hostedInvoiceUrl" TEXT,
    "invoicePdfUrl" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoice_line_items" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerLineItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "providerIntentId" TEXT,
    "paymentMethodId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "amountRefunded" INTEGER NOT NULL DEFAULT 0,
    "status" "public"."PaymentStatus" NOT NULL,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "description" TEXT,
    "metadata" JSONB,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."refunds" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRefundId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" "public"."RefundReason",
    "reasonNote" TEXT,
    "status" "public"."RefundStatus" NOT NULL,
    "failureReason" TEXT,
    "processedBy" TEXT,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_history" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "paymentId" TEXT,
    "refundId" TEXT,
    "eventType" "public"."BillingEventType" NOT NULL,
    "provider" TEXT,
    "description" TEXT NOT NULL,
    "amount" INTEGER,
    "currency" TEXT,
    "metadata" JSONB,
    "actor" TEXT,

    CONSTRAINT "billing_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."billing_metrics" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATE NOT NULL,
    "totalRevenue" INTEGER NOT NULL DEFAULT 0,
    "recurringRevenue" INTEGER NOT NULL DEFAULT 0,
    "oneTimeRevenue" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "newCustomers" INTEGER NOT NULL DEFAULT 0,
    "churnedCustomers" INTEGER NOT NULL DEFAULT 0,
    "totalActiveCustomers" INTEGER NOT NULL DEFAULT 0,
    "newSubscriptions" INTEGER NOT NULL DEFAULT 0,
    "canceledSubscriptions" INTEGER NOT NULL DEFAULT 0,
    "upgrades" INTEGER NOT NULL DEFAULT 0,
    "downgrades" INTEGER NOT NULL DEFAULT 0,
    "totalActiveSubscriptions" INTEGER NOT NULL DEFAULT 0,
    "successfulPayments" INTEGER NOT NULL DEFAULT 0,
    "failedPayments" INTEGER NOT NULL DEFAULT 0,
    "refunds" INTEGER NOT NULL DEFAULT 0,
    "refundedAmount" INTEGER NOT NULL DEFAULT 0,
    "stripeRevenue" INTEGER NOT NULL DEFAULT 0,
    "mercadopagoRevenue" INTEGER NOT NULL DEFAULT 0,
    "paypalRevenue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "billing_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_lifetime_value" (
    "id" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "totalRevenue" INTEGER NOT NULL DEFAULT 0,
    "totalPayments" INTEGER NOT NULL DEFAULT 0,
    "totalRefunds" INTEGER NOT NULL DEFAULT 0,
    "netRevenue" INTEGER NOT NULL DEFAULT 0,
    "monthsSubscribed" INTEGER NOT NULL DEFAULT 0,
    "upgrades" INTEGER NOT NULL DEFAULT 0,
    "downgrades" INTEGER NOT NULL DEFAULT 0,
    "averageMonthlyValue" INTEGER NOT NULL DEFAULT 0,
    "predictedLtv" INTEGER,
    "firstPurchaseDate" TIMESTAMP(3),
    "lastPurchaseDate" TIMESTAMP(3),

    CONSTRAINT "customer_lifetime_value_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_discordUserId_key" ON "public"."customers"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "public"."customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_stripeCustomerId_key" ON "public"."customers"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_mercadopagoCustomerId_key" ON "public"."customers"("mercadopagoCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_paypalCustomerId_key" ON "public"."customers"("paypalCustomerId");

-- CreateIndex
CREATE INDEX "customers_discordUserId_idx" ON "public"."customers"("discordUserId");

-- CreateIndex
CREATE INDEX "customers_email_idx" ON "public"."customers"("email");

-- CreateIndex
CREATE INDEX "customers_stripeCustomerId_idx" ON "public"."customers"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "customers_mercadopagoCustomerId_idx" ON "public"."customers"("mercadopagoCustomerId");

-- CreateIndex
CREATE INDEX "payment_methods_customerId_idx" ON "public"."payment_methods"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_provider_providerPaymentMethodId_key" ON "public"."payment_methods"("provider", "providerPaymentMethodId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_name_key" ON "public"."subscription_plans"("name");

-- CreateIndex
CREATE INDEX "subscription_prices_planId_idx" ON "public"."subscription_prices"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_prices_provider_providerPriceId_key" ON "public"."subscription_prices"("provider", "providerPriceId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_providerSubscriptionId_key" ON "public"."subscriptions"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_customerId_idx" ON "public"."subscriptions"("customerId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "public"."subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_currentPeriodEnd_idx" ON "public"."subscriptions"("currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_providerInvoiceId_key" ON "public"."invoices"("providerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "public"."invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_customerId_idx" ON "public"."invoices"("customerId");

-- CreateIndex
CREATE INDEX "invoices_subscriptionId_idx" ON "public"."invoices"("subscriptionId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "public"."invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_dueDate_idx" ON "public"."invoices"("dueDate");

-- CreateIndex
CREATE INDEX "invoice_line_items_invoiceId_idx" ON "public"."invoice_line_items"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "public"."payments"("providerPaymentId");

-- CreateIndex
CREATE INDEX "payments_customerId_idx" ON "public"."payments"("customerId");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "public"."payments"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "public"."payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_providerRefundId_key" ON "public"."refunds"("providerRefundId");

-- CreateIndex
CREATE INDEX "refunds_customerId_idx" ON "public"."refunds"("customerId");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "public"."refunds"("paymentId");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "public"."refunds"("status");

-- CreateIndex
CREATE INDEX "billing_history_customerId_idx" ON "public"."billing_history"("customerId");

-- CreateIndex
CREATE INDEX "billing_history_subscriptionId_idx" ON "public"."billing_history"("subscriptionId");

-- CreateIndex
CREATE INDEX "billing_history_eventType_idx" ON "public"."billing_history"("eventType");

-- CreateIndex
CREATE INDEX "billing_history_createdAt_idx" ON "public"."billing_history"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_metrics_date_key" ON "public"."billing_metrics"("date");

-- CreateIndex
CREATE INDEX "billing_metrics_date_idx" ON "public"."billing_metrics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "customer_lifetime_value_customerId_key" ON "public"."customer_lifetime_value"("customerId");

-- CreateIndex
CREATE INDEX "customer_lifetime_value_netRevenue_idx" ON "public"."customer_lifetime_value"("netRevenue");

-- AddForeignKey
ALTER TABLE "public"."UsageLimit" ADD CONSTRAINT "UsageLimit_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payment_methods" ADD CONSTRAINT "payment_methods_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscription_prices" ADD CONSTRAINT "subscription_prices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "public"."subscription_prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "public"."payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_usageTrackingId_fkey" FOREIGN KEY ("usageTrackingId") REFERENCES "public"."UsageTracking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "public"."payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refunds" ADD CONSTRAINT "refunds_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_history" ADD CONSTRAINT "billing_history_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_history" ADD CONSTRAINT "billing_history_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_history" ADD CONSTRAINT "billing_history_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."billing_history" ADD CONSTRAINT "billing_history_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "public"."refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

