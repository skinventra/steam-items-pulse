import cron from 'node-cron';
import { providerManager } from '../providers/index.js';
import { steamMarketConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('scheduler');

let scheduledTask: cron.ScheduledTask | null = null;

/**
 * Start the scheduler for background parsing
 */
export function startScheduler(): void {
  if (!steamMarketConfig.enabled) {
    logger.info('Steam Market provider is disabled, scheduler not started');
    return;
  }

  const intervalMinutes = steamMarketConfig.intervalMinutes;
  let cronExpression: string;

  if (intervalMinutes < 60) {
    // For intervals less than 1 hour, use minutes
    cronExpression = `*/${intervalMinutes} * * * *`;
  } else if (intervalMinutes % 60 === 0) {
    // For intervals that are exact hours, use hour syntax
    const intervalHours = intervalMinutes / 60;
    cronExpression = `0 */${intervalHours} * * *`;
  } else {
    // For other intervals, use minutes but ensure they work correctly
    cronExpression = `0 0 * * *`; // Default to daily
    logger.warn(
      { intervalMinutes },
      'Interval minutes is not a multiple of 60, defaulting to daily execution'
    );
  }

  logger.info({ cronExpression, intervalMinutes }, 'Starting scheduler');

  scheduledTask = cron.schedule(cronExpression, async () => {
    logger.info('Scheduled scan triggered');

    try {
      const results = await providerManager.runAll();

      for (const result of results) {
        logger.info(
          {
            provider: result.provider,
            itemsProcessed: result.itemsProcessed,
            itemsUpdated: result.itemsUpdated,
            errors: result.errors,
            durationMs: result.completedAt.getTime() - result.startedAt.getTime(),
          },
          'Provider scan completed'
        );
      }
    } catch (error) {
      logger.error({ error: String(error) }, 'Scheduled scan failed');
    }
  });

  logger.info('Scheduler started');
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('Scheduler stopped');
  }
}

/**
 * Run initial scan on startup
 */
export async function runInitialScan(): Promise<void> {
  if (!steamMarketConfig.enabled) {
    logger.info('Steam Market provider is disabled, skipping initial scan');
    return;
  }

  logger.info('Running initial scan...');

  try {
    const results = await providerManager.runAll();

    for (const result of results) {
      logger.info(
        {
          provider: result.provider,
          itemsProcessed: result.itemsProcessed,
          errors: result.errors,
        },
        'Initial scan completed'
      );
    }
  } catch (error) {
    logger.error({ error: String(error) }, 'Initial scan failed');
  }
}



