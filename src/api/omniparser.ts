import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';
import { omniParserService } from '../services/omniParserService';

const router = Router();

/**
 * POST /api/omniparser/parse
 * Parse screenshot with OmniParser to detect all UI elements
 * 
 * Request body:
 * {
 *   "screenshot": { "base64": "...", "mimeType": "image/png" },
 *   "context": {
 *     "url": "https://example.com",
 *     "screenWidth": 1440,
 *     "screenHeight": 900,
 *     "windowBounds": { "x": 100, "y": 100, "width": 1200, "height": 800 }
 *   }
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "elements": [
 *     {
 *       "id": 0,
 *       "type": "text" | "icon",
 *       "bbox": { "x1": 100, "y1": 50, "x2": 200, "y2": 80 },
 *       "normalizedBbox": [0.1, 0.05, 0.2, 0.08],
 *       "interactivity": true,
 *       "content": "Submit",
 *       "confidence": 0.9
 *     }
 *   ],
 *   "metadata": {
 *     "totalElements": 150,
 *     "interactiveElements": 45,
 *     "byType": { "text": 120, "icon": 30 },
 *     "cacheHit": false,
 *     "method": "omniparser"
 *   },
 *   "latencyMs": 2500
 * }
 */
router.post('/parse', async (req: Request, res: Response): Promise<void> => {
  try {
    const { screenshot, context } = req.body;

    // Validate request
    if (!screenshot?.base64) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: screenshot.base64',
      });
      return;
    }

    // Check if OmniParser is available
    if (!omniParserService.isAvailable()) {
      res.status(503).json({
        success: false,
        error: 'OmniParser service not available',
        message: 'REPLICATE_API_TOKEN not configured',
      });
      return;
    }

    logger.info('🔍 [OMNIPARSER-API] Parse request received', {
      screenshotSize: screenshot.base64.length,
      hasContext: !!context,
      url: context?.url,
      screenDimensions: context?.screenWidth && context?.screenHeight 
        ? `${context.screenWidth}x${context.screenHeight}` 
        : 'unknown',
      hasWindowBounds: !!context?.windowBounds,
      userId: (req as any).user?.id,
    });

    const startTime = Date.now();

    // Build context object
    const omniContext = {
      url: context?.url || context?.activeUrl || 'unknown',
      screenWidth: context?.screenWidth || context?.screenshotWidth || 1440,
      screenHeight: context?.screenHeight || context?.screenshotHeight || 900,
      screenshotWidth: context?.screenshotWidth || context?.screenWidth || 1440,
      screenshotHeight: context?.screenshotHeight || context?.screenHeight || 900,
      windowBounds: context?.windowBounds,
    };

    // Call OmniParser with special description to fetch all elements
    const result = await omniParserService.detectElement(
      screenshot,
      'fetch_all_elements', // Special flag to return all elements
      omniContext
    );

    const latencyMs = Date.now() - startTime;

    // Extract elements from result
    const elements = result.allElements || [];

    logger.info('✅ [OMNIPARSER-API] Parse successful', {
      totalElements: elements.length,
      interactiveElements: elements.filter((e) => e.interactivity).length,
      byType: {
        text: elements.filter((e) => e.type === 'text').length,
        icon: elements.filter((e) => e.type === 'icon').length,
      },
      cacheHit: result.cacheHit,
      method: result.method,
      latencyMs,
    });

    res.status(200).json({
      success: true,
      elements,
      metadata: {
        totalElements: elements.length,
        interactiveElements: elements.filter((e) => e.interactivity).length,
        byType: {
          text: elements.filter((e) => e.type === 'text').length,
          icon: elements.filter((e) => e.type === 'icon').length,
        },
        cacheHit: result.cacheHit,
        method: result.method,
      },
      latencyMs,
    });
  } catch (error: any) {
    logger.error('❌ [OMNIPARSER-API] Parse failed', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to parse screenshot with OmniParser',
      message: error.message,
    });
  }
});

