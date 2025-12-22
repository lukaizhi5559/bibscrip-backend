import { ocrService, OCRResult } from './ocrService';
import { logger } from '../utils/logger';
import OpenAI from 'openai';
import sharp from 'sharp';

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

interface DetectedElement {
  id: number;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  label: string;
  confidence: number;
  source: 'omniparser' | 'ocr' | 'vision_objects' | 'vision_logos';
  interactable?: boolean;
}

export interface DetectionResult {
  coordinates: { x: number; y: number };
  confidence: number;
  method: 'spatial_aware' | 'vision_api_fallback';
  selectedElement?: string;
}

export class UIDetectionService {
  // Cache menu bar filter decisions to reduce API calls
  private menuBarFilterCache = new Map<string, boolean>();

  async detectElement(
    screenshot: { base64: string; mimeType: string },
    description: string,
    context: any
  ): Promise<DetectionResult> {
    logger.info(' [HYBRID-DETECTION] Starting multi-tier detection', {
      description,
    });

    // NOTE: Frontend handles text detection with nut.js + Tesseract.js (1-5s)
    // Backend OCR is disabled to avoid redundant work
    // This method is only used as fallback for complex spatial queries
    logger.info('⚠️ [HYBRID-DETECTION] Backend OCR disabled - frontend handles text detection');
    logger.info('⚠️ [HYBRID-DETECTION] Using Vision API fallback for complex spatial query');
    return await this.fallbackToVisionAPIWithRefinement(screenshot, description, context, []);

    /* DISABLED: Frontend handles OCR with nut.js + Tesseract.js
    try {
      // Tier 1: Detect all elements (OCR text + Google Vision objects/logos)
      const allElements = await this.detectAllElements(screenshot.base64);

      if (allElements.length === 0) {
        logger.warn('⚠️ [HYBRID-DETECTION] No elements detected, falling back to Vision API with geometric refinement');
        return await this.fallbackToVisionAPIWithRefinement(screenshot, description, context, []);
      }

      logger.info(' [HYBRID-DETECTION] Elements detected', {
        total: allElements.length,
        bySource: {
          ocr: allElements.filter(e => e.source === 'ocr').length,
          vision_objects: allElements.filter(e => e.source === 'vision_objects').length,
        },
      });

      // Simple menu bar filtering (y < 30) - no LLM needed
      const shouldFilterMenuBar = true; // Always filter menu bar for speed

      logger.info('🔍 [HYBRID-DETECTION] Filtering menu bar elements (y < 30)', {
        description: description.substring(0, 100),
      });

      const filteredElements = allElements.filter(e => {
        const center = this.getCenter(e.bbox);
        const height = e.bbox.y2 - e.bbox.y1;
        const width = e.bbox.x2 - e.bbox.x1;
        
        // Filter menu bar (y < 30) based on LLM decision
        if (center.y < 30 && shouldFilterMenuBar) {
          return false;
        }
        
        // Remove very small text elements (likely labels, not buttons)
        // But keep them if menu bar filtering is disabled (menu items can be small)
        if (shouldFilterMenuBar && e.source === 'ocr' && height < 15 && width < 100) {
          return false;
        }
        
        return true;
      });

      if (filteredElements.length === 0) {
        logger.warn('⚠️ [HYBRID-DETECTION] All elements filtered out, falling back to Vision API');
        return await this.fallbackToVisionAPIWithRefinement(screenshot, description, context, allElements);
      }

      logger.info(' [HYBRID-DETECTION] Elements after filtering', {
        original: allElements.length,
        filtered: filteredElements.length,
        removed: allElements.length - filteredElements.length,
      });

      // Tier 2: Create annotated image with bounding boxes
      const annotatedImage = await this.createSetOfMark(screenshot.base64, filteredElements);

      // Tier 3: LLM selects best element from detected options
      const selectedMarkId = await this.selectElementWithSpatialReasoning(
        annotatedImage,
        filteredElements,
        description,
        context
      );

      const selectedElement = filteredElements.find(e => e.id === selectedMarkId);
      if (!selectedElement) {
        logger.warn(' [HYBRID-DETECTION] LLM selected invalid mark, falling back to Vision API with refinement');
        return await this.fallbackToVisionAPIWithRefinement(screenshot, description, context, allElements);
      }

      const center = this.getCenter(selectedElement.bbox);

      // Validate: reject menu bar elements (y < 30) based on LLM filtering decision
      if (center.y < 30 && shouldFilterMenuBar) {
        logger.warn('⚠️ [HYBRID-DETECTION] Selected element is in menu bar (y < 30), rejecting based on task intent', {
          markId: selectedMarkId,
          label: selectedElement.label,
          coordinates: center,
          shouldFilterMenuBar,
        });
        // Filter out menu bar elements and retry with Vision API
        const nonMenuBarElements = filteredElements.filter(e => {
          const c = this.getCenter(e.bbox);
          return c.y >= 30;
        });
        return await this.fallbackToVisionAPIWithRefinement(screenshot, description, context, nonMenuBarElements);
      }

      logger.info(' [HYBRID-DETECTION] Element selected', {
        markId: selectedMarkId,
        label: selectedElement.label,
        source: selectedElement.source,
        coordinates: center,
        confidence: selectedElement.confidence,
      });

      return {
        coordinates: center,
        confidence: selectedElement.confidence,
        method: 'spatial_aware',
        selectedElement: selectedElement.label,
      };

    } catch (error: any) {
      logger.error('❌ [HYBRID-DETECTION] Detection failed', {
        error: error.message,
      });
      // Tier 4: Vision API fallback with mathematical refinement
      logger.warn('⚠️ [HYBRID-DETECTION] Falling back to Vision API with geometric refinement');
      return await this.fallbackToVisionAPIWithRefinement(screenshot, description, context, []);
    }
    */
  }

