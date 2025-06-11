// Analytics service for tracking events across the BibScrip backend
// In production, this would be connected to a proper analytics service
import { logger } from './logger';

/**
 * Detailed analytics service for tracking various system events
 */
class AnalyticsService {
  // Track AI requests
  trackAIRequest(data: {
    provider: string;
    fromCache: boolean;
    tokenUsage?: {
      prompt?: number;
      completion?: number;
      total?: number;
    };
    latencyMs: number;
    status: string;
    query: string;
    cacheKey?: string;
    cacheAge?: number;
    errorType?: string;
    complexity?: 'simple' | 'moderate' | 'complex';
  }): void {
    logger.info(`AI Request: ${data.provider} (${data.fromCache ? 'cached' : 'live'}) - ${data.status}`, {
      category: 'ai_request',
      ...data
    });
    // In a real implementation, send this data to your analytics service
  }

  // Track cache operations
  trackCacheOperation(data: {
    operation: 'hit' | 'miss' | 'set' | 'delete';
    key: string;
    ttl?: number;
    size?: number;
    category?: string;
  }): void {
    logger.debug(`Cache ${data.operation}: ${data.key}`, {
      category: 'cache_operation',
      ...data
    });
    // In a real implementation, send this data to your analytics service
  }

  // Track rate limit events
  trackRateLimit(data: {
    ip: string;
    endpoint: string;
    resetMs: number;
    userId?: string;
    quotaType?: string;
  }): void {
    logger.warn(`Rate limit: ${data.endpoint} from ${data.ip}`, {
      category: 'rate_limit',
      ...data
    });
    // In a real implementation, send this data to your analytics service
  }

  // Track embedding operations
  trackEmbeddingRequest(data: {
    status: 'success' | 'error';
    model: string;
    tokens?: number;
    latencyMs: number;
    count?: number;
    errorType?: string;
    namespace?: string;
  }): void {
    logger.info(`Embedding Request: ${data.model} - ${data.status}${data.count ? ` (batch: ${data.count})` : ''}`, {
      category: 'embedding_request',
      ...data
    });
    // In a real implementation, send this data to your analytics service
  }

  // Track RAG operations
  trackRagOperation(data: {
    operation: 'retrieve' | 'augment' | 'generate' | 'store';
    status: 'success' | 'error';
    namespace?: string;
    documentCount?: number;
    sourceType?: string; // Bible, commentary, QA
    latencyMs: number;
    errorType?: string;
  }): void {
    logger.info(`RAG ${data.operation}: ${data.status}${data.documentCount ? ` (${data.documentCount} docs)` : ''}`, {
      category: 'rag_operation',
      ...data
    });
    // In a real implementation, send this data to your analytics service
  }
  
  // Track quota check operations
  trackQuotaCheck(params: {
    ip: string;
    userId?: string;
    complexity: string;
    allowed: boolean;
    remaining: number;
    tier: string;
  }): void {
    logger.info('Quota check tracked', {
      category: 'quota_check',
      ...params
    });
    // In a real implementation, send this data to your analytics service
  }
}

export const analytics = new AnalyticsService();
