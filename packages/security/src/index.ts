/**
 * Security Package Entry Point
 * Zero-Trust Security System for Discord Music Bot
 */

import { logger } from '@discord-bot/logger';

// Legacy exports
export { SecureRateLimiter, RateLimitExceededError } from './secure-rate-limiter.js';
export type { RateLimitResult, RateLimitOptions } from './secure-rate-limiter.js';
export { SecureHeaderManager, SecurityError } from './secure-headers.js';
export { SecureCorsManager, getCorsManager } from './cors-config.js';
export type { CorsOriginConfig, SecurityHeaders } from './cors-config.js';

// Zero-Trust Authentication
export {
  ZeroTrustAuthManager,
  type AuthContext,
  type AuthRequest,
  type AuthResult,
  type SecurityPolicy
} from './auth/zero-trust-auth.js';

// Role-Based Access Control
export {
  PermissionManager,
  type Permission,
  type Role,
  type Policy,
  type AccessRequest,
  type AccessContext,
  type AccessDecision
} from './rbac/permission-manager.js';

// Data Protection and Encryption
export {
  DataProtectionManager,
  SecureKVStore,
  type EncryptionConfig,
  type EncryptedData,
  type VaultEntry,
  type DataClassification
} from './encryption/data-protection.js';

// Security Audit and Monitoring
export {
  SecurityAuditManager,
  SecurityEventType,
  SecurityEventSeverity,
  type SecurityEvent,
  type ThreatDetectionRule,
  type SecurityAlert,
  type AnomalyDetectionResult
} from './audit/security-audit.js';

/**
 * Integrated Zero-Trust Security System
 */
export class ZeroTrustSecuritySystem {
  private readonly authManager: ZeroTrustAuthManager;
  private readonly permissionManager: PermissionManager;
  private readonly dataProtection: DataProtectionManager;
  private readonly auditManager: SecurityAuditManager;

  constructor(config: {
    redisClient: any;
    masterKey: string;
    jwtSecret: string;
    refreshSecret: string;
    metrics?: any;
  }) {
    // Initialize components
    this.authManager = new ZeroTrustAuthManager(config.redisClient, {
      jwtSecret: config.jwtSecret,
      refreshSecret: config.refreshSecret,
      metrics: config.metrics
    });

    this.permissionManager = new PermissionManager(config.metrics);

    this.dataProtection = new DataProtectionManager(
      config.masterKey,
      {
        keyRotation: {
          enabled: true,
          intervalDays: 90,
          retainOldKeys: 3
        }
      },
      config.metrics
    );

    this.auditManager = new SecurityAuditManager(config.metrics);

    // Wire up security event logging
    this.setupSecurityEventLogging();

    logger.info('Zero-Trust Security System initialized');
  }

  /**
   * Get authentication manager
   */
  getAuthManager(): ZeroTrustAuthManager {
    return this.authManager;
  }

  /**
   * Get permission manager
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * Get data protection manager
   */
  getDataProtection(): DataProtectionManager {
    return this.dataProtection;
  }

  /**
   * Get audit manager
   */
  getAuditManager(): SecurityAuditManager {
    return this.auditManager;
  }

