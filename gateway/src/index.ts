// Gateway Service - Clean Architecture Implementation
export * from './domain/index.js';
export * from './application/index.js';
export * from './infrastructure/index.js';
export * from './presentation/index.js';
export { GatewayApplication } from './main.js';

// Start the application when this file is run directly
import './main.js';