/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** Requests per minute limit */
  rateLimit: number;
  
  /** Delay between requests in ms */
  requestDelay: number;
  
  /** Items per request batch */
  batchSize: number;
  
  /** Max retry attempts */
  maxRetries: number;
  
  /** Delay on retry for failed requests in ms */
  retryDelay: number;
  
  /** Base URL for API */
  baseUrl: string;
  
  /** Optional API key */
  apiKey?: string;
}

/**
 * Normalized item data from provider
 */
export interface ProviderItem {
  /** Unique identifier (market_hash_name) */
  externalId: string;
  
  /** Price in cents */
  priceCents: number;
  
  /** Currency code (EUR, USD, RUB, etc.) */
  currency: string;
  
  /** Number of listings */
  listings: number;
  
  /** Icon URL (full URL) */
  iconUrl: string | null;
  
  /** Source provider name */
  source: string;
}

/**
 * Fetch options for pagination
 */
export interface FetchOptions {
  offset: number;
  limit: number;
}

/**
 * Result of a full scan
 */
export interface ScanResult {
  provider: string;
  startedAt: Date;
  completedAt: Date;
  itemsProcessed: number;
  itemsUpdated: number;
  errors: number;
  errorMessages: string[];
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  healthy: boolean;
  latencyMs: number;
  lastError?: string;
  lastSuccessAt?: Date;
}

/**
 * Common interface for all data providers
 */
export interface IProvider {
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
   */
  fetchItems(options: FetchOptions): Promise<ProviderItem[]>;
  
  /**
   * Get total count of available items
   */
  getTotalCount(): Promise<number>;
  
  /**
   * Perform full scan of all items
   */
  performFullScan(): Promise<ScanResult>;
  
  /**
   * Check if provider is healthy and accessible
   */
  healthCheck(): Promise<ProviderHealth>;
}

