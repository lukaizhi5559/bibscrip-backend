import { logger } from '../utils/logger';
import { LLMRouter } from '../utils/llmRouter';

interface ParsedElement {
  id: number;
  type: 'text' | 'icon';
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  normalizedBbox: [number, number, number, number];
  interactivity: boolean;
  content: string;
  confidence: number;
}

interface ElementMatchResult {
  element: ParsedElement | null;
  confidence: number;
  reasoning: string;
  attemptNumber?: number;
  excludedCount?: number;
}

interface MatchOptions {
  intentType?: string;
  activeApp?: string;
  activeUrl?: string;
  screenshotWidth?: number;
  screenshotHeight?: number;
  excludedElementIds?: number[]; // Elements to exclude from matching (failed attempts)
  maxRetries?: number;
}

export class LLMElementMatcher {
  private llmRouter: LLMRouter;

  constructor() {
    this.llmRouter = new LLMRouter();
  }

  /**
   * Match element with automatic retry on failure
   * This is the main entry point - it handles retries automatically
   */
  async matchElementWithRetry(
    description: string,
    elements: ParsedElement[],
    options: MatchOptions = {}
  ): Promise<ElementMatchResult> {
    const maxRetries = options.maxRetries || 3;
    const excludedIds: number[] = options.excludedElementIds || [];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info('🔄 [LLM_MATCHER] Match attempt', {
        description,
        attempt,
        maxRetries,
        excludedCount: excludedIds.length,
      });

      const result = await this.matchElement(description, elements, {
        ...options,
        excludedElementIds: excludedIds,
      });

      if (result.element) {
        return {
          ...result,
          attemptNumber: attempt,
          excludedCount: excludedIds.length,
        };
      }

      // No match found - if we have more retries, continue
      if (attempt < maxRetries) {
        logger.warn('⚠️ [LLM_MATCHER] No match on attempt, will retry', {
          description,
          attempt,
          remainingRetries: maxRetries - attempt,
        });
        // Don't exclude anything yet - just retry with different LLM response
        continue;
      }
    }

