# Steam Market Pulse

> Technical Design Document

| Field | Value |
|-------|-------|
| **Project** | Steam Market Pulse |
| **Description** | CS2 Item Price Aggregator Service |
| **Author** | Skinventra Team |
| **Status** | Draft |
| **Created** | 2025-12-14 |
| **Updated** | 2025-12-14 |

---

## 1. Overview

### 1.1 Summary

**Steam Items Pulse** is a backend service that automatically collects CS2 item data from the Steam Community Market, stores it in PostgreSQL, and provides a REST API for accessing this data.

### 1.2 Goals

1. Automatic collection of all CS2 items from Steam Market
2. Store item names (in English) and current prices in PostgreSQL
3. Provide REST API for integration with external services
4. Run 24/7 with minimal maintenance

### 1.3 Non-Goals (Out of Scope)

- Parsing items from other games (Dota 2, TF2, etc.) — possible in future phases
- Historical price data and analytics — Phase 2
- Steam authentication — not required
- Buying/selling items — not supported

---

## 2. Motivation

### 2.1 Problem

The main Skinventra project requires up-to-date CS2 item price data. Steam doesn't provide an official API for bulk price retrieval, so a custom parser service is needed.

### 2.2 Solution

Create a separate microservice that:
- Periodically polls Steam Market
- Caches data in PostgreSQL
- Provides fast API for clients

### 2.3 Benefits

- **Independence** — separate service, easy to scale
- **Freshness** — data updates every 5-10 minutes
- **Performance** — API response < 50ms (data already in DB)
- **Reliability** — doesn't depend on Steam availability at client request time

---

## 3. Technical Design

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Steam Items Pulse                                   │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                           Application Layer                                  ││
│  │                                                                              ││
│  │  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       ││
│  │  │                  │    │                  │    │                  │       ││
│  │  │   HTTP Server    │    │   Scheduler      │    │   Parser         │       ││
│  │  │   (Hono/Fastify) │    │   (node-cron)    │───▶│   (Steam Client) │       ││
│  │  │                  │    │                  │    │                  │       ││
│  │  └────────┬─────────┘    └──────────────────┘    └────────┬─────────┘       ││
│  │           │                                               │                  ││
│  │           │              ┌──────────────────┐             │                  ││
│  │           └─────────────▶│   Service Layer  │◀────────────┘                  ││
│  │                          │   (Business      │                                ││
│  │                          │    Logic)        │                                ││
│  │                          └────────┬─────────┘                                ││
│  │                                   │                                          ││
│  │                          ┌────────▼─────────┐                                ││
│  │                          │   Repository     │                                ││
│  │                          │   (Data Access)  │                                ││
│  │                          └────────┬─────────┘                                ││
│  │                                   │                                          ││
│  └───────────────────────────────────┼──────────────────────────────────────────┘│
│                                      │                                           │
│  ┌───────────────────────────────────▼──────────────────────────────────────────┐│
│  │                              PostgreSQL                                       ││
│  │                                                                               ││
│  │   ┌─────────────┐    ┌─────────────────────┐    ┌─────────────────────┐      ││
│  │   │   items     │    │   price_history     │    │   parser_state      │      ││
│  │   │   table     │    │   table (Phase 2)   │    │   table             │      ││
│  │   └─────────────┘    └─────────────────────┘    └─────────────────────┘      ││
│  │                                                                               ││
│  └───────────────────────────────────────────────────────────────────────────────┘│
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘

                                      ▲
                                      │
                    ┌─────────────────┴─────────────────┐
                    │                                   │
                    │   External Clients (Skinventra)   │
                    │   GET /api/v1/items               │
                    │                                   │
                    └───────────────────────────────────┘
```

### 3.2 System Components

#### 3.2.1 HTTP Server

**Responsibility:** Handle incoming HTTP requests from clients.

**Technology:** Hono (lightweight, fast, TypeScript-first)

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check for monitoring |
| `GET` | `/api/v1/items` | List items with filters |
| `GET` | `/api/v1/items/:id` | Single item by ID |
| `GET` | `/api/v1/items/by-hash/:hashName` | Item by market_hash_name |
| `GET` | `/api/v1/providers` | List all providers |
| `GET` | `/api/v1/providers/:name` | Get provider details |
| `POST` | `/api/v1/providers/:name/run` | Trigger manual scan |
| `GET` | `/api/v1/stats` | Overall statistics |

#### 3.2.2 Scheduler

**Responsibility:** Run background tasks on schedule.

**Technology:** node-cron

**Tasks:**

| Cron Expression | Task | Description |
|-----------------|------|-------------|
| `*/5 * * * *` | `fullMarketScan` | Full market scan every 5 minutes |
| `0 * * * *` | `cleanupOldData` | Cleanup stale data (hourly) |
| `*/1 * * * *` | `healthCheck` | Parser health check |

#### 3.2.3 Provider System (Strategy Pattern)

**Responsibility:** Abstract data source interaction with pluggable providers.

The system uses the **Strategy Pattern** to support multiple data sources (Steam Market, CSFloat, Skinport, etc.). Each provider implements a common interface, allowing easy addition of new sources without modifying core logic.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Provider Architecture                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────┐
                              │   ProviderManager   │
                              │                     │
                              │  - providers[]      │
                              │  - runAll()         │
                              │  - runByName()      │
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
          ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
          │  SteamMarket    │  │    CSFloat      │  │    Skinport     │
          │    Provider     │  │    Provider     │  │    Provider     │
          │                 │  │                 │  │                 │
          │ implements      │  │ implements      │  │ implements      │
          │ IProvider       │  │ IProvider       │  │ IProvider       │
          └─────────────────┘  └─────────────────┘  └─────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
          ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
          │ Steam Market    │  │  CSFloat API    │  │  Skinport API   │
          │ API             │  │                 │  │                 │
          └─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Provider Interface:**

```typescript
/**
 * Common interface for all data providers.
 * Each provider implements this interface to fetch item data
 * from different sources (Steam, CSFloat, Skinport, etc.)
 */
