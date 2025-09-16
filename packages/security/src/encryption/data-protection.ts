/**
 * Data Protection and Encryption System
 * Advanced encryption and data security for sensitive information
 */

import crypto from 'crypto';
import { forge } from 'node-forge';
import argon2 from 'argon2';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';

/**
 * Encryption Configuration
 */
export interface EncryptionConfig {
  algorithm: string;
  keyDerivation: {
    iterations: number;
    memory: number;
    parallelism: number;
    saltLength: number;
  };
  encryption: {
    algorithm: 'aes-256-gcm' | 'aes-256-cbc' | 'chacha20-poly1305';
    keyLength: number;
    ivLength: number;
    tagLength: number;
  };
  keyRotation: {
    enabled: boolean;
    intervalDays: number;
    retainOldKeys: number;
  };
}

/**
 * Encrypted Data
 */
export interface EncryptedData {
  data: string;
  iv: string;
  tag?: string;
  salt: string;
  keyId: string;
  algorithm: string;
  timestamp: number;
}

/**
 * Key Material
 */
export interface KeyMaterial {
  id: string;
  key: Buffer;
  derivedFrom: string;
  algorithm: string;
  createdAt: Date;
  expiresAt?: Date;
  isActive: boolean;
  metadata: Record<string, any>;
}

/**
 * Secure Vault Entry
 */
export interface VaultEntry {
  id: string;
  path: string;
  data: EncryptedData;
  metadata: {
    contentType: string;
    owner: string;
    permissions: string[];
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
    accessCount: number;
    lastAccessed?: Date;
  };
}

/**
 * Data Classification
 */
export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted' | 'top_secret';

/**
 * Data Protection Manager
 */
export class DataProtectionManager {
  private readonly config: EncryptionConfig;
  private readonly metrics?: MetricsCollector;

  // Key management
  private readonly masterKey: Buffer;
  private readonly keyMaterials = new Map<string, KeyMaterial>();
  private readonly activeKeyId: string;

  // Secure vault
  private readonly vault = new Map<string, VaultEntry>();

  // Performance metrics
  private encryptionCount = 0;
  private decryptionCount = 0;
  private totalEncryptionTime = 0;
  private totalDecryptionTime = 0;

  constructor(masterKey: string, config?: Partial<EncryptionConfig>, metrics?: MetricsCollector) {
    this.config = {
      algorithm: 'argon2id',
      keyDerivation: {
        iterations: 3,
        memory: 65536, // 64 MB
        parallelism: 4,
        saltLength: 32
      },
      encryption: {
        algorithm: 'aes-256-gcm',
        keyLength: 32,
        ivLength: 16,
        tagLength: 16
      },
      keyRotation: {
        enabled: true,
        intervalDays: 90,
        retainOldKeys: 3
      },
      ...config
    };

    this.metrics = metrics;
    this.masterKey = Buffer.from(masterKey, 'base64');
    this.activeKeyId = this.generateKeyId();

    // Initialize key material
    this.initializeKeyMaterial();

    logger.info('Data Protection Manager initialized', {
      algorithm: this.config.encryption.algorithm,
      keyRotationEnabled: this.config.keyRotation.enabled,
      keyRotationInterval: this.config.keyRotation.intervalDays
    });
  }

