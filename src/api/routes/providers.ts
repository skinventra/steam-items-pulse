import { Hono } from 'hono';
import { providerManager } from '../../providers/index.js';

const providersRouter = new Hono();

/**
 * GET /api/v1/providers
 * List all providers
 */
providersRouter.get('/', async (c) => {
  const providers = providerManager.getAll();
  const healthMap = await providerManager.healthCheckAll();

  const data = providers.map((provider) => {
    const health = healthMap.get(provider.name);
    return {
      name: provider.name,
      displayName: provider.displayName,
      enabled: provider.enabled,
      status: health?.healthy ? 'healthy' : 'unhealthy',
      config: {
        batchSize: provider.config.batchSize,
        requestDelay: provider.config.requestDelay,
      },
    };
  });

  return c.json({ data });
});

/**
 * GET /api/v1/providers/:name
 * Get provider details
 */
providersRouter.get('/:name', async (c) => {
  const name = c.req.param('name');
  const provider = providerManager.get(name);

  if (!provider) {
    return c.json(
      { error: { code: 'PROVIDER_NOT_FOUND', message: `Provider ${name} not found` } },
      404
    );
  }

  const health = await provider.healthCheck();

  return c.json({
    data: {
      name: provider.name,
      displayName: provider.displayName,
      enabled: provider.enabled,
      config: provider.config,
      health: {
        healthy: health.healthy,
        latencyMs: health.latencyMs,
        lastError: health.lastError,
        lastSuccessAt: health.lastSuccessAt?.toISOString(),
      },
    },
  });
});

/**
 * POST /api/v1/providers/:name/run
 * Trigger manual scan
 */
providersRouter.post('/:name/run', async (c) => {
  const name = c.req.param('name');

  try {
    const result = await providerManager.runProvider(name);

    return c.json({
      message: 'Scan completed',
      result: {
        provider: result.provider,
        startedAt: result.startedAt.toISOString(),
        completedAt: result.completedAt.toISOString(),
        itemsProcessed: result.itemsProcessed,
        itemsUpdated: result.itemsUpdated,
        errors: result.errors,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: { code: 'SCAN_FAILED', message } }, 400);
  }
});

export { providersRouter };

