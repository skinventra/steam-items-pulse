import { Hono } from 'hono';
import { db, items } from '../../db/index.js';
import { providerManager } from '../../providers/index.js';
import { sql } from 'drizzle-orm';

const statsRouter = new Hono();

/**
 * GET /api/v1/stats
 * Overall system statistics
 */
statsRouter.get('/', async (c) => {
  // Get item counts
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(items);

  const totalItems = countResult[0]?.count ?? 0;

  // Get update timestamps
  const timestamps = await db
    .select({
      oldest: sql<Date>`min(updated_at)`,
      newest: sql<Date>`max(updated_at)`,
    })
    .from(items);

  // Provider stats
  const providers = providerManager.getAll();
  const enabledCount = providerManager.getEnabled().length;
  const healthMap = await providerManager.healthCheckAll();
  const healthyCount = Array.from(healthMap.values()).filter((h) => h.healthy).length;

  return c.json({
    totalItems,
    providers: {
      total: providers.length,
      enabled: enabledCount,
      healthy: healthyCount,
    },
    database: {
      itemsCount: totalItems,
      oldestUpdate: timestamps[0]?.oldest?.toISOString() ?? null,
      newestUpdate: timestamps[0]?.newest?.toISOString() ?? null,
    },
  });
});

export { statsRouter };