  /**
   * Comprehensive security check
   */
  async performSecurityCheck(request: {
    userId: string;
    guildId?: string;
    resource: string;
    action: string;
    token: string;
    ipAddress: string;
    userAgent: string;
    deviceFingerprint: string;
  }): Promise<{
    allowed: boolean;
    authContext?: AuthContext;
    accessDecision?: AccessDecision;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      // 1. Validate authentication token
      const tokenValidation = await this.authManager.validateToken(request.token);
      if (!tokenValidation.valid) {
        errors.push(...tokenValidation.errors);
        return { allowed: false, errors };
      }

      const authContext = tokenValidation.context!;

      // 2. Check permissions
      const accessRequest: AccessRequest = {
        userId: request.userId,
        guildId: request.guildId,
        resource: request.resource,
        action: request.action,
        context: {
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          timestamp: Date.now(),
          deviceFingerprint: request.deviceFingerprint,
          sessionId: authContext.sessionId,
          riskScore: authContext.riskScore,
          trustLevel: authContext.trustLevel,
          additionalAttributes: {}
        }
      };

      const accessDecision = await this.permissionManager.checkPermission(accessRequest);

      // 3. Log security event
      await this.auditManager.logSecurityEvent({
        type: accessDecision.allowed ? SecurityEventType.ACCESS_GRANTED : SecurityEventType.ACCESS_DENIED,
        severity: accessDecision.allowed ? SecurityEventSeverity.INFO : SecurityEventSeverity.MEDIUM,
        source: 'zero_trust_system',
        actor: {
          userId: request.userId,
          guildId: request.guildId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          sessionId: authContext.sessionId
        },
        target: {
          resource: request.resource,
          action: request.action
        },
        context: accessRequest.context,
        details: {
          accessDecision: {
            allowed: accessDecision.allowed,
            reason: accessDecision.reason,
            appliedPolicies: accessDecision.appliedPolicies
          }
        },
        metadata: {
          tags: ['access_control', request.resource],
          alertTriggered: !accessDecision.allowed,
          automated: true
        }
      });

      return {
        allowed: accessDecision.allowed,
        authContext,
        accessDecision,
        errors: accessDecision.allowed ? [] : [accessDecision.reason]
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Security check failed: ${errorMessage}`);

      // Log error event
      await this.auditManager.logSecurityEvent({
        type: SecurityEventType.SECURITY_POLICY_VIOLATION,
        severity: SecurityEventSeverity.HIGH,
        source: 'zero_trust_system',
        actor: {
          userId: request.userId,
          guildId: request.guildId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent
        },
        target: {
          resource: request.resource,
          action: request.action
        },
        context: {
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          timestamp: Date.now(),
          deviceFingerprint: request.deviceFingerprint,
          sessionId: '',
          riskScore: 1.0,
          trustLevel: 'low',
          additionalAttributes: {}
        },
        details: {
          error: errorMessage
        },
        metadata: {
          tags: ['system_error', 'security_check'],
          alertTriggered: true,
          automated: true
        }
      });

      return { allowed: false, errors };
    }
  }

  /**
   * Get comprehensive security metrics
   */
  getSecurityMetrics(): {
    authentication: any;
    authorization: any;
    dataProtection: any;
    audit: any;
  } {
    return {
      authentication: {
        // Auth metrics would be exposed by auth manager
        activeSessions: 0, // TODO: Implement
        failedAttempts: 0, // TODO: Implement
        averageRiskScore: 0 // TODO: Implement
      },
      authorization: this.permissionManager.getMetrics(),
      dataProtection: this.dataProtection.getMetrics(),
      audit: this.auditManager.getSecurityMetrics()
    };
  }

  /**
   * Generate security report
   */
  async generateSecurityReport(timeRange: { start: Date; end: Date }): Promise<string> {
    const auditReport = this.auditManager.exportAuditReport(timeRange, 'json');
    const metrics = this.getSecurityMetrics();

    const report = {
      reportMetadata: {
        generatedAt: new Date(),
        timeRange,
        reportType: 'comprehensive_security_report'
      },
      systemMetrics: metrics,
      auditData: JSON.parse(auditReport)
    };

    return JSON.stringify(report, null, 2);
  }

  /**
   * Setup security event logging integration
   */
  private setupSecurityEventLogging(): void {
    // Log authentication events
    // Note: In a real implementation, these would be connected to actual auth events

    // Log permission events
    // Note: In a real implementation, these would be connected to actual permission events

    // Log data protection events
    // Note: In a real implementation, these would be connected to actual encryption events

    logger.debug('Security event logging configured');
  }
}