  /**
   * Encrypt sensitive data
   */
  async encrypt(
    data: string | Buffer,
    classification: DataClassification = 'confidential',
    context?: {
      owner?: string;
      path?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<EncryptedData> {
    const startTime = Date.now();

    try {
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      const keyMaterial = this.getActiveKeyMaterial();

      // Generate salt and IV
      const salt = crypto.randomBytes(this.config.keyDerivation.saltLength);
      const iv = crypto.randomBytes(this.config.encryption.ivLength);

      // Derive encryption key
      const derivedKey = await this.deriveKey(keyMaterial.key, salt);

      // Encrypt data
      const cipher = crypto.createCipher(this.config.encryption.algorithm, derivedKey);
      cipher.setAAD(Buffer.from(classification)); // Additional authenticated data

      let encrypted = cipher.update(dataBuffer);
      encrypted = Buffer.concat([encrypted, cipher.final()]);

      // Get authentication tag for GCM mode
      const tag = this.config.encryption.algorithm.includes('gcm') ? cipher.getAuthTag() : undefined;

      const encryptedData: EncryptedData = {
        data: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag?.toString('base64'),
        salt: salt.toString('base64'),
        keyId: keyMaterial.id,
        algorithm: this.config.encryption.algorithm,
        timestamp: Date.now()
      };

      // Store in vault if path is provided
      if (context?.path) {
        await this.storeInVault(context.path, encryptedData, classification, context);
      }

      this.encryptionCount++;
      this.totalEncryptionTime += Date.now() - startTime;
      this.recordMetrics('encryption', Date.now() - startTime);

      logger.debug('Data encrypted successfully', {
        classification,
        keyId: keyMaterial.id,
        dataSize: dataBuffer.length,
        encryptionTime: Date.now() - startTime
      });

      return encryptedData;

    } catch (error) {
      this.recordMetrics('encryption_error', Date.now() - startTime);

      logger.error('Encryption failed', {
        classification,
        error: error instanceof Error ? error.message : String(error)
      });

      throw new Error('Encryption operation failed');
    }
  }

  /**
   * Decrypt sensitive data
   */
  async decrypt(
    encryptedData: EncryptedData,
    classification: DataClassification = 'confidential'
  ): Promise<Buffer> {
    const startTime = Date.now();

    try {
      const keyMaterial = this.keyMaterials.get(encryptedData.keyId);
      if (!keyMaterial) {
        throw new Error(`Key material not found: ${encryptedData.keyId}`);
      }

      // Decode components
      const encrypted = Buffer.from(encryptedData.data, 'base64');
      const iv = Buffer.from(encryptedData.iv, 'base64');
      const salt = Buffer.from(encryptedData.salt, 'base64');
      const tag = encryptedData.tag ? Buffer.from(encryptedData.tag, 'base64') : undefined;

      // Derive decryption key
      const derivedKey = await this.deriveKey(keyMaterial.key, salt);

      // Decrypt data
      const decipher = crypto.createDecipher(encryptedData.algorithm, derivedKey);
      decipher.setAAD(Buffer.from(classification)); // Additional authenticated data

      if (tag && encryptedData.algorithm.includes('gcm')) {
        decipher.setAuthTag(tag);
      }

      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      this.decryptionCount++;
      this.totalDecryptionTime += Date.now() - startTime;
      this.recordMetrics('decryption', Date.now() - startTime);

      logger.debug('Data decrypted successfully', {
        classification,
        keyId: encryptedData.keyId,
        dataSize: decrypted.length,
        decryptionTime: Date.now() - startTime
      });

      return decrypted;

    } catch (error) {
      this.recordMetrics('decryption_error', Date.now() - startTime);

      logger.error('Decryption failed', {
        keyId: encryptedData.keyId,
        algorithm: encryptedData.algorithm,
        error: error instanceof Error ? error.message : String(error)
      });

      throw new Error('Decryption operation failed');
    }
  }

  /**
   * Hash password with Argon2
   */
  async hashPassword(password: string): Promise<string> {
    try {
      const hash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: this.config.keyDerivation.memory,
        timeCost: this.config.keyDerivation.iterations,
        parallelism: this.config.keyDerivation.parallelism,
        saltLength: this.config.keyDerivation.saltLength
      });

      logger.debug('Password hashed successfully');
      return hash;

    } catch (error) {
      logger.error('Password hashing failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Password hashing failed');
    }
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      const isValid = await argon2.verify(hash, password);

      logger.debug('Password verification completed', { isValid });
      return isValid;

    } catch (error) {
      logger.error('Password verification failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Generate secure random token
   */
  generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('base64url');
  }

  /**
   * Generate HMAC signature
   */
  generateHMAC(data: string, secret?: string): string {
    const key = secret ? Buffer.from(secret) : this.masterKey;
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(data);
    return hmac.digest('hex');
  }

  /**
   * Verify HMAC signature
   */
  verifyHMAC(data: string, signature: string, secret?: string): boolean {
    const expectedSignature = this.generateHMAC(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * Store data in secure vault
   */
  async storeInVault(
    path: string,
    encryptedData: EncryptedData,
    classification: DataClassification,
    context: {
      owner?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const entry: VaultEntry = {
      id: this.generateEntryId(),
      path,
      data: encryptedData,
      metadata: {
        contentType: 'encrypted',
        owner: context.owner || 'system',
        permissions: this.getDefaultPermissions(classification),
        tags: [classification],
        createdAt: new Date(),
        updatedAt: new Date(),
        accessCount: 0,
        ...context.metadata
      }
    };

    this.vault.set(path, entry);

    logger.info('Data stored in vault', {
      path,
      classification,
      owner: entry.metadata.owner,
      entryId: entry.id
    });
  }

  /**
   * Retrieve data from secure vault
   */
  async retrieveFromVault(
    path: string,
    requester: string,
    classification: DataClassification
  ): Promise<Buffer | null> {
    const entry = this.vault.get(path);
    if (!entry) {
      return null;
    }

    // Check permissions
    if (!this.checkVaultPermissions(entry, requester)) {
      logger.warn('Vault access denied', {
        path,
        requester,
        owner: entry.metadata.owner
      });
      throw new Error('Access denied');
    }

    // Update access metadata
    entry.metadata.accessCount++;
    entry.metadata.lastAccessed = new Date();

    // Decrypt and return data
    const decryptedData = await this.decrypt(entry.data, classification);

    logger.info('Data retrieved from vault', {
      path,
      requester,
      accessCount: entry.metadata.accessCount
    });

    return decryptedData;
  }

  /**
   * Rotate encryption keys
   */
  async rotateKeys(): Promise<void> {
    logger.info('Starting key rotation process');

    try {
      // Generate new key material
      const newKeyId = this.generateKeyId();
      const newKeyMaterial = await this.generateKeyMaterial(newKeyId);

      // Add to key materials
      this.keyMaterials.set(newKeyId, newKeyMaterial);

      // Update active key
      const oldActiveKeyId = this.activeKeyId;
      (this as any).activeKeyId = newKeyId;

      // Mark old key as inactive
      const oldKeyMaterial = this.keyMaterials.get(oldActiveKeyId);
      if (oldKeyMaterial) {
        oldKeyMaterial.isActive = false;
      }

      // Clean up old keys
      await this.cleanupOldKeys();

      logger.info('Key rotation completed successfully', {
        oldKeyId: oldActiveKeyId,
        newKeyId: newKeyId,
        totalKeys: this.keyMaterials.size
      });

    } catch (error) {
      logger.error('Key rotation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get encryption metrics
   */
  getMetrics(): {
    encryptionCount: number;
    decryptionCount: number;
    averageEncryptionTime: number;
    averageDecryptionTime: number;
    activeKeys: number;
    vaultEntries: number;
    keyRotationEnabled: boolean;
  } {
    return {
      encryptionCount: this.encryptionCount,
      decryptionCount: this.decryptionCount,
      averageEncryptionTime: this.encryptionCount > 0 ? this.totalEncryptionTime / this.encryptionCount : 0,
      averageDecryptionTime: this.decryptionCount > 0 ? this.totalDecryptionTime / this.decryptionCount : 0,
      activeKeys: Array.from(this.keyMaterials.values()).filter(k => k.isActive).length,
      vaultEntries: this.vault.size,
      keyRotationEnabled: this.config.keyRotation.enabled
    };
  }

  // Private methods

  private async initializeKeyMaterial(): Promise<void> {
    const keyMaterial = await this.generateKeyMaterial(this.activeKeyId);
    this.keyMaterials.set(this.activeKeyId, keyMaterial);
  }

  private async generateKeyMaterial(keyId: string): Promise<KeyMaterial> {
    const key = crypto.randomBytes(this.config.encryption.keyLength);

    return {
      id: keyId,
      key,
      derivedFrom: 'master_key',
      algorithm: this.config.encryption.algorithm,
      createdAt: new Date(),
      isActive: true,
      metadata: {
        version: '1.0',
        purpose: 'data_encryption'
      }
    };
  }

  private async deriveKey(baseKey: Buffer, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        baseKey,
        salt,
        this.config.keyDerivation.iterations,
        this.config.encryption.keyLength,
        'sha256',
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        }
      );
    });
  }

  private getActiveKeyMaterial(): KeyMaterial {
    const keyMaterial = this.keyMaterials.get(this.activeKeyId);
    if (!keyMaterial || !keyMaterial.isActive) {
      throw new Error('No active key material available');
    }
    return keyMaterial;
  }

  private generateKeyId(): string {
    return `key_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private generateEntryId(): string {
    return `entry_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private getDefaultPermissions(classification: DataClassification): string[] {
    switch (classification) {
      case 'public':
        return ['read'];
      case 'internal':
        return ['read'];
      case 'confidential':
        return ['read'];
      case 'restricted':
        return [];
      case 'top_secret':
        return [];
      default:
        return ['read'];
    }
  }

  private checkVaultPermissions(entry: VaultEntry, requester: string): boolean {
    // Owner always has access
    if (entry.metadata.owner === requester) {
      return true;
    }

    // Check if requester has explicit permissions
    return entry.metadata.permissions.includes('read') ||
           entry.metadata.permissions.includes('*');
  }

  private async cleanupOldKeys(): Promise<void> {
    const inactiveKeys = Array.from(this.keyMaterials.values())
      .filter(k => !k.isActive)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (inactiveKeys.length > this.config.keyRotation.retainOldKeys) {
      const keysToRemove = inactiveKeys.slice(this.config.keyRotation.retainOldKeys);

      for (const key of keysToRemove) {
        this.keyMaterials.delete(key.id);
        logger.debug('Old key material removed', { keyId: key.id });
      }
    }
  }

  private recordMetrics(type: 'encryption' | 'decryption' | 'encryption_error' | 'decryption_error', duration: number): void {
    if (!this.metrics) return;

    this.metrics.recordCustomMetric(
      'data_protection_operations_total',
      1,
      { type },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'data_protection_operation_duration_ms',
      duration,
      { type },
      'histogram'
    );
  }
}

/**
 * Secure Key-Value Store
 */
export class SecureKVStore {
  private readonly dataProtection: DataProtectionManager;

  constructor(dataProtection: DataProtectionManager) {
    this.dataProtection = dataProtection;
  }

  /**
   * Store encrypted key-value pair
   */
  async set(
    key: string,
    value: any,
    classification: DataClassification = 'confidential',
    owner?: string
  ): Promise<void> {
    const serializedValue = JSON.stringify(value);

    await this.dataProtection.encrypt(serializedValue, classification, {
      path: key,
      owner,
      metadata: {
        type: 'kv_store',
        originalType: typeof value
      }
    });
  }

  /**
   * Retrieve and decrypt value
   */
  async get(
    key: string,
    requester: string,
    classification: DataClassification = 'confidential'
  ): Promise<any> {
    const decryptedData = await this.dataProtection.retrieveFromVault(key, requester, classification);

    if (!decryptedData) {
      return null;
    }

    const serializedValue = decryptedData.toString('utf8');
    return JSON.parse(serializedValue);
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    return (this.dataProtection as any).vault.has(key);
  }

  /**
   * Delete key
   */
  delete(key: string): boolean {
    return (this.dataProtection as any).vault.delete(key);
  }
}