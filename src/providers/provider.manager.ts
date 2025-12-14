import type { IProvider, ScanResult, ProviderHealth } from './provider.interface.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('provider-manager');

/**
 * Manages multiple providers and orchestrates data collection
 */
export class ProviderManager {
  private providers: Map<string, IProvider> = new Map();

  /**
   * Register a new provider
   */
  register(provider: IProvider): void {
    this.providers.set(provider.name, provider);
    logger.info(
      { provider: provider.name, enabled: provider.enabled },
      'Provider registered'
    );
  }

  /**
   * Get provider by name
   */
  get(name: string): IProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all registered providers
   */
  getAll(): IProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all enabled providers
   */
  getEnabled(): IProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.enabled);
  }

  /**
   * Run scan for specific provider
   */
  async runProvider(name: string): Promise<ScanResult> {
    const provider = this.get(name);
    if (!provider) {
      throw new Error(`Provider ${name} not found`);
    }
    if (!provider.enabled) {
      throw new Error(`Provider ${name} is disabled`);
    }
    return provider.performFullScan();
  }

  /**
   * Run scan for all enabled providers
   */
  async runAll(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    for (const provider of this.getEnabled()) {
      logger.info({ provider: provider.name }, 'Starting provider scan');

      try {
        const result = await provider.performFullScan();
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ provider: provider.name, error: message }, 'Provider scan failed');

        results.push({
          provider: provider.name,
          startedAt: new Date(),
          completedAt: new Date(),
          itemsProcessed: 0,
          itemsUpdated: 0,
          errors: 1,
          errorMessages: [message],
        });
      }
    }

    return results;
  }

  /**
   * Health check all providers
   */
  async healthCheckAll(): Promise<Map<string, ProviderHealth>> {
    const results = new Map<string, ProviderHealth>();

    for (const [name, provider] of this.providers) {
      try {
        results.set(name, await provider.healthCheck());
      } catch (error) {
        results.set(name, {
          healthy: false,
          latencyMs: 0,
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }
}

// Singleton instance
export const providerManager = new ProviderManager();

