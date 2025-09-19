import { NotificationService } from '../../application/use-cases/subscription-management-use-case.js';
import { Customer } from '../../domain/entities/customer.js';

/**
 * Stub Notification Service - For Development/Testing
 * In production, this would send emails, Discord DMs, or push notifications
 */
export class StubNotificationService implements NotificationService {
  async sendSubscriptionExpiring(customer: Customer): Promise<void> {
    console.log(`[StubNotificationService] Subscription expiring notification sent to ${customer.email}`);
    console.log(`Customer: ${customer.name} (${customer.id})`);
    console.log(`Subscription expires in ${customer.daysUntilExpiration} days`);
  }

  async sendTrialEnding(customer: Customer): Promise<void> {
    console.log(`[StubNotificationService] Trial ending notification sent to ${customer.email}`);
    console.log(`Customer: ${customer.name} (${customer.id})`);
    console.log(`Trial expires in ${customer.daysUntilExpiration} days`);
  }

  async sendSubscriptionUpgraded(customer: Customer): Promise<void> {
    console.log(`[StubNotificationService] Subscription upgraded notification sent to ${customer.email}`);
    console.log(`Customer: ${customer.name} (${customer.id})`);
    console.log(`New plan: ${customer.subscriptionPlan.name} (${customer.subscriptionPlan.type})`);
  }

  async sendSubscriptionCancelled(customer: Customer): Promise<void> {
    console.log(`[StubNotificationService] Subscription cancelled notification sent to ${customer.email}`);
    console.log(`Customer: ${customer.name} (${customer.id})`);
    console.log(`Subscription will remain active until: ${customer.subscriptionExpiresAt}`);
  }
}