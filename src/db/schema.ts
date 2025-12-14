import { pgTable, serial, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * Items table - stores CS2 items with prices from providers
 * 
 * The `prices` JSONB field contains price data from each provider:
 * {
 *   "steam-market": {
 *     "price": 490,           // price in cents
 *     "currency": "EUR",      // currency code
 *     "listings": 10,         // number of sell listings
 *     "updatedAt": "2025-12-14T10:25:00Z"
 *   }
 * }
 */
export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  
  // Steam market_hash_name - unique item identifier and name
  marketHashName: varchar('market_hash_name', { length: 512 }).notNull().unique(),
  
  // Item icon URL (full URL)
  iconUrl: text('icon_url'),
  
  // Prices from providers (JSONB)
  prices: jsonb('prices').notNull().default({}),
  
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// TypeScript types derived from schema
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;

// Price data structure for each provider
export interface ProviderPrice {
  price: number;        // Price in cents
  currency: string;     // Currency code (EUR, USD, RUB, etc.)
  listings: number;     // Number of sell listings
  updatedAt: string;    // ISO timestamp
}

// Full prices object type
export type ItemPrices = Record<string, ProviderPrice>;

