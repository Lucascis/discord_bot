/**
 * Payment Provider Factory
 *
 * Factory for creating payment provider instances based on configuration.
 * Supports multiple providers: Stripe, MercadoPago, PayPal, etc.
 *
 * @module PaymentProviderFactory
 * @category Infrastructure
 */

import { IPaymentProvider, PaymentProviderConfig, PaymentProviderConfigError } from './payment-provider.interface.js';
import { StubPaymentProvider } from './stub-payment-provider.js';
import { StripePaymentProvider } from './stripe-payment-provider.js';
// import { MercadoPagoPaymentProvider } from './mercadopago-payment-provider.js'; // TODO: Implement

/**
 * Payment provider factory configuration
 */
export interface PaymentFactoryConfig {
  /** Default provider to use */
  defaultProvider: 'stripe' | 'mercadopago' | 'paypal' | 'stub';

  /** Provider-specific configurations */
  providers: {
    stripe?: PaymentProviderConfig;
    mercadopago?: PaymentProviderConfig;
    paypal?: PaymentProviderConfig;
  };

  /** Region-based routing */
  regionRouting?: {
    [country: string]: 'stripe' | 'mercadopago' | 'paypal';
  };

  /** Fallback strategy */
  fallbackProvider?: 'stripe' | 'mercadopago' | 'paypal' | 'stub';
}

/**
 * Payment Provider Factory
 *
 * Creates and manages payment provider instances with support for:
 * - Multiple providers
 * - Region-based routing
 * - Fallback strategies
 * - Provider health checking
 */
export class PaymentProviderFactory {
  private providers: Map<string, IPaymentProvider> = new Map();
  private config: PaymentFactoryConfig;

  constructor(config: PaymentFactoryConfig) {
    this.config = config;
    this.initializeProviders();
  }

  /**
   * Initialize all configured providers
   */
  private initializeProviders(): void {
    // Always initialize stub provider for testing
    this.providers.set('stub', new StubPaymentProvider({
      name: 'custom',
      apiKey: 'stub_key',
      apiSecret: 'stub_secret',
      webhookSecret: 'stub_webhook_secret',
      supportedCurrencies: ['USD', 'EUR', 'ARS', 'BRL', 'MXN'],
      supportedCountries: ['US', 'AR', 'BR', 'MX', 'EU'],
      supportsSubscriptions: true,
      supportsRefunds: true,
      supportsPartialRefunds: true,
      supportsPaymentMethods: true,
      testMode: true
    }));

    // Initialize Stripe if configured
    if (this.config.providers.stripe) {
      this.providers.set('stripe', new StripePaymentProvider(this.config.providers.stripe));
      console.log('[PaymentFactory] Stripe provider initialized');
    }

    // TODO: Initialize MercadoPago if configured
    if (this.config.providers.mercadopago) {
      // this.providers.set('mercadopago', new MercadoPagoPaymentProvider(this.config.providers.mercadopago));
      console.log('[PaymentFactory] MercadoPago provider configuration found but implementation pending');
    }

    // TODO: Initialize PayPal if configured
    if (this.config.providers.paypal) {
      // this.providers.set('paypal', new PayPalPaymentProvider(this.config.providers.paypal));
      console.log('[PaymentFactory] PayPal provider configuration found but implementation pending');
    }
  }

  /**
   * Get payment provider by name
   */
  getProvider(name?: string): IPaymentProvider {
    const providerName = name || this.config.defaultProvider;
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new PaymentProviderConfigError(
        providerName,
        `Payment provider '${providerName}' not configured or not available`
      );
    }

    return provider;
  }

  /**
   * Get payment provider based on customer's country
   *
   * Routes to the best provider for the region:
   * - Stripe for US/EU
   * - MercadoPago for LATAM
   * - PayPal as fallback
   */
  getProviderForCountry(country: string): IPaymentProvider {
    // Check custom routing configuration
    if (this.config.regionRouting?.[country]) {
      return this.getProvider(this.config.regionRouting[country]);
    }

    // Default regional routing
    const regionMap: Record<string, string> = {
      // North America
      'US': 'stripe',
      'CA': 'stripe',

      // Europe
      'UK': 'stripe',
      'DE': 'stripe',
      'FR': 'stripe',
      'ES': 'stripe',
      'IT': 'stripe',

      // Latin America
      'AR': 'mercadopago',
      'BR': 'mercadopago',
      'MX': 'mercadopago',
      'CL': 'mercadopago',
      'CO': 'mercadopago',
      'PE': 'mercadopago',
      'UY': 'mercadopago',
    };

    const preferredProvider = regionMap[country] || this.config.defaultProvider;

    try {
      return this.getProvider(preferredProvider);
    } catch {
      // Fallback to default if preferred provider not available
      console.warn(`[PaymentFactory] Provider '${preferredProvider}' not available for ${country}, using default`);
      return this.getProvider();
    }
  }

  /**
   * Get payment provider based on currency
   */
  getProviderForCurrency(currency: string): IPaymentProvider {
    // Find a provider that supports this currency
    for (const [_name, provider] of this.providers.entries()) {
      if (provider.supportsCurrency(currency)) {
        return provider;
      }
    }

    // Fallback to default
    return this.getProvider();
  }

  /**
   * Get all available providers
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is available
   */
  isProviderAvailable(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Get provider with fallback support
   *
   * Tries primary provider first, falls back to secondary if primary fails
   */
  async getProviderWithFallback(primaryProvider?: string): Promise<IPaymentProvider> {
    try {
      const provider = this.getProvider(primaryProvider);

      // TODO: Add health check
      // const isHealthy = await this.checkProviderHealth(provider);
      // if (!isHealthy) throw new Error('Provider unhealthy');

      return provider;
    } catch (error) {
      console.warn(`[PaymentFactory] Primary provider failed, using fallback`, error);

      if (this.config.fallbackProvider) {
        return this.getProvider(this.config.fallbackProvider);
      }

      // Last resort: stub provider
      return this.getProvider('stub');
    }
  }

  /**
   * Create a multi-provider transaction context
   *
   * Useful for implementing retry logic across providers
   */
  createTransactionContext(options: {
    preferredProvider?: string;
    fallbackProviders?: string[];
    maxRetries?: number;
  }) {
    return new PaymentTransactionContext(
      this,
      options.preferredProvider,
      options.fallbackProviders || [],
      options.maxRetries || 3
    );
  }
}

