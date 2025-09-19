import { Customer } from '../../domain/entities/customer.js';
import { CustomerRepository } from '../../application/use-cases/subscription-management-use-case.js';

/**
 * In-Memory Customer Repository - For Development/Testing
 * In production, this would be replaced with a database implementation
 */
export class InMemoryCustomerRepository implements CustomerRepository {
  private customers = new Map<string, Customer>();
  private guildToCustomer = new Map<string, string>(); // guildId -> customerId
  private emailToCustomer = new Map<string, string>(); // email -> customerId

  async findById(customerId: string): Promise<Customer | null> {
    return this.customers.get(customerId) || null;
  }

  async findByGuildId(guildId: string): Promise<Customer | null> {
    const customerId = this.guildToCustomer.get(guildId);
    if (!customerId) return null;
    return this.customers.get(customerId) || null;
  }

  async findByEmail(email: string): Promise<Customer | null> {
    const customerId = this.emailToCustomer.get(email);
    if (!customerId) return null;
    return this.customers.get(customerId) || null;
  }

  async save(customer: Customer): Promise<void> {
    const data = customer.toData();

    // Update main customer map
    this.customers.set(customer.id, customer);

    // Update email index
    this.emailToCustomer.set(customer.email, customer.id);

    // Update guild-to-customer index
    for (const guildId of data.guildIds) {
      this.guildToCustomer.set(guildId, customer.id);
    }
  }

  async delete(customerId: string): Promise<void> {
    const customer = this.customers.get(customerId);
    if (!customer) return;

    const data = customer.toData();

    // Remove from all indexes
    this.customers.delete(customerId);
    this.emailToCustomer.delete(customer.email);

    for (const guildId of data.guildIds) {
      this.guildToCustomer.delete(guildId);
    }
  }

  async findExpiringSoon(days: number): Promise<Customer[]> {
    const targetDate = new Date(Date.now() + (days * 24 * 60 * 60 * 1000));
    const customers: Customer[] = [];

    for (const customer of this.customers.values()) {
      if (customer.subscriptionExpiresAt &&
          customer.subscriptionExpiresAt <= targetDate &&
          customer.subscriptionExpiresAt > new Date()) {
        customers.push(customer);
      }
    }

    return customers;
  }

  async findTrialsEndingSoon(days: number): Promise<Customer[]> {
    const targetDate = new Date(Date.now() + (days * 24 * 60 * 60 * 1000));
    const customers: Customer[] = [];

    for (const customer of this.customers.values()) {
      if (customer.trialEndsAt &&
          customer.trialEndsAt <= targetDate &&
          customer.trialEndsAt > new Date()) {
        customers.push(customer);
      }
    }

    return customers;
  }

  // Development helpers
  getAllCustomers(): Customer[] {
    return Array.from(this.customers.values());
  }

  clear(): void {
    this.customers.clear();
    this.guildToCustomer.clear();
    this.emailToCustomer.clear();
  }

  getStats(): { totalCustomers: number; totalGuilds: number } {
    return {
      totalCustomers: this.customers.size,
      totalGuilds: this.guildToCustomer.size
    };
  }
}