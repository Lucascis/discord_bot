/**
 * Zero-Trust Authentication System
 * Implements never trust, always verify principles
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import argon2 from 'argon2';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'redis';

/**
 * Authentication Context
 */
export interface AuthContext {
  userId: string;
  guildId?: string;
  roles: string[];
  permissions: string[];
  ipAddress: string;
  userAgent: string;
  deviceFingerprint: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  riskScore: number;
  trustLevel: 'low' | 'medium' | 'high';
}

/**
 * Authentication Request
 */
export interface AuthRequest {
  userId: string;
  guildId?: string;
  ipAddress: string;
  userAgent: string;
  deviceFingerprint: string;
  challenge?: string;
  mfaToken?: string;
}

/**
 * Authentication Result
 */
export interface AuthResult {
  success: boolean;
  token?: string;
  refreshToken?: string;
  context?: AuthContext;
  errors: string[];
  requiresMFA: boolean;
  trustScore: number;
  riskFactors: string[];
  sessionTimeout: number;
}

/**
 * Security Policy
 */
export interface SecurityPolicy {
  maxSessions: number;
  sessionTimeout: number;
  requireMFA: boolean;
  allowedIpRanges: string[];
  blockedCountries: string[];
  maxLoginAttempts: number;
  lockoutDuration: number;
  passwordPolicy: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSymbols: boolean;
  };
}

/**
 * Zero-Trust Authentication Manager
 */
export class ZeroTrustAuthManager {
  private readonly redisClient: Redis.RedisClientType;
  private readonly metrics?: MetricsCollector;
  private readonly rateLimiter: RateLimiterRedis;
  private readonly jwtSecret: string;
  private readonly refreshSecret: string;

  // Security policies
  private readonly defaultPolicy: SecurityPolicy = {
    maxSessions: 3,
    sessionTimeout: 3600000, // 1 hour
    requireMFA: false,
    allowedIpRanges: [],
    blockedCountries: [],
    maxLoginAttempts: 5,
    lockoutDuration: 900000, // 15 minutes
    passwordPolicy: {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSymbols: true
    }
  };

  // Active sessions
  private readonly activeSessions = new Map<string, AuthContext>();
  private readonly sessionsByUser = new Map<string, Set<string>>();

  // Anomaly detection
  private readonly loginPatterns = new Map<string, {
    locations: string[];
    devices: string[];
    times: number[];
    frequency: number;
  }>();

  constructor(redisClient: Redis.RedisClientType, config: {
    jwtSecret: string;
    refreshSecret: string;
    metrics?: MetricsCollector;
  }) {
    this.redisClient = redisClient;
    this.metrics = config.metrics;
    this.jwtSecret = config.jwtSecret;
    this.refreshSecret = config.refreshSecret;

    // Configure rate limiter
    this.rateLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'auth_limit',
      points: 5, // Number of attempts
      duration: 900, // Per 15 minutes
      blockDuration: 900 // Block for 15 minutes
    });

    logger.info('Zero-Trust Authentication Manager initialized');
  }

  /**
   * Authenticate user with zero-trust principles
   */
  async authenticate(request: AuthRequest): Promise<AuthResult> {
    const startTime = Date.now();

    try {
      // Check rate limiting
      const rateLimitCheck = await this.checkRateLimit(request.userId, request.ipAddress);
      if (!rateLimitCheck.allowed) {
        return {
          success: false,
          errors: ['Rate limit exceeded'],
          requiresMFA: false,
          trustScore: 0,
          riskFactors: ['Rate limit exceeded'],
          sessionTimeout: 0
        };
      }

      // Perform risk assessment
      const riskAssessment = await this.assessRisk(request);

      // Validate user identity
      const identityValidation = await this.validateIdentity(request);
      if (!identityValidation.valid) {
        await this.recordFailedAttempt(request);
        return {
          success: false,
          errors: identityValidation.errors,
          requiresMFA: false,
          trustScore: riskAssessment.score,
          riskFactors: riskAssessment.factors,
          sessionTimeout: 0
        };
      }

      // Check if MFA is required
      const mfaRequired = await this.requiresMFA(request, riskAssessment);
      if (mfaRequired && !request.mfaToken) {
        return {
          success: false,
          errors: ['Multi-factor authentication required'],
          requiresMFA: true,
          trustScore: riskAssessment.score,
          riskFactors: riskAssessment.factors,
          sessionTimeout: 0
        };
      }

      // Validate MFA if provided
      if (request.mfaToken) {
        const mfaValid = await this.validateMFA(request.userId, request.mfaToken);
        if (!mfaValid) {
          await this.recordFailedAttempt(request);
          return {
            success: false,
            errors: ['Invalid multi-factor authentication token'],
            requiresMFA: true,
            trustScore: riskAssessment.score,
            riskFactors: riskAssessment.factors,
            sessionTimeout: 0
          };
        }
      }

      // Create authentication context
      const context = await this.createAuthContext(request, riskAssessment);

      // Generate tokens
      const tokens = await this.generateTokens(context);

      // Register session
      await this.registerSession(context);

      // Update login patterns for anomaly detection
      await this.updateLoginPatterns(request);

      // Record successful authentication
      this.recordMetrics('auth_success', Date.now() - startTime);

      logger.info('User authenticated successfully', {
        userId: request.userId,
        guildId: request.guildId,
        trustScore: riskAssessment.score,
        sessionId: context.sessionId
      });

      return {
        success: true,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        context,
        errors: [],
        requiresMFA: false,
        trustScore: riskAssessment.score,
        riskFactors: riskAssessment.factors,
        sessionTimeout: context.expiresAt - context.issuedAt
      };

    } catch (error) {
      this.recordMetrics('auth_error', Date.now() - startTime);

      logger.error('Authentication failed', {
        userId: request.userId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        errors: ['Authentication system error'],
        requiresMFA: false,
        trustScore: 0,
        riskFactors: ['System error'],
        sessionTimeout: 0
      };
    }
  }

  /**
   * Validate authentication token
   */
  async validateToken(token: string): Promise<{
    valid: boolean;
    context?: AuthContext;
    errors: string[];
  }> {
    try {
      // Verify JWT signature
      const decoded = jwt.verify(token, this.jwtSecret) as any;

      // Check if session is still active
      const sessionId = decoded.sessionId;
      const context = this.activeSessions.get(sessionId);

      if (!context) {
        return {
          valid: false,
          errors: ['Session not found or expired']
        };
      }

      // Check expiration
      if (Date.now() > context.expiresAt) {
        await this.invalidateSession(sessionId);
        return {
          valid: false,
          errors: ['Token expired']
        };
      }

      // Continuous risk assessment
      const currentRisk = await this.assessCurrentRisk(context);
      if (currentRisk.score > 0.8) {
        await this.invalidateSession(sessionId);
        return {
          valid: false,
          errors: ['Session invalidated due to high risk']
        };
      }

      // Update last activity
      context.issuedAt = Date.now();

      return {
        valid: true,
        context,
        errors: []
      };

    } catch (error) {
      return {
        valid: false,
        errors: ['Invalid token']
      };
    }
  }

  /**
   * Refresh authentication token
   */
  async refreshToken(refreshToken: string): Promise<{
    success: boolean;
    accessToken?: string;
    newRefreshToken?: string;
    errors: string[];
  }> {
    try {
      const decoded = jwt.verify(refreshToken, this.refreshSecret) as any;
      const sessionId = decoded.sessionId;
      const context = this.activeSessions.get(sessionId);

      if (!context) {
        return {
          success: false,
          errors: ['Invalid refresh token']
        };
      }

      // Generate new tokens
      const tokens = await this.generateTokens(context);

      return {
        success: true,
        accessToken: tokens.accessToken,
        newRefreshToken: tokens.refreshToken,
        errors: []
      };

    } catch (error) {
      return {
        success: false,
        errors: ['Invalid refresh token']
      };
    }
  }

  /**
   * Invalidate session
   */
  async invalidateSession(sessionId: string): Promise<void> {
    const context = this.activeSessions.get(sessionId);
    if (!context) return;

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    // Remove from user sessions
    const userSessions = this.sessionsByUser.get(context.userId);
    if (userSessions) {
      userSessions.delete(sessionId);
      if (userSessions.size === 0) {
        this.sessionsByUser.delete(context.userId);
      }
    }

    // Store in Redis for distributed invalidation
    await this.redisClient.setEx(`invalidated_session:${sessionId}`, 3600, 'true');

    logger.info('Session invalidated', {
      sessionId,
      userId: context.userId
    });
  }

  /**
   * Get user sessions
   */
  getUserSessions(userId: string): AuthContext[] {
    const sessionIds = this.sessionsByUser.get(userId);
    if (!sessionIds) return [];

    return Array.from(sessionIds)
      .map(id => this.activeSessions.get(id))
      .filter(Boolean) as AuthContext[];
  }

  /**
   * Assess authentication risk
   */
  private async assessRisk(request: AuthRequest): Promise<{
    score: number;
    factors: string[];
    level: 'low' | 'medium' | 'high';
  }> {
    const factors: string[] = [];
    let score = 0;

    // Check IP reputation
    const ipRisk = await this.assessIPRisk(request.ipAddress);
    score += ipRisk.score;
    factors.push(...ipRisk.factors);

    // Check device fingerprint
    const deviceRisk = await this.assessDeviceRisk(request.deviceFingerprint, request.userId);
    score += deviceRisk.score;
    factors.push(...deviceRisk.factors);

    // Check behavioral patterns
    const behaviorRisk = await this.assessBehaviorRisk(request);
    score += behaviorRisk.score;
    factors.push(...behaviorRisk.factors);

    // Check temporal patterns
    const temporalRisk = await this.assessTemporalRisk(request.userId);
    score += temporalRisk.score;
    factors.push(...temporalRisk.factors);

    // Normalize score (0-1)
    score = Math.min(1, Math.max(0, score / 4));

    const level = score < 0.3 ? 'low' : score < 0.7 ? 'medium' : 'high';

    return { score, factors, level };
  }

  private async assessIPRisk(ipAddress: string): Promise<{
    score: number;
    factors: string[];
  }> {
    const factors: string[] = [];
    let score = 0;

    // Check against known malicious IPs
    const isMalicious = await this.checkMaliciousIP(ipAddress);
    if (isMalicious) {
      score += 0.8;
      factors.push('Malicious IP detected');
    }

    // Check geographic anomalies
    const location = await this.getIPLocation(ipAddress);
    if (location.country && this.defaultPolicy.blockedCountries.includes(location.country)) {
      score += 0.6;
      factors.push(`Login from blocked country: ${location.country}`);
    }

    // Check if VPN/Proxy
    if (location.isProxy) {
      score += 0.3;
      factors.push('VPN/Proxy detected');
    }

    return { score, factors };
  }

  private async assessDeviceRisk(fingerprint: string, userId: string): Promise<{
    score: number;
    factors: string[];
  }> {
    const factors: string[] = [];
    let score = 0;

    // Check if device is known
    const knownDevices = await this.getUserDevices(userId);
    if (!knownDevices.includes(fingerprint)) {
      score += 0.4;
      factors.push('Unknown device');
    }

    // Check device reputation
    const deviceReputationScore = await this.getDeviceReputation(fingerprint);
    if (deviceReputationScore > 0.5) {
      score += deviceReputationScore * 0.3;
      factors.push('Device has poor reputation');
    }

    return { score, factors };
  }

  private async assessBehaviorRisk(request: AuthRequest): Promise<{
    score: number;
    factors: string[];
  }> {
    const factors: string[] = [];
    let score = 0;

    const patterns = this.loginPatterns.get(request.userId);
    if (!patterns) {
      // First time user
      score += 0.2;
      factors.push('First time user');
      return { score, factors };
    }

    // Check location patterns
    const currentLocation = await this.getIPLocation(request.ipAddress);
    if (!patterns.locations.includes(currentLocation.country || 'unknown')) {
      score += 0.3;
      factors.push('Login from new location');
    }

    // Check device patterns
    if (!patterns.devices.includes(request.deviceFingerprint)) {
      score += 0.3;
      factors.push('Login from new device');
    }

    // Check time patterns
    const currentHour = new Date().getHours();
    const hourDistribution = this.calculateHourDistribution(patterns.times);
    if (hourDistribution[currentHour] < 0.1) {
      score += 0.2;
      factors.push('Login at unusual time');
    }

    return { score, factors };
  }

  private async assessTemporalRisk(userId: string): Promise<{
    score: number;
    factors: string[];
  }> {
    const factors: string[] = [];
    let score = 0;

    // Check recent failed attempts
    const failedAttempts = await this.getRecentFailedAttempts(userId);
    if (failedAttempts > 3) {
      score += 0.5;
      factors.push('Multiple recent failed attempts');
    }

    // Check login frequency
    const recentLogins = await this.getRecentLogins(userId);
    if (recentLogins > 10) {
      score += 0.3;
      factors.push('High login frequency');
    }

    return { score, factors };
  }

  private async validateIdentity(request: AuthRequest): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    // In a real implementation, this would validate against user database
    // For now, we'll simulate basic validation
    const errors: string[] = [];

    if (!request.userId) {
      errors.push('User ID is required');
    }

    if (!request.deviceFingerprint) {
      errors.push('Device fingerprint is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private async requiresMFA(
    request: AuthRequest,
    riskAssessment: { score: number; level: string }
  ): Promise<boolean> {
    // Force MFA for high risk
    if (riskAssessment.score > 0.7) {
      return true;
    }

    // Check user preferences
    const userMFASettings = await this.getUserMFASettings(request.userId);
    if (userMFASettings.enabled) {
      return true;
    }

    // Check policy
    if (this.defaultPolicy.requireMFA) {
      return true;
    }

    return false;
  }

  private async validateMFA(userId: string, token: string): Promise<boolean> {
    // In a real implementation, this would validate TOTP, SMS, or other MFA methods
    // For now, we'll simulate validation
    return token.length === 6 && /^\d+$/.test(token);
  }

  private async createAuthContext(
    request: AuthRequest,
    riskAssessment: { score: number; level: string }
  ): Promise<AuthContext> {
    const now = Date.now();
    const sessionTimeout = this.calculateSessionTimeout(riskAssessment.score);

    return {
      userId: request.userId,
      guildId: request.guildId,
      roles: await this.getUserRoles(request.userId),
      permissions: await this.getUserPermissions(request.userId),
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      deviceFingerprint: request.deviceFingerprint,
      sessionId: this.generateSessionId(),
      issuedAt: now,
      expiresAt: now + sessionTimeout,
      riskScore: riskAssessment.score,
      trustLevel: riskAssessment.level as 'low' | 'medium' | 'high'
    };
  }

  private async generateTokens(context: AuthContext): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const accessToken = jwt.sign(
      {
        userId: context.userId,
        guildId: context.guildId,
        sessionId: context.sessionId,
        permissions: context.permissions,
        trustLevel: context.trustLevel
      },
      this.jwtSecret,
      { expiresIn: '1h' }
    );

    const refreshToken = jwt.sign(
      {
        userId: context.userId,
        sessionId: context.sessionId
      },
      this.refreshSecret,
      { expiresIn: '7d' }
    );

    return { accessToken, refreshToken };
  }

  private async registerSession(context: AuthContext): Promise<void> {
    // Add to active sessions
    this.activeSessions.set(context.sessionId, context);

    // Track user sessions
    if (!this.sessionsByUser.has(context.userId)) {
      this.sessionsByUser.set(context.userId, new Set());
    }
    this.sessionsByUser.get(context.userId)!.add(context.sessionId);

    // Enforce session limits
    await this.enforceSessionLimits(context.userId);

    // Store in Redis for distributed access
    await this.redisClient.setEx(
      `session:${context.sessionId}`,
      Math.floor((context.expiresAt - context.issuedAt) / 1000),
      JSON.stringify(context)
    );
  }

  // Helper methods (simplified implementations)

  private async checkRateLimit(userId: string, ipAddress: string): Promise<{ allowed: boolean }> {
    try {
      await this.rateLimiter.consume(`${userId}:${ipAddress}`);
      return { allowed: true };
    } catch {
      return { allowed: false };
    }
  }

  private async checkMaliciousIP(ipAddress: string): Promise<boolean> {
    // In a real implementation, this would check against threat intelligence feeds
    return false;
  }

  private async getIPLocation(ipAddress: string): Promise<{
    country?: string;
    isProxy: boolean;
  }> {
    // In a real implementation, this would use GeoIP services
    return { country: 'US', isProxy: false };
  }

  private async getUserDevices(userId: string): Promise<string[]> {
    // In a real implementation, this would fetch from database
    return [];
  }

  private async getDeviceReputation(fingerprint: string): Promise<number> {
    // In a real implementation, this would check device reputation
    return 0;
  }

  private calculateHourDistribution(times: number[]): number[] {
    const distribution = new Array(24).fill(0);
    times.forEach(time => {
      const hour = new Date(time).getHours();
      distribution[hour]++;
    });
    const total = times.length;
    return distribution.map(count => count / total);
  }

  private async getRecentFailedAttempts(userId: string): Promise<number> {
    // In a real implementation, this would fetch from database
    return 0;
  }

  private async getRecentLogins(userId: string): Promise<number> {
    // In a real implementation, this would fetch from database
    return 0;
  }

  private async getUserMFASettings(userId: string): Promise<{ enabled: boolean }> {
    // In a real implementation, this would fetch from database
    return { enabled: false };
  }

  private async getUserRoles(userId: string): Promise<string[]> {
    // In a real implementation, this would fetch from database
    return ['user'];
  }

  private async getUserPermissions(userId: string): Promise<string[]> {
    // In a real implementation, this would fetch from RBAC system
    return ['basic_access'];
  }

  private calculateSessionTimeout(riskScore: number): number {
    // Higher risk = shorter session timeout
    const baseTimeout = this.defaultPolicy.sessionTimeout;
    const riskMultiplier = 1 - (riskScore * 0.7); // 0.3 to 1.0
    return Math.floor(baseTimeout * riskMultiplier);
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async enforceSessionLimits(userId: string): Promise<void> {
    const userSessions = this.sessionsByUser.get(userId);
    if (!userSessions || userSessions.size <= this.defaultPolicy.maxSessions) {
      return;
    }

    // Remove oldest sessions
    const sessions = Array.from(userSessions)
      .map(id => this.activeSessions.get(id))
      .filter(Boolean)
      .sort((a, b) => a!.issuedAt - b!.issuedAt);

    const toRemove = sessions.slice(0, sessions.length - this.defaultPolicy.maxSessions);
    for (const session of toRemove) {
      await this.invalidateSession(session!.sessionId);
    }
  }

  private async assessCurrentRisk(context: AuthContext): Promise<{ score: number }> {
    // Simplified continuous risk assessment
    let score = context.riskScore;

    // Check session age
    const sessionAge = Date.now() - context.issuedAt;
    if (sessionAge > 3600000) { // 1 hour
      score += 0.1;
    }

    return { score };
  }

  private async recordFailedAttempt(request: AuthRequest): Promise<void> {
    // Record in Redis for rate limiting and analysis
    await this.redisClient.incr(`failed_attempts:${request.userId}`);
    await this.redisClient.expire(`failed_attempts:${request.userId}`, 900); // 15 minutes
  }

  private async updateLoginPatterns(request: AuthRequest): Promise<void> {
    const patterns = this.loginPatterns.get(request.userId) || {
      locations: [],
      devices: [],
      times: [],
      frequency: 0
    };

    const location = await this.getIPLocation(request.ipAddress);
    if (location.country && !patterns.locations.includes(location.country)) {
      patterns.locations.push(location.country);
    }

    if (!patterns.devices.includes(request.deviceFingerprint)) {
      patterns.devices.push(request.deviceFingerprint);
    }

    patterns.times.push(Date.now());
    patterns.frequency++;

    // Keep only recent data
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    patterns.times = patterns.times.filter(time => time > oneMonthAgo);

    this.loginPatterns.set(request.userId, patterns);
  }

  private recordMetrics(type: 'auth_success' | 'auth_error', duration: number): void {
    if (!this.metrics) return;

    this.metrics.recordCustomMetric(
      'auth_requests_total',
      1,
      { type },
      'counter'
    );

    this.metrics.recordCustomMetric(
      'auth_duration_ms',
      duration,
      { type },
      'histogram'
    );
  }
}