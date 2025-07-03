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
 * @swagger
 * /api/cache/{key}:
 *   get:
 *     summary: Retrieve cached item by key
 *     tags: [Cache]
 *     description: Get a cached value by its key. Returns the cached data if found and not expired.
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Cache key (supports namespacing with colon separator, e.g., 'namespace:keyname')
 *         example: 'bible:verse:john3:16'
 *     responses:
 *       200:
 *         description: Cache hit - item found and returned
 *         headers:
 *           Cache-Control:
 *             description: Cache control header with max-age
 *             schema:
 *               type: string
 *           X-Cache:
 *             description: Cache status indicator
 *             schema:
 *               type: string
 *               example: 'HIT'
 *         content:
 *           application/json:
 *             schema:
 *               description: The cached value (can be any JSON type)
 *               example: { "verse": "For God so loved the world..." }
 *       404:
 *         description: Cache miss - item not found or expired
 *         headers:
 *           Cache-Control:
 *             description: No-cache header
 *             schema:
 *               type: string
 *               example: 'no-cache'
 *           X-Cache:
 *             description: Cache status indicator
 *             schema:
 *               type: string
 *               example: 'MISS'
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: 'Cache miss'
 *       400:
 *         description: Invalid request - no cache key provided
 *       500:
 *         description: Cache access error
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
 * @swagger
 * /api/cache:
 *   post:
 *     summary: Store item in cache
 *     tags: [Cache]
 *     description: Store a key-value pair in the cache with optional TTL (time-to-live)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - key
 *               - value
 *             properties:
 *               key:
 *                 type: string
 *                 description: Cache key (supports namespacing with colon separator)
 *                 example: 'bible:verse:john3:16'
 *               value:
 *                 description: Value to cache (can be any JSON type)
 *                 example: { "verse": "For God so loved the world...", "translation": "ESV" }
 *               ttl:
 *                 type: number
 *                 description: Time-to-live in milliseconds (default: 24 hours)
 *                 example: 3600000
 *                 default: 86400000
 *     responses:
 *       200:
 *         description: Item successfully cached
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Invalid request - key and value are required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: 'Key and value are required'
 *       500:
 *         description: Cache write error
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
 * @swagger
 * /api/cache/{key}:
 *   delete:
 *     summary: Delete cached item or clear cache
 *     tags: [Cache]
 *     description: Delete a specific cached item by key, clear an entire namespace, or clear all cache
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: |
 *           Cache key to delete. Special values:
 *           - 'all': Clear all cache entries
 *           - 'namespace:all': Clear all entries in a namespace
 *           - 'namespace:keyname': Delete specific key
 *         example: 'bible:verse:john3:16'
 *     responses:
 *       200:
 *         description: Cache deletion successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   description: Optional success message
 *                   example: 'All cache entries cleared'
 *       404:
 *         description: Cache key or namespace not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: 'Cache key not found'
 *       500:
 *         description: Cache deletion error
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
