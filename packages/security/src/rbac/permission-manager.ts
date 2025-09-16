/**
 * Role-Based Access Control (RBAC) Permission Manager
 * Advanced permission system with dynamic policies
 */

import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';

/**
 * Permission
 */
export interface Permission {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: string;
  conditions?: PermissionCondition[];
  metadata?: Record<string, any>;
}

/**
 * Permission Condition
 */
export interface PermissionCondition {
  type: 'time' | 'location' | 'context' | 'custom';
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'in' | 'contains';
  field: string;
  value: any;
  description: string;
}

/**
 * Role
 */
export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  inherits?: string[];
  conditions?: RoleCondition[];
  priority: number;
  isActive: boolean;
  metadata?: Record<string, any>;
}

/**
 * Role Condition
 */
export interface RoleCondition {
  type: 'time_based' | 'location_based' | 'context_based';
  configuration: Record<string, any>;
  description: string;
}

/**
 * Policy
 */
export interface Policy {
  id: string;
  name: string;
  description: string;
  effect: 'allow' | 'deny';
  resources: string[];
  actions: string[];
  conditions?: PolicyCondition[];
  priority: number;
  isActive: boolean;
}

/**
 * Policy Condition
 */
export interface PolicyCondition {
  type: 'attribute' | 'time' | 'location' | 'risk' | 'custom';
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'in' | 'contains' | 'matches';
  value: any;
}

/**
 * Access Request
 */
export interface AccessRequest {
  userId: string;
  guildId?: string;
  resource: string;
  action: string;
  context: AccessContext;
}

/**
 * Access Context
 */
export interface AccessContext {
  ipAddress: string;
  userAgent: string;
  timestamp: number;
  location?: {
    country: string;
    region: string;
    city: string;
  };
  deviceFingerprint: string;
  sessionId: string;
  riskScore: number;
  trustLevel: 'low' | 'medium' | 'high';
  additionalAttributes: Record<string, any>;
}

/**
 * Access Decision
 */
export interface AccessDecision {
  allowed: boolean;
  reason: string;
  appliedPolicies: string[];
  conditions: string[];
  metadata: {
    evaluationTime: number;
    riskFactors: string[];
    warnings: string[];
  };
}

/**
 * Permission Manager with Advanced RBAC
 */
export class PermissionManager {
  private readonly metrics?: MetricsCollector;

  // Core data structures
  private readonly permissions = new Map<string, Permission>();
  private readonly roles = new Map<string, Role>();
  private readonly policies = new Map<string, Policy>();
  private readonly userRoles = new Map<string, Set<string>>();
  private readonly roleHierarchy = new Map<string, Set<string>>();

  // Caching for performance
  private readonly permissionCache = new Map<string, {
    decision: AccessDecision;
    timestamp: number;
  }>();

  // Policy evaluation engine
  private readonly policyEvaluators = new Map<string, (condition: PolicyCondition, context: AccessContext) => boolean>();

  constructor(metrics?: MetricsCollector) {
    this.metrics = metrics;
    this.initializePolicyEvaluators();
    this.initializeDefaultPermissions();
    this.initializeDefaultRoles();

    logger.info('Permission Manager initialized with RBAC system');
  }

  /**
   * Check if user has permission to perform action on resource
   */
  async checkPermission(request: AccessRequest): Promise<AccessDecision> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(request);

    try {
      // Check cache first
      const cached = this.permissionCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 300000) { // 5 minutes cache
        this.recordMetrics('permission_check_cached', Date.now() - startTime);
        return cached.decision;
      }

      // Evaluate permission
      const decision = await this.evaluatePermission(request);

      // Cache decision
      this.permissionCache.set(cacheKey, {
        decision,
        timestamp: Date.now()
      });

      // Clean cache if too large
      if (this.permissionCache.size > 10000) {
        this.cleanupCache();
      }

      this.recordMetrics('permission_check_evaluated', Date.now() - startTime);

      logger.debug('Permission evaluated', {
        userId: request.userId,
        resource: request.resource,
        action: request.action,
        allowed: decision.allowed,
        reason: decision.reason,
        evaluationTime: Date.now() - startTime
      });

      return decision;

    } catch (error) {
      this.recordMetrics('permission_check_error', Date.now() - startTime);

      logger.error('Permission evaluation failed', {
        userId: request.userId,
        resource: request.resource,
        action: request.action,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        allowed: false,
        reason: 'Permission evaluation error',
        appliedPolicies: [],
        conditions: [],
        metadata: {
          evaluationTime: Date.now() - startTime,
          riskFactors: ['evaluation_error'],
          warnings: ['Permission system error occurred']
        }
      };
    }
  }

  /**
   * Assign role to user
   */
  async assignRole(userId: string, roleId: string, guildId?: string): Promise<void> {
    const role = this.roles.get(roleId);
    if (!role) {
      throw new Error(`Role ${roleId} not found`);
    }

    const userKey = guildId ? `${userId}:${guildId}` : userId;

    if (!this.userRoles.has(userKey)) {
      this.userRoles.set(userKey, new Set());
    }

    this.userRoles.get(userKey)!.add(roleId);

    // Build role hierarchy
    await this.buildRoleHierarchy(userId, guildId);

    // Clear permission cache for user
    this.clearUserCache(userId, guildId);

    logger.info('Role assigned to user', {
      userId,
      guildId,
      roleId,
      roleName: role.name
    });
  }

  /**
   * Remove role from user
   */
  async removeRole(userId: string, roleId: string, guildId?: string): Promise<void> {
    const userKey = guildId ? `${userId}:${guildId}` : userId;
    const userRoleSet = this.userRoles.get(userKey);

    if (userRoleSet) {
      userRoleSet.delete(roleId);
      if (userRoleSet.size === 0) {
        this.userRoles.delete(userKey);
      }
    }

    // Rebuild role hierarchy
    await this.buildRoleHierarchy(userId, guildId);

    // Clear permission cache for user
    this.clearUserCache(userId, guildId);

    logger.info('Role removed from user', {
      userId,
      guildId,
      roleId
    });
  }

  /**
   * Get user's effective permissions
   */
  async getUserPermissions(userId: string, guildId?: string, context?: AccessContext): Promise<Permission[]> {
    const userRoles = await this.getUserRoles(userId, guildId);
    const permissions = new Map<string, Permission>();

    for (const role of userRoles) {
      // Check role conditions
      if (context && !await this.evaluateRoleConditions(role, context)) {
        continue;
      }

      for (const permissionId of role.permissions) {
        const permission = this.permissions.get(permissionId);
        if (permission) {
          // Check permission conditions
          if (context && !await this.evaluatePermissionConditions(permission, context)) {
            continue;
          }

          permissions.set(permissionId, permission);
        }
      }
    }

    return Array.from(permissions.values());
  }

  /**
   * Create or update permission
   */
  async createPermission(permission: Permission): Promise<void> {
    this.permissions.set(permission.id, permission);

    logger.info('Permission created/updated', {
      permissionId: permission.id,
      name: permission.name,
      resource: permission.resource,
      action: permission.action
    });
  }

  /**
   * Create or update role
   */
  async createRole(role: Role): Promise<void> {
    // Validate permission IDs
    for (const permissionId of role.permissions) {
      if (!this.permissions.has(permissionId)) {
        throw new Error(`Permission ${permissionId} not found`);
      }
    }

    this.roles.set(role.id, role);

    // Rebuild role hierarchies for affected users
    await this.rebuildAllRoleHierarchies();

    logger.info('Role created/updated', {
      roleId: role.id,
      name: role.name,
      permissionCount: role.permissions.length,
      inherits: role.inherits
    });
  }

  /**
   * Create or update policy
   */
  async createPolicy(policy: Policy): Promise<void> {
    this.policies.set(policy.id, policy);

    // Clear all permission cache since policies affect all decisions
    this.permissionCache.clear();

    logger.info('Policy created/updated', {
      policyId: policy.id,
      name: policy.name,
      effect: policy.effect,
      priority: policy.priority
    });
  }

  /**
   * Get system metrics
   */
  getMetrics(): {
    permissionCount: number;
    roleCount: number;
    policyCount: number;
    userRoleAssignments: number;
    cacheSize: number;
    cacheHitRate: number;
  } {
    return {
      permissionCount: this.permissions.size,
      roleCount: this.roles.size,
      policyCount: this.policies.size,
      userRoleAssignments: this.userRoles.size,
      cacheSize: this.permissionCache.size,
      cacheHitRate: 0 // TODO: Implement cache hit rate tracking
    };
  }

  // Private methods

  private async evaluatePermission(request: AccessRequest): Promise<AccessDecision> {
    const appliedPolicies: string[] = [];
    const conditions: string[] = [];
    const warnings: string[] = [];
    const riskFactors: string[] = [];

    // Get user roles and permissions
    const userRoles = await this.getUserRoles(request.userId, request.guildId);
    const userPermissions = await this.getUserPermissions(request.userId, request.guildId, request.context);

    // Check direct permission match
    const matchingPermission = userPermissions.find(p =>
      p.resource === request.resource && p.action === request.action
    );

    if (!matchingPermission) {
      return {
        allowed: false,
        reason: 'No matching permission found',
        appliedPolicies,
        conditions,
        metadata: {
          evaluationTime: 0,
          riskFactors: ['no_permission'],
          warnings
        }
      };
    }

    // Evaluate policies (sorted by priority)
    const applicablePolicies = Array.from(this.policies.values())
      .filter(p => p.isActive)
      .filter(p => this.policyAppliesToRequest(p, request))
      .sort((a, b) => b.priority - a.priority);

    let finalDecision = true; // Default allow if permission exists
    let reason = 'Permission granted';

    for (const policy of applicablePolicies) {
      appliedPolicies.push(policy.id);

      // Evaluate policy conditions
      const policyConditionsMet = await this.evaluatePolicyConditions(policy, request.context);

      if (policyConditionsMet) {
        if (policy.effect === 'deny') {
          finalDecision = false;
          reason = `Access denied by policy: ${policy.name}`;
          riskFactors.push(`policy_deny:${policy.id}`);
          break; // Deny policies are final
        }
        // Allow policies don't override deny policies
      }
    }

    // Risk-based adjustments
    if (request.context.riskScore > 0.8) {
      finalDecision = false;
      reason = 'Access denied due to high risk score';
      riskFactors.push('high_risk_score');
    }

    // Trust level adjustments
    if (request.context.trustLevel === 'low' && this.requiresHighTrust(request.resource, request.action)) {
      finalDecision = false;
      reason = 'Access denied due to low trust level';
      riskFactors.push('low_trust_level');
    }

    return {
      allowed: finalDecision,
      reason,
      appliedPolicies,
      conditions,
      metadata: {
        evaluationTime: 0,
        riskFactors,
        warnings
      }
    };
  }

  private async getUserRoles(userId: string, guildId?: string): Promise<Role[]> {
    const userKey = guildId ? `${userId}:${guildId}` : userId;
    const userRoleIds = this.userRoles.get(userKey);

    if (!userRoleIds) {
      return [];
    }

    // Get roles with inheritance
    const allRoleIds = new Set<string>();
    for (const roleId of userRoleIds) {
      allRoleIds.add(roleId);

      // Add inherited roles
      const inheritedRoles = this.roleHierarchy.get(roleId);
      if (inheritedRoles) {
        inheritedRoles.forEach(id => allRoleIds.add(id));
      }
    }

    return Array.from(allRoleIds)
      .map(id => this.roles.get(id))
      .filter(Boolean) as Role[];
  }

  private async buildRoleHierarchy(userId: string, guildId?: string): Promise<void> {
    const userRoles = await this.getUserRoles(userId, guildId);

    for (const role of userRoles) {
      if (!role.inherits) continue;

      if (!this.roleHierarchy.has(role.id)) {
        this.roleHierarchy.set(role.id, new Set());
      }

      const hierarchy = this.roleHierarchy.get(role.id)!;

      // Add direct inheritance
      role.inherits.forEach(parentId => hierarchy.add(parentId));

      // Add transitive inheritance
      for (const parentId of role.inherits) {
        const parentHierarchy = this.roleHierarchy.get(parentId);
        if (parentHierarchy) {
          parentHierarchy.forEach(id => hierarchy.add(id));
        }
      }
    }
  }

  private async rebuildAllRoleHierarchies(): Promise<void> {
    this.roleHierarchy.clear();

    for (const [userKey] of this.userRoles) {
      const [userId, guildId] = userKey.split(':');
      await this.buildRoleHierarchy(userId, guildId);
    }
  }

  private async evaluateRoleConditions(role: Role, context: AccessContext): Promise<boolean> {
    if (!role.conditions) return true;

    for (const condition of role.conditions) {
      if (!await this.evaluateRoleCondition(condition, context)) {
        return false;
      }
    }

    return true;
  }

  private async evaluateRoleCondition(condition: RoleCondition, context: AccessContext): Promise<boolean> {
    switch (condition.type) {
      case 'time_based':
        return this.evaluateTimeBasedCondition(condition.configuration, context);
      case 'location_based':
        return this.evaluateLocationBasedCondition(condition.configuration, context);
      case 'context_based':
        return this.evaluateContextBasedCondition(condition.configuration, context);
      default:
        return true;
    }
  }

  private async evaluatePermissionConditions(permission: Permission, context: AccessContext): Promise<boolean> {
    if (!permission.conditions) return true;

    for (const condition of permission.conditions) {
      if (!await this.evaluatePermissionCondition(condition, context)) {
        return false;
      }
    }

    return true;
  }

  private async evaluatePermissionCondition(condition: PermissionCondition, context: AccessContext): Promise<boolean> {
    const evaluator = this.policyEvaluators.get(condition.type);
    if (!evaluator) return true;

    const policyCondition: PolicyCondition = {
      type: condition.type as any,
      field: condition.field,
      operator: condition.operator as any,
      value: condition.value
    };

    return evaluator(policyCondition, context);
  }

  private policyAppliesToRequest(policy: Policy, request: AccessRequest): boolean {
    // Check if policy applies to this resource and action
    const resourceMatch = policy.resources.includes('*') ||
                         policy.resources.includes(request.resource);

    const actionMatch = policy.actions.includes('*') ||
                       policy.actions.includes(request.action);

    return resourceMatch && actionMatch;
  }

  private async evaluatePolicyConditions(policy: Policy, context: AccessContext): Promise<boolean> {
    if (!policy.conditions) return true;

    for (const condition of policy.conditions) {
      const evaluator = this.policyEvaluators.get(condition.type);
      if (!evaluator) continue;

      if (!evaluator(condition, context)) {
        return false;
      }
    }

    return true;
  }

  private initializePolicyEvaluators(): void {
    // Time-based evaluator
    this.policyEvaluators.set('time', (condition, context) => {
      const currentTime = new Date(context.timestamp);
      const conditionValue = new Date(condition.value);

      switch (condition.operator) {
        case 'gt': return currentTime > conditionValue;
        case 'lt': return currentTime < conditionValue;
        case 'eq': return currentTime.getTime() === conditionValue.getTime();
        default: return true;
      }
    });

    // Location-based evaluator
    this.policyEvaluators.set('location', (condition, context) => {
      if (!context.location) return false;

      const locationValue = context.location[condition.field as keyof typeof context.location];

      switch (condition.operator) {
        case 'eq': return locationValue === condition.value;
        case 'ne': return locationValue !== condition.value;
        case 'in': return Array.isArray(condition.value) && condition.value.includes(locationValue);
        case 'contains': return String(locationValue).includes(condition.value);
        default: return true;
      }
    });

    // Risk-based evaluator
    this.policyEvaluators.set('risk', (condition, context) => {
      const riskScore = context.riskScore;

      switch (condition.operator) {
        case 'gt': return riskScore > condition.value;
        case 'lt': return riskScore < condition.value;
        case 'eq': return riskScore === condition.value;
        default: return true;
      }
    });

    // Attribute-based evaluator
    this.policyEvaluators.set('attribute', (condition, context) => {
      const attributeValue = context.additionalAttributes[condition.field];

      switch (condition.operator) {
        case 'eq': return attributeValue === condition.value;
        case 'ne': return attributeValue !== condition.value;
        case 'gt': return attributeValue > condition.value;
        case 'lt': return attributeValue < condition.value;
        case 'in': return Array.isArray(condition.value) && condition.value.includes(attributeValue);
        case 'contains': return String(attributeValue).includes(condition.value);
        case 'matches': return new RegExp(condition.value).test(String(attributeValue));
        default: return true;
      }
    });
  }

  private evaluateTimeBasedCondition(config: Record<string, any>, context: AccessContext): boolean {
    const currentHour = new Date(context.timestamp).getHours();
    const allowedHours = config.allowedHours || [];

    return allowedHours.length === 0 || allowedHours.includes(currentHour);
  }

  private evaluateLocationBasedCondition(config: Record<string, any>, context: AccessContext): boolean {
    if (!context.location) return false;

    const allowedCountries = config.allowedCountries || [];
    const blockedCountries = config.blockedCountries || [];

    if (blockedCountries.includes(context.location.country)) {
      return false;
    }

    return allowedCountries.length === 0 || allowedCountries.includes(context.location.country);
  }

  private evaluateContextBasedCondition(config: Record<string, any>, context: AccessContext): boolean {
    const maxRiskScore = config.maxRiskScore || 1.0;
    const minTrustLevel = config.minTrustLevel || 'low';

    if (context.riskScore > maxRiskScore) {
      return false;
    }

    const trustLevels = { low: 0, medium: 1, high: 2 };
    const requiredLevel = trustLevels[minTrustLevel as keyof typeof trustLevels] || 0;
    const currentLevel = trustLevels[context.trustLevel] || 0;

    return currentLevel >= requiredLevel;
  }

  private requiresHighTrust(resource: string, action: string): boolean {
    // Define resources/actions that require high trust
    const highTrustResources = ['admin', 'security', 'billing'];
    const highTrustActions = ['delete', 'modify_permissions', 'admin_access'];

    return highTrustResources.includes(resource) || highTrustActions.includes(action);
  }

  private generateCacheKey(request: AccessRequest): string {
    return `${request.userId}:${request.guildId || 'global'}:${request.resource}:${request.action}:${request.context.riskScore}:${request.context.trustLevel}`;
  }

  private clearUserCache(userId: string, guildId?: string): void {
    const userPrefix = `${userId}:${guildId || 'global'}:`;

    for (const [key] of this.permissionCache) {
      if (key.startsWith(userPrefix)) {
        this.permissionCache.delete(key);
      }
    }
  }

  private cleanupCache(): void {
    // Remove oldest cache entries
    const entries = Array.from(this.permissionCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, Math.floor(entries.length * 0.3));
    toRemove.forEach(([key]) => this.permissionCache.delete(key));

    logger.debug('Permission cache cleanup completed', {
      removed: toRemove.length,
      remaining: this.permissionCache.size
    });
  }

  private initializeDefaultPermissions(): void {
    const defaultPermissions: Permission[] = [
      {
        id: 'music.play',
        name: 'Play Music',
        description: 'Permission to play music in voice channels',
        resource: 'music',
        action: 'play'
      },
      {
        id: 'music.skip',
        name: 'Skip Track',
        description: 'Permission to skip currently playing track',
        resource: 'music',
        action: 'skip'
      },
      {
        id: 'music.volume',
        name: 'Control Volume',
        description: 'Permission to change music volume',
        resource: 'music',
        action: 'volume'
      },
      {
        id: 'queue.manage',
        name: 'Manage Queue',
        description: 'Permission to manage music queue',
        resource: 'queue',
        action: 'manage'
      },
      {
        id: 'admin.settings',
        name: 'Admin Settings',
        description: 'Permission to modify bot settings',
        resource: 'admin',
        action: 'settings'
      }
    ];

    defaultPermissions.forEach(permission => {
      this.permissions.set(permission.id, permission);
    });
  }

  private initializeDefaultRoles(): void {
    const defaultRoles: Role[] = [
      {
        id: 'user',
        name: 'User',
        description: 'Basic user role with music access',
        permissions: ['music.play'],
        priority: 1,
        isActive: true
      },
      {
        id: 'dj',
        name: 'DJ',
        description: 'DJ role with queue management',
        permissions: ['music.play', 'music.skip', 'music.volume', 'queue.manage'],
        inherits: ['user'],
        priority: 2,
        isActive: true
      },
      {
        id: 'admin',
        name: 'Administrator',
        description: 'Full administrative access',
        permissions: ['music.play', 'music.skip', 'music.volume', 'queue.manage', 'admin.settings'],
        inherits: ['dj'],
        priority: 3,
        isActive: true
      }
    ];

    defaultRoles.forEach(role => {
      this.roles.set(role.id, role);
    });
  }

  private recordMetrics(type: 'permission_check_cached' | 'permission_check_evaluated' | 'permission_check_error', duration: number): void {
    if (!this.metrics) return;

    this.metrics.recordCustomMetric(
      'rbac_permission_checks_total',
      1,
      { type },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'rbac_permission_check_duration_ms',
      duration,
      { type },
      'histogram'
    );
  }
}