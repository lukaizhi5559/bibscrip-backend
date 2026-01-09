import Replicate from 'replicate';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import Redis from 'ioredis';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Initialize Replicate client (fallback)
const replicateClient = process.env.REPLICATE_API_TOKEN
  ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  : null;

// Modal.com configuration (preferred for serverless GPU)
const MODAL_API_KEY = process.env.MODAL_API_KEY;
const MODAL_ENDPOINT = process.env.MODAL_OMNIPARSER_ENDPOINT; // Set this after deploying to Modal
const USE_MODAL = !!MODAL_API_KEY && !!MODAL_ENDPOINT;

// Initialize Redis client
const redis = process.env.REDIS_HOST
  ? new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    })
  : null;

interface OmniParserElement {
  type: 'text' | 'icon';
  bbox: [number, number, number, number]; // Normalized 0-1 coordinates [x1, y1, x2, y2]
  interactivity: boolean;
  content: string;
}

interface OmniParserResponse {
  img: string; // Annotated image URL
  elements: string; // Raw string of elements
}

interface ParsedElement {
  id: number;
  type: 'text' | 'icon';
  bbox: {
    x1: number; // Absolute pixel coordinates
    y1: number;
    x2: number;
    y2: number;
  };
  normalizedBbox: [number, number, number, number]; // Original 0-1 coordinates
  interactivity: boolean;
  content: string;
  confidence: number;
}

interface CachedElements {
  elements: ParsedElement[];
  timestamp: number;
  url?: string;
  screenshotHash: string;
  screenshotWidth: number;
  screenshotHeight: number;
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OmniParserDetectionResult {
  coordinates: { x: number; y: number };
  confidence: number;
  method: 'omniparser' | 'omniparser_cached' | 'vision_fallback';
  selectedElement?: string;
  cacheHit?: boolean;
  allElements?: ParsedElement[]; // For LLM-driven element selection
}

export class OmniParserService {
  private readonly CACHE_TTL_SECONDS = 3 * 24 * 60 * 60; // 3 days for static sites
  private readonly CACHE_PREFIX = 'omniparser';

  /**
   * Main detection method - uses cache or calls OmniParser API
   */
  async detectElement(
    screenshot: { base64: string; mimeType: string },
    description: string,
    context: any
  ): Promise<OmniParserDetectionResult> {
    if (!replicateClient) {
      logger.warn('⚠️ [OMNIPARSER] Replicate client not initialized, skipping');
      throw new Error('OmniParser not available - REPLICATE_API_TOKEN not set');
    }

    logger.info('🔍 [OMNIPARSER] Starting element detection', {
      description,
      hasWindowBounds: !!context?.windowBounds,
      fetchAllElements: description === 'fetch_all_elements',
    });

    // Generate screenshot hash for cache key
    const screenshotHash = this.hashScreenshot(screenshot.base64);
    const url = context?.url || context?.activeUrl || 'unknown';
    const cacheKey = this.getCacheKey(url, screenshotHash);

    // Try to get from cache first
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      logger.info('✅ [OMNIPARSER] Cache hit', {
        cacheKey,
        elementCount: cached.elements.length,
        age: Math.round((Date.now() - cached.timestamp) / 1000) + 's',
      });

      // If requesting all elements, return them directly
      if (description === 'fetch_all_elements') {
        return {
          coordinates: { x: 0, y: 0 },
          confidence: 1.0,
          method: 'omniparser_cached',
          cacheHit: true,
          allElements: cached.elements,
        };
      }

      // Find element in cached data
      const result = await this.findElementInCache(cached, description, context);
      if (result) {
        return {
          ...result,
          method: 'omniparser_cached',
          cacheHit: true,
        };
      }

      logger.warn('⚠️ [OMNIPARSER] Element not found in cache, calling API');
    }

    // Cache miss or element not found - call OmniParser API
    logger.info('📡 [OMNIPARSER] Calling Replicate API', {
      cacheKey,
      reason: cached ? 'element_not_found' : 'cache_miss',
    });

    const elements = await this.callOmniParserAPI(screenshot, context);

    // Cache the results
    await this.saveToCache(cacheKey, {
      elements,
      timestamp: Date.now(),
      url,
      screenshotHash,
      screenshotWidth: context?.screenshotWidth || context?.screenWidth || 1440,
      screenshotHeight: context?.screenshotHeight || context?.screenHeight || 900,
      windowBounds: context?.windowBounds,
    });

