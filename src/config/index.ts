import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string(),

  // Steam Market Provider
  STEAM_MARKET_ENABLED: z.coerce.boolean().default(true),
  STEAM_MARKET_INTERVAL_MINUTES: z.coerce.number().default(5),
  STEAM_MARKET_BATCH_SIZE: z.coerce.number().default(10),
  STEAM_MARKET_DELAY_MS: z.coerce.number().default(3000),
  STEAM_MARKET_MAX_RETRIES: z.coerce.number().default(3),
  STEAM_MARKET_RETRY_DELAY_MS: z.coerce.number().default(60000),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

export const serverConfig = {
  port: config.PORT,
  host: config.HOST,
  isDev: config.NODE_ENV === 'development',
  isProd: config.NODE_ENV === 'production',
};

export const steamMarketConfig = {
  enabled: config.STEAM_MARKET_ENABLED,
  intervalMinutes: config.STEAM_MARKET_INTERVAL_MINUTES,
  batchSize: config.STEAM_MARKET_BATCH_SIZE,
  delayMs: config.STEAM_MARKET_DELAY_MS,
  maxRetries: config.STEAM_MARKET_MAX_RETRIES,
  retryDelayMs: config.STEAM_MARKET_RETRY_DELAY_MS,
  baseUrl: 'https://steamcommunity.com/market',
  cdnBaseUrl: 'https://steamcommunity-a.akamaihd.net/economy/image/',
};