interface IProvider {
  /** Unique provider identifier */
  readonly name: string;
  
  /** Human-readable display name */
  readonly displayName: string;
  
  /** Whether this provider is currently enabled */
  readonly enabled: boolean;
  
  /** Provider-specific configuration */
  readonly config: ProviderConfig;
  
  /**
   * Fetch items from the data source
   * @param options - Pagination and filtering options
   * @returns Normalized item data
   */
  fetchItems(options: FetchOptions): Promise<ProviderItem[]>;
  
  /**
   * Get total count of available items
   */
  getTotalCount(): Promise<number>;
  
  /**
   * Perform full scan of all items
   * @returns Scan result with statistics
   */
  performFullScan(): Promise<ScanResult>;
  
  /**
   * Check if provider is healthy and accessible
   */
  healthCheck(): Promise<ProviderHealth>;
}

interface ProviderConfig {
  /** Requests per minute limit */
  rateLimit: number;
  
  /** Delay between requests in ms */
  requestDelay: number;
  
  /** Items per request batch */
  batchSize: number;
  
  /** Max retry attempts */
  maxRetries: number;
  
  /** Base URL for API */
  baseUrl: string;
  
  /** Optional API key */
  apiKey?: string;
}

interface ProviderItem {
  /** Unique identifier (market_hash_name for Steam) */
  externalId: string;
  
  /** Item name in English */
  nameEn: string;
  
  /** Price in USD cents */
  priceUsdCents: number;
  
  /** Number of listings (if available) */
  listings?: number;
  
  /** Icon URL */
  iconUrl?: string;
  
  /** Source provider name */
  source: string;
  
  /** Raw data from provider (for debugging) */
  rawData?: unknown;
}

interface FetchOptions {
  offset: number;
  limit: number;
}

interface ScanResult {
  provider: string;
  startedAt: Date;
  completedAt: Date;
  itemsProcessed: number;
  itemsUpdated: number;
  errors: number;
  errorMessages: string[];
}

interface ProviderHealth {
  healthy: boolean;
  latencyMs: number;
  lastError?: string;
  lastSuccessAt?: Date;
}
```

**Provider Manager:**

```typescript
/**
 * Manages multiple providers and orchestrates data collection
 */
class ProviderManager {
  private providers: Map<string, IProvider> = new Map();
  
  /** Register a new provider */
  register(provider: IProvider): void {
    this.providers.set(provider.name, provider);
  }
  
  /** Get provider by name */
  get(name: string): IProvider | undefined {
    return this.providers.get(name);
  }
  
  /** Get all enabled providers */
  getEnabled(): IProvider[] {
    return Array.from(this.providers.values())
      .filter(p => p.enabled);
  }
  
  /** Run scan for specific provider */
  async runProvider(name: string): Promise<ScanResult> {
    const provider = this.get(name);
    if (!provider) throw new Error(`Provider ${name} not found`);
    return provider.performFullScan();
  }
  
  /** Run scan for all enabled providers */
  async runAll(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for (const provider of this.getEnabled()) {
      try {
        const result = await provider.performFullScan();
        results.push(result);
      } catch (error) {
        results.push({
          provider: provider.name,
          startedAt: new Date(),
          completedAt: new Date(),
          itemsProcessed: 0,
          itemsUpdated: 0,
          errors: 1,
          errorMessages: [String(error)],
        });
      }
    }
    return results;
  }
  
  /** Health check all providers */
  async healthCheckAll(): Promise<Map<string, ProviderHealth>> {
    const results = new Map<string, ProviderHealth>();
    for (const [name, provider] of this.providers) {
      results.set(name, await provider.healthCheck());
    }
    return results;
  }
}
```

**Steam Market Provider Implementation:**

```typescript
class SteamMarketProvider implements IProvider {
  readonly name = 'steam-market';
  readonly displayName = 'Steam Community Market';
  readonly enabled = true;
  
  readonly config: ProviderConfig = {
    rateLimit: 20,
    requestDelay: 3000,
    batchSize: 10,           // 10 items per request
    maxRetries: 3,
    baseUrl: 'https://steamcommunity.com/market',
  };
  