    // All retries exhausted
    return {
      element: null,
      confidence: 0,
      reasoning: `No match found after ${maxRetries} attempts`,
      attemptNumber: maxRetries,
      excludedCount: excludedIds.length,
    };
  }

  /**
   * Use LLM to intelligently match a description to the best element
   * Internal method - use matchElementWithRetry for automatic retries
   */
  async matchElement(
    description: string,
    elements: ParsedElement[],
    options: MatchOptions = {}
  ): Promise<ElementMatchResult> {
    if (elements.length === 0) {
      return {
        element: null,
        confidence: 0,
        reasoning: 'No elements provided',
      };
    }

    // Filter out excluded elements (from previous failed attempts)
    const excludedIds = options.excludedElementIds || [];
    const availableElements = excludedIds.length > 0
      ? elements.filter(e => !excludedIds.includes(e.id))
      : elements;

    if (availableElements.length === 0) {
      logger.warn('⚠️ [LLM_MATCHER] All elements excluded', {
        description,
        totalElements: elements.length,
        excludedCount: excludedIds.length,
      });
      return {
        element: null,
        confidence: 0,
        reasoning: 'All elements have been excluded from previous attempts',
      };
    }

    // Pre-filter candidates to reduce LLM input size
    const candidates = this.preFilterCandidates(description, availableElements, options);

    if (candidates.length === 0) {
      logger.warn('⚠️ [LLM_MATCHER] No candidates after pre-filtering', {
        description,
        totalElements: elements.length,
      });
      return {
        element: null,
        confidence: 0,
        reasoning: 'No matching candidates found',
      };
    }

    logger.info('🤖 [LLM_MATCHER] Starting LLM-based matching', {
      description,
      candidateCount: candidates.length,
      totalElements: elements.length,
      availableElements: availableElements.length,
      excludedCount: excludedIds.length,
    });

    // Build prompt
    const prompt = this.buildMatchingPrompt(description, candidates, options);

    try {
      // Use LLMRouter to process the matching prompt
      const response = await this.llmRouter.processPrompt(prompt, {
        skipCache: false, // Cache matching results for performance
        taskType: 'element_matching',
      });

      // Parse LLM response
      const result = this.parseLLMResponse(response.text, candidates);
      
      logger.info('✅ [LLM_MATCHER] Match found', {
        description,
        matched: result.element?.content,
        confidence: result.confidence,
        reasoning: result.reasoning,
      });

      return result;
    } catch (error: any) {
      logger.error('❌ [LLM_MATCHER] LLM matching failed', {
        description,
        error: error.message,
      });
      
      // Fallback: return first candidate
      return {
        element: candidates[0],
        confidence: 0.5,
        reasoning: `LLM matching failed, using first candidate: ${error.message}`,
      };
    }
  }

  /**
   * Pre-filter candidates to reduce LLM input size
   * Conservative filtering to minimize false positives
   */
  private preFilterCandidates(
    description: string,
    elements: ParsedElement[],
    context?: any
  ): ParsedElement[] {
    const descLower = description.toLowerCase().trim();
    
    // First, exclude obvious non-matches (debugging info, timestamps, etc.)
    const cleanElements = elements.filter((elem) => {
      if (!elem.content) return false;
      const content = elem.content.toLowerCase().trim();
      
      // Exclude debugging/log elements
      if (content.match(/\d+\.\d+s/)) return false; // timestamps
      if (content.includes('backend:') || content.includes('frontend:')) return false;
      if (content.includes('thinking') || content.includes('iteration')) return false;
      if (content.includes('llm:') || content.includes('action')) return false;
      
      return true;
    });

    // Spotlight-specific filtering: Exclude search input area
    const isSpotlight = context?.intentType === 'spotlight_search';
    let searchPool = cleanElements;
    
    if (isSpotlight) {
      // In Spotlight, exclude elements in the search bar area (top ~22% of screen)
      // The search input text appears around y=0.28, but we want results below that
      searchPool = cleanElements.filter((elem) => {
        const centerY = (elem.bbox.y1 + elem.bbox.y2) / 2;
        // Exclude top search bar area - results are typically below y=0.22
        return centerY > 0.22;
      });
      
      logger.info('🔍 [LLM_MATCHER] Spotlight filtering applied', {
        description,
        originalCount: cleanElements.length,
        afterSpotlightFilter: searchPool.length,
      });
    }

    // Strategy 1: Try exact filename match first (highest priority)
    const filenameMatch = description.match(/([\w\-\.]+\.[a-zA-Z]{2,4})/);
    if (filenameMatch) {
      const filename = filenameMatch[1].toLowerCase();
      const filenameMatches = searchPool.filter((elem) => {
        const contentLower = elem.content.toLowerCase().trim();
        
        // Normalize by removing both spaces AND dots/special chars
        // OmniParser returns "test.txt rtf" instead of "test.txt.rtf"
        const normalizedContent = contentLower.replace(/[\s\.]+/g, '');
        const normalizedFilename = filename.replace(/[\s\.]+/g, '');
        
        // Also try exact match with original formatting
        return normalizedContent.includes(normalizedFilename) || 
               contentLower.includes(filename) ||
               contentLower.replace(/\s+/g, '.').includes(filename);
      });
      
      if (filenameMatches.length > 0) {
        // For Spotlight: Filter out large elements (likely search result containers)
        // Prefer smaller, specific file items
        if (isSpotlight) {
          const compactMatches = filenameMatches.filter((elem) => {
            const width = elem.bbox.x2 - elem.bbox.x1;
            const height = elem.bbox.y2 - elem.bbox.y1;
            // Exclude elements that are too large (likely containers, not file items)
            // File items in Spotlight are typically small (width < 0.3, height < 0.15)
            return width < 0.30 && height < 0.15;
          });
          
          if (compactMatches.length > 0) {
            logger.info('🎯 [LLM_MATCHER] Pre-filter: Compact filename matches (filtered large containers)', {
              description,
              filename,
              matchCount: compactMatches.length,
              filteredOut: filenameMatches.length - compactMatches.length,
            });
            return compactMatches.slice(0, 10);
          }
        }
        
        logger.info('🎯 [LLM_MATCHER] Pre-filter: Exact filename matches', {
          description,
          filename,
          matchCount: filenameMatches.length,
        });
        // High confidence - return all filename matches (usually 1-5)
        return filenameMatches.slice(0, 10);
      }
      
      // Fallback for Spotlight: If no text matches found, look for interactive elements
      // that might be the file result (OmniParser sometimes detects file results as icons)
      if (isSpotlight) {
        const interactiveInResults = searchPool.filter((elem) => {
          const centerY = (elem.bbox.y1 + elem.bbox.y2) / 2;
          // Look for interactive elements in the results area (y > 0.22, y < 0.50)
          return elem.interactivity && centerY > 0.22 && centerY < 0.50;
        });
        
        if (interactiveInResults.length > 0) {
          logger.info('🎯 [LLM_MATCHER] Spotlight fallback: Interactive elements in results area', {
            description,
            matchCount: interactiveInResults.length,
          });
          return interactiveInResults.slice(0, 20);
        }
      }
    }

    // Strategy 2: Exact content match
    const exactMatches = cleanElements.filter((elem) => {
      const contentLower = elem.content.toLowerCase().trim();
      return contentLower === descLower;
    });
    
    if (exactMatches.length > 0) {
      logger.info('🎯 [LLM_MATCHER] Pre-filter: Exact content matches', {
        description,
        matchCount: exactMatches.length,
      });
      // High confidence - return all exact matches (usually 1-3)
      return exactMatches.slice(0, 10);
    }

    // Strategy 3: Strong partial match (requires significant word overlap)
    const descWords = descLower.split(/\s+/).filter(w => w.length > 3); // Only meaningful words
    const strongMatches = cleanElements.filter((elem) => {
      const contentLower = elem.content.toLowerCase().trim();
      const contentWords = contentLower.split(/\s+/);
      
      // Require at least 50% word overlap for multi-word descriptions
      if (descWords.length > 1) {
        const overlap = descWords.filter(dw => 
          contentWords.some(cw => cw === dw || cw.includes(dw) || dw.includes(cw))
        );
        return overlap.length >= Math.ceil(descWords.length * 0.5);
      }
      
      // For single-word descriptions, require the word to be present
      return contentWords.some(cw => cw === descWords[0] || cw.includes(descWords[0]));
    });

    if (strongMatches.length > 0) {
      logger.info('🎯 [LLM_MATCHER] Pre-filter: Strong partial matches', {
        description,
        matchCount: strongMatches.length,
      });
      
      // Medium confidence - return more candidates to avoid missing target
      // Prioritize interactive elements if we have many matches
      if (strongMatches.length > 30) {
        const interactive = strongMatches.filter(m => m.interactivity);
        if (interactive.length > 0) {
          return interactive.slice(0, 30);
        }
      }
      
      return strongMatches.slice(0, 30);
    }

    // Strategy 4: Fallback - return all clean elements (let LLM decide)
    // This happens when description is very generic or no good pre-matches
    logger.warn('⚠️ [LLM_MATCHER] Pre-filter: No strong matches, using all elements', {
      description,
      elementCount: cleanElements.length,
    });
    
    // Low confidence - return more candidates to maximize chance of finding target
    // Prioritize interactive elements for generic queries
    const interactive = cleanElements.filter(e => e.interactivity);
    if (interactive.length > 0) {
      return interactive.slice(0, 40);
    }
    
    // If no interactive elements, return all clean elements
    return cleanElements.slice(0, 40);
  }

  /**
   * Build the LLM matching prompt
   */
  private buildMatchingPrompt(
    description: string,
    candidates: ParsedElement[],
    context: any
  ): string {
    // Determine spatial context hints
    const spatialHints = this.getSpatialHints(candidates, context);

    // Build element list with spatial information
    const elementList = candidates
      .map((elem, idx) => {
        const spatial = this.getElementSpatialDescription(elem, context);
        const interactive = elem.interactivity ? '✓ interactive' : '✗ not interactive';
        return `${idx + 1}. "${elem.content}" (${elem.type}, ${spatial}, ${interactive})`;
      })
      .join('\n');

    // Intent-specific guidance
    const intentGuidance = this.getIntentSpecificGuidance(context.intentType);

    return `You are an expert UI element matcher. Your task is to select the BEST matching element for a given description.

**Target Description:**
"${description}"

**Context:**
- Active app: ${context.activeApp || 'unknown'}
- Intent type: ${context.intentType || 'unknown'}
- Screen size: ${context.screenshotWidth || '?'}x${context.screenshotHeight || '?'}

**Available Elements:**
${elementList}

**Spatial Context:**
${spatialHints}

**Matching Rules:**
1. **Exact matches** take priority over partial matches
2. **Interactive elements** are preferred for clickable actions
3. **Spatial context matters**: Consider element position (menu bar vs content area)
4. **Avoid false positives**: Skip menu items when looking for content, skip generic words
5. **File extensions**: "test.txt.rtf" should match "test.txt rtf" (spaces in extensions are common)
6. **Case insensitive**: Treat uppercase and lowercase as equivalent

${intentGuidance}

**Output Format:**
Return ONLY a JSON object with this exact structure:
{
  "elementIndex": <number 1-${candidates.length}>,
  "confidence": <number 0.0-1.0>,
  "reasoning": "<brief explanation>"
}

**Examples:**
- If description is "test.txt.rtf" and element 5 is "test.txt rtf", return: {"elementIndex": 5, "confidence": 0.95, "reasoning": "Exact filename match"}
- If description is "search input" and element 2 is "Ask anything", return: {"elementIndex": 2, "confidence": 0.9, "reasoning": "Search input field with placeholder text"}
- If description is "close button" and element 8 is "×", return: {"elementIndex": 8, "confidence": 0.85, "reasoning": "Close button symbol"}

**Important:**
- Return ONLY the JSON object, no additional text
- If no good match exists, return {"elementIndex": 1, "confidence": 0.3, "reasoning": "No clear match, returning first candidate"}`;
  }

  /**
   * Get intent-specific guidance for matching
   */
  private getIntentSpecificGuidance(intentType?: string): string {
    if (!intentType) return '';

    switch (intentType) {
      case 'spotlight_search':
        return `**CRITICAL - Spotlight Search Rules:**
- **Prioritize TOP area elements** (y < 30% of screen height) - Spotlight results appear at the top
- **Text elements are valid targets** - Spotlight file results are often detected as non-interactive text
- **Ignore browser/web elements** - Skip Google Chrome, Safari, or web search results
- **Exact filename match in top area** beats interactive icon in middle/bottom area
- If multiple matches exist, choose the one HIGHEST on the screen (smallest y coordinate)`;

      case 'browser_navigation':
        return `**Browser Navigation Rules:**
- Prioritize interactive elements in the address bar or navigation area
- URL inputs are typically in the top 10% of the screen`;

      case 'file_explorer':
        return `**File Explorer Rules:**
- File/folder names in the main content area (center) are the target
- Avoid sidebar or menu bar elements`;

      default:
        return '';
    }
  }

  /**
   * Get spatial hints about element distribution
   */
  private getSpatialHints(candidates: ParsedElement[], context: any): string {
    const screenHeight = context.screenshotHeight || 900;
    const topThreshold = screenHeight * 0.1; // Top 10% is likely menu bar
    const bottomThreshold = screenHeight * 0.9; // Bottom 10% is likely status bar

    const topElements = candidates.filter(e => e.bbox.y1 < topThreshold);
    const bottomElements = candidates.filter(e => e.bbox.y1 > bottomThreshold);
    const centerElements = candidates.filter(e => e.bbox.y1 >= topThreshold && e.bbox.y1 <= bottomThreshold);

    const hints: string[] = [];
    if (topElements.length > 0) {
      hints.push(`- Top area (menu bar): ${topElements.length} elements`);
    }
    if (centerElements.length > 0) {
      hints.push(`- Center area (main content): ${centerElements.length} elements`);
    }
    if (bottomElements.length > 0) {
      hints.push(`- Bottom area (status bar): ${bottomElements.length} elements`);
    }

    return hints.join('\n') || '- No clear spatial distribution';
  }

  /**
   * Get spatial description for a single element
   */
  private getElementSpatialDescription(elem: ParsedElement, context: any): string {
    const screenHeight = context.screenshotHeight || 900;
    const screenWidth = context.screenshotWidth || 1440;
    
    const centerY = (elem.bbox.y1 + elem.bbox.y2) / 2;
    const centerX = (elem.bbox.x1 + elem.bbox.x2) / 2;

    // Vertical position
    let vertical = 'center';
    if (centerY < screenHeight * 0.1) vertical = 'top';
    else if (centerY > screenHeight * 0.9) vertical = 'bottom';

    // Horizontal position
    let horizontal = 'center';
    if (centerX < screenWidth * 0.2) horizontal = 'left';
    else if (centerX > screenWidth * 0.8) horizontal = 'right';

    return `${vertical}-${horizontal}`;
  }

  /**
   * Parse LLM response and extract the matched element
   */
  private parseLLMResponse(
    response: string,
    candidates: ParsedElement[]
  ): ElementMatchResult {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = response.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```\n?$/g, '').trim();
      }

      const parsed = JSON.parse(jsonStr);
      const elementIndex = parsed.elementIndex;
      const confidence = parsed.confidence;
      const reasoning = parsed.reasoning;

      // Validate
      if (typeof elementIndex !== 'number' || elementIndex < 1 || elementIndex > candidates.length) {
        throw new Error(`Invalid elementIndex: ${elementIndex}`);
      }

      if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
        throw new Error(`Invalid confidence: ${confidence}`);
      }

      // Return matched element (convert 1-indexed to 0-indexed)
      return {
        element: candidates[elementIndex - 1],
        confidence,
        reasoning: reasoning || 'LLM match',
      };
    } catch (error: any) {
      logger.error('❌ [LLM_MATCHER] Failed to parse LLM response', {
        response,
        error: error.message,
      });

      // Fallback: return first candidate
      return {
        element: candidates[0],
        confidence: 0.5,
        reasoning: `Failed to parse LLM response: ${error.message}`,
      };
    }
  }
}
