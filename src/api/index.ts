import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { health } from './routes/health.js';
import { itemsRouter } from './routes/items.js';
import { providersRouter } from './routes/providers.js';
import { statsRouter } from './routes/stats.js';

export function createApp() {
  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.use('*', honoLogger());

  // Health check (root level)
  app.route('/health', health);

  // API v1 routes
  const v1 = new Hono();
  v1.route('/items', itemsRouter);
  v1.route('/providers', providersRouter);
  v1.route('/stats', statsRouter);

  app.route('/api/v1', v1);

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
  });

  // Error handler
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      500
    );
  });

  return app;
}