  async fetchItems(options: FetchOptions): Promise<ProviderItem[]> {
    const response = await this.fetchWithRetry(
      `${this.config.baseUrl}/search/render/`,
      {
        appid: 730,              // CS2
        norender: 1,             // Return JSON
        start: options.offset,
        count: 10,               // 10 items per request
        sort_column: 'name',     // Sort by name alphabetically
        sort_dir: 'asc',         // Ascending order (A → Z)
      }
    );
    
    return response.results.map(item => ({
      externalId: item.hash_name,
      nameEn: item.name,
      priceCents: item.sell_price,
      currency: this.extractCurrency(item.sell_price_text), // "4,90€" → "EUR"
      listings: item.sell_listings,
      iconUrl: this.buildIconUrl(item.asset_description?.icon_url),
      source: this.name,
    }));
  }
  
  // Extract currency from price text like "4,90€", "$12.50", "₽850"
  private extractCurrency(priceText: string): string {
    if (priceText.includes('€')) return 'EUR';
    if (priceText.includes('$')) return 'USD';
    if (priceText.includes('₽')) return 'RUB';
    if (priceText.includes('£')) return 'GBP';
    return 'USD'; // fallback
  }
  
  // ... other methods
}
```

**CSFloat Provider Implementation (Future):**

```typescript
class CSFloatProvider implements IProvider {
  readonly name = 'csfloat';
  readonly displayName = 'CSFloat';
  readonly enabled = false; // Enable when ready
  
  readonly config: ProviderConfig = {
    rateLimit: 60,
    requestDelay: 1000,
    batchSize: 50,
    maxRetries: 3,
    baseUrl: 'https://csfloat.com/api/v1',
    apiKey: process.env.CSFLOAT_API_KEY,
  };
  
  async fetchItems(options: FetchOptions): Promise<ProviderItem[]> {
    // CSFloat-specific implementation
    const response = await this.fetchWithRetry(
      `${this.config.baseUrl}/listings`,
      {
        limit: options.limit,
        offset: options.offset,
      },
      { 'Authorization': this.config.apiKey }
    );
    
    return response.data.map(item => ({
      externalId: item.market_hash_name,
      nameEn: item.item_name,
      priceUsdCents: Math.round(item.price * 100),
      listings: item.quantity,
      source: this.name,
    }));
  }
  
  // ... other methods
}
```

**Adding New Provider Checklist:**

1. Create new class implementing `IProvider`
2. Define provider-specific `config`
3. Implement `fetchItems()` with data normalization
4. Implement `getTotalCount()`, `performFullScan()`, `healthCheck()`
5. Register in `ProviderManager`
6. Add environment variables if needed
7. Update scheduler if different intervals required

**Rate Limiting (Per Provider):**

```
┌─────────────────────────────────────────────────────────────────┐
│                     Rate Limiting Strategy                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Constants:                                                      │
│  ├── MAX_REQUESTS_PER_MINUTE: 20                                │
│  ├── DELAY_BETWEEN_REQUESTS: 3000ms                             │
│  ├── BATCH_SIZE: 10 items                                       │
│  └── BACKOFF_MULTIPLIER: 2                                      │
│                                                                  │
│  On 429 Error (Too Many Requests):                              │
│  ├── 1st retry: wait 60 seconds                                 │
│  ├── 2nd retry: wait 120 seconds                                │
│  └── 3rd retry: wait 240 seconds, then fail                     │
│                                                                  │
│  On 5xx Error:                                                   │
│  ├── Retry up to 3 times with exponential backoff               │
│  └── Log and continue with next batch                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2.4 Service Layer

**Responsibility:** Application business logic.

```typescript
interface ItemService {
  // Get items with filtering and pagination
  getItems(filters: ItemFilters): Promise<PaginatedResult<Item>>;
  
  // Get single item
  getItemById(id: number): Promise<Item | null>;
  
  // Get item by hash name
  getItemByHashName(hashName: string): Promise<Item | null>;
  
  // Upsert items from parser
  upsertItems(items: ParsedItem[]): Promise<UpsertResult>;
  
  // Statistics
  getStats(): Promise<ParserStats>;
}
```

#### 3.2.5 Repository Layer

**Responsibility:** Data access, PostgreSQL interaction.

**Technology:** Drizzle ORM

---

### 3.3 Database Schema

The database uses a **simplified single-table design** with JSONB for storing prices from multiple providers. This approach is optimal for the primary use case: fetching all prices for a specific item in one query.

#### 3.3.1 `items` Table

Single table storing items with all provider prices in JSONB.

