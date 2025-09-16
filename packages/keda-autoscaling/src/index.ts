/**
 * KEDA Autoscaling Package
 * Export all KEDA functionality for event-driven autoscaling
 */

export { KEDAManager, DiscordBotScalingProfiles } from './keda-manager';

export type {
  KEDAScalerConfig,
  KEDAScaledObjectConfig,
  KEDAScaledJobConfig,
  KEDATriggerAuthConfig,
  KEDAScaledObject
} from './keda-manager';