  private async detectAllElements(screenshot: string): Promise<DetectedElement[]> {
    const elements: DetectedElement[] = [];
    let idCounter = 1;

    // Run all Google Cloud Vision API calls in parallel for speed
    if (ocrService.isServiceAvailable()) {
      try {
        const [objectResults, logoResults, ocrResults] = await Promise.all([
          ocrService.detectObjects(screenshot).catch(err => {
            logger.warn('⚠️ [OBJECT-DETECTION] Detection failed', { error: err.message });
            return [];
          }),
          ocrService.detectLogos(screenshot).catch(err => {
            logger.warn('⚠️ [LOGO-DETECTION] Detection failed', { error: err.message });
            return [];
          }),
          ocrService.detectText(screenshot).catch(err => {
            logger.warn('⚠️ [OCR] Detection failed', { error: err.message });
            return [];
          }),
        ]);

        // Process object detection results
        for (const result of objectResults) {
          elements.push({
            id: idCounter++,
            bbox: result.bbox,
            label: `Object: "${result.name}"`,
            confidence: result.confidence,
            source: 'vision_objects',
            interactable: false,
          });
        }
        
        // Process logo detection results
        for (const result of logoResults) {
          elements.push({
            id: idCounter++,
            bbox: result.bbox,
            label: `Logo: "${result.name}"`,
            confidence: result.confidence,
            source: 'vision_logos',
            interactable: true,
          });
        }
        
        // Process OCR results
        for (const result of ocrResults) {
          if (result.text.length < 2) continue;
          elements.push({
            id: idCounter++,
            bbox: result.bbox,
            label: `Text: "${result.text}"`,
            confidence: result.confidence,
            source: 'ocr',
            interactable: false,
          });
        }

        logger.info('✅ [PARALLEL-DETECTION] All detections complete', {
          objects: objectResults.length,
          logos: logoResults.length,
          text: ocrResults.length,
          total: elements.length,
        });
      } catch (error: any) {
        logger.error('❌ [PARALLEL-DETECTION] Failed', {
          error: error.message,
        });
      }
    }

    return elements;
  }