/**
 * POST /api/omniparser/detect
 * Detect specific element in screenshot using OmniParser
 * 
 * Request body:
 * {
 *   "screenshot": { "base64": "...", "mimeType": "image/png" },
 *   "description": "the submit button",
 *   "context": {
 *     "url": "https://example.com",
 *     "screenWidth": 1440,
 *     "screenHeight": 900,
 *     "windowBounds": { "x": 100, "y": 100, "width": 1200, "height": 800 }
 *   }
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "coordinates": { "x": 640, "y": 850 },
 *   "confidence": 0.95,
 *   "selectedElement": "Submit",
 *   "method": "omniparser_cached",
 *   "cacheHit": true,
 *   "latencyMs": 150
 * }
 */
router.post('/detect', async (req: Request, res: Response): Promise<void> => {
  try {
    const { screenshot, description, context } = req.body;

    // Validate request
    if (!screenshot?.base64 || !description) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: screenshot.base64 and description',
      });
      return;
    }

    // Check if OmniParser is available
    if (!omniParserService.isAvailable()) {
      res.status(503).json({
        success: false,
        error: 'OmniParser service not available',
        message: 'REPLICATE_API_TOKEN not configured',
      });
      return;
    }

    logger.info('🎯 [OMNIPARSER-API] Detect request received', {
      description,
      screenshotSize: screenshot.base64.length,
      hasContext: !!context,
      userId: (req as any).user?.id,
    });

    const startTime = Date.now();

    // Build context object
    const omniContext = {
      url: context?.url || context?.activeUrl || 'unknown',
      screenWidth: context?.screenWidth || context?.screenshotWidth || 1440,
      screenHeight: context?.screenHeight || context?.screenshotHeight || 900,
      screenshotWidth: context?.screenshotWidth || context?.screenWidth || 1440,
      screenshotHeight: context?.screenshotHeight || context?.screenHeight || 900,
      windowBounds: context?.windowBounds,
      intentType: context?.intentType,
      activeApp: context?.activeApp,
      activeUrl: context?.activeUrl,
    };

    // Call OmniParser to detect specific element
    const result = await omniParserService.detectElement(
      screenshot,
      description,
      omniContext
    );

    const latencyMs = Date.now() - startTime;

    logger.info('✅ [OMNIPARSER-API] Detect successful', {
      description,
      coordinates: result.coordinates,
      confidence: result.confidence,
      selectedElement: result.selectedElement,
      method: result.method,
      cacheHit: result.cacheHit,
      latencyMs,
    });

    res.status(200).json({
      success: true,
      coordinates: result.coordinates,
      confidence: result.confidence,
      selectedElement: result.selectedElement,
      method: result.method,
      cacheHit: result.cacheHit,
      latencyMs,
    });
  } catch (error: any) {
    logger.error('❌ [OMNIPARSER-API] Detect failed', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to detect element with OmniParser',
      message: error.message,
    });
  }
});

/**
 * GET /api/omniparser/health
 * Health check endpoint for OmniParser service
 */
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const available = omniParserService.isAvailable();
    const hasHuggingFace = !!process.env.HUGGINGFACE_OMNIPARSER_ENDPOINT;
    const hasModal = !!process.env.MODAL_API_KEY && !!process.env.MODAL_OMNIPARSER_ENDPOINT;
    const hasReplicate = !!process.env.REPLICATE_API_TOKEN;

    const status = {
      service: 'omniparser',
      status: available ? 'healthy' : 'unavailable',
      providers: {
        huggingface: {
          available: hasHuggingFace,
          priority: 1,
          endpoint: process.env.HUGGINGFACE_OMNIPARSER_ENDPOINT ? 'configured' : 'not configured',
        },
        modal: {
          available: hasModal,
          priority: 2,
          endpoint: process.env.MODAL_OMNIPARSER_ENDPOINT ? 'configured' : 'not configured',
        },
        replicate: {
          available: hasReplicate,
          priority: 3,
          fallback: true,
        },
      },
      features: {
        caching: true,
        elementDetection: true,
        batchParsing: true,
      },
      timestamp: new Date().toISOString(),
    };

    const httpStatus = status.status === 'healthy' ? 200 : 503;

    res.status(httpStatus).json(status);
  } catch (error: any) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      service: 'omniparser',
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
