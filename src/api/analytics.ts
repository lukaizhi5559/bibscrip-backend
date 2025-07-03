import { Router, Request, Response } from 'express';
import typedAsyncHandler from '../utils/asyncHandler';

// In a production setup, you'd use a proper database or analytics service 
// like Firebase Analytics, Vercel KV, or a custom solution
// This is a simple in-memory implementation for the demo/development

// Accumulate events in memory (not suitable for production)
// In production, use a dedicated database/store
let analyticsEvents: any[] = [];

const router = Router();

/**
 * @swagger
 * /api/analytics:
 *   post:
 *     summary: Record analytics events
 *     tags: [Analytics]
 *     description: Submit analytics events for tracking user behavior, performance metrics, and system usage
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   description: Event type (e.g., 'pageView', 'ai_request', 'cache_operation')
 *                   example: 'pageView'
 *                 userId:
 *                   type: string
 *                   description: Unique user identifier
 *                   example: 'user123'
 *                 path:
 *                   type: string
 *                   description: Page path for pageView events
 *                   example: '/dashboard'
 *                 operation:
 *                   type: string
 *                   description: Operation type for cache events
 *                   example: 'hit'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Event timestamp
 *                 metadata:
 *                   type: object
 *                   description: Additional event metadata
 *     responses:
 *       200:
 *         description: Events recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 eventsReceived:
 *                   type: number
 *                   example: 5
 *       400:
 *         description: Invalid events format
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: 'Invalid events format, array expected'
 *       500:
 *         description: Analytics processing error
 */
router.post('/', typedAsyncHandler(async (req: Request, res: Response) => {
  try {
    const events = req.body;
    
    // Validate that we received an array of events
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'Invalid events format, array expected' });
    }
    
    // Add events to our store
    analyticsEvents.push(...events);
    
    // In a production environment, we would:
    // 1. Validate events
    // 2. Store in a database
    // 3. Process for dashboards or export to analytics service
    
    // Log event count for development
    console.log(`Received ${events.length} analytics events. Total stored: ${analyticsEvents.length}`);
    
    // Basic memory management - cap the number of events we store in memory
    if (analyticsEvents.length > 1000) {
      // Keep only the most recent 1000 events
      analyticsEvents = analyticsEvents.slice(-1000);
    }
    
    return res.json({ success: true, eventsReceived: events.length });
  } catch (error) {
    console.error('Analytics POST error:', error);
    return res.status(500).json({ error: 'Analytics processing error' });
  }
}));

/**
 * @swagger
 * /api/analytics:
 *   get:
 *     summary: Get analytics summary or raw data
 *     tags: [Analytics]
 *     description: Retrieve analytics data summary or raw events for monitoring and analysis
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [summary, raw]
 *           default: summary
 *         description: Response format - 'summary' for aggregated data or 'raw' for full event data
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   description: Analytics summary (default)
 *                   properties:
 *                     totalEvents:
 *                       type: number
 *                       example: 150
 *                     uniqueUsers:
 *                       type: number
 *                       example: 25
 *                     eventCounts:
 *                       type: object
 *                       additionalProperties:
 *                         type: number
 *                       example: { "pageView": 80, "ai_request": 45, "cache_operation": 25 }
 *                     pageViews:
 *                       type: object
 *                       additionalProperties:
 *                         type: number
 *                       example: { "/dashboard": 30, "/search": 25, "/profile": 15 }
 *                     aiStats:
 *                       type: object
 *                       properties:
 *                         totalRequests:
 *                           type: number
 *                           example: 45
 *                     cacheStats:
 *                       type: object
 *                       properties:
 *                         hits:
 *                           type: number
 *                           example: 20
 *                         misses:
 *                           type: number
 *                           example: 5
 *                         hitRatio:
 *                           type: number
 *                           format: float
 *                           example: 0.8
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *                 - type: array
 *                   description: Raw analytics events (when format=raw)
 *                   items:
 *                     type: object
 *       500:
 *         description: Analytics retrieval error
 */
router.get('/', typedAsyncHandler(async (req: Request, res: Response) => {
  try {
    // Check for authentication in a real-world scenario
    const format = req.query.format as string || 'summary';
    
    if (format === 'raw') {
      // Return full event data (for admin/debugging)
      return res.json(analyticsEvents);
    }
    
    // Return a summary of events by type
    const eventCounts: Record<string, number> = {};
    
    analyticsEvents.forEach(event => {
      if (event.type) {
        eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
      }
    });
    
    // Get approximate session count based on unique userIds
    const uniqueUserIds = new Set();
    analyticsEvents.forEach(event => {
      if (event.userId) {
        uniqueUserIds.add(event.userId);
      }
    });
    
    // Get page view counts
    const pageViews: Record<string, number> = {};
    analyticsEvents
      .filter(event => event.type === 'pageView' && event.path)
      .forEach(event => {
        pageViews[event.path] = (pageViews[event.path] || 0) + 1;
      });
      
    // Count AI requests and cache operations
    const aiRequests = analyticsEvents.filter(event => event.type === 'ai_request').length;
    const cacheHits = analyticsEvents.filter(event => 
      event.type === 'cache_operation' && event.operation === 'hit').length;
    const cacheMisses = analyticsEvents.filter(event => 
      event.type === 'cache_operation' && event.operation === 'miss').length;
    
    // Calculate cache hit ratio
    const totalCacheOps = cacheHits + cacheMisses;
    const cacheHitRatio = totalCacheOps > 0 ? cacheHits / totalCacheOps : 0;
    
    // Build basic summary object
    const analyticsSummary = {
      totalEvents: analyticsEvents.length,
      uniqueUsers: uniqueUserIds.size,
      eventCounts,
      pageViews,
      aiStats: {
        totalRequests: aiRequests,
      },
      cacheStats: {
        hits: cacheHits,
        misses: cacheMisses,
        hitRatio: cacheHitRatio
      },
      lastUpdated: new Date().toISOString()
    };
    
    return res.json(analyticsSummary);
  } catch (error) {
    console.error('Analytics GET error:', error);
    return res.status(500).json({ error: 'Analytics retrieval error' });
  }
}));

export default router;
