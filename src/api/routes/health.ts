import { Hono } from 'hono';
import { checkDatabaseConnection } from '../../db/index.js';
import { providerManager } from '../../providers/index.js';

const health = new Hono();

health.get('/', async (c) => {
  const dbHealthy = await checkDatabaseConnection();
  const providerHealth = await providerManager.healthCheckAll();

  const providers: Record<string, { status: string; latencyMs?: number }> = {};
  for (const [name, health] of providerHealth) {
    providers[name] = {
      status: health.healthy ? 'healthy' : 'unhealthy',
      latencyMs: health.latencyMs,
    };
  }

  const allHealthy = dbHealthy && Array.from(providerHealth.values()).every((h) => h.healthy);

  return c.json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    database: dbHealthy ? 'connected' : 'disconnected',
    providers,
  }, allHealthy ? 200 : 503);
});

export { health };