/**
 * Payment Transaction Context
 *
 * Provides automatic retry logic with fallback to different providers
 */
class PaymentTransactionContext {
  constructor(
    private factory: PaymentProviderFactory,
    private preferredProvider?: string,
    private fallbackProviders: string[] = [],
    private maxRetries: number = 3
  ) {}

  /**
   * Execute a payment operation with automatic retry and fallback
   */
  async execute<T>(
    operation: (provider: IPaymentProvider) => Promise<T>,
    onError?: (error: Error, provider: string, attempt: number) => void
  ): Promise<T> {
    const providers = [
      this.preferredProvider,
      ...this.fallbackProviders
    ].filter(Boolean) as string[];

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      for (const providerName of providers) {
        try {
          const provider = this.factory.getProvider(providerName);
          const result = await operation(provider);

          if (attempt > 0) {
            console.log(`[PaymentFactory] Transaction succeeded after ${attempt + 1} attempts using ${providerName}`);
          }

          return result;
        } catch (error) {
          lastError = error as Error;

          if (onError) {
            onError(lastError, providerName, attempt + 1);
          }

          console.warn(
            `[PaymentFactory] Transaction attempt ${attempt + 1} failed with ${providerName}:`,
            lastError.message
          );

          // Don't retry on validation errors
          if (lastError.name === 'PaymentProviderValidationError') {
            throw lastError;
          }
        }
      }

      // Wait before retrying (exponential backoff)
      if (attempt < this.maxRetries - 1) {
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }

    throw new Error(
      `Payment transaction failed after ${this.maxRetries} attempts across all providers: ${lastError?.message}`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create default payment factory from environment variables
 */
export function createPaymentFactoryFromEnv(): PaymentProviderFactory {
  const config: PaymentFactoryConfig = {
    defaultProvider: (process.env.PAYMENT_PROVIDER as 'paypal' | 'stripe' | 'mercadopago' | 'stub' | undefined) || 'stub',
    providers: {},
    fallbackProvider: 'stub'
  };

  // Configure Stripe if credentials provided
  if (process.env.STRIPE_SECRET_KEY) {
    config.providers.stripe = {
      name: 'stripe',
      apiKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD'],
      supportedCountries: ['US', 'CA', 'UK', 'DE', 'FR', 'ES', 'IT'],
      supportsSubscriptions: true,
      supportsRefunds: true,
      supportsPartialRefunds: true,
      supportsPaymentMethods: true,
      testMode: process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')
    };
  }

  // Configure MercadoPago if credentials provided
  if (process.env.MERCADOPAGO_ACCESS_TOKEN) {
    config.providers.mercadopago = {
      name: 'mercadopago',
      apiKey: process.env.MERCADOPAGO_ACCESS_TOKEN,
      webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
      supportedCurrencies: ['ARS', 'BRL', 'MXN', 'CLP', 'COP', 'PEN', 'UYU'],
      supportedCountries: ['AR', 'BR', 'MX', 'CL', 'CO', 'PE', 'UY'],
      supportsSubscriptions: true,
      supportsRefunds: true,
      supportsPartialRefunds: true,
      supportsPaymentMethods: true,
      testMode: process.env.MERCADOPAGO_ACCESS_TOKEN.startsWith('TEST-')
    };
  }

  return new PaymentProviderFactory(config);
}

/**
 * Global payment factory instance
 *
 * Use this for dependency injection throughout the application
 */
let globalFactory: PaymentProviderFactory | null = null;

export function getPaymentFactory(): PaymentProviderFactory {
  if (!globalFactory) {
    globalFactory = createPaymentFactoryFromEnv();
  }
  return globalFactory;
}

export function setPaymentFactory(factory: PaymentProviderFactory): void {
  globalFactory = factory;
}
