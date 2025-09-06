import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';

describe('health', () => {
  it('returns health status', async () => {
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('service', 'api');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
    
    // If healthy, expect proper health object
    if (res.status === 200) {
      expect(['healthy', 'degraded']).toContain(res.body.status);
      expect(res.body).toHaveProperty('checks');
    }
    // If unhealthy, expect error information
    else if (res.status === 503) {
      expect(res.body.status).toBe('unhealthy');
    }
  });
});
