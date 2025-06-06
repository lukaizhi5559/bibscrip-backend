import { cacheManager } from './cache-manager';

// Rate limiting configuration per provider
const PROVIDER_RATE_LIMITS: Record<string, { requestsPerMinute: number; requestsPerDay: number }> = {
  openai: { requestsPerMinute: 20, requestsPerDay: 200 },
  anthropic: { requestsPerMinute: 15, requestsPerDay: 150 },
  default: { requestsPerMinute: 10, requestsPerDay: 100 }
};

// Track requests per provider
const providerRequestCounts: Record<string, { minuteRequests: number[]; dayRequests: number[] }> = {};

export interface AIErrorResponse {
  error: string;
  details?: string;
}

interface RequestOptions {
  cacheKey: string;
  forceRefresh?: boolean;
  cacheTTL?: number;
  provider?: string;
  onCacheHit?: () => void;
  onCacheMiss?: () => void;
}

interface RequestResult<T> {
  data: T;
  fromCache: boolean;
  cacheAge?: number;
  provider?: string;
  tokenUsage?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  latencyMs: number;
}

/**
 * Makes a request with caching and rate limiting
 * @param requestFn Function that performs the actual request
 * @param options Request options including cache settings
 */
export async function makeRequest<T>(
  requestFn: () => Promise<T>,
  options: RequestOptions
): Promise<RequestResult<T>> {
  const {
    cacheKey,
    forceRefresh = false,
    cacheTTL = 24 * 60 * 60 * 1000, // Default: 24 hours
    provider = 'default',
    onCacheHit,
    onCacheMiss
  } = options;

  const startTime = performance.now();

  // Check cache first if not forcing refresh
  if (!forceRefresh) {
    const cachedItem = await cacheManager.get<T>(cacheKey);
    if (cachedItem) {
      // Calculate cache age
      const cacheAge = Date.now() - (cachedItem.expiresAt - cacheTTL);
      
      // Call the cache hit callback if provided
      if (onCacheHit) {
        onCacheHit();
      }
      
      return {
        data: cachedItem.data,
        fromCache: true,
        cacheAge,
        provider,
        latencyMs: performance.now() - startTime
      };
    }
  }
  
  // Call the cache miss callback if provided
  if (onCacheMiss) {
    onCacheMiss();
  }
  
  // Make the actual request
  const response = await requestFn();
  
  // Cache the response
  await cacheManager.set(cacheKey, response, { ttl: cacheTTL });
  
  // Calculate latency
  const latencyMs = performance.now() - startTime;
  
  return {
    data: response,
    fromCache: false,
    provider,
    latencyMs
  };
}
