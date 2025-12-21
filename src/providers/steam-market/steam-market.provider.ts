import type {
  IProvider,
  ProviderConfig,
  ProviderItem,
  FetchOptions,
  ScanResult,
  ProviderHealth,
} from '../provider.interface.js';
import type { SteamMarketSearchResponse } from './steam-market.types.js';
import { steamMarketConfig } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { sleep } from '../../utils/sleep.js';
import { db, items, type ProviderPrice } from '../../db/index.js';
import { eq, sql } from 'drizzle-orm';

const logger = createLogger('steam-market-provider');

export class SteamMarketProvider implements IProvider {
  readonly name = 'steam-market';
  readonly displayName = 'Steam Community Market';
  readonly enabled: boolean;
  readonly config: ProviderConfig;

  private lastHealthCheck: ProviderHealth | null = null;

  constructor() {
    this.enabled = steamMarketConfig.enabled;
    this.config = {
      rateLimit: 20,
      requestDelay: steamMarketConfig.delayMs,
      batchSize: steamMarketConfig.batchSize,
      maxRetries: steamMarketConfig.maxRetries,
      retryDelay: steamMarketConfig.retryDelayMs,
      baseUrl: steamMarketConfig.baseUrl,
    };
  }

  /**
   * Fetch items from Steam Market
   */
  async fetchItems(options: FetchOptions): Promise<ProviderItem[]> {
    const url = new URL(`${this.config.baseUrl}/search/render/`);
    url.searchParams.set('appid', '730');
    url.searchParams.set('norender', '1');
    url.searchParams.set('start', String(options.offset));
    url.searchParams.set('count', String(options.limit));
    url.searchParams.set('sort_column', 'name');
    url.searchParams.set('sort_dir', 'asc');

    const response = await this.fetchWithRetry(url.toString());
    
    return response.results.map((item) => ({
      externalId: item.hash_name,
      priceCents: item.sell_price,
      currency: this.extractCurrency(item.sell_price_text),
      listings: item.sell_listings,
      iconUrl: this.buildIconUrl(item.asset_description?.icon_url),
      source: this.name,
    }));
  }

  /**
   * Get total count of items
   */
  async getTotalCount(): Promise<number> {
    const url = new URL(`${this.config.baseUrl}/search/render/`);
    url.searchParams.set('appid', '730');
    url.searchParams.set('norender', '1');
    url.searchParams.set('start', '0');
    url.searchParams.set('count', '1');

    const response = await this.fetchWithRetry(url.toString());
    return response.total_count;
  }

  /**
   * Perform full market scan
   */
  async performFullScan(): Promise<ScanResult> {
    const startedAt = new Date();
    let itemsProcessed = 0;
    let itemsUpdated = 0;
    let errors = 0;
    const errorMessages: string[] = [];

    logger.info('Starting full market scan');

    try {
      const totalCount = await this.getTotalCount();
      const totalBatches = Math.ceil(totalCount / this.config.batchSize);

      logger.info({ totalCount, totalBatches }, 'Market scan parameters');

      for (let batch = 0; batch < totalBatches; batch++) {
        const offset = batch * this.config.batchSize;

        try {
          const items = await this.fetchItems({
            offset,
            limit: this.config.batchSize,
          });

          // Upsert items to database
          const updated = await this.upsertItems(items);
          itemsUpdated += updated;
          itemsProcessed += items.length;

          logger.debug(
            { batch: batch + 1, totalBatches, itemsProcessed },
            'Batch processed'
          );

          // Rate limiting delay
          if (batch < totalBatches - 1) {
            await sleep(this.config.requestDelay);
          }
        } catch (error) {
          errors++;
          const message = error instanceof Error ? error.message : String(error);
          errorMessages.push(`Batch ${batch}: ${message}`);
          logger.error({ batch, error: message }, 'Batch failed');
          
          // Continue with next batch
          await sleep(this.config.requestDelay * 2);
        }
      }
    } catch (error) {
      errors++;
      const message = error instanceof Error ? error.message : String(error);
      errorMessages.push(message);
      logger.error({ error: message }, 'Full scan failed');
    }

    const completedAt = new Date();
    const duration = (completedAt.getTime() - startedAt.getTime()) / 1000;

    logger.info(
      { itemsProcessed, itemsUpdated, errors, durationSeconds: duration },
      'Full scan completed'
    );

    return {
      provider: this.name,
      startedAt,
      completedAt,
      itemsProcessed,
      itemsUpdated,
      errors,
      errorMessages,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();

    try {
      await this.getTotalCount();
      const latencyMs = Date.now() - start;

      this.lastHealthCheck = {
        healthy: true,
        latencyMs,
        lastSuccessAt: new Date(),
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      
      this.lastHealthCheck = {
        healthy: false,
        latencyMs,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }

    return this.lastHealthCheck;
  }

  /**
   * Fetch with retry logic
   */
  private async fetchWithRetry(
    url: string,
    attempt = 1
  ): Promise<SteamMarketSearchResponse> {
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (response.status === 429) {
        if (attempt <= this.config.maxRetries) {
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
          logger.warn({ attempt, delayMs: delay }, 'Rate limited, waiting...');
          await sleep(delay);
          return this.fetchWithRetry(url, attempt + 1);
        }
        throw new Error('Rate limit exceeded after max retries');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as SteamMarketSearchResponse;

      if (!data.success) {
        throw new Error('Steam API returned success: false');
      }

      return data;
    } catch (error) {
      if (attempt <= this.config.maxRetries && !(error instanceof Error && error.message.includes('Rate limit'))) {
        const delay = this.config.requestDelay * Math.pow(2, attempt - 1);
        logger.warn({ attempt, error: String(error) }, 'Request failed, retrying...');
        await sleep(delay);
        return this.fetchWithRetry(url, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Upsert items to database
   */
  private async upsertItems(providerItems: ProviderItem[]): Promise<number> {
    let updated = 0;

    for (const item of providerItems) {
      const priceData: ProviderPrice = {
        price: item.priceCents,
        currency: item.currency,
        listings: item.listings,
        updatedAt: new Date().toISOString(),
      };

      // Check if item exists
      const existing = await db
        .select({ id: items.id })
        .from(items)
        .where(eq(items.marketHashName, item.externalId))
        .limit(1);

      if (existing.length > 0) {
        // Update existing item
        await db
          .update(items)
          .set({
            prices: sql`jsonb_set(COALESCE(prices, '{}'::jsonb), '{steam-market}', ${JSON.stringify(priceData)}::jsonb)`,
            iconUrl: item.iconUrl,
            updatedAt: new Date(),
          })
          .where(eq(items.marketHashName, item.externalId));
      } else {
        // Insert new item
        await db.insert(items).values({
          marketHashName: item.externalId,
          iconUrl: item.iconUrl,
          prices: { [this.name]: priceData },
        });
      }

      updated++;
    }

    return updated;
  }

  /**
   * Extract currency from price text
   */
  private extractCurrency(priceText: string): string {
    if (priceText.includes('€')) return 'EUR';
    if (priceText.includes('$')) return 'USD';
    if (priceText.includes('₽')) return 'RUB';
    if (priceText.includes('£')) return 'GBP';
    if (priceText.includes('¥')) return 'CNY';
    if (priceText.includes('₴')) return 'UAH';
    if (priceText.includes('zł')) return 'PLN';
    return 'USD'; // fallback
  }

  /**
   * Build full icon URL from Steam's relative path
   */
  private buildIconUrl(iconPath: string | undefined): string | null {
    if (!iconPath) return null;
    return `${steamMarketConfig.cdnBaseUrl}${iconPath}`;
  }
}

