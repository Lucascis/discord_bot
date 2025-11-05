/**
 * Payment Processor Factory
 *
 * Creates and manages payment processor instances based on configuration.
 * Supports multiple payment providers (Stripe, Mercado Pago).
 *
 * @module packages/subscription/payment-processor-factory
 */
import { logger } from '@discord-bot/logger';
import { StripeProcessor } from './processors/stripe-processor.js';
import { MercadoPagoProcessor } from './processors/mercadopago-processor.js';
export class PaymentProcessorFactory {
    constructor(config) {
        this.config = config;
        this.processors = new Map();
        this.activeProvider = config.provider;
        logger.info({ provider: this.activeProvider }, 'Payment processor factory initialized');
    }
    createProcessor(provider) {
        // Return cached processor if exists
        const cached = this.processors.get(provider);
        if (cached) {
            return cached;
        }
        // Create new processor
        let processor;
        switch (provider) {
            case 'stripe': {
                if (!this.config.stripe?.apiKey) {
                    throw new Error('Stripe API key not configured');
                }
                processor = new StripeProcessor(this.config.stripe.apiKey);
                break;
            }
            case 'mercadopago': {
                if (!this.config.mercadopago?.accessToken) {
                    throw new Error('Mercado Pago access token not configured');
                }
                processor = new MercadoPagoProcessor(this.config.mercadopago.accessToken);
                break;
            }
            default: {
                const exhaustive = provider;
                throw new Error(`Unknown payment provider: ${exhaustive}`);
            }
        }
        // Cache and return
        this.processors.set(provider, processor);
        logger.info({ provider }, 'Payment processor created and cached');
        return processor;
    }
    getActiveProcessor() {
        return this.createProcessor(this.activeProvider);
    }
    /**
     * Get active provider name
     */
    getActiveProviderName() {
        return this.activeProvider;
    }
    /**
     * Check if provider is supported and configured
     */
    isProviderConfigured(provider) {
        switch (provider) {
            case 'stripe':
                return !!this.config.stripe?.apiKey;
            case 'mercadopago':
                return !!this.config.mercadopago?.accessToken;
            default:
                return false;
        }
    }
    /**
     * Clear processor cache (useful for testing)
     */
    clearCache() {
        this.processors.clear();
        logger.debug('Payment processor cache cleared');
    }
}
/**
 * Create factory from environment variables
 */
export function createPaymentProcessorFactoryFromEnv() {
    const provider = (process.env.PAYMENT_PROVIDER || 'stripe');
    const config = {
        provider,
        stripe: {
            apiKey: process.env.STRIPE_SECRET_KEY || '',
        },
        mercadopago: {
            accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
        },
    };
    // Validate active provider is configured
    if (provider === 'stripe' && !config.stripe.apiKey) {
        throw new Error('STRIPE_SECRET_KEY environment variable is required when PAYMENT_PROVIDER=stripe');
    }
    if (provider === 'mercadopago' && !config.mercadopago.accessToken) {
        throw new Error('MERCADOPAGO_ACCESS_TOKEN environment variable is required when PAYMENT_PROVIDER=mercadopago');
    }
    return new PaymentProcessorFactory(config);
}
/**
 * Singleton instance (created on first access)
 */
let factoryInstance = null;
/**
 * Get singleton factory instance
 */
export function getPaymentProcessorFactory() {
    if (!factoryInstance) {
        factoryInstance = createPaymentProcessorFactoryFromEnv();
    }
    return factoryInstance;
}
/**
 * Reset singleton (useful for testing)
 */
export function resetPaymentProcessorFactory() {
    factoryInstance = null;
    logger.debug('Payment processor factory singleton reset');
}