```sql
CREATE TABLE items (
    -- Primary Key
    id SERIAL PRIMARY KEY,
    
    -- Universal identifier (Steam market_hash_name as canonical key)
    market_hash_name VARCHAR(512) NOT NULL UNIQUE,
    
    -- English name
    name_en VARCHAR(512) NOT NULL,
    
    -- Item icon URL
    icon_url TEXT,
    
    -- Prices from all providers (JSONB)
    prices JSONB NOT NULL DEFAULT '{}',
    /*
    Example structure:
    {
      "steam-market": {
        "price": 490,               // price in cents
        "currency": "EUR",          // currency code (EUR, USD, RUB, etc.)
        "listings": 10,             // number of sell listings
        "updatedAt": "2025-12-14T10:25:00Z"
      },
      "csfloat": {
        "price": 450,
        "currency": "USD",
        "listings": 234,
        "updatedAt": "2025-12-14T10:22:00Z"
      },
      "skinport": {
        "price": 480,
        "currency": "EUR",
        "listings": 89,
        "updatedAt": "2025-12-14T10:20:00Z"
      }
    }
    */
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_items_market_hash_name ON items (market_hash_name);
CREATE INDEX idx_items_name_en ON items USING gin (name_en gin_trgm_ops);
CREATE INDEX idx_items_updated_at ON items (updated_at);

-- Optional: GIN index on prices for JSONB queries (if needed)
-- CREATE INDEX idx_items_prices ON items USING gin (prices);
```

#### 3.3.2 How Providers Update Prices

Each provider updates only its own key within the `prices` JSONB field:

```typescript
// Steam Market provider updates its prices
await db.execute(sql`
  UPDATE items 
  SET 
    prices = jsonb_set(
      COALESCE(prices, '{}'::jsonb),
      '{steam-market}',
      ${JSON.stringify({
        price: 1250,
        listings: 1847,
        updatedAt: new Date().toISOString()
      })}::jsonb
    ),
    updated_at = NOW()
  WHERE market_hash_name = ${marketHashName}
`);

// CSFloat provider updates its prices (doesn't touch steam-market data)
await db.execute(sql`
  UPDATE items 
  SET 
    prices = jsonb_set(
      COALESCE(prices, '{}'::jsonb),
      '{csfloat}',
      ${JSON.stringify({
        price: 1180,
        listings: 234,
        updatedAt: new Date().toISOString()
      })}::jsonb
    ),
    updated_at = NOW()
  WHERE market_hash_name = ${marketHashName}
`);
```

#### 3.3.3 Query Examples

**Get item with all prices (primary use case):**

```sql
SELECT * FROM items WHERE market_hash_name = 'AK-47 | Redline (Field-Tested)';
```

**Get items with search:**

```sql
SELECT * FROM items 
WHERE name_en ILIKE '%AK-47%'
ORDER BY updated_at DESC
LIMIT 50;
```

**Get lowest price across providers (computed in app layer):**

```typescript
const item = await db.query.items.findFirst({
  where: eq(items.marketHashName, hashName)
});

const prices = item.prices as Record<string, { price: number }>;
const lowestPrice = Object.entries(prices)
  .reduce((min, [provider, data]) => 
    data.price < min.price ? { provider, price: data.price } : min,
    { provider: '', price: Infinity }
  );
```

#### 3.3.4 `price_history` Table (Phase 2)

Optional table for price analytics, to be added when needed.

```sql
CREATE TABLE price_history (
    id BIGSERIAL PRIMARY KEY,
    
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    
    -- Which provider recorded this price
    provider VARCHAR(50) NOT NULL,
    
    price_usd_cents INTEGER NOT NULL,
    
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_price_history_item_provider_date 
    ON price_history (item_id, provider, recorded_at DESC);
```

#### 3.3.5 Database Schema Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         Database Schema (Simplified)                             │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                                   items                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│  id (PK)                                                                         │
│  market_hash_name (UNIQUE)     "AK-47 | Redline (Field-Tested)"                 │
│  name_en                       "AK-47 | Redline (Field-Tested)"                 │
│  icon_url                      "https://steamcdn-a.akamaihd.net/..."            │
│  prices (JSONB)                {                                                 │
│                                  "steam-market": { price: 1250, listings: 1847 },│
│                                  "csfloat": { price: 1180, listings: 234 },      │
│                                  "skinport": { price: 1220, listings: 89 }       │
│                                }                                                 │
│  created_at                                                                      │
│  updated_at                                                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ (Phase 2)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          price_history (Optional)                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│  id (PK) │ item_id (FK) │ provider │ price_usd_cents │ recorded_at              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 3.3.6 Why Single Table with JSONB?

| Benefit | Explanation |
|---------|-------------|
| **Simple queries** | One SELECT returns item + all prices |
| **No JOINs** | Primary use case (get item by name) is O(1) |
| **Flexible schema** | Add new providers without migrations |
| **Atomic updates** | Each provider updates only its key |
| **Less complexity** | One table instead of 3-4 |

This design is optimized for the use case: "Given an item, show me prices from all providers."

#### 3.3.3 `price_history` Table (Phase 2)

Price change history for analytics.

```sql
CREATE TABLE price_history (
    id BIGSERIAL PRIMARY KEY,
    
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    
    price_usd_cents INTEGER NOT NULL,
    
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Partitioning by month (for performance)
-- Index for fast lookups
CREATE INDEX idx_price_history_item_date ON price_history (item_id, recorded_at DESC);
```

---

