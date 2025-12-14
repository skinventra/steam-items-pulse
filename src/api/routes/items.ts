import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db, items, type ItemPrices } from '../../db/index.js';
import { eq, ilike, desc, asc, sql } from 'drizzle-orm';

const itemsRouter = new Hono();

// Query params schema
const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  sortBy: z.enum(['name', 'updatedAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

/**
 * Extract price from prices JSONB (currently only steam-market)
 */
function extractPrice(prices: ItemPrices): { price: number; currency: string; listings: number } | null {
  const steamPrice = prices['steam-market'];
  if (!steamPrice) return null;
  return {
    price: steamPrice.price,
    currency: steamPrice.currency,
    listings: steamPrice.listings,
  };
}

/**
 * GET /api/v1/items
 * List items with pagination and filtering
 */
itemsRouter.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { page, limit, search, sortBy, order } = c.req.valid('query');
  const offset = (page - 1) * limit;

  // Build query
  let query = db.select().from(items).$dynamic();

  // Search filter
  if (search) {
    query = query.where(ilike(items.nameEn, `%${search}%`));
  }

  // Sorting
  const orderFn = order === 'asc' ? asc : desc;
  if (sortBy === 'name') {
    query = query.orderBy(orderFn(items.nameEn));
  } else {
    query = query.orderBy(orderFn(items.updatedAt));
  }

  // Pagination
  query = query.limit(limit).offset(offset);

  const data = await query;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(items)
    .where(search ? ilike(items.nameEn, `%${search}%`) : undefined);

  const total = countResult[0]?.count ?? 0;

  // Transform response
  const transformedData = data.map((item) => {
    const priceData = extractPrice(item.prices as ItemPrices);
    return {
      id: item.id,
      marketHashName: item.marketHashName,
      iconUrl: item.iconUrl,
      price: priceData?.price ?? null,
      currency: priceData?.currency ?? null,
      listings: priceData?.listings ?? null,
      updatedAt: item.updatedAt.toISOString(),
    };
  });

  return c.json({
    data: transformedData,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * GET /api/v1/items/:id
 * Get item by ID
 */
itemsRouter.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);

  if (isNaN(id)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid ID' } }, 400);
  }

  const item = await db.select().from(items).where(eq(items.id, id)).limit(1);

  if (item.length === 0) {
    return c.json({ error: { code: 'ITEM_NOT_FOUND', message: `Item with id ${id} not found` } }, 404);
  }

  const data = item[0];
  const priceData = extractPrice(data.prices as ItemPrices);

  return c.json({
    data: {
      id: data.id,
      marketHashName: data.marketHashName,
      iconUrl: data.iconUrl,
      price: priceData?.price ?? null,
      currency: priceData?.currency ?? null,
      listings: priceData?.listings ?? null,
      createdAt: data.createdAt.toISOString(),
      updatedAt: data.updatedAt.toISOString(),
    },
  });
});

/**
 * GET /api/v1/items/by-hash/:hashName
 * Get item by market_hash_name
 */
itemsRouter.get('/by-hash/:hashName', async (c) => {
  const hashName = decodeURIComponent(c.req.param('hashName'));

  const item = await db
    .select()
    .from(items)
    .where(eq(items.marketHashName, hashName))
    .limit(1);

  if (item.length === 0) {
    return c.json(
      { error: { code: 'ITEM_NOT_FOUND', message: `Item with hash_name "${hashName}" not found` } },
      404
    );
  }

  const data = item[0];
  const priceData = extractPrice(data.prices as ItemPrices);

  return c.json({
    data: {
      id: data.id,
      marketHashName: data.marketHashName,
      iconUrl: data.iconUrl,
      price: priceData?.price ?? null,
      currency: priceData?.currency ?? null,
      listings: priceData?.listings ?? null,
      createdAt: data.createdAt.toISOString(),
      updatedAt: data.updatedAt.toISOString(),
    },
  });
});

export { itemsRouter };