    // If requesting all elements, return them directly
    if (description === 'fetch_all_elements') {
      return {
        coordinates: { x: 0, y: 0 },
        confidence: 1.0,
        method: 'omniparser',
        cacheHit: false,
        allElements: elements,
      };
    }

    // Find element in fresh data
    const result = await this.findElementInCache(
      {
        elements,
        timestamp: Date.now(),
        url,
        screenshotHash,
        screenshotWidth: context?.screenshotWidth || context?.screenWidth || 1440,
        screenshotHeight: context?.screenshotHeight || context?.screenHeight || 900,
        windowBounds: context?.windowBounds,
      },
      description,
      context
    );

    if (!result) {
      throw new Error(`Element not found: ${description}`);
    }

    return {
      ...result,
      method: 'omniparser',
      cacheHit: false,
    };
  }

  /**
   * Call OmniParser API via Hugging Face (preferred), Modal.com, or Replicate (fallback)
   */
  private async callOmniParserAPI(
    screenshot: { base64: string; mimeType: string },
    context: any
  ): Promise<ParsedElement[]> {
    const startTime = Date.now();

    // Try Hugging Face Gradio API first (Microsoft's official deployment, no cold starts)
    const HF_ENDPOINT = process.env.HUGGINGFACE_OMNIPARSER_ENDPOINT;
    if (HF_ENDPOINT) {
      try {
        logger.info('📡 [OMNIPARSER] Calling Hugging Face Gradio API', {
          endpoint: HF_ENDPOINT,
        });

        const imageDataUri = `data:${screenshot.mimeType};base64,${screenshot.base64}`;

        const response = await axios.post(
          HF_ENDPOINT,
          {
            data: [
              imageDataUri,
              0.05, // box_threshold
              0.1   // iou_threshold
            ]
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 60000, // 60 second timeout - allows for cold boots
          }
        );

        const latencyMs = Date.now() - startTime;

        logger.info('✅ [OMNIPARSER] Hugging Face call successful', {
          latencyMs,
          provider: 'huggingface',
        });

        // Gradio returns data in format: { data: [elements_string, annotated_image] }
        const elementsString = response.data.data[0];

        // Parse the elements string into structured data
        const elements = this.parseOmniParserElements(
          elementsString,
          context?.screenshotWidth || context?.screenWidth || 1440,
          context?.screenshotHeight || context?.screenHeight || 900,
          context?.windowBounds
        );

        logger.info('📊 [OMNIPARSER] Parsed elements', {
          total: elements.length,
          interactive: elements.filter((e) => e.interactivity).length,
          byType: {
            text: elements.filter((e) => e.type === 'text').length,
            icon: elements.filter((e) => e.type === 'icon').length,
          },
        });

        return elements;
      } catch (error: any) {
        logger.warn('⚠️ [OMNIPARSER] Hugging Face call failed, trying Modal.com', {
          error: error.message,
        });
        // Fall through to Modal fallback
      }
    }

    // Try Modal.com second (serverless GPU)
    if (USE_MODAL) {
      try {
        logger.info('📡 [OMNIPARSER] Calling Modal.com serverless endpoint', {
          endpoint: MODAL_ENDPOINT,
        });

        const response = await axios.post(
          MODAL_ENDPOINT!,
          {
            image: screenshot.base64,
            imgsz: 640,
            box_threshold: 0.05,
            iou_threshold: 0.1,
          },
          {
            headers: {
              'Authorization': `Bearer ${MODAL_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 60000, // 60 second timeout - allows for cold boots
          }
        );

        const latencyMs = Date.now() - startTime;

        logger.info('✅ [OMNIPARSER] Modal.com call successful', {
          latencyMs,
          provider: 'modal',
        });

        const output = response.data as OmniParserResponse;

        const elements = this.parseOmniParserElements(
          output.elements,
          context?.screenshotWidth || context?.screenWidth || 1440,
          context?.screenshotHeight || context?.screenHeight || 900,
          context?.windowBounds
        );

        logger.info('📊 [OMNIPARSER] Parsed elements', {
          total: elements.length,
          interactive: elements.filter((e) => e.interactivity).length,
          byType: {
            text: elements.filter((e) => e.type === 'text').length,
            icon: elements.filter((e) => e.type === 'icon').length,
          },
        });

        return elements;
      } catch (error: any) {
        logger.warn('⚠️ [OMNIPARSER] Modal.com call failed, falling back to Replicate', {
          error: error.message,
        });
        // Fall through to Replicate fallback
      }
    }

    // Fallback to Replicate
    if (!replicateClient) {
      throw new Error('Neither Modal nor Replicate client is configured');
    }

    logger.info('📡 [OMNIPARSER] Calling Replicate API (fallback)', {
      reason: USE_MODAL ? 'modal_failed' : 'modal_not_configured',
    });

    const imageDataUri = `data:${screenshot.mimeType};base64,${screenshot.base64}`;

    try {
      const TIMEOUT_MS = 60000; // 60 seconds max - allows for cold boots
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`OmniParser API timeout after ${TIMEOUT_MS}ms`));
        }, TIMEOUT_MS);
      });

      const apiPromise = replicateClient.run(
        'microsoft/omniparser-v2:49cf3d41b8d3aca1360514e83be4c97131ce8f0d99abfc365526d8384caa88df',
        {
          input: {
            image: imageDataUri,
            imgsz: 640,
            box_threshold: 0.05,
            iou_threshold: 0.1,
          },
        }
      );

      const output = (await Promise.race([apiPromise, timeoutPromise])) as OmniParserResponse;

      const latencyMs = Date.now() - startTime;

      logger.info('✅ [OMNIPARSER] Replicate call successful', {
        latencyMs,
        provider: 'replicate',
      });

      // Save OmniParser response to file for debugging
      try {
        const debugDir = path.join(process.cwd(), 'omniparser-debug');
        if (!fs.existsSync(debugDir)) {
          fs.mkdirSync(debugDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `omniparser-${timestamp}.json`;
        const filepath = path.join(debugDir, filename);
        fs.writeFileSync(filepath, JSON.stringify({
          timestamp: new Date().toISOString(),
          latencyMs,
          url: context?.url || context?.activeUrl || 'unknown',
          screenshotWidth: context?.screenshotWidth || context?.screenWidth || 1440,
          screenshotHeight: context?.screenshotHeight || context?.screenHeight || 900,
          rawResponse: output,
          elementsString: output.elements,
        }, null, 2));
        logger.info('💾 [OMNIPARSER] Response saved to file', { filepath });
      } catch (saveError: any) {
        logger.warn('⚠️ [OMNIPARSER] Failed to save response to file', {
          error: saveError.message,
        });
      }

      const elements = this.parseOmniParserElements(
        output.elements,
        context?.screenshotWidth || context?.screenWidth || 1440,
        context?.screenshotHeight || context?.screenHeight || 900,
        context?.windowBounds
      );

      logger.info('📊 [OMNIPARSER] Parsed elements', {
        total: elements.length,
        interactive: elements.filter((e) => e.interactivity).length,
        byType: {
          text: elements.filter((e) => e.type === 'text').length,
          icon: elements.filter((e) => e.type === 'icon').length,
        },
      });

      return elements;
    } catch (error: any) {
      logger.error('❌ [OMNIPARSER] API call failed', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Parse OmniParser elements string into structured data
   */
  private parseOmniParserElements(
    elementsString: string,
    screenshotWidth: number,
    screenshotHeight: number,
    windowBounds?: { x: number; y: number; width: number; height: number }
  ): ParsedElement[] {
    const elements: ParsedElement[] = [];
    const lines = elementsString.split('\n');

    for (const line of lines) {
      // Parse line format: "icon 0: {'type': 'text', 'bbox': [0.31, 0.10, 0.41, 0.13], 'interactivity': False, 'content': 'Type here to search'}"
      const match = line.match(/icon (\d+): ({.*})/);
      if (!match) continue;

      const id = parseInt(match[1]);
      
      // Convert Python dict to JSON - robust handling of nested quotes
      let jsonStr = match[2];
      
      // Strategy: Extract content value separately, escape it, then reconstruct
      const contentMatch = jsonStr.match(/'content':\s*'([^']*(?:\\'[^']*)*)'/);
      let escapedContent = '';
      
      if (contentMatch) {
        // Extract raw content and escape special chars
        const rawContent = contentMatch[1];
        escapedContent = rawContent
          .replace(/\\/g, '\\\\')  // Escape backslashes first
          .replace(/"/g, '\\"')     // Escape double quotes
          .replace(/\n/g, '\\n')    // Escape newlines
          .replace(/\r/g, '\\r')    // Escape carriage returns
          .replace(/\t/g, '\\t');   // Escape tabs
        
        // Replace content field with properly escaped version
        jsonStr = jsonStr.replace(
          /'content':\s*'[^']*(?:\\'[^']*)*'/,
          `"content": "${escapedContent}"`
        );
      }
      
      // Replace remaining single quotes with double quotes
      jsonStr = jsonStr.replace(/'/g, '"');
      
      // Replace Python booleans
      jsonStr = jsonStr.replace(/False/g, 'false').replace(/True/g, 'true');

      try {
        const data = JSON.parse(jsonStr) as OmniParserElement;

        // Convert normalized coordinates (0-1) to absolute pixels
        const normalizedBbox = data.bbox;
        const absoluteBbox = {
          x1: normalizedBbox[0] * screenshotWidth,
          y1: normalizedBbox[1] * screenshotHeight,
          x2: normalizedBbox[2] * screenshotWidth,
          y2: normalizedBbox[3] * screenshotHeight,
        };

        // If window bounds provided, offset coordinates to desktop space
        if (windowBounds) {
          absoluteBbox.x1 += windowBounds.x;
          absoluteBbox.y1 += windowBounds.y;
          absoluteBbox.x2 += windowBounds.x;
          absoluteBbox.y2 += windowBounds.y;
        }

        elements.push({
          id,
          type: data.type,
          bbox: absoluteBbox,
          normalizedBbox,
          interactivity: data.interactivity,
          content: data.content,
          confidence: 0.9, // OmniParser has high accuracy
        });
      } catch (error: any) {
        logger.warn('⚠️ [OMNIPARSER] Failed to parse element line', {
          line,
          error: error.message,
        });
      }
    }

    return elements;
  }

  /**
   * Find element in cached data using fuzzy matching
   */
  private async findElementInCache(
    cached: CachedElements,
    description: string,
    context: any
  ): Promise<{ coordinates: { x: number; y: number }; confidence: number; selectedElement?: string } | null> {
    const descLower = description.toLowerCase().trim();
    let matches: ParsedElement[] = [];

    // CRITICAL: For input/search fields, ONLY consider interactive elements
    const isInputQuery = descLower.includes('input') || descLower.includes('search') || descLower.includes('field') || descLower.includes('box');
    const searchPool = isInputQuery 
      ? cached.elements.filter(e => e.interactivity === true)
      : cached.elements;

    logger.info('🔍 [OMNIPARSER] Search strategy', {
      description,
      isInputQuery,
      searchPoolSize: searchPool.length,
      totalElements: cached.elements.length,
      interactiveElements: cached.elements.filter(e => e.interactivity).length,
    });

    // Strategy 1: Semantic pattern matching for common UI elements
    const semanticPatterns: { [key: string]: RegExp[] } = {
      'search': [/^ask anything/i, /^search/i, /^type.*search/i, /^enter.*query/i, /placeholder.*ask/i],
      'input': [/^ask anything/i, /^type.*here/i, /^enter.*text/i, /^input/i, /^text.*field/i],
      'button': [/^button$/i, /^click$/i, /^submit$/i, /^send$/i, /^close$/i, /^×$/i, /^x$/i],
      'menu': [/^menu$/i, /^navigation$/i, /^nav$/i],
    };
    
    // Exclude elements that look like logs, timestamps, or debugging info
    const excludePatterns = [
      /\d+\.\d+s/i,  // timestamps like "3.81s"
      /backend:/i,
      /frontend:/i,
      /thinking/i,
      /actions/i,
      /iteration/i,
      /llm:/i,
    ];

    // Check if description matches a semantic pattern
    for (const [pattern, regexes] of Object.entries(semanticPatterns)) {
      if (descLower.includes(pattern)) {
        const semanticMatches = searchPool.filter((elem) => {
          const contentLower = elem.content.toLowerCase().trim();
          
          // Exclude debugging/log elements
          if (excludePatterns.some(exclude => exclude.test(contentLower))) {
            return false;
          }
          
          return regexes.some((regex) => regex.test(contentLower));
        });
        if (semanticMatches.length > 0) {
          matches = semanticMatches;
          logger.info('✅ [OMNIPARSER] Semantic pattern match', {
            description,
            pattern,
            matchCount: matches.length,
          });
          break;
        }
      }
    }

    // Strategy 2: Exact content match
    if (!matches || matches.length === 0) {
      matches = searchPool.filter((elem) => {
        const contentLower = elem.content.toLowerCase().trim();
        return contentLower === descLower || contentLower.includes(descLower) || descLower.includes(contentLower);
      });
    }

    // Strategy 3: Fuzzy match with Levenshtein distance
    if (matches.length === 0) {
      matches = searchPool.filter((elem) => {
        const contentLower = elem.content.toLowerCase().trim();
        const similarity = this.calculateSimilarity(descLower, contentLower);
        return similarity > 0.6; // 60% similarity threshold
      });
    }

    // Strategy 4: Partial word match
    if (matches.length === 0) {
      const descWords = descLower.split(/\s+/);
      matches = searchPool.filter((elem) => {
        const contentLower = elem.content.toLowerCase().trim();
        return descWords.some((word) => word.length > 3 && contentLower.includes(word));
      });
    }

    if (matches.length === 0) {
      logger.warn('⚠️ [OMNIPARSER] No matches found in cache', {
        description,
        totalElements: cached.elements.length,
      });
      return null;
    }

    // Prefer interactive elements
    const interactiveMatches = matches.filter((m) => m.interactivity);
    const bestMatch = interactiveMatches.length > 0 ? interactiveMatches[0] : matches[0];

    // Calculate center point of bounding box
    const center = {
      x: Math.round((bestMatch.bbox.x1 + bestMatch.bbox.x2) / 2),
      y: Math.round((bestMatch.bbox.y1 + bestMatch.bbox.y2) / 2),
    };

    logger.info('✅ [OMNIPARSER] Element found in cache', {
      description,
      matched: bestMatch.content,
      coordinates: center,
      interactivity: bestMatch.interactivity,
      matchCount: matches.length,
    });

    return {
      coordinates: center,
      confidence: bestMatch.confidence,
      selectedElement: bestMatch.content,
    };
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Levenshtein distance algorithm
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Invalidate cache for a specific URL or screenshot
   */
  async invalidateCache(url?: string, screenshotHash?: string): Promise<void> {
    if (!redis) {
      logger.warn('⚠️ [OMNIPARSER] Redis not available, cannot invalidate cache');
      return;
    }

    try {
      if (url && screenshotHash) {
        const cacheKey = this.getCacheKey(url, screenshotHash);
        await redis.del(cacheKey);
        logger.info('🗑️ [OMNIPARSER] Cache invalidated', { cacheKey });
      } else if (url) {
        // Invalidate all cache entries for this URL
        const pattern = `${this.CACHE_PREFIX}:${url}:*`;
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
          logger.info('🗑️ [OMNIPARSER] Cache invalidated for URL', { url, count: keys.length });
        }
      }
    } catch (error: any) {
      logger.error('❌ [OMNIPARSER] Cache invalidation failed', {
        error: error.message,
      });
    }
  }

  /**
   * Get cached elements
   */
  private async getFromCache(cacheKey: string): Promise<CachedElements | null> {
    if (!redis) {
      logger.warn('⚠️ [OMNIPARSER] Redis not available, cache disabled');
      return null;
    }

    try {
      const cached = await redis.get(cacheKey);
      if (!cached) return null;

      const data = JSON.parse(cached) as CachedElements;

      // Check if cache is still valid (TTL check)
      const age = Date.now() - data.timestamp;
      const maxAge = this.CACHE_TTL_SECONDS * 1000;

      if (age > maxAge) {
        logger.info('⏰ [OMNIPARSER] Cache expired', {
          cacheKey,
          age: Math.round(age / 1000) + 's',
          maxAge: Math.round(maxAge / 1000) + 's',
        });
        await redis.del(cacheKey);
        return null;
      }

      return data;
    } catch (error: any) {
      logger.error('❌ [OMNIPARSER] Cache read failed', {
        cacheKey,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Save elements to cache
   */
  private async saveToCache(cacheKey: string, data: CachedElements): Promise<void> {
    if (!redis) {
      logger.warn('⚠️ [OMNIPARSER] Redis not available, cache disabled');
      return;
    }

    try {
      await redis.setex(cacheKey, this.CACHE_TTL_SECONDS, JSON.stringify(data));
      logger.info('💾 [OMNIPARSER] Cached elements', {
        cacheKey,
        elementCount: data.elements.length,
        ttl: this.CACHE_TTL_SECONDS + 's',
      });
    } catch (error: any) {
      logger.error('❌ [OMNIPARSER] Cache write failed', {
        cacheKey,
        error: error.message,
      });
    }
  }

  /**
   * Generate cache key from URL and screenshot hash
   */
  private getCacheKey(url: string, screenshotHash: string): string {
    return `${this.CACHE_PREFIX}:${url}:${screenshotHash}`;
  }

  /**
   * Generate hash of screenshot for cache key
   */
  private hashScreenshot(base64: string): string {
    return createHash('sha256').update(base64).digest('hex').substring(0, 16);
  }

  /**
   * Check if OmniParser is available
   */
  isAvailable(): boolean {
    return !!replicateClient;
  }
}

export const omniParserService = new OmniParserService();
