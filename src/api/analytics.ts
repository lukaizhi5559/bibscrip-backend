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
 * POST handler for recording analytics events
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
 * GET handler to retrieve analytics summary
 * For admin/monitoring purposes
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
