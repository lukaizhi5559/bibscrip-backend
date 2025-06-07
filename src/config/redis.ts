import { logger } from '../utils/logger';

// Cache TTL constants (in seconds)
export const TTL = {
  AI_RESPONSE: {
    DEFAULT: 60 * 60 * 24 * 7, // 7 days for regular questions
    TRENDING: 60 * 60 * 24 * 2, // 2 days for trending topics (refreshed more frequently)
    THEOLOGICAL: 60 * 60 * 24 * 30, // 30 days for fundamental theological questions
  },
  BIBLE_VERSE: 60 * 60 * 24 * 30, // 30 days for Bible verses (rarely change)
  EMBEDDING: 60 * 60 * 24 * 90, // 90 days for embeddings
};

// Redis key prefixes for organization
export const REDIS_PREFIX = {
  AI_RESPONSE: 'ai:response:',
  BIBLE_VERSE: 'bible:verse:',
  SEMANTIC_CACHE: 'semantic:',
  RATE_LIMIT: 'rate:',
  EMBEDDING: 'embedding:',
  QUEUE: 'queue:',
  USER_QUOTA: 'quota:user:',
  IP_QUOTA: 'quota:ip:',
};

// Import Redis - since we have type issues, use a simpler approach
const redis = require('redis');

// Initialize Redis client with retry strategy
const redisClient = redis.createClient({
  // Use separate host and port if available, otherwise fall back to URL
  ...(process.env.REDIS_HOST ? {
    socket: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379', 10)
    }
  } : {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  }),
  socket: {
    reconnectStrategy: (retries: number) => {
      // Exponential backoff with max delay of 10 seconds
      const delay = Math.min(Math.pow(2, retries) * 100, 10000);
      logger.info(`Redis reconnecting in ${delay}ms...`, { retries });
      return delay;
    },
  },
});

// Error handler
redisClient.on('error', (err: Error) => {
  logger.error('Redis client error', { error: err.message, stack: err.stack });
});

// Connection events
redisClient.on('connect', () => {
  logger.info('Redis client connected');
});

redisClient.on('reconnecting', () => {
  logger.warn('Redis client reconnecting');
});

// Initialize connection
let connectionPromise: Promise<any> | null = null;

/**
 * Get Redis client with automatic connection
 */
export const getRedisClient = async () => {
  if (!redisClient.isOpen) {
    if (!connectionPromise) {
      connectionPromise = redisClient.connect().catch((err: Error) => {
        connectionPromise = null;
        throw err;
      });
    }
    await connectionPromise;
  }
  return redisClient;
};

export default redisClient;
