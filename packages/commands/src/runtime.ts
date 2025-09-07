import type { ChatInputCommandInteraction } from 'discord.js';

export interface ValidationResult<T> { success: boolean; data?: T; error?: string }

export interface Validators {
  validateSearchQuery: (query: string) => ValidationResult<string>;
  validateInteger: (value: number, min?: number, max?: number, name?: string) => ValidationResult<number>;
  validateLoopMode: (mode: string) => ValidationResult<'off'|'track'|'queue'>;
}

export interface MusicRuntime {
  publish: (channel: string, message: string) => Promise<void>;
  subscribeOnce: (channel: string) => Promise<string | null>;
  incPublishMetric?: (channel: string) => void;
  hasDjOrAdmin: (interaction: ChatInputCommandInteraction) => boolean;
  allow: (interaction: ChatInputCommandInteraction, cmd: string, limit?: number, windowSec?: number) => Promise<boolean>;
  ensureLiveNow?: (guildId: string, channelId: string, forceRelocate?: boolean) => Promise<void>;
  validators: Validators;
}
