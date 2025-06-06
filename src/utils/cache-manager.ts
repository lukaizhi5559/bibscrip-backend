// Simple cache management utility
// In production, use Redis or another distributed cache

interface CacheOptions {
  ttl?: number;  // Time to live in milliseconds
}

interface CachedItem<T> {
  data: T;
  expiresAt: number;
}

/**
 * Creates a normalized cache key for consistent lookups
 */
export function createCacheKey(params: Record<string, any>): string {
  // Sort keys for consistent ordering
  const sortedKeys = Object.keys(params).sort();
  
  // Build a normalized key string
  return sortedKeys
    .map(key => {
      const value = params[key];
      // Skip undefined/null values
      if (value === undefined || value === null) return '';
      // Handle different value types
      const stringValue = typeof value === 'string' 
        ? value 
        : JSON.stringify(value);
      
      return `${key}:${stringValue}`;
    })
    .filter(Boolean)
    .join('|');
}

/**
 * Basic cache manager implementation
 */
class CacheManager {
  private cache: Map<string, CachedItem<any>> = new Map();
  
  /**
   * Get an item from cache
   */
  async get<T>(key: string): Promise<CachedItem<T> | null> {
    const item = this.cache.get(key);
    
    if (!item) {
      return null;
    }
    
    // Check if item is expired
    if (item.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    
    return item as CachedItem<T>;
  }
  
  /**
   * Set an item in the cache
   */
  async set<T>(key: string, data: T, options: CacheOptions = {}): Promise<void> {
    const ttl = options.ttl || 24 * 60 * 60 * 1000; // Default: 24 hours
    
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl
    });
    
    // Basic memory management - run cleanup occasionally
    if (this.cache.size % 100 === 0) {
      this.cleanup();
    }
  }
  
  /**
   * Delete an item from cache
   */
  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }
  
  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.cache.clear();
  }
  
  /**
   * Remove expired items from cache
   */
  private cleanup(): void {
    const now = Date.now();
    
    for (const [key, item] of this.cache.entries()) {
      if (item.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }
}

export const cacheManager = new CacheManager();
