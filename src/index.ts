import { serve } from '@hono/node-server';
import { createApp } from './api/index.js';
import { checkDatabaseConnection, closeDatabaseConnection } from './db/index.js';
import { providerManager, SteamMarketProvider } from './providers/index.js';
import { startScheduler, stopScheduler, runInitialScan } from './workers/scheduler.js';
import { serverConfig } from './config/index.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('main');

async function main() {
  logger.info('Starting Steam Market Pulse...');

  // Check database connection
  const dbConnected = await checkDatabaseConnection();
  if (!dbConnected) {
    logger.error('Failed to connect to database, exiting');
    process.exit(1);
  }

  // Register providers
  providerManager.register(new SteamMarketProvider());
  logger.info({ providers: providerManager.getAll().map((p) => p.name) }, 'Providers registered');

  // Create and start HTTP server
  const app = createApp();

  const server = serve({
    fetch: app.fetch,
    port: serverConfig.port,
    hostname: serverConfig.host,
  }, (info) => {
    logger.info({ host: serverConfig.host, port: info.port }, 'HTTP server started');
  });

  // Start scheduler
  startScheduler();

  // Run initial scan (optional, can be enabled/disabled)
  if (process.env.RUN_INITIAL_SCAN === 'true') {
    runInitialScan().catch((error) => {
      logger.error({ error: String(error) }, 'Initial scan failed');
    });
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');

    stopScheduler();
    server.close();
    await closeDatabaseConnection();

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

