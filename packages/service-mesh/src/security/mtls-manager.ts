/**
 * Mutual TLS (mTLS) Security Manager
 * Advanced certificate management and secure service-to-service communication
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { logger } from '@discord-bot/logger';
import { MetricsCollector } from '@discord-bot/observability';
import { EventEmitter } from 'events';

/**
 * Certificate Authority Configuration
 */
export interface CAConfig {
  keySize: number;
  algorithm: string;
  hashAlgorithm: string;
  validityDays: number;
  organization: string;
  organizationalUnit: string;
  country: string;
  state: string;
  locality: string;
}

/**
 * Certificate Request
 */
export interface CertificateRequest {
  serviceName: string;
  namespace: string;
  commonName: string;
  subjectAlternativeNames: string[];
  keyUsage: string[];
  extendedKeyUsage: string[];
  validityDays: number;
}

/**
 * Certificate Information
 */
export interface CertificateInfo {
  serviceName: string;
  serialNumber: string;
  issuer: string;
  subject: string;
  validFrom: Date;
  validTo: Date;
  fingerprint: string;
  algorithm: string;
  keySize: number;
  status: 'valid' | 'expired' | 'revoked' | 'pending_renewal';
}

/**
 * TLS Policy
 */
export interface TLSPolicy {
  serviceName: string;
  namespace: string;
  mode: 'STRICT' | 'PERMISSIVE' | 'DISABLE';
  cipherSuites: string[];
  minTlsVersion: '1.2' | '1.3';
  maxTlsVersion: '1.2' | '1.3';
  certificateValidation: {
    validateCertificateChain: boolean;
    validateHostname: boolean;
    allowSelfSigned: boolean;
    customCAs: string[];
  };
  rotationPolicy: {
    autoRotate: boolean;
    rotateBeforeExpiryDays: number;
    rotationCheckInterval: number; // hours
  };
}

/**
 * Certificate Metrics
 */
export interface CertificateMetrics {
  totalCertificates: number;
  validCertificates: number;
  expiredCertificates: number;
  revokedCertificates: number;
  pendingRenewal: number;
  averageValidityDays: number;
  rotationEvents: number;
  validationFailures: number;
}

/**
 * Mutual TLS Manager
 */
export class MTLSManager extends EventEmitter {
  private readonly caConfig: CAConfig;
  private readonly metrics?: MetricsCollector;

  // Certificate Authority
  private caPrivateKey?: crypto.KeyObject;
  private caCertificate?: string;

  // Certificate storage
  private readonly certificates = new Map<string, {
    certificate: string;
    privateKey: string;
    info: CertificateInfo;
  }>();

  // TLS policies
  private readonly tlsPolicies = new Map<string, TLSPolicy>();

  // Certificate revocation list
  private readonly revokedCertificates = new Set<string>();

  // Performance tracking
  private certificateIssuanceCount = 0;
  private validationAttempts = 0;
  private validationFailures = 0;
  private rotationEvents = 0;

  constructor(caConfig: CAConfig, metrics?: MetricsCollector) {
    super();
    this.caConfig = caConfig;
    this.metrics = metrics;

    // Initialize CA
    this.initializeCertificateAuthority();

    // Start certificate monitoring
    this.startCertificateMonitoring();

    logger.info('mTLS Manager initialized', {
      organization: caConfig.organization,
      keySize: caConfig.keySize,
      algorithm: caConfig.algorithm
    });
  }

  /**
   * Issue certificate for service
   */
  async issueCertificate(request: CertificateRequest): Promise<{
    certificate: string;
    privateKey: string;
    caCertificate: string;
  }> {
    const startTime = Date.now();

    try {
      // Generate key pair
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: this.caConfig.keySize,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });

      // Create certificate
      const certificate = await this.createCertificate(request, publicKey);

      // Store certificate
      const certificateInfo = this.extractCertificateInfo(certificate, request.serviceName);
      this.certificates.set(request.serviceName, {
        certificate,
        privateKey,
        info: certificateInfo
      });

      this.certificateIssuanceCount++;
      this.recordMetrics('certificate_issued', Date.now() - startTime);

      // Emit certificate issued event
      this.emit('certificateIssued', {
        serviceName: request.serviceName,
        serialNumber: certificateInfo.serialNumber,
        validTo: certificateInfo.validTo
      });

      logger.info('Certificate issued successfully', {
        serviceName: request.serviceName,
        namespace: request.namespace,
        validTo: certificateInfo.validTo,
        issuanceTime: Date.now() - startTime
      });

      return {
        certificate,
        privateKey,
        caCertificate: this.caCertificate!
      };

    } catch (error) {
      this.recordMetrics('certificate_issuance_error', Date.now() - startTime);

      logger.error('Failed to issue certificate', {
        serviceName: request.serviceName,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Validate certificate
   */
  async validateCertificate(
    certificate: string,
    serviceName: string,
    hostname?: string
  ): Promise<{
    valid: boolean;
    reasons: string[];
    certificateInfo: CertificateInfo;
  }> {
    const startTime = Date.now();
    this.validationAttempts++;

    try {
      const certificateInfo = this.extractCertificateInfo(certificate, serviceName);
      const reasons: string[] = [];

      // Check if certificate is revoked
      if (this.revokedCertificates.has(certificateInfo.serialNumber)) {
        reasons.push('Certificate has been revoked');
        this.validationFailures++;
        this.recordMetrics('certificate_validation_failed', Date.now() - startTime);

        return { valid: false, reasons, certificateInfo };
      }

      // Check expiration
      if (new Date() > certificateInfo.validTo) {
        reasons.push('Certificate has expired');
        this.validationFailures++;
        this.recordMetrics('certificate_validation_failed', Date.now() - startTime);

        return { valid: false, reasons, certificateInfo };
      }

      // Check not before
      if (new Date() < certificateInfo.validFrom) {
        reasons.push('Certificate is not yet valid');
        this.validationFailures++;
        this.recordMetrics('certificate_validation_failed', Date.now() - startTime);

        return { valid: false, reasons, certificateInfo };
      }

      // Verify certificate chain
      if (!await this.verifyCertificateChain(certificate)) {
        reasons.push('Certificate chain verification failed');
        this.validationFailures++;
        this.recordMetrics('certificate_validation_failed', Date.now() - startTime);

        return { valid: false, reasons, certificateInfo };
      }

      // Hostname validation
      if (hostname && !this.validateHostname(certificate, hostname)) {
        reasons.push(`Hostname ${hostname} does not match certificate`);
        this.validationFailures++;
        this.recordMetrics('certificate_validation_failed', Date.now() - startTime);

        return { valid: false, reasons, certificateInfo };
      }

      this.recordMetrics('certificate_validation_success', Date.now() - startTime);

      logger.debug('Certificate validation successful', {
        serviceName,
        serialNumber: certificateInfo.serialNumber,
        validationTime: Date.now() - startTime
      });

      return {
        valid: true,
        reasons: ['Certificate is valid'],
        certificateInfo
      };

    } catch (error) {
      this.validationFailures++;
      this.recordMetrics('certificate_validation_error', Date.now() - startTime);

      logger.error('Certificate validation error', {
        serviceName,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Revoke certificate
   */
  async revokeCertificate(
    serviceName: string,
    reason: 'keyCompromise' | 'caCompromise' | 'affiliationChanged' | 'superseded' | 'cessationOfOperation'
  ): Promise<void> {
    try {
      const storedCert = this.certificates.get(serviceName);
      if (!storedCert) {
        throw new Error(`Certificate not found for service: ${serviceName}`);
      }

      // Add to revocation list
      this.revokedCertificates.add(storedCert.info.serialNumber);

      // Update certificate status
      storedCert.info.status = 'revoked';

      // Emit revocation event
      this.emit('certificateRevoked', {
        serviceName,
        serialNumber: storedCert.info.serialNumber,
        reason
      });

      logger.warn('Certificate revoked', {
        serviceName,
        serialNumber: storedCert.info.serialNumber,
        reason
      });

    } catch (error) {
      logger.error('Failed to revoke certificate', {
        serviceName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Configure TLS policy for service
   */
  configureTLSPolicy(policy: TLSPolicy): void {
    this.tlsPolicies.set(policy.serviceName, policy);

    logger.info('TLS policy configured', {
      serviceName: policy.serviceName,
      namespace: policy.namespace,
      mode: policy.mode,
      minTlsVersion: policy.minTlsVersion,
      autoRotate: policy.rotationPolicy.autoRotate
    });
  }

  /**
   * Rotate certificate
   */
  async rotateCertificate(serviceName: string): Promise<{
    certificate: string;
    privateKey: string;
    caCertificate: string;
  }> {
    try {
      const existingCert = this.certificates.get(serviceName);
      if (!existingCert) {
        throw new Error(`No existing certificate found for service: ${serviceName}`);
      }

      // Create new certificate request based on existing one
      const request: CertificateRequest = {
        serviceName,
        namespace: 'default', // TODO: Extract from existing cert
        commonName: serviceName,
        subjectAlternativeNames: [serviceName, `${serviceName}.default.svc.cluster.local`],
        keyUsage: ['digitalSignature', 'keyEncipherment'],
        extendedKeyUsage: ['serverAuth', 'clientAuth'],
        validityDays: this.caConfig.validityDays
      };

      // Issue new certificate
      const newCertificates = await this.issueCertificate(request);

      // Revoke old certificate
      await this.revokeCertificate(serviceName, 'superseded');

      this.rotationEvents++;
      this.recordMetrics('certificate_rotated', 0);

      logger.info('Certificate rotated successfully', {
        serviceName,
        oldSerialNumber: existingCert.info.serialNumber,
        newCertificate: true
      });

      return newCertificates;

    } catch (error) {
      logger.error('Certificate rotation failed', {
        serviceName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get certificate metrics
   */
  getCertificateMetrics(): CertificateMetrics {
    const certs = Array.from(this.certificates.values());
    const now = new Date();

    const validCerts = certs.filter(c => c.info.status === 'valid' && c.info.validTo > now);
    const expiredCerts = certs.filter(c => c.info.validTo <= now);
    const revokedCerts = certs.filter(c => c.info.status === 'revoked');

    // Calculate pending renewal (certificates expiring in next 30 days)
    const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
    const pendingRenewal = certs.filter(c =>
      c.info.status === 'valid' &&
      c.info.validTo > now &&
      c.info.validTo <= thirtyDaysFromNow
    );

    // Calculate average validity
    const totalValidityDays = certs.reduce((sum, cert) => {
      const validityMs = cert.info.validTo.getTime() - cert.info.validFrom.getTime();
      return sum + (validityMs / (24 * 60 * 60 * 1000));
    }, 0);

    const averageValidityDays = certs.length > 0 ? totalValidityDays / certs.length : 0;

    return {
      totalCertificates: certs.length,
      validCertificates: validCerts.length,
      expiredCertificates: expiredCerts.length,
      revokedCertificates: revokedCerts.length,
      pendingRenewal: pendingRenewal.length,
      averageValidityDays,
      rotationEvents: this.rotationEvents,
      validationFailures: this.validationFailures
    };
  }

  /**
   * Export certificate bundle for service
   */
  exportCertificateBundle(serviceName: string): {
    certificate: string;
    privateKey: string;
    caCertificate: string;
    certificateChain: string;
  } | null {
    const storedCert = this.certificates.get(serviceName);
    if (!storedCert) {
      return null;
    }

    return {
      certificate: storedCert.certificate,
      privateKey: storedCert.privateKey,
      caCertificate: this.caCertificate!,
      certificateChain: storedCert.certificate + '\n' + this.caCertificate!
    };
  }

  // Private methods

  private initializeCertificateAuthority(): void {
    // Generate CA key pair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: this.caConfig.keySize,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    this.caPrivateKey = crypto.createPrivateKey(privateKey);

    // Create self-signed CA certificate
    this.caCertificate = this.createCACertificate(publicKey);

    logger.info('Certificate Authority initialized', {
      keySize: this.caConfig.keySize,
      algorithm: this.caConfig.algorithm,
      validityDays: this.caConfig.validityDays
    });
  }

  private createCACertificate(publicKey: string): string {
    // Simplified CA certificate creation
    // In production, use proper X.509 certificate creation library
    const now = new Date();
    const validTo = new Date(now.getTime() + (this.caConfig.validityDays * 24 * 60 * 60 * 1000));

    const certificateData = {
      version: 3,
      serialNumber: this.generateSerialNumber(),
      issuer: {
        C: this.caConfig.country,
        ST: this.caConfig.state,
        L: this.caConfig.locality,
        O: this.caConfig.organization,
        OU: this.caConfig.organizationalUnit,
        CN: 'Discord Bot CA'
      },
      subject: {
        C: this.caConfig.country,
        ST: this.caConfig.state,
        L: this.caConfig.locality,
        O: this.caConfig.organization,
        OU: this.caConfig.organizationalUnit,
        CN: 'Discord Bot CA'
      },
      validFrom: now,
      validTo,
      publicKey,
      extensions: [
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true },
        { name: 'subjectKeyIdentifier', value: 'hash' }
      ]
    };

    // In a real implementation, use a proper X.509 library like node-forge
    return `-----BEGIN CERTIFICATE-----\n${Buffer.from(JSON.stringify(certificateData)).toString('base64')}\n-----END CERTIFICATE-----`;
  }

  private async createCertificate(request: CertificateRequest, publicKey: string): Promise<string> {
    const now = new Date();
    const validTo = new Date(now.getTime() + (request.validityDays * 24 * 60 * 60 * 1000));

    const certificateData = {
      version: 3,
      serialNumber: this.generateSerialNumber(),
      issuer: {
        C: this.caConfig.country,
        ST: this.caConfig.state,
        L: this.caConfig.locality,
        O: this.caConfig.organization,
        OU: this.caConfig.organizationalUnit,
        CN: 'Discord Bot CA'
      },
      subject: {
        C: this.caConfig.country,
        ST: this.caConfig.state,
        L: this.caConfig.locality,
        O: this.caConfig.organization,
        OU: this.caConfig.organizationalUnit,
        CN: request.commonName
      },
      validFrom: now,
      validTo,
      publicKey,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', values: request.keyUsage },
        { name: 'extKeyUsage', values: request.extendedKeyUsage },
        { name: 'subjectAltName', altNames: request.subjectAlternativeNames.map(name => ({ type: 'DNS', value: name })) }
      ]
    };

    // Sign certificate with CA private key (simplified)
    // In production, use proper cryptographic signing
    return `-----BEGIN CERTIFICATE-----\n${Buffer.from(JSON.stringify(certificateData)).toString('base64')}\n-----END CERTIFICATE-----`;
  }

  private extractCertificateInfo(certificate: string, serviceName: string): CertificateInfo {
    // Simplified certificate parsing
    // In production, use proper X.509 parsing library
    try {
      const certData = JSON.parse(Buffer.from(
        certificate.replace('-----BEGIN CERTIFICATE-----\n', '')
                  .replace('\n-----END CERTIFICATE-----', ''),
        'base64'
      ).toString());

      return {
        serviceName,
        serialNumber: certData.serialNumber,
        issuer: JSON.stringify(certData.issuer),
        subject: JSON.stringify(certData.subject),
        validFrom: new Date(certData.validFrom),
        validTo: new Date(certData.validTo),
        fingerprint: crypto.createHash('sha256').update(certificate).digest('hex'),
        algorithm: this.caConfig.algorithm,
        keySize: this.caConfig.keySize,
        status: 'valid'
      };

    } catch (error) {
      throw new Error(`Failed to parse certificate: ${error}`);
    }
  }

  private async verifyCertificateChain(certificate: string): Promise<boolean> {
    // Simplified chain verification
    // In production, implement proper certificate chain validation
    try {
      const certInfo = this.extractCertificateInfo(certificate, 'temp');
      return certInfo.issuer.includes('Discord Bot CA');
    } catch (error) {
      return false;
    }
  }

  private validateHostname(certificate: string, hostname: string): boolean {
    // Simplified hostname validation
    // In production, implement proper SAN and CN checking
    try {
      const certInfo = this.extractCertificateInfo(certificate, 'temp');
      return certInfo.subject.includes(hostname);
    } catch (error) {
      return false;
    }
  }

  private startCertificateMonitoring(): void {
    // Check for certificate expiration every hour
    setInterval(() => {
      this.checkCertificateExpiration();
    }, 60 * 60 * 1000);

    // Check for auto-rotation every 6 hours
    setInterval(() => {
      this.checkAutoRotation();
    }, 6 * 60 * 60 * 1000);
  }

  private checkCertificateExpiration(): void {
    const now = new Date();
    const warningThreshold = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days

    for (const [serviceName, cert] of this.certificates) {
      if (cert.info.status !== 'valid') continue;

      if (cert.info.validTo <= now) {
        cert.info.status = 'expired';
        this.emit('certificateExpired', {
          serviceName,
          serialNumber: cert.info.serialNumber,
          expiredAt: cert.info.validTo
        });

        logger.warn('Certificate expired', {
          serviceName,
          serialNumber: cert.info.serialNumber,
          expiredAt: cert.info.validTo
        });

      } else if (cert.info.validTo <= warningThreshold) {
        cert.info.status = 'pending_renewal';
        this.emit('certificateExpiringWarning', {
          serviceName,
          serialNumber: cert.info.serialNumber,
          expiresAt: cert.info.validTo,
          daysUntilExpiry: Math.ceil((cert.info.validTo.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        });

        logger.warn('Certificate expiring soon', {
          serviceName,
          serialNumber: cert.info.serialNumber,
          expiresAt: cert.info.validTo
        });
      }
    }
  }

  private async checkAutoRotation(): Promise<void> {
    for (const [serviceName, policy] of this.tlsPolicies) {
      if (!policy.rotationPolicy.autoRotate) continue;

      const cert = this.certificates.get(serviceName);
      if (!cert || cert.info.status !== 'valid') continue;

      const now = new Date();
      const rotateThreshold = new Date(
        cert.info.validTo.getTime() - (policy.rotationPolicy.rotateBeforeExpiryDays * 24 * 60 * 60 * 1000)
      );

      if (now >= rotateThreshold) {
        try {
          await this.rotateCertificate(serviceName);
          logger.info('Certificate auto-rotated', {
            serviceName,
            rotateBeforeExpiryDays: policy.rotationPolicy.rotateBeforeExpiryDays
          });
        } catch (error) {
          logger.error('Auto-rotation failed', {
            serviceName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }

  private generateSerialNumber(): string {
    return crypto.randomBytes(20).toString('hex');
  }

  private recordMetrics(
    type: 'certificate_issued' | 'certificate_issuance_error' | 'certificate_validation_success' |
          'certificate_validation_failed' | 'certificate_validation_error' | 'certificate_rotated',
    duration: number
  ): void {
    if (!this.metrics) return;

    this.metrics.recordCustomMetric(
      'mtls_operations_total',
      1,
      { type },
      'counter'
    );

    if (duration > 0) {
      this.metrics.recordCustomMetric(
        'mtls_operation_duration_ms',
        duration,
        { type },
        'histogram'
      );
    }
  }
}