### 3.4 Steam Market API

#### 3.4.1 Endpoints Used

**1. Search Render (primary)**

```
GET https://steamcommunity.com/market/search/render/

Query Parameters:
├── appid: 730                    # CS2 (formerly CS:GO)
├── norender: 1                   # Return JSON instead of HTML
├── start: 0                      # Pagination offset
├── count: 10                     # Items per request
├── sort_column: name             # Sort by name (alphabetical)
└── sort_dir: asc                 # Ascending order (A → Z)
```

> **Note:** We use `sort_column=name` and `sort_dir=asc` for consistent alphabetical ordering. 
> This ensures deterministic pagination without skipping or duplicating items between requests.
>
> **Currency:** Not specified as a parameter. Steam returns prices based on server IP geolocation.
> Currency symbol is extracted from `sell_price_text` field (e.g., "4,90€", "$12.50", "₽850").

**Example Response:**

```json
{
  "success": true,
  "start": 0,
  "pagesize": 100,
  "total_count": 15234,
  "searchdata": {
    "query": "",
    "search_descriptions": false,
    "total_count": 15234
  },
  "results": [
    {
      "name": "AK-47 | Redline (Field-Tested)",
      "hash_name": "AK-47 | Redline (Field-Tested)",
      "sell_listings": 1847,
      "sell_price": 1250,
      "sell_price_text": "$12.50",
      "app_icon": "https://...",
      "app_name": "Counter-Strike 2",
      "asset_description": {
        "appid": 730,
        "classid": "310777578",
        "instanceid": "302028390",
        "icon_url": "fWFc82js0fmoRAP-qOIPu5THSWqfSmTELLqcUywGkijVjZULUrsm1j-9xgEAaR4uURrwvz0N252yVaDVWrRTno9m4ccG2GNqxlQoZrC2aG9hcVGUWflbX_drrVu5UGki5sAij6tOtQ",
        "tradable": 1,
        "name": "AK-47 | Redline (Field-Tested)",
        "type": "Classified Rifle"
      }
    }
  ]
}
```

**2. Price Overview (for single item)**

```
GET https://steamcommunity.com/market/priceoverview/

Query Parameters:
├── appid: 730
├── currency: 1
└── market_hash_name: AK-47 | Redline (Field-Tested)
```

---

### 3.5 Parsing Algorithm

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Full Market Scan Algorithm                         │
└─────────────────────────────────────────────────────────────────────────────┘

START
  │
  ▼
┌─────────────────────────────────────────┐
│  1. Get total_count from Steam          │
│     GET /search/render?count=1          │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  2. Calculate number of batches         │
│     batches = ceil(total_count / 10)    │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  3. For each batch (0..batches):        │
│                                         │
│     a) GET /search/render               │
│        ?appid=730                       │
│        &start={batch * 10}              │
│        &count=10                        │
│        &sort_column=name                │
│        &sort_dir=asc                    │
│                                         │
│     b) Rate limit: wait 3 seconds       │
│                                         │
│     c) Parse response                   │
│                                         │
│     d) Upsert items to PostgreSQL       │
│                                         │
│     e) Update parser_state              │
│                                         │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  4. On 429 error:                       │
│     - Wait 60 seconds                   │
│     - Retry current batch               │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  5. Log results:                        │
│     - Items processed                   │
│     - Time elapsed                      │
│     - Errors count                      │
└─────────────────┬───────────────────────┘
                  │
                  ▼
                 END


Approximate full scan time:
─────────────────────────────
Total items:     ~15,000
Batch size:      10
Total batches:   1,500
Delay per batch: 3 sec
─────────────────────────────
Total time:      ~75 minutes

Note: With batch size of 10, full scan takes longer but is safer
for rate limiting. Consider running continuously in background.
```

---

### 3.6 REST API Specification

#### 3.6.1 `GET /health`

Health check endpoint.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2025-12-14T10:30:00Z",
  "version": "1.0.0",
  "database": "connected",
  "parser": {
    "status": "idle",
    "lastRun": "2025-12-14T10:25:00Z",
    "nextRun": "2025-12-14T10:30:00Z"
  }
}
```

#### 3.6.2 `GET /api/v1/items`

Get list of items with filtering.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number |
| `limit` | integer | 50 | Items per page (max: 100) |
| `search` | string | - | Search by name |
| `minPrice` | number | - | Minimum price (USD) |
| `maxPrice` | number | - | Maximum price (USD) |
| `sortBy` | string | "name" | Sort field: name, price, updatedAt |
| `order` | string | "asc" | Sort direction: asc, desc |

**Response:**

```json
{
  "data": [
    {
      "id": 1,
      "marketHashName": "AK-47 | Redline (Field-Tested)",
      "nameEn": "AK-47 | Redline (Field-Tested)",
      "iconUrl": "https://steamcdn-a.akamaihd.net/...",
      "prices": {
        "steam-market": {
          "priceUsd": 12.50,
          "sellListings": 1847,
          "updatedAt": "2025-12-14T10:25:00Z"
        }
      },
      "lowestPrice": {
        "provider": "steam-market",
        "priceUsd": 12.50
      },
      "updatedAt": "2025-12-14T10:25:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 15234,
    "totalPages": 305
  }
}
```

#### 3.6.3 `GET /api/v1/items/:id`

Get item by ID with prices from all providers.

**Response:**

```json
{
  "data": {
    "id": 1,
    "marketHashName": "AK-47 | Redline (Field-Tested)",
    "nameEn": "AK-47 | Redline (Field-Tested)",
    "iconUrl": "https://steamcdn-a.akamaihd.net/...",
    "prices": {
      "steam-market": {
        "priceUsd": 12.50,
        "sellListings": 1847,
        "updatedAt": "2025-12-14T10:25:00Z"
      },
      "csfloat": {
        "priceUsd": 11.80,
        "sellListings": 234,
        "updatedAt": "2025-12-14T10:22:00Z"
      }
    },
    "lowestPrice": {
      "provider": "csfloat",
      "priceUsd": 11.80
    },
    "createdAt": "2025-12-01T00:00:00Z",
    "updatedAt": "2025-12-14T10:25:00Z"
  }
}
```

#### 3.6.4 `GET /api/v1/items/by-hash/:hashName`

Get item by market_hash_name.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `hashName` | string (URL encoded) | Steam market_hash_name |

**Response:** Same as `/api/v1/items/:id`

#### 3.6.5 `GET /api/v1/providers`

List all registered providers.

**Response:**

```json
{
  "data": [
    {
      "name": "steam-market",
      "displayName": "Steam Community Market",
      "enabled": true,
      "status": "idle",
      "lastRunAt": "2025-12-14T10:25:00Z",
      "nextRunAt": "2025-12-14T10:30:00Z",
      "lastRunStats": {
        "itemsProcessed": 15234,
        "itemsUpdated": 1547,
        "duration": "8m 12s",
        "errors": 0
      }
    },
    {
      "name": "csfloat",
      "displayName": "CSFloat",
      "enabled": false,
      "status": "disabled",
      "lastRunAt": null,
      "nextRunAt": null
    }
  ]
}
```

#### 3.6.6 `GET /api/v1/providers/:name`

Get single provider details.

**Response:**

```json
{
  "data": {
    "name": "steam-market",
    "displayName": "Steam Community Market",
    "enabled": true,
    "status": "idle",
    "config": {
      "rateLimit": 20,
      "requestDelay": 3000,
      "batchSize": 100,
      "intervalMinutes": 5
    },
    "lastRunAt": "2025-12-14T10:25:00Z",
    "nextRunAt": "2025-12-14T10:30:00Z",
    "lastRunStats": {
      "startedAt": "2025-12-14T10:17:00Z",
      "completedAt": "2025-12-14T10:25:00Z",
      "itemsProcessed": 15234,
      "itemsUpdated": 1547,
      "errors": 0
    },
    "health": {
      "healthy": true,
      "latencyMs": 245,
      "lastSuccessAt": "2025-12-14T10:25:00Z"
    }
  }
}
```

#### 3.6.7 `POST /api/v1/providers/:name/run`

Trigger manual scan for a provider.

**Response:**

```json
{
  "message": "Scan started",
  "provider": "steam-market",
  "startedAt": "2025-12-14T10:30:00Z"
}
```

#### 3.6.8 `GET /api/v1/stats`

Overall system statistics.

**Response:**

```json
{
  "totalItems": 15234,
  "providers": {
    "total": 3,
    "enabled": 1,
    "healthy": 1
  },
  "lastUpdates": {
    "steam-market": "2025-12-14T10:25:00Z",
    "csfloat": null,
    "skinport": null
  },
  "database": {
    "itemsCount": 15234,
    "pricesCount": 15234,
    "oldestUpdate": "2025-12-14T10:20:00Z",
    "newestUpdate": "2025-12-14T10:28:00Z"
  }
}
```

---

### 3.7 Error Handling

#### 3.7.1 API Error Response Format

```json
{
  "error": {
    "code": "ITEM_NOT_FOUND",
    "message": "Item with id 99999 not found",
    "details": null
  },
  "timestamp": "2025-12-14T10:30:00Z"
}
```

#### 3.7.2 Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid request parameters |
| 404 | `ITEM_NOT_FOUND` | Item not found |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Internal server error |
| 503 | `SERVICE_UNAVAILABLE` | Service temporarily unavailable |

---

## 4. Project Structure

```
steam-items-pulse/
│
├── docs/
│   └── steam-market-pulse.md             # This document
│
├── src/
│   ├── index.ts                          # Entry point
│   │
│   ├── api/
│   │   ├── index.ts                      # API router setup
│   │   ├── middleware/
│   │   │   ├── error-handler.ts          # Global error handler
│   │   │   ├── logger.ts                 # Request logging
│   │   │   └── rate-limiter.ts           # API rate limiting
│   │   └── routes/
│   │       ├── health.ts                 # Health check routes
│   │       ├── items.ts                  # Items CRUD routes
│   │       ├── providers.ts              # Provider management routes
│   │       └── stats.ts                  # Stats routes
│   │
│   ├── config/
│   │   ├── index.ts                      # Config aggregator
│   │   ├── database.ts                   # DB config
│   │   ├── providers.ts                  # Provider configs
│   │   └── server.ts                     # Server config
│   │
│   ├── db/
│   │   ├── index.ts                      # DB client export
│   │   ├── client.ts                     # Drizzle client setup
│   │   ├── schema.ts                     # Table definitions
│   │   └── migrations/                   # SQL migrations
│   │       └── 0001_initial.sql
│   │
│   ├── providers/                        # Data source providers
│   │   ├── index.ts                      # Provider exports
│   │   ├── provider.interface.ts         # IProvider interface
│   │   ├── provider.manager.ts           # ProviderManager class
│   │   ├── base.provider.ts              # Abstract base provider
│   │   │
│   │   ├── steam-market/                 # Steam Market provider
│   │   │   ├── index.ts
│   │   │   ├── steam-market.provider.ts
│   │   │   ├── steam-market.client.ts    # HTTP client for Steam
│   │   │   └── steam-market.types.ts     # Steam API types
│   │   │
│   │   ├── csfloat/                      # CSFloat provider (future)
│   │   │   ├── index.ts
│   │   │   ├── csfloat.provider.ts
│   │   │   ├── csfloat.client.ts
│   │   │   └── csfloat.types.ts
│   │   │
│   │   └── skinport/                     # Skinport provider (future)
│   │       ├── index.ts
│   │       ├── skinport.provider.ts
│   │       ├── skinport.client.ts
│   │       └── skinport.types.ts
│   │
│   ├── repositories/
│   │   ├── index.ts                      # Repository exports
│   │   └── item.repository.ts            # Item data access (includes prices)
│   │
│   ├── services/
│   │   ├── index.ts                      # Service exports
│   │   ├── item.service.ts               # Item business logic
│   │   └── provider.service.ts           # Provider orchestration
│   │
│   ├── workers/
│   │   ├── index.ts                      # Worker exports
│   │   └── scheduler.ts                  # Cron jobs setup
│   │
│   ├── types/
│   │   ├── index.ts                      # Type exports
│   │   ├── provider.ts                   # Provider types
│   │   ├── database.ts                   # DB entity types
│   │   └── api.ts                        # API request/response types
│   │
│   └── utils/
│       ├── logger.ts                     # Logging utility
│       ├── rate-limiter.ts               # Rate limiting utility
│       └── sleep.ts                      # Async sleep helper
│
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   └── providers/
│   └── integration/
│       └── api/
│
├── .env.example                          # Environment variables template
├── .gitignore
├── docker-compose.yml                    # Docker Compose config
├── Dockerfile                            # Docker image
├── drizzle.config.ts                     # Drizzle ORM config
├── package.json
├── tsconfig.json
└── README.md
```

---

## 5. Configuration

### 5.1 Environment Variables

```bash
# Server
PORT=8000
HOST=0.0.0.0
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/steam_market

# Provider: Steam Market
STEAM_MARKET_ENABLED=true
STEAM_MARKET_INTERVAL_MINUTES=5
STEAM_MARKET_BATCH_SIZE=10
STEAM_MARKET_DELAY_MS=3000
STEAM_MARKET_MAX_RETRIES=3

# Provider: CSFloat (future)
CSFLOAT_ENABLED=false
CSFLOAT_API_KEY=
CSFLOAT_INTERVAL_MINUTES=10
CSFLOAT_BATCH_SIZE=50
CSFLOAT_DELAY_MS=1000

# Provider: Skinport (future)
SKINPORT_ENABLED=false
SKINPORT_API_KEY=
SKINPORT_INTERVAL_MINUTES=10

# Rate Limiting (API)
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

### 5.2 Docker Compose

```yaml
version: '3.8'

services:
  app:
    build: .
    container_name: steam-items-pulse
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://steam:steam@db:5432/steam_market
      - PARSER_ENABLED=true
      - PARSER_INTERVAL_MINUTES=5
      - NODE_ENV=production
    depends_on:
      db:
        condition: service_healthy
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: postgres:16-alpine
    container_name: steam-items-pulse-db
    environment:
      - POSTGRES_USER=steam
      - POSTGRES_PASSWORD=steam
      - POSTGRES_DB=steam_market
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U steam -d steam_market"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

---

## 6. Deployment & Operations

### 6.1 Server Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 512 MB | 1 GB |
| Disk | 5 GB | 10 GB |
| Network | 10 Mbps | 100 Mbps |

### 6.2 Monitoring

**Metrics to Track:**

- `parser_items_total` — total items in DB
- `parser_last_scan_duration_seconds` — last scan duration
- `parser_last_scan_items_updated` — items updated per scan
- `parser_errors_total` — error count
- `api_requests_total` — API request count
- `api_request_duration_seconds` — API response time

**Alerts:**

- Parser hasn't run for > 30 minutes
- Error count > 10 per hour
- API response time > 1 second
- Database connection errors

### 6.3 Backups

```bash
# Daily PostgreSQL backup
0 3 * * * pg_dump -U steam steam_market | gzip > /backups/steam_market_$(date +\%Y\%m\%d).sql.gz

# Keep 7 days
find /backups -name "steam_market_*.sql.gz" -mtime +7 -delete
```

---

## 7. Security

### 7.1 Security Measures

1. **No authentication by default** — service intended for internal use
2. **API rate limiting** — DDoS protection
3. **Input validation** — Zod schemas
4. **SQL injection** — prevented by ORM (Drizzle)
5. **No secrets in code** — use env variables

### 7.2 Optional Authentication

If public access is needed, add:

```typescript
// API Key authentication
const API_KEY = process.env.API_KEY;

app.use('/api/*', async (c, next) => {
  const key = c.req.header('X-API-Key');
  if (key !== API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});
```

---

## 8. Testing

### 8.1 Unit Tests

```typescript
// tests/unit/services/item.service.test.ts
describe('ItemService', () => {
  describe('getItems', () => {
    it('should return paginated items', async () => { ... });
    it('should filter by price range', async () => { ... });
    it('should search by name', async () => { ... });
  });
});
```

### 8.2 Integration Tests

```typescript
// tests/integration/api/items.test.ts
describe('GET /api/v1/items', () => {
  it('should return 200 with items list', async () => { ... });
  it('should paginate correctly', async () => { ... });
  it('should return 400 for invalid params', async () => { ... });
});
```

### 8.3 E2E Tests

```typescript
// tests/e2e/parser.test.ts
describe('Parser E2E', () => {
  it('should fetch and store items from Steam', async () => { ... });
  it('should handle rate limiting', async () => { ... });
});
```

---

## 9. Implementation Plan

### Phase 1: Foundation (3-4 days)

- [ ] Project initialization (package.json, tsconfig)
- [ ] Docker and docker-compose setup
- [ ] DB schema and migrations (Drizzle)
- [ ] Basic folder structure
- [ ] Configuration (env variables)

### Phase 2: Parser (2-3 days)

- [ ] Steam HTTP client with rate limiting
- [ ] Parsing algorithm
- [ ] Upsert logic for DB
- [ ] Scheduler (node-cron)
- [ ] Logging and error handling

### Phase 3: API (2 days)

- [ ] REST API endpoints
- [ ] Request validation (Zod)
- [ ] Pagination and filtering
- [ ] Error handling middleware
- [ ] OpenAPI documentation

### Phase 4: Quality (1-2 days)

- [ ] Unit tests
- [ ] Integration tests
- [ ] CI/CD pipeline
- [ ] README documentation

### Phase 5: Production (1 day)

- [ ] Production Dockerfile
- [ ] Health checks
- [ ] Monitoring (optional)
- [ ] Deployment

---

## 10. Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Steam blocks IP | Medium | High | Rate limiting, proxy, backoff |
| Steam changes API | Low | High | Monitoring, alerts, fallback |
| High DB load | Low | Medium | Indexes, connection pooling |
| Data staleness | Low | Medium | Reduce parsing interval |

---

## 11. Future Improvements

### Phase 2 Features

- [ ] Enable CSFloat provider
- [ ] Enable Skinport provider
- [ ] Price history tracking (price_history table)
- [ ] Price comparison across providers
- [ ] WebSocket for real-time updates
- [ ] Support for other games (Dota 2, TF2)
- [ ] GraphQL API
- [ ] Redis caching
- [ ] Prometheus metrics

### Provider Roadmap

| Provider | Status | Priority | Notes |
|----------|--------|----------|-------|
| Steam Market | ✅ Phase 1 | High | Primary data source |
| CSFloat | 📋 Phase 2 | High | Better prices, float values |
| Skinport | 📋 Phase 2 | Medium | Alternative marketplace |
| Buff163 | 📋 Phase 3 | Medium | Chinese market prices |
| DMarket | 📋 Phase 3 | Low | Additional source |

---

## 12. References

- [Steam Community Market](https://steamcommunity.com/market/)
- [Hono Framework](https://hono.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Zod Validation](https://zod.dev/)

---

## Appendix A: Steam Market API Examples

### A.1 Curl Examples

```bash
# Get first 10 CS2 items (sorted by name A→Z)
curl "https://steamcommunity.com/market/search/render/?appid=730&norender=1&start=0&count=10&sort_column=name&sort_dir=asc"

# Get specific item price
curl "https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=AK-47%20%7C%20Redline%20(Field-Tested)"
```

### A.2 Response Samples

See section 3.4.1

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **market_hash_name** | Unique item identifier in Steam Market |
| **appid** | Application ID in Steam (730 = CS2) |
| **Rate Limiting** | Request frequency limiting to prevent blocking |
| **Upsert** | INSERT or UPDATE if record exists |
| **Batch** | Group of elements for processing at once |
| **Provider** | Data source implementation (Steam Market, CSFloat, etc.) |
| **Strategy Pattern** | Design pattern allowing interchangeable algorithms/implementations |
