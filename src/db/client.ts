import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db');

// Create postgres connection
const queryClient = postgres(config.DATABASE_URL, {
  max: 10,
  onnotice: () => {}, // Suppress notices
});

// Create drizzle instance
export const db = drizzle(queryClient, { schema });

// Health check function
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`;
    logger.info('Database connection established');
    return true;
  } catch (error) {
    logger.error({ error }, 'Database connection failed');
    return false;
  }
}

// Graceful shutdown
export async function closeDatabaseConnection(): Promise<void> {
  await queryClient.end();
  logger.info('Database connection closed');
}