  private async createSetOfMark(
    screenshot: string,
    elements: DetectedElement[]
  ): Promise<string> {
    const imageBuffer = Buffer.from(screenshot, 'base64');
    
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 1920;
    const height = metadata.height || 1080;

    const svgOverlay = this.generateSVGOverlay(elements, width, height);

    const markedImage = await image
      .composite([{
        input: Buffer.from(svgOverlay),
        top: 0,
        left: 0,
      }])
      .png()
      .toBuffer();

    return markedImage.toString('base64');
  }

  private generateSVGOverlay(
    elements: DetectedElement[],
    width: number,
    height: number
  ): string {
    const boxes = elements.map(elem => {
      const { x1, y1, x2, y2 } = elem.bbox;
      const centerX = (x1 + x2) / 2;
      const centerY = (y1 + y2) / 2;

      return `
        <rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" 
              fill="none" stroke="red" stroke-width="2" opacity="0.8"/>
        <circle cx="${centerX}" cy="${centerY}" r="15" fill="red" opacity="0.9"/>
        <text x="${centerX}" y="${centerY + 5}" 
              font-size="14" font-weight="bold" fill="white" 
              text-anchor="middle">${elem.id}</text>
      `;
    }).join('\n');

    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        ${boxes}
      </svg>
    `;
  }

  private async selectElementWithSpatialReasoning(
    markedScreenshot: string,
    elements: DetectedElement[],
    description: string,
    context: any
  ): Promise<number | null> {
    if (!openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const elementList = elements.map(e => 
      `[${e.id}] ${e.label} (${e.source}, confidence: ${e.confidence.toFixed(2)}, y: ${Math.round((e.bbox.y1 + e.bbox.y2) / 2)})`
    ).join('\n');

    const prompt = `Find the UI element that best matches: "${description}"

App: ${context?.activeApp || 'unknown'}

Elements:
${elementList}

Rules:
1. Match text content to description (exact or partial match)
2. Prefer elements with higher confidence
3. Consider context (app name, URL)
4. If multiple matches, choose the most relevant one
5. Menu bar elements (y < 30) are already filtered out

Return JSON:
{
  "selected_mark": <number or null>,
  "reasoning": "Why this element matches"
}

Be lenient - if there's a reasonable match, select it. Only return null if truly no match exists.`;

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini', // 4x faster than gpt-4o
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${markedScreenshot}`,
                detail: 'low', // Low detail for speed
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 150, // Reduced for faster response
      temperature: 0,
    });

    const response = completion.choices[0]?.message?.content || '';
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const result = JSON.parse(cleaned);

    logger.info('🧠 [SPATIAL-DETECTION] LLM reasoning', {
      selectedMark: result.selected_mark,
      reasoning: result.reasoning,
    });

    return result.selected_mark;
  }

  /**
   * Mathematical coordinate refinement using Vision API semantic understanding
   * + geometric calculations for precision
   */
  private async fallbackToVisionAPIWithRefinement(
    screenshot: { base64: string; mimeType: string },
    description: string,
    context: any,
    detectedElements?: DetectedElement[]
  ): Promise<DetectionResult> {
    // If we have detected elements, use Set-of-Mark approach (more accurate)
    if (detectedElements && detectedElements.length > 0) {
      logger.info('🎯 [VISION-API-SOM] Using Set-of-Mark approach with detected elements', {
        elementCount: detectedElements.length,
      });
      
      try {
        // Create marked screenshot with numbered bounding boxes
        const markedScreenshot = await this.createSetOfMark(screenshot.base64, detectedElements);
        
        // Ask Vision API to select the numbered element (much more accurate)
        const selectedMarkId = await this.selectElementWithVisionAPI(
          markedScreenshot,
          detectedElements,
          description,
          context
        );
        
        const selectedElement = detectedElements.find(e => e.id === selectedMarkId);
        if (selectedElement) {
          const center = this.getCenter(selectedElement.bbox);
          
          logger.info('✅ [VISION-API-SOM] Element selected from marked screenshot', {
            markId: selectedMarkId,
            label: selectedElement.label,
            coordinates: center,
            confidence: 0.9,
          });
          
          return {
            coordinates: center,
            confidence: 0.9, // Higher confidence with SoM approach
            method: 'vision_api_fallback',
            selectedElement: selectedElement.label,
          };
        }
      } catch (error: any) {
        logger.warn('⚠️ [VISION-API-SOM] Set-of-Mark approach failed, falling back to coordinate guessing', {
          error: error.message,
        });
      }
    }
    
    // Fallback: Vision API guesses coordinates (less accurate)
    logger.info('📍 [VISION-API-GUESS] Using coordinate guessing (no detected elements available)');
    const visionResult = await this.fallbackToVisionAPI(screenshot, description, context);
    
    // If we have detected elements, try to refine the guessed coordinates
    if (detectedElements && detectedElements.length > 0) {
      const refined = this.refineCoordinatesWithAnchors(
        visionResult.coordinates,
        description,
        detectedElements,
        context
      );
      
      if (refined) {
        logger.info('✅ [COORDINATE-REFINEMENT] Refined guessed coordinates using anchors', {
          original: visionResult.coordinates,
          refined: refined,
          improvement: `${Math.abs(refined.x - visionResult.coordinates.x)}px horizontal, ${Math.abs(refined.y - visionResult.coordinates.y)}px vertical`,
        });
        
        return {
          ...visionResult,
          coordinates: refined,
          confidence: Math.min(visionResult.confidence + 0.1, 0.95),
        };
      }
    }
    
    return visionResult;
  }

  /**
   * Use Vision API to select element from marked screenshot (Set-of-Mark approach)
   */
  private async selectElementWithVisionAPI(
    markedScreenshot: string,
    elements: DetectedElement[],
    description: string,
    context: any
  ): Promise<number> {
    if (!openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const elementList = elements.map(e => 
      `[${e.id}] ${e.label} (${e.source})`
    ).join('\n');

    const prompt = `You are analyzing a screenshot with NUMBERED UI ELEMENTS (red boxes with white numbers).

**TASK:** Find: "${description}"

**DETECTED ELEMENTS:**
${elementList}

**YOUR JOB:**
Look at the numbered red boxes in the screenshot and select the number that best matches "${description}".

Return ONLY valid JSON:
{
  "selected_mark": <number>,
  "reasoning": "<why this element matches>"
}`;

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini', // 4x faster than gpt-4o
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${markedScreenshot}`,
                detail: 'low', // Low detail for speed
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 150, // Reduced for faster response
      temperature: 0,
    });

    const response = completion.choices[0]?.message?.content || '';
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const result = JSON.parse(cleaned);

    logger.info('🧠 [VISION-API-SOM] Element selection', {
      selectedMark: result.selected_mark,
      reasoning: result.reasoning,
    });

    return result.selected_mark;
  }

  /**
   * Refine coordinates using nearby detected elements as geometric anchors
   */
  private refineCoordinatesWithAnchors(
    approximateCoords: { x: number; y: number },
    description: string,
    elements: DetectedElement[],
    context: any
  ): { x: number; y: number } | null {
    const screenWidth = context?.screenshotWidth || context?.screenWidth || 1440;
    const screenHeight = context?.screenshotHeight || context?.screenHeight || 900;
    
    // Common UI patterns and their geometric relationships
    const patterns = {
      'hamburger menu': {
        // Hamburger menus are typically 40-80px from left edge, 40-80px from top
        expectedRegion: { xMin: 0.02, xMax: 0.08, yMin: 0.04, yMax: 0.12 },
        // Usually 50-70px left of the app logo/title
        anchorRelationship: (anchor: DetectedElement) => {
          if (anchor.label.toLowerCase().includes('chatgpt') || 
              anchor.label.toLowerCase().includes('logo')) {
            return { x: anchor.bbox.x1 - 60, y: (anchor.bbox.y1 + anchor.bbox.y2) / 2 };
          }
          return null;
        },
      },
      'sidebar toggle': {
        expectedRegion: { xMin: 0.02, xMax: 0.08, yMin: 0.04, yMax: 0.12 },
        anchorRelationship: (anchor: DetectedElement) => {
          if (anchor.label.toLowerCase().includes('chatgpt')) {
            return { x: anchor.bbox.x1 - 60, y: (anchor.bbox.y1 + anchor.bbox.y2) / 2 };
          }
          return null;
        },
      },
      'profile': {
        // Profile buttons are typically in top-right or bottom area
        expectedRegion: { xMin: 0.85, xMax: 0.98, yMin: 0.02, yMax: 0.15 },
        anchorRelationship: (anchor: DetectedElement) => {
          // Profile icon is usually above the profile name text
          if (anchor.source === 'ocr' && 
              description.toLowerCase().includes(anchor.label.toLowerCase().replace('Text: "', '').replace('"', ''))) {
            return { x: (anchor.bbox.x1 + anchor.bbox.x2) / 2, y: anchor.bbox.y1 - 30 };
          }
          return null;
        },
      },
    };
    
    // Detect which pattern matches the description
    let matchedPattern: any = null;
    for (const [key, pattern] of Object.entries(patterns)) {
      if (description.toLowerCase().includes(key)) {
        matchedPattern = pattern;
        break;
      }
    }
    
    if (!matchedPattern) {
      return null; // No pattern match, can't refine
    }
    
    // Find nearby anchor elements
    const nearbyElements = elements.filter(elem => {
      const distance = Math.sqrt(
        Math.pow(elem.bbox.x1 - approximateCoords.x, 2) +
        Math.pow(elem.bbox.y1 - approximateCoords.y, 2)
      );
      return distance < 200; // Within 200px
    });
    
    // Try to refine using anchor relationships
    for (const anchor of nearbyElements) {
      const refined = matchedPattern.anchorRelationship(anchor);
      if (refined) {
        // Validate refined coordinates are within expected region
        const normalizedX = refined.x / screenWidth;
        const normalizedY = refined.y / screenHeight;
        
        if (normalizedX >= matchedPattern.expectedRegion.xMin &&
            normalizedX <= matchedPattern.expectedRegion.xMax &&
            normalizedY >= matchedPattern.expectedRegion.yMin &&
            normalizedY <= matchedPattern.expectedRegion.yMax) {
          return refined;
        }
      }
    }
    
    // Fallback: Snap to expected region center
    const regionCenterX = Math.round(screenWidth * (matchedPattern.expectedRegion.xMin + matchedPattern.expectedRegion.xMax) / 2);
    const regionCenterY = Math.round(screenHeight * (matchedPattern.expectedRegion.yMin + matchedPattern.expectedRegion.yMax) / 2);
    
    logger.info('📐 [COORDINATE-REFINEMENT] Using geometric region center', {
      pattern: description,
      region: matchedPattern.expectedRegion,
      coordinates: { x: regionCenterX, y: regionCenterY },
    });
    
    return { x: regionCenterX, y: regionCenterY };
  }

  private async fallbackToVisionAPI(
    screenshot: { base64: string; mimeType: string },
    description: string,
    context: any
  ): Promise<DetectionResult> {
    logger.warn('⚠️ [SPATIAL-DETECTION] Using Vision API fallback');
    
    if (!openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const screenWidth = context?.screenWidth || 0;
    const screenHeight = context?.screenHeight || 0;
    const screenInfo = screenWidth && screenHeight
      ? `Screen: ${screenWidth}x${screenHeight}`
      : '';

    const prompt = `Find the EXACT pixel coordinates of: "${description}"

${screenInfo}

**CRITICAL - COORDINATE SYSTEM:**
- Screenshot origin: Top-left corner (0, 0)
- X increases from left to right
- Y increases from top to bottom
- Top of screen: y = 0
- Bottom of screen: y = ${screenHeight || 'screen height'}
- Example: Element at bottom of screen has HIGH y value (near ${screenHeight})

**CRITICAL - BROWSER UI DISAMBIGUATION:**
- Browser Address Bar = Top of browser (y: 30-100), shows URL
- In-Page Search Box = Inside web page (y: 120+), application-specific
- Message Input Field = Usually at BOTTOM of screen (high y value, near ${screenHeight})

Return ONLY valid JSON:
{
  "x": <pixel number>,
  "y": <pixel number>,
  "confidence": <0.0 to 1.0>
}`;

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini', // 4x faster than gpt-4o
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${screenshot.mimeType};base64,${screenshot.base64}`,
                detail: 'low', // Low detail for speed
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 100, // Reduced for faster response
      temperature: 0,
    });

    const response = completion.choices[0]?.message?.content || '';
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const result = JSON.parse(cleaned);

    logger.info('🔍 [VISION-API] Coordinate analysis', {
      description,
      screenDimensions: `${screenWidth}x${screenHeight}`,
      rawCoordinates: { x: result.x, y: result.y },
      confidence: result.confidence,
    });

    return {
      coordinates: { x: result.x, y: result.y },
      confidence: result.confidence,
      method: 'vision_api_fallback',
    };
  }

  /**
   * Use LLM to intelligently determine if task requires menu bar interaction
   * Cached to reduce API calls
   */
  private async shouldFilterMenuBarElements(description: string, context: any): Promise<boolean> {
    // Normalize description for caching
    const cacheKey = description.toLowerCase().trim().substring(0, 100);
    
    // Check cache first
    if (this.menuBarFilterCache.has(cacheKey)) {
      const cached = this.menuBarFilterCache.get(cacheKey)!;
      logger.info('🎯 [MENU-BAR-FILTER] Using cached decision', {
        description: description.substring(0, 80),
        shouldFilter: cached,
      });
      return cached;
    }

    if (!openaiClient) {
      // Fallback to conservative approach if no LLM available
      logger.warn('⚠️ [MENU-BAR-FILTER] No OpenAI client, using conservative filtering');
      const fallback = description.toLowerCase().includes('window') || 
                       description.toLowerCase().includes('application') ||
                       description.toLowerCase().includes('open');
      this.menuBarFilterCache.set(cacheKey, fallback);
      return fallback;
    }

    const prompt = `Analyze this UI automation task and determine if it requires clicking menu bar items (File, Edit, View, etc. at the top of the screen).

Task: "${description}"
Active App: ${context?.activeApp || 'unknown'}

Answer with ONLY "true" or "false":
- "false" = Task requires menu bar interaction (File menu, Edit menu, preferences, etc.)
- "true" = Task is about windows, apps, icons, or other non-menu-bar elements

Examples:
- "Click File menu and select Save" → false (needs menu bar)
- "Open preferences from Edit menu" → false (needs menu bar)
- "Open TextEdit application" → true (filter menu bar)
- "Click the TextEdit window" → true (filter menu bar)
- "Find app icon in dock" → true (filter menu bar)

Return ONLY "true" or "false":`;

    try {
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini', // Use mini for speed
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
        temperature: 0,
      });

      const response = (completion.choices[0]?.message?.content || 'true').trim().toLowerCase();
      const shouldFilter = response === 'true';
      
      // Cache the decision
      this.menuBarFilterCache.set(cacheKey, shouldFilter);
      
      logger.info('🤖 [MENU-BAR-FILTER] LLM decision', {
        description: description.substring(0, 80),
        shouldFilter,
        response,
      });

      return shouldFilter;
    } catch (error: any) {
      logger.error('❌ [MENU-BAR-FILTER] LLM call failed, using conservative filtering', {
        error: error.message,
      });
      // Fallback to conservative filtering
      const fallback = description.toLowerCase().includes('window') || 
                       description.toLowerCase().includes('application') ||
                       description.toLowerCase().includes('open');
      this.menuBarFilterCache.set(cacheKey, fallback);
      return fallback;
    }
  }

  private getCenter(bbox: { x1: number; y1: number; x2: number; y2: number }): { x: number; y: number } {
    return {
      x: Math.round((bbox.x1 + bbox.x2) / 2),
      y: Math.round((bbox.y1 + bbox.y2) / 2),
    };
  }
}

export const uiDetectionService = new UIDetectionService();
