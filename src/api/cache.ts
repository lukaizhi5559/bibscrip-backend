import { Router, Request, Response } from 'express';
import expressAsyncHandler from '../utils/asyncHandler';

// In a production setup, you'd use Vercel KV, Redis, or another distributed cache
// For this implementation, we'll use a simple in-memory cache with TTL
// which will be replaced with Vercel KV in production

// Simple in-memory cache for development/demo
interface CacheEntry {
  key: string;
  value: any;
  expires: number;
}

// Cache store with namespace separation
const cacheStore: Record<string, CacheEntry[]> = {};

// Helper to extract namespace from key
function getNamespaceFromKey(key: string): string {
  const parts = key.split(':');
  return parts[0] || 'default';
}

const router = Router();

/**
 * GET handler for retrieving cached items
 */
router.get('/:key', expressAsyncHandler(async (req: Request, res: Response) => {
  try {
    // Get the key from the query string
    const key = req.params.key as string;
    
    if (!key) {
      return res.status(400).json({ error: 'No cache key provided' });
    }
    
    const namespace = getNamespaceFromKey(key);
    const now = Date.now();
    
    // Find the item in the cache
    if (cacheStore[namespace]) {
      const entry = cacheStore[namespace].find(entry => entry.key === key);
      
      if (entry && entry.expires > now) {
        // Return the cached value
        return res.status(200)
          .set('Cache-Control', `public, max-age=${Math.floor((entry.expires - now) / 1000)}`)
          .set('X-Cache', 'HIT')
          .json(entry.value);
      }
    }
    
    // Item not found or expired
    return res.status(404)
      .set('Cache-Control', 'no-cache')
      .set('X-Cache', 'MISS')
      .json({ error: 'Cache miss' });
  } catch (error) {
    console.error('Cache GET error:', error);
    return res.status(500).json({ error: 'Cache access error' });
  }
}));

/**
 * POST handler for storing cache items
 */
router.post('/', expressAsyncHandler(async (req: Request, res: Response) => {
  try {
    const { key, value, ttl = 86400000 } = req.body; // Default TTL: 24 hours
    
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Key and value are required' });
    }
    
    const namespace = getNamespaceFromKey(key);
    const now = Date.now();
    const expires = now + ttl;
    
    // Initialize namespace if needed
    if (!cacheStore[namespace]) {
      cacheStore[namespace] = [];
    }
    
    // Check if key exists and update, or add new entry
    const existingIndex = cacheStore[namespace].findIndex(entry => entry.key === key);
    
    if (existingIndex !== -1) {
      // Update existing entry
      cacheStore[namespace][existingIndex] = { key, value, expires };
    } else {
      // Add new entry
      cacheStore[namespace].push({ key, value, expires });
      
      // Cleanup expired items every 10 additions (basic memory management)
      if (cacheStore[namespace].length % 10 === 0) {
        cacheStore[namespace] = cacheStore[namespace].filter(entry => entry.expires > now);
      }
    }
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Cache POST error:', error);
    return res.status(500).json({ error: 'Cache write error' });
  }
}));

/**
 * DELETE handler for clearing cache
 */
router.delete('/:key', expressAsyncHandler(async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    
    if (key) {
      // Delete specific key
      // Extract namespace from key format: namespace:keyname
      const nameParts = key.split(':');
      const namespace = nameParts.length > 1 ? nameParts[0] : 'default';
      
      if (cacheStore[namespace]) {
        // If the key is 'all' then clear entire namespace
        if (key === 'all') {
          delete cacheStore[namespace];
          return res.status(200).json({ success: true, message: 'All cache entries cleared' });
        } else {
          // Remove specific key
          const initialLength = cacheStore[namespace].length;
          cacheStore[namespace] = cacheStore[namespace].filter(entry => entry.key !== key);
          
          if (cacheStore[namespace].length === initialLength) {
            return res.status(404).json({ error: 'Cache key not found' });
          }
        }
      } else {
        return res.status(404).json({ error: 'Cache namespace not found' });
      }
    } else if (key === 'all') {
      // Delete all cache if the key is 'all'
      Object.keys(cacheStore).forEach(ns => delete cacheStore[ns]);
    }
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Cache DELETE error:', error);
    return res.status(500).json({ error: 'Cache deletion error' });
  }
}));

export default router;
