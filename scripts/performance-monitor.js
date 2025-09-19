#!/usr/bin/env node

/**
 * Performance Monitor Script
 * Monitors system performance and generates reports
 */

import { performanceMonitor } from '../packages/logger/src/performance.js';
import { logger } from '../packages/logger/src/index.js';

class PerformanceReporter {
  constructor() {
    this.metrics = [];
    this.startTime = Date.now();
  }

  start() {
    logger.info('Starting performance monitoring...');

    // Start the performance monitor
    performanceMonitor.start();

    // Enable memory leak detection
    performanceMonitor.createMemoryLeakDetector(300, 10); // 300MB threshold, 10 samples

    // Listen for metrics
    performanceMonitor.on('metrics', (metrics) => {
      this.metrics.push({
        timestamp: Date.now(),
        ...metrics
      });

      // Keep only last 100 metrics to avoid memory growth
      if (this.metrics.length > 100) {
        this.metrics.shift();
      }

      this.logMetrics(metrics);
    });

    // Listen for memory leak alerts
    performanceMonitor.on('memoryLeak', (alert) => {
      logger.error('MEMORY LEAK ALERT', alert);
      console.error('\n🚨 MEMORY LEAK DETECTED!');
      console.error(`Current usage: ${Math.round(alert.currentUsage)}MB`);
      console.error(`Trend: +${Math.round(alert.trend)}MB`);
      console.error(`Threshold: ${alert.threshold}MB\n`);
    });

    // Report summary every 5 minutes
    setInterval(() => {
      this.generateSummaryReport();
    }, 5 * 60 * 1000);

    // Graceful shutdown
    process.on('SIGINT', () => {
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      this.shutdown();
    });
  }

  logMetrics(metrics) {
    const memoryMB = Math.round(metrics.memory.heapUsed / 1024 / 1024);
    const utilizationPercent = Math.round(metrics.memory.heapUtilization * 100);
    const eventLoopLag = Math.round(metrics.eventLoop.lag);

    console.log(
      `📊 Memory: ${memoryMB}MB (${utilizationPercent}%) | ` +
      `Event Loop: ${eventLoopLag}ms | ` +
      `GC: ${metrics.gc.collections} collections | ` +
      `Uptime: ${Math.round(metrics.cpu.processUptime)}s`
    );

    // Warning indicators
    if (metrics.memory.heapUtilization > 0.8) {
      console.log('⚠️  High memory usage');
    }
    if (metrics.eventLoop.lag > 50) {
      console.log('⚠️  High event loop lag');
    }
  }

  generateSummaryReport() {
    if (this.metrics.length === 0) return;

    const latest = this.metrics[this.metrics.length - 1];
    const oldest = this.metrics[0];

    // Calculate averages over the period
    const avgMemory = this.metrics.reduce((sum, m) => sum + m.memory.heapUsed, 0) / this.metrics.length;
    const avgLag = this.metrics.reduce((sum, m) => sum + m.eventLoop.lag, 0) / this.metrics.length;

    // Memory trend
    const memoryTrend = latest.memory.heapUsed - oldest.memory.heapUsed;
    const trendDirection = memoryTrend > 0 ? '↗️' : memoryTrend < 0 ? '↘️' : '➡️';

    console.log('\n' + '='.repeat(60));
    console.log('📊 PERFORMANCE SUMMARY REPORT');
    console.log('='.repeat(60));
    console.log(`⏱️  Runtime: ${Math.round((Date.now() - this.startTime) / 1000 / 60)}m`);
    console.log(`📈 Samples: ${this.metrics.length}`);
    console.log(`💾 Current Memory: ${Math.round(latest.memory.heapUsed / 1024 / 1024)}MB`);
    console.log(`📊 Average Memory: ${Math.round(avgMemory / 1024 / 1024)}MB`);
    console.log(`${trendDirection} Memory Trend: ${memoryTrend > 0 ? '+' : ''}${Math.round(memoryTrend / 1024 / 1024)}MB`);
    console.log(`⚡ Current Event Loop: ${Math.round(latest.eventLoop.lag)}ms`);
    console.log(`📈 Average Event Loop: ${Math.round(avgLag)}ms`);
    console.log(`🗑️  GC Collections: ${latest.gc.collections}`);
    console.log(`⏱️  GC Avg Duration: ${Math.round(latest.gc.averageDuration)}ms`);
    console.log('='.repeat(60) + '\n');

    // Generate recommendations
    this.generateRecommendations(latest, avgMemory, avgLag);
  }

  generateRecommendations(latest, avgMemory, avgLag) {
    const recommendations = [];

    if (latest.memory.heapUtilization > 0.8) {
      recommendations.push('🔧 Consider increasing --max-old-space-size');
    }

    if (avgLag > 30) {
      recommendations.push('🔧 Event loop lag detected - consider optimizing async operations');
    }

    if (latest.gc.averageDuration > 50) {
      recommendations.push('🔧 Long GC pauses - consider using --gc-interval for more frequent collection');
    }

    if (avgMemory / (1024 * 1024) > 1500) {
      recommendations.push('🔧 High memory usage - check for memory leaks or optimize data structures');
    }

    if (recommendations.length > 0) {
      console.log('💡 RECOMMENDATIONS:');
      recommendations.forEach(rec => console.log(`   ${rec}`));
      console.log('');
    }
  }

  shutdown() {
    logger.info('Shutting down performance monitor...');
    performanceMonitor.stop();
    this.generateSummaryReport();
    process.exit(0);
  }
}

// Start monitoring if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const reporter = new PerformanceReporter();
  reporter.start();
}

export { PerformanceReporter };