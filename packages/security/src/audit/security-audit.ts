/**
 * Security Audit and Monitoring System
 * Comprehensive security event logging and threat detection
 */

import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import { EventEmitter } from 'events';

/**
 * Security Event Types
 */
export enum SecurityEventType {
  // Authentication Events
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILURE = 'login_failure',
  LOGOUT = 'logout',
  MFA_CHALLENGE = 'mfa_challenge',
  MFA_SUCCESS = 'mfa_success',
  MFA_FAILURE = 'mfa_failure',

  // Authorization Events
  ACCESS_GRANTED = 'access_granted',
  ACCESS_DENIED = 'access_denied',
  PERMISSION_ESCALATION = 'permission_escalation',
  ROLE_ASSIGNED = 'role_assigned',
  ROLE_REMOVED = 'role_removed',

  // Data Events
  DATA_ACCESS = 'data_access',
  DATA_MODIFICATION = 'data_modification',
  DATA_DELETION = 'data_deletion',
  DATA_EXPORT = 'data_export',
  ENCRYPTION_KEY_ROTATION = 'encryption_key_rotation',

  // Security Events
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  BRUTE_FORCE_ATTEMPT = 'brute_force_attempt',
  ANOMALOUS_BEHAVIOR = 'anomalous_behavior',
  SECURITY_POLICY_VIOLATION = 'security_policy_violation',

  // System Events
  SYSTEM_START = 'system_start',
  SYSTEM_SHUTDOWN = 'system_shutdown',
  CONFIG_CHANGE = 'config_change',
  VULNERABILITY_DETECTED = 'vulnerability_detected',
  SECURITY_UPDATE = 'security_update'
}

/**
 * Security Event Severity
 */
export enum SecurityEventSeverity {
  INFO = 'info',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Security Event
 */
export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  severity: SecurityEventSeverity;
  timestamp: Date;
  source: string;
  actor: {
    userId?: string;
    guildId?: string;
    ipAddress: string;
    userAgent: string;
    sessionId?: string;
  };
  target?: {
    resource: string;
    resourceId?: string;
    action: string;
  };
  context: {
    riskScore: number;
    trustLevel: 'low' | 'medium' | 'high';
    location?: {
      country: string;
      region: string;
      city: string;
    };
    device?: {
      fingerprint: string;
      type: string;
      os: string;
      browser: string;
    };
  };
  details: Record<string, any>;
  metadata: {
    correlationId?: string;
    tags: string[];
    alertTriggered: boolean;
    automated: boolean;
  };
}

/**
 * Threat Detection Rule
 */
export interface ThreatDetectionRule {
  id: string;
  name: string;
  description: string;
  eventTypes: SecurityEventType[];
  conditions: ThreatCondition[];
  actions: ThreatAction[];
  timeWindow: number; // milliseconds
  threshold: number;
  severity: SecurityEventSeverity;
  isActive: boolean;
}

/**
 * Threat Condition
 */
export interface ThreatCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'in' | 'contains' | 'matches';
  value: any;
  description: string;
}

/**
 * Threat Action
 */
export interface ThreatAction {
  type: 'alert' | 'block' | 'quarantine' | 'notify' | 'escalate';
  parameters: Record<string, any>;
  description: string;
}

/**
 * Security Alert
 */
export interface SecurityAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: SecurityEventSeverity;
  timestamp: Date;
  events: SecurityEvent[];
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  assignedTo?: string;
  resolution?: {
    action: string;
    description: string;
    timestamp: Date;
    resolvedBy: string;
  };
}

/**
 * Anomaly Detection Result
 */
export interface AnomalyDetectionResult {
  isAnomaly: boolean;
  score: number; // 0-1, higher = more anomalous
  factors: string[];
  baseline: {
    average: number;
    standardDeviation: number;
    recentTrend: 'increasing' | 'decreasing' | 'stable';
  };
}

/**
 * Security Audit Manager
 */
export class SecurityAuditManager extends EventEmitter {
  private readonly metrics?: MetricsCollector;

  // Event storage
  private readonly events: SecurityEvent[] = [];
  private readonly eventIndex = new Map<string, SecurityEvent[]>();

  // Threat detection
  private readonly threatRules = new Map<string, ThreatDetectionRule>();
  private readonly activeAlerts = new Map<string, SecurityAlert>();

  // Anomaly detection
  private readonly behaviorBaselines = new Map<string, {
    values: number[];
    mean: number;
    stdDev: number;
    lastUpdate: Date;
  }>();

  // Performance tracking
  private eventCount = 0;
  private alertCount = 0;
  private totalProcessingTime = 0;

  constructor(metrics?: MetricsCollector) {
    super();
    this.metrics = metrics;
    this.initializeDefaultRules();

    logger.info('Security Audit Manager initialized');
  }

  /**
   * Log security event
   */
  async logSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): Promise<void> {
    const startTime = Date.now();

    try {
      const securityEvent: SecurityEvent = {
        ...event,
        id: this.generateEventId(),
        timestamp: new Date()
      };

      // Store event
      this.events.push(securityEvent);
      this.indexEvent(securityEvent);

      // Run threat detection
      await this.runThreatDetection(securityEvent);

      // Run anomaly detection
      await this.runAnomalyDetection(securityEvent);

      // Emit event for external listeners
      this.emit('securityEvent', securityEvent);

      this.eventCount++;
      this.totalProcessingTime += Date.now() - startTime;
      this.recordMetrics('event_logged', Date.now() - startTime);

      logger.debug('Security event logged', {
        eventId: securityEvent.id,
        type: securityEvent.type,
        severity: securityEvent.severity,
        actor: securityEvent.actor.userId || securityEvent.actor.ipAddress
      });

      // Clean up old events periodically
      if (this.eventCount % 1000 === 0) {
        await this.cleanupOldEvents();
      }

    } catch (error) {
      this.recordMetrics('event_logging_error', Date.now() - startTime);

      logger.error('Failed to log security event', {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Create threat detection rule
   */
  createThreatRule(rule: ThreatDetectionRule): void {
    this.threatRules.set(rule.id, rule);

    logger.info('Threat detection rule created', {
      ruleId: rule.id,
      name: rule.name,
      eventTypes: rule.eventTypes.length,
      threshold: rule.threshold,
      timeWindow: rule.timeWindow
    });
  }

  /**
   * Get security events by criteria
   */
  getEvents(criteria: {
    eventTypes?: SecurityEventType[];
    severity?: SecurityEventSeverity[];
    timeRange?: { start: Date; end: Date };
    actor?: { userId?: string; ipAddress?: string };
    limit?: number;
  }): SecurityEvent[] {
    let filteredEvents = this.events;

    // Filter by event types
    if (criteria.eventTypes) {
      filteredEvents = filteredEvents.filter(e => criteria.eventTypes!.includes(e.type));
    }

    // Filter by severity
    if (criteria.severity) {
      filteredEvents = filteredEvents.filter(e => criteria.severity!.includes(e.severity));
    }

    // Filter by time range
    if (criteria.timeRange) {
      filteredEvents = filteredEvents.filter(e =>
        e.timestamp >= criteria.timeRange!.start && e.timestamp <= criteria.timeRange!.end
      );
    }

    // Filter by actor
    if (criteria.actor) {
      filteredEvents = filteredEvents.filter(e => {
        if (criteria.actor!.userId && e.actor.userId !== criteria.actor!.userId) {
          return false;
        }
        if (criteria.actor!.ipAddress && e.actor.ipAddress !== criteria.actor!.ipAddress) {
          return false;
        }
        return true;
      });
    }

    // Sort by timestamp (newest first)
    filteredEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit
    if (criteria.limit) {
      filteredEvents = filteredEvents.slice(0, criteria.limit);
    }

    return filteredEvents;
  }

  /**
   * Get active security alerts
   */
  getActiveAlerts(): SecurityAlert[] {
    return Array.from(this.activeAlerts.values())
      .filter(alert => alert.status === 'open' || alert.status === 'investigating')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Resolve security alert
   */
  resolveAlert(
    alertId: string,
    resolution: {
      action: string;
      description: string;
      resolvedBy: string;
    }
  ): void {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }

    alert.status = 'resolved';
    alert.resolution = {
      ...resolution,
      timestamp: new Date()
    };

    logger.info('Security alert resolved', {
      alertId,
      ruleId: alert.ruleId,
      action: resolution.action,
      resolvedBy: resolution.resolvedBy
    });
  }

  /**
   * Get security metrics and statistics
   */
  getSecurityMetrics(): {
    eventCounts: Record<SecurityEventType, number>;
    severityCounts: Record<SecurityEventSeverity, number>;
    alertCounts: Record<string, number>;
    topThreatSources: Array<{ source: string; count: number }>;
    riskTrends: Array<{ timestamp: Date; averageRisk: number }>;
    anomalyDetectionStats: {
      anomaliesDetected: number;
      averageAnomalyScore: number;
      falsePositiveRate: number;
    };
  } {
    // Calculate event counts by type
    const eventCounts = {} as Record<SecurityEventType, number>;
    Object.values(SecurityEventType).forEach(type => {
      eventCounts[type] = 0;
    });

    // Calculate severity counts
    const severityCounts = {} as Record<SecurityEventSeverity, number>;
    Object.values(SecurityEventSeverity).forEach(severity => {
      severityCounts[severity] = 0;
    });

    // Process events
    const threatSources = new Map<string, number>();
    const riskData: Array<{ timestamp: Date; risk: number }> = [];

    for (const event of this.events) {
      eventCounts[event.type]++;
      severityCounts[event.severity]++;

      // Track threat sources
      const source = event.actor.userId || event.actor.ipAddress;
      threatSources.set(source, (threatSources.get(source) || 0) + 1);

      // Collect risk data
      riskData.push({
        timestamp: event.timestamp,
        risk: event.context.riskScore
      });
    }

    // Calculate top threat sources
    const topThreatSources = Array.from(threatSources.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Calculate risk trends (daily averages)
    const riskTrends = this.calculateRiskTrends(riskData);

    // Alert counts by status
    const alertCounts = {
      open: 0,
      investigating: 0,
      resolved: 0,
      false_positive: 0
    };

    for (const alert of this.activeAlerts.values()) {
      alertCounts[alert.status]++;
    }

    return {
      eventCounts,
      severityCounts,
      alertCounts,
      topThreatSources,
      riskTrends,
      anomalyDetectionStats: {
        anomaliesDetected: 0, // TODO: Implement
        averageAnomalyScore: 0, // TODO: Implement
        falsePositiveRate: 0 // TODO: Implement
      }
    };
  }

  /**
   * Export security audit report
   */
  exportAuditReport(
    timeRange: { start: Date; end: Date },
    format: 'json' | 'csv' = 'json'
  ): string {
    const events = this.getEvents({
      timeRange,
      limit: 10000 // Max events in report
    });

    const metrics = this.getSecurityMetrics();
    const alerts = this.getActiveAlerts();

    const report = {
      metadata: {
        generatedAt: new Date(),
        timeRange,
        eventCount: events.length,
        alertCount: alerts.length
      },
      metrics,
      events: events.map(e => ({
        ...e,
        // Sanitize sensitive data
        actor: {
          ...e.actor,
          sessionId: e.actor.sessionId ? '[REDACTED]' : undefined
        }
      })),
      alerts
    };

    if (format === 'csv') {
      return this.convertToCSV(report);
    }

    return JSON.stringify(report, null, 2);
  }

  // Private methods

  private async runThreatDetection(event: SecurityEvent): Promise<void> {
    for (const rule of this.threatRules.values()) {
      if (!rule.isActive || !rule.eventTypes.includes(event.type)) {
        continue;
      }

      // Check if conditions match
      const conditionsMet = rule.conditions.every(condition =>
        this.evaluateThreatCondition(condition, event)
      );

      if (!conditionsMet) {
        continue;
      }

      // Get recent matching events
      const recentEvents = this.getRecentMatchingEvents(rule, event);

      // Check threshold
      if (recentEvents.length >= rule.threshold) {
        await this.triggerAlert(rule, recentEvents);
      }
    }
  }

  private async runAnomalyDetection(event: SecurityEvent): Promise<void> {
    // Detect anomalies in various metrics
    const metrics = [
      { key: 'login_frequency', value: this.getLoginFrequency(event.actor.userId) },
      { key: 'risk_score', value: event.context.riskScore },
      { key: 'hour_of_day', value: event.timestamp.getHours() }
    ];

    for (const metric of metrics) {
      const result = this.detectAnomaly(metric.key, metric.value);

      if (result.isAnomaly && result.score > 0.8) {
        // Create anomaly event
        const anomalyEvent: Omit<SecurityEvent, 'id' | 'timestamp'> = {
          type: SecurityEventType.ANOMALOUS_BEHAVIOR,
          severity: SecurityEventSeverity.MEDIUM,
          source: 'anomaly_detection',
          actor: event.actor,
          context: event.context,
          details: {
            originalEvent: event.id,
            metric: metric.key,
            value: metric.value,
            anomalyScore: result.score,
            factors: result.factors
          },
          metadata: {
            tags: ['anomaly', metric.key],
            alertTriggered: false,
            automated: true
          }
        };

        await this.logSecurityEvent(anomalyEvent);
      }
    }
  }

  private detectAnomaly(metricKey: string, value: number): AnomalyDetectionResult {
    let baseline = this.behaviorBaselines.get(metricKey);

    if (!baseline) {
      baseline = {
        values: [],
        mean: 0,
        stdDev: 0,
        lastUpdate: new Date()
      };
      this.behaviorBaselines.set(metricKey, baseline);
    }

    // Add new value
    baseline.values.push(value);

    // Keep only recent values (last 1000)
    if (baseline.values.length > 1000) {
      baseline.values = baseline.values.slice(-1000);
    }

    // Update statistics
    baseline.mean = baseline.values.reduce((sum, v) => sum + v, 0) / baseline.values.length;

    const variance = baseline.values.reduce((sum, v) => sum + Math.pow(v - baseline.mean, 2), 0) / baseline.values.length;
    baseline.stdDev = Math.sqrt(variance);
    baseline.lastUpdate = new Date();

    // Calculate z-score
    const zScore = baseline.stdDev > 0 ? Math.abs(value - baseline.mean) / baseline.stdDev : 0;

    // Determine if anomalous (z-score > 2.5 indicates strong anomaly)
    const isAnomaly = zScore > 2.5;
    const score = Math.min(1, zScore / 4); // Normalize to 0-1

    const factors: string[] = [];
    if (zScore > 3) factors.push('extreme_deviation');
    if (value > baseline.mean + (2 * baseline.stdDev)) factors.push('above_normal');
    if (value < baseline.mean - (2 * baseline.stdDev)) factors.push('below_normal');

    return {
      isAnomaly,
      score,
      factors,
      baseline: {
        average: baseline.mean,
        standardDeviation: baseline.stdDev,
        recentTrend: this.calculateTrend(baseline.values)
      }
    };
  }

  private calculateTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (values.length < 10) return 'stable';

    const recent = values.slice(-10);
    const older = values.slice(-20, -10);

    if (older.length === 0) return 'stable';

    const recentAvg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
    const olderAvg = older.reduce((sum, v) => sum + v, 0) / older.length;

    const change = (recentAvg - olderAvg) / olderAvg;

    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  private evaluateThreatCondition(condition: ThreatCondition, event: SecurityEvent): boolean {
    const value = this.getFieldValue(condition.field, event);

    switch (condition.operator) {
      case 'eq': return value === condition.value;
      case 'ne': return value !== condition.value;
      case 'gt': return value > condition.value;
      case 'lt': return value < condition.value;
      case 'in': return Array.isArray(condition.value) && condition.value.includes(value);
      case 'contains': return String(value).includes(condition.value);
      case 'matches': return new RegExp(condition.value).test(String(value));
      default: return false;
    }
  }

  private getFieldValue(field: string, event: SecurityEvent): any {
    const parts = field.split('.');
    let value: any = event;

    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) break;
    }

    return value;
  }

  private getRecentMatchingEvents(rule: ThreatDetectionRule, currentEvent: SecurityEvent): SecurityEvent[] {
    const cutoffTime = new Date(currentEvent.timestamp.getTime() - rule.timeWindow);

    return this.events.filter(event => {
      if (event.timestamp < cutoffTime) return false;
      if (!rule.eventTypes.includes(event.type)) return false;

      return rule.conditions.every(condition =>
        this.evaluateThreatCondition(condition, event)
      );
    });
  }

  private async triggerAlert(rule: ThreatDetectionRule, events: SecurityEvent[]): Promise<void> {
    const alertId = this.generateAlertId();

    const alert: SecurityAlert = {
      id: alertId,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      timestamp: new Date(),
      events,
      status: 'open'
    };

    this.activeAlerts.set(alertId, alert);
    this.alertCount++;

    // Execute rule actions
    for (const action of rule.actions) {
      await this.executeAction(action, alert);
    }

    // Emit alert
    this.emit('securityAlert', alert);

    logger.warn('Security alert triggered', {
      alertId,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      eventCount: events.length
    });
  }

  private async executeAction(action: ThreatAction, alert: SecurityAlert): Promise<void> {
    switch (action.type) {
      case 'alert':
        // Already handled by logging
        break;
      case 'block':
        // TODO: Implement blocking logic
        logger.info('Block action triggered', { alertId: alert.id, action });
        break;
      case 'quarantine':
        // TODO: Implement quarantine logic
        logger.info('Quarantine action triggered', { alertId: alert.id, action });
        break;
      case 'notify':
        // TODO: Implement notification logic
        logger.info('Notification action triggered', { alertId: alert.id, action });
        break;
      case 'escalate':
        // TODO: Implement escalation logic
        logger.warn('Alert escalated', { alertId: alert.id, action });
        break;
    }
  }

  private getLoginFrequency(userId?: string): number {
    if (!userId) return 0;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return this.events.filter(event =>
      event.actor.userId === userId &&
      event.type === SecurityEventType.LOGIN_SUCCESS &&
      event.timestamp > oneDayAgo
    ).length;
  }

  private indexEvent(event: SecurityEvent): void {
    // Index by type
    if (!this.eventIndex.has(event.type)) {
      this.eventIndex.set(event.type, []);
    }
    this.eventIndex.get(event.type)!.push(event);

    // Index by actor
    const actorKey = event.actor.userId || event.actor.ipAddress;
    if (!this.eventIndex.has(actorKey)) {
      this.eventIndex.set(actorKey, []);
    }
    this.eventIndex.get(actorKey)!.push(event);
  }

  private async cleanupOldEvents(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const initialCount = this.events.length;

    // Remove old events
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].timestamp < thirtyDaysAgo) {
        this.events.splice(i, 1);
      }
    }

    // Rebuild index
    this.eventIndex.clear();
    for (const event of this.events) {
      this.indexEvent(event);
    }

    const removedCount = initialCount - this.events.length;
    if (removedCount > 0) {
      logger.info('Cleaned up old security events', {
        removed: removedCount,
        remaining: this.events.length
      });
    }
  }

  private calculateRiskTrends(riskData: Array<{ timestamp: Date; risk: number }>): Array<{ timestamp: Date; averageRisk: number }> {
    // Group by day and calculate averages
    const dailyRisk = new Map<string, number[]>();

    for (const data of riskData) {
      const dateKey = data.timestamp.toISOString().split('T')[0];
      if (!dailyRisk.has(dateKey)) {
        dailyRisk.set(dateKey, []);
      }
      dailyRisk.get(dateKey)!.push(data.risk);
    }

    return Array.from(dailyRisk.entries())
      .map(([dateKey, risks]) => ({
        timestamp: new Date(dateKey),
        averageRisk: risks.reduce((sum, risk) => sum + risk, 0) / risks.length
      }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private convertToCSV(report: any): string {
    // Simplified CSV conversion
    const lines: string[] = [];

    // Headers
    lines.push('Timestamp,Type,Severity,Actor,Target,Details');

    // Events
    for (const event of report.events) {
      const line = [
        event.timestamp,
        event.type,
        event.severity,
        event.actor.userId || event.actor.ipAddress,
        event.target?.resource || '',
        JSON.stringify(event.details).replace(/"/g, '""')
      ].join(',');

      lines.push(line);
    }

    return lines.join('\n');
  }

  private initializeDefaultRules(): void {
    const defaultRules: ThreatDetectionRule[] = [
      {
        id: 'brute_force_detection',
        name: 'Brute Force Attack Detection',
        description: 'Detects multiple failed login attempts',
        eventTypes: [SecurityEventType.LOGIN_FAILURE],
        conditions: [
          {
            field: 'actor.ipAddress',
            operator: 'eq',
            value: 'same_ip',
            description: 'Same IP address'
          }
        ],
        actions: [
          {
            type: 'alert',
            parameters: {},
            description: 'Generate security alert'
          },
          {
            type: 'block',
            parameters: { duration: 900000 }, // 15 minutes
            description: 'Block IP for 15 minutes'
          }
        ],
        timeWindow: 600000, // 10 minutes
        threshold: 5,
        severity: SecurityEventSeverity.HIGH,
        isActive: true
      },
      {
        id: 'privilege_escalation',
        name: 'Privilege Escalation Detection',
        description: 'Detects suspicious permission escalations',
        eventTypes: [SecurityEventType.PERMISSION_ESCALATION],
        conditions: [],
        actions: [
          {
            type: 'alert',
            parameters: {},
            description: 'Generate critical alert'
          },
          {
            type: 'escalate',
            parameters: { level: 'critical' },
            description: 'Escalate to security team'
          }
        ],
        timeWindow: 3600000, // 1 hour
        threshold: 1,
        severity: SecurityEventSeverity.CRITICAL,
        isActive: true
      }
    ];

    defaultRules.forEach(rule => {
      this.threatRules.set(rule.id, rule);
    });
  }

  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private recordMetrics(type: 'event_logged' | 'event_logging_error', duration: number): void {
    if (!this.metrics) return;

    this.metrics.recordCustomMetric(
      'security_audit_operations_total',
      1,
      { type },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'security_audit_operation_duration_ms',
      duration,
      { type },
      'histogram'
    );
  }
}