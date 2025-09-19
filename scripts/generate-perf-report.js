#!/usr/bin/env node

/**
 * Performance Report Generator
 * Generates detailed performance analysis reports
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from '../packages/logger/dist/index.js';

class PerformanceReportGenerator {
  constructor() {
    this.reportData = {
      timestamp: new Date().toISOString(),
      system: this.getSystemInfo(),
      processes: [],
      recommendations: []
    };
  }

  getSystemInfo() {
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
      cpus: os.cpus().length,
      loadAverage: os.loadavg()
    };
  }

  async analyzeService(serviceName, pid) {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      const serviceData = {
        name: serviceName,
        pid: pid || process.pid,
        memory: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
          external: Math.round(memUsage.external / 1024 / 1024) + 'MB',
          rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
          utilization: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100) + '%'
        },
        cpu: {
          user: Math.round(cpuUsage.user / 1000) + 'ms',
          system: Math.round(cpuUsage.system / 1000) + 'ms'
        },
        uptime: Math.round(process.uptime()) + 's'
      };

      this.reportData.processes.push(serviceData);
      return serviceData;

    } catch (error) {
      logger.error(`Failed to analyze service ${serviceName}:`, error);
      return null;
    }
  }

  analyzeNodeOptions() {
    const nodeOptions = process.env.NODE_OPTIONS || '';
    const options = {
      maxOldSpaceSize: this.extractNodeOption(nodeOptions, '--max-old-space-size'),
      maxSemiSpaceSize: this.extractNodeOption(nodeOptions, '--max-semi-space-size'),
      gcInterval: this.extractNodeOption(nodeOptions, '--gc-interval'),
      optimizeForSize: nodeOptions.includes('--optimize-for-size'),
      exposeGc: nodeOptions.includes('--expose-gc')
    };

    const recommendations = [];

    if (!options.maxOldSpaceSize) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Memory',
        issue: 'No max-old-space-size limit set',
        recommendation: 'Set --max-old-space-size=2048 to prevent excessive memory usage',
        impact: 'Prevents OOM crashes and improves garbage collection'
      });
    }

    if (!options.exposeGc) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'Monitoring',
        issue: 'GC monitoring disabled',
        recommendation: 'Add --expose-gc flag for better memory monitoring',
        impact: 'Enables garbage collection metrics and manual GC triggering'
      });
    }

    if (!options.optimizeForSize) {
      recommendations.push({
        priority: 'LOW',
        category: 'Memory',
        issue: 'Not optimized for memory',
        recommendation: 'Add --optimize-for-size for better memory efficiency',
        impact: 'Reduces memory footprint at slight performance cost'
      });
    }

    this.reportData.nodeOptions = options;
    this.reportData.recommendations.push(...recommendations);

    return options;
  }

  extractNodeOption(nodeOptions, option) {
    const regex = new RegExp(`${option}=(\\d+)`);
    const match = nodeOptions.match(regex);
    return match ? parseInt(match[1]) : null;
  }

  async analyzeDependencies() {
    try {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8')
      );

      const analysis = {
        scripts: packageJson.scripts,
        dependencies: Object.keys(packageJson.dependencies || {}).length,
        devDependencies: Object.keys(packageJson.devDependencies || {}).length,
        pnpmConfig: packageJson.pnpm || {}
      };

      // Check for performance-related configurations
      const recommendations = [];

      if (!packageJson.pnpm?.overrides) {
        recommendations.push({
          priority: 'MEDIUM',
          category: 'Dependencies',
          issue: 'No pnpm overrides configured',
          recommendation: 'Configure pnpm overrides for critical dependencies like esbuild',
          impact: 'Ensures consistent dependency versions and security patches'
        });
      }

      // Check for memory-optimized start scripts
      if (!packageJson.scripts?.['start:prod']?.includes('--max-old-space-size')) {
        recommendations.push({
          priority: 'HIGH',
          category: 'Scripts',
          issue: 'Production start script not memory-optimized',
          recommendation: 'Add memory limits to production start scripts',
          impact: 'Prevents memory exhaustion in production'
        });
      }

      this.reportData.dependencies = analysis;
      this.reportData.recommendations.push(...recommendations);

      return analysis;

    } catch (error) {
      logger.error('Failed to analyze dependencies:', error);
      return null;
    }
  }

  async analyzeLavalinkConfig() {
    try {
      const lavalinkConfig = await fs.readFile(
        path.join(process.cwd(), 'lavalink/application.yml'),
        'utf8'
      );

      const analysis = {
        hasCompression: lavalinkConfig.includes('compression:'),
        bufferSettings: {
          bufferDuration: this.extractYmlValue(lavalinkConfig, 'bufferDurationMs'),
          frameBuffer: this.extractYmlValue(lavalinkConfig, 'frameBufferDurationMs')
        },
        playlistLimits: {
          youtube: this.extractYmlValue(lavalinkConfig, 'youtubePlaylistLoadLimit'),
          general: this.extractYmlValue(lavalinkConfig, 'playlistLoadLimit')
        }
      };

      const recommendations = [];

      if (analysis.playlistLimits.youtube > 50) {
        recommendations.push({
          priority: 'MEDIUM',
          category: 'Lavalink',
          issue: 'High YouTube playlist load limit',
          recommendation: 'Reduce youtubePlaylistLoadLimit to 50 or lower',
          impact: 'Reduces memory usage and API rate limiting'
        });
      }

      if (!analysis.hasCompression) {
        recommendations.push({
          priority: 'LOW',
          category: 'Lavalink',
          issue: 'Compression not enabled',
          recommendation: 'Enable compression for better network efficiency',
          impact: 'Reduces bandwidth usage and improves response times'
        });
      }

      this.reportData.lavalink = analysis;
      this.reportData.recommendations.push(...recommendations);

      return analysis;

    } catch (error) {
      logger.warn('Could not analyze Lavalink configuration:', error.message);
      return null;
    }
  }

  extractYmlValue(content, key) {
    const regex = new RegExp(`${key}:\\s*(\\d+)`);
    const match = content.match(regex);
    return match ? parseInt(match[1]) : null;
  }

  generateSummary() {
    const totalMemory = this.reportData.processes.reduce((sum, proc) => {
      return sum + parseInt(proc.memory.rss.replace('MB', ''));
    }, 0);

    const highPriorityIssues = this.reportData.recommendations.filter(r => r.priority === 'HIGH').length;
    const mediumPriorityIssues = this.reportData.recommendations.filter(r => r.priority === 'MEDIUM').length;

    return {
      totalProcesses: this.reportData.processes.length,
      totalMemoryUsage: totalMemory + 'MB',
      highPriorityIssues,
      mediumPriorityIssues,
      overallHealth: this.calculateOverallHealth()
    };
  }

  calculateOverallHealth() {
    const issues = this.reportData.recommendations;
    const highIssues = issues.filter(r => r.priority === 'HIGH').length;
    const mediumIssues = issues.filter(r => r.priority === 'MEDIUM').length;

    if (highIssues === 0 && mediumIssues === 0) return 'EXCELLENT';
    if (highIssues === 0 && mediumIssues <= 2) return 'GOOD';
    if (highIssues <= 1 && mediumIssues <= 3) return 'FAIR';
    return 'NEEDS_ATTENTION';
  }

  async generateReport() {
    logger.info('Generating performance report...');

    // Analyze current process
    await this.analyzeService('Current Process', process.pid);

    // Analyze configuration
    this.analyzeNodeOptions();
    await this.analyzeDependencies();
    await this.analyzeLavalinkConfig();

    // Generate summary
    this.reportData.summary = this.generateSummary();

    // Save report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `performance-report-${timestamp}.json`;
    const reportPath = path.join(process.cwd(), 'reports', filename);

    try {
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, JSON.stringify(this.reportData, null, 2));
      logger.info(`Performance report saved to: ${reportPath}`);
    } catch (error) {
      logger.error('Failed to save report:', error);
    }

    // Print summary to console
    this.printSummary();

    return this.reportData;
  }

  printSummary() {
    const summary = this.reportData.summary;

    console.log('\n' + '='.repeat(60));
    console.log('🚀 PERFORMANCE ANALYSIS REPORT');
    console.log('='.repeat(60));
    console.log(`📊 System: ${this.reportData.system.platform} ${this.reportData.system.arch}`);
    console.log(`💾 Total Memory: ${this.reportData.system.totalMemory}`);
    console.log(`⚡ CPU Cores: ${this.reportData.system.cpus}`);
    console.log(`🔧 Node Version: ${this.reportData.system.nodeVersion}`);
    console.log('');
    console.log(`📈 Processes Analyzed: ${summary.totalProcesses}`);
    console.log(`💾 Total Memory Usage: ${summary.totalMemoryUsage}`);
    console.log(`🚨 High Priority Issues: ${summary.highPriorityIssues}`);
    console.log(`⚠️  Medium Priority Issues: ${summary.mediumPriorityIssues}`);
    console.log(`🎯 Overall Health: ${summary.overallHealth}`);

    // Print top recommendations
    if (this.reportData.recommendations.length > 0) {
      console.log('\n📋 TOP RECOMMENDATIONS:');
      this.reportData.recommendations
        .filter(r => r.priority === 'HIGH')
        .slice(0, 3)
        .forEach((rec, i) => {
          console.log(`   ${i + 1}. [${rec.priority}] ${rec.issue}`);
          console.log(`      💡 ${rec.recommendation}`);
        });
    }

    console.log('='.repeat(60) + '\n');
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const generator = new PerformanceReportGenerator();
  generator.generateReport().catch(console.error);
}

export { PerformanceReportGenerator };