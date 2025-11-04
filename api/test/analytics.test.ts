import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import Redis from 'ioredis';
import { mockDashboardMetrics, mockGuildAnalytics, validGuildId, validApiKey } from './fixtures.js';

describe('Analytics Routes', () => {
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = new Redis();
    vi.clearAllMocks();
  });

  describe('GET /api/v1/analytics/dashboard', () => {
    it('should return dashboard metrics successfully', async () => {
      // Mock Redis response
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: mockDashboardMetrics
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body.data).toHaveProperty('overview');
      expect(res.body.data).toHaveProperty('performance');
      expect(res.body.data).toHaveProperty('activity');
      expect(res.body.data).toHaveProperty('growth');
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/dashboard');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle worker service timeout', async () => {
      // Don't mock response to trigger timeout
      mockRedis.on.mockImplementation(() => {});

      const res = await request(app)
        .get('/api/v1/analytics/dashboard')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('GET /api/v1/analytics/guilds/:guildId', () => {
    it('should return guild analytics successfully', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: mockGuildAnalytics
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get(`/api/v1/analytics/guilds/${validGuildId}`)
        .set('X-API-Key', validApiKey)
        .query({ period: 'week', limit: 50 });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('guildId', validGuildId);
      expect(res.body.data).toHaveProperty('metrics');
      expect(res.body.data.metrics).toHaveProperty('totalTracks');
      expect(res.body.data.metrics).toHaveProperty('popularTracks');
    });

    it('should validate guild ID format', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/guilds/invalid-id')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should accept period and limit query parameters', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: mockGuildAnalytics
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get(`/api/v1/analytics/guilds/${validGuildId}`)
        .set('X-API-Key', validApiKey)
        .query({ period: 'month', limit: 100 });

      expect(res.status).toBe(200);
      expect(mockRedis.publish).toHaveBeenCalled();
    });

    it('should handle guild not found error', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              error: 'Guild not found'
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get(`/api/v1/analytics/guilds/${validGuildId}`)
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/v1/analytics/music/popular', () => {
    it('should return popular tracks with pagination', async () => {
      const mockPopularTracks = {
        tracks: [
          {
            track: mockGuildAnalytics.metrics.popularTracks[0].track,
            playCount: 50,
            uniqueGuilds: 10,
            avgRating: 4.5
          }
        ],
        total: 1
      };

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: mockPopularTracks
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/analytics/music/popular')
        .set('X-API-Key', validApiKey)
        .query({ page: 1, limit: 20, period: 'week' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('page', 1);
      expect(res.body.pagination).toHaveProperty('limit', 20);
      expect(res.body.pagination).toHaveProperty('total');
      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('should validate pagination parameters', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/music/popular')
        .set('X-API-Key', validApiKey)
        .query({ page: 0, limit: 200 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should filter by genre if provided', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: { tracks: [], total: 0 }
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/analytics/music/popular')
        .set('X-API-Key', validApiKey)
        .query({ page: 1, limit: 20, genre: 'electronic' });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/analytics/usage/trends', () => {
    it('should return usage trends data', async () => {
      const mockTrends = {
        metric: 'commands',
        period: 'month',
        dataPoints: [
          { timestamp: '2025-10-01', value: 100, change: 5 },
          { timestamp: '2025-10-02', value: 105, change: 5 }
        ],
        summary: {
          total: 205,
          average: 102.5,
          growth: 5,
          peak: { value: 105, timestamp: '2025-10-02' }
        }
      };

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: mockTrends
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/analytics/usage/trends')
        .set('X-API-Key', validApiKey)
        .query({ period: 'month', metric: 'commands' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('dataPoints');
      expect(res.body.data).toHaveProperty('summary');
      expect(res.body.data.dataPoints).toBeInstanceOf(Array);
    });

    it('should use default parameters when not provided', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: { metric: 'commands', period: 'month', dataPoints: [], summary: { total: 0, average: 0, growth: 0, peak: { value: 0, timestamp: '' } } }
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/analytics/usage/trends')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/analytics/performance', () => {
    it('should return performance metrics', async () => {
      const mockPerformance = {
        timeRange: '24h',
        metrics: {
          responseTime: { avg: 50, p50: 45, p95: 80, p99: 100 },
          throughput: { commandsPerSecond: 10, peakCommandsPerSecond: 50, totalCommands: 100000 },
          errorRate: { percentage: 0.5, total: 500, byType: { 'timeout': 300, 'validation': 200 } },
          systemHealth: { memoryUsage: 75, cpuUsage: 50, diskUsage: 60, activeConnections: 100 },
          serviceStatus: {
            gateway: 'healthy' as const,
            audio: 'healthy' as const,
            worker: 'healthy' as const,
            api: 'healthy' as const
          }
        }
      };

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: mockPerformance
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/analytics/performance')
        .set('X-API-Key', validApiKey)
        .query({ timeRange: '24h' });

      expect(res.status).toBe(200);
      expect(res.body.data.metrics).toHaveProperty('responseTime');
      expect(res.body.data.metrics).toHaveProperty('throughput');
      expect(res.body.data.metrics).toHaveProperty('errorRate');
      expect(res.body.data.metrics).toHaveProperty('systemHealth');
      expect(res.body.data.metrics).toHaveProperty('serviceStatus');
    });
  });

  describe('POST /api/v1/analytics/reports/generate', () => {
    it('should generate custom report successfully', async () => {
      const mockReport = {
        reportId: 'report-123',
        status: 'processing' as const,
        estimatedCompletion: new Date().toISOString(),
        metrics: ['playCount', 'uniqueUsers'],
        format: 'json'
      };

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: mockReport
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .post('/api/v1/analytics/reports/generate')
        .set('X-API-Key', validApiKey)
        .send({
          guildIds: [validGuildId],
          metrics: ['playCount', 'uniqueUsers'],
          dateRange: { start: '2025-10-01', end: '2025-10-31' },
          format: 'json'
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('reportId');
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data.status).toBe('processing');
    });

    it('should accept different report formats', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: { reportId: 'report-456', status: 'processing', metrics: [], format: 'csv' }
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .post('/api/v1/analytics/reports/generate')
        .set('X-API-Key', validApiKey)
        .send({
          metrics: ['playCount'],
          dateRange: { start: '2025-10-01', end: '2025-10-31' },
          format: 'csv'
        });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/analytics/reports/:reportId', () => {
    it('should return report status', async () => {
      const mockReportStatus = {
        reportId: 'report-123',
        status: 'completed' as const,
        downloadUrl: 'https://example.com/reports/report-123.json',
        progress: 100,
        createdAt: '2025-10-31T00:00:00Z',
        completedAt: '2025-10-31T00:05:00Z'
      };

      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              data: mockReportStatus
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/analytics/reports/report-123')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('reportId', 'report-123');
      expect(res.body.data).toHaveProperty('status', 'completed');
      expect(res.body.data).toHaveProperty('downloadUrl');
    });

    it('should handle report not found', async () => {
      mockRedis.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'message') {
          setTimeout(() => {
            callback('analytics-response:test', JSON.stringify({
              error: 'Report not found'
            }));
          }, 10);
        }
      });

      const res = await request(app)
        .get('/api/v1/analytics/reports/nonexistent')
        .set('X-API-Key', validApiKey);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
