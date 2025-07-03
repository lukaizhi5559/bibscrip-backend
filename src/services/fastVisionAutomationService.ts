// Fast Vision-First Automation Service optimized for sub-5-second execution
import screenshot from 'screenshot-desktop';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { logger } from '../utils/logger';
import { fastLLMRouter } from '../utils/fastLLMRouter';
import { DesktopAutomationService } from './desktopAutomationService';
import { z } from 'zod';
import axios from 'axios';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import path from 'path';

// Enhanced OCR result interface with bounding boxes and confidence
interface EnhancedOCRResult {
  text: string;
  boundingBoxes: Array<{
    text: string;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
  confidence: number;
  source: 'local' | 'cloud';
  processingTime: number;
}

// Screenshot data interface
interface ScreenshotData {
  buffer: Buffer;
  width: number;
  height: number;
  timestamp: string;
  format: string;
}

// Action interface
interface Action {
  type: string;
  coordinates?: { x: number; y: number };
  text?: string;
  startCoordinates?: { x: number; y: number };
  key?: string;
  duration?: number;
  direction?: string;
  amount?: number;
}

// Fast execution schema for speed optimization
const FastActionSchema = z.object({
  type: z.enum(['click', 'moveMouse', 'type', 'screenshot', 'rightClick', 'doubleClick', 'drag', 'scroll', 'keyboardShortcut', 'hover', 'pressKey']),
  coordinates: z.object({
    x: z.number(),
    y: z.number()
  }).optional(),
  text: z.string().optional(),
  dragTo: z.object({
    x: z.number(),
    y: z.number()
  }).optional()
});

const FastActionPlanSchema = z.object({
  actions: z.array(FastActionSchema),
  confidence: z.number().min(0).max(1),
  reasoning: z.string()
});

/**
 * Fast Vision-First Automation Service
 * Optimized for sub-5-second desktop automation execution
 */
export class FastVisionAutomationService {
  private desktopAutomation: any; // Use existing service instance
  private ocrWorker: any;
  private visionClient: ImageAnnotatorClient | null = null;
  private isInitialized: boolean = false;
  private screenshotCache: Map<string, ScreenshotData> = new Map();
  private cacheTimeout: number = 1000; // 1 second cache for ultra-fast execution

  constructor() {
    // Use existing desktop automation service instance
    this.desktopAutomation = require('./desktopAutomationService').desktopAutomationService;
    
    // Initialize Google Cloud Vision client if credentials are available
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        this.visionClient = new ImageAnnotatorClient();
        logger.info('Google Cloud Vision client initialized successfully');
      } catch (error) {
        logger.warn('Failed to initialize Google Cloud Vision client:', { error });
        this.visionClient = null;
      }
    } else {
      logger.info('Google Cloud Vision not configured (GOOGLE_APPLICATION_CREDENTIALS not set)');
    }
  }

  /**
   * Initialize service with minimal overhead
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Initialize OCR worker with minimal configuration for speed
      this.ocrWorker = await createWorker('eng', 1, {
        logger: () => {} // Disable OCR logging for speed
      });
      
      await this.ocrWorker.setParameters({
        tessedit_pageseg_mode: '6', // Uniform block of text
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?-()[]{}:;'
      });

      // Desktop automation service initializes itself in constructor
      this.isInitialized = true;
      
      logger.info('FastVisionAutomationService initialized');
    } catch (error) {
      logger.error('Failed to initialize FastVisionAutomationService:', { error });
      throw error;
    }
  }

  /**
   * Ultra-fast screenshot capture with aggressive optimization
   */
  private async captureScreenshotFast(): Promise<ScreenshotData> {
    const cacheKey = 'current_screenshot';
    const cached = this.screenshotCache.get(cacheKey);
    
    // Use cached screenshot if recent (within 1 second for speed)
    if (cached && (Date.now() - new Date(cached.timestamp).getTime()) < 1000) {
      return cached;
    }

    try {
      // Use JPEG format for faster capture (quality handled by sharp)
      const buffer = await screenshot({ format: 'jpg' });
      
      // Get display info for dimensions
      const displays = await screenshot.listDisplays();
      const primaryDisplay = displays[0];
      
      // Use sharp to get actual dimensions and optimize quality
      const optimizedBuffer = await sharp(buffer)
        .jpeg({ quality: 75 })
        .toBuffer();
      
      const metadata = await sharp(optimizedBuffer).metadata();
      
      const screenshotData: ScreenshotData = {
        buffer: optimizedBuffer,
        width: metadata.width || 1920,
        height: metadata.height || 1200,
        timestamp: new Date().toISOString(),
        format: 'jpg'
      };

      // Cache the screenshot
      this.screenshotCache.set(cacheKey, screenshotData);
      
      // Clear cache after timeout
      setTimeout(() => {
        this.screenshotCache.delete(cacheKey);
      }, 1000);

      return screenshotData;
    } catch (error) {
      logger.error('Fast screenshot capture failed:', { error });
      throw error;
    }
  }

  /**
   * Hybrid OCR pipeline with Google Cloud Vision first, local fallback
   * Prioritizes accuracy with Google Cloud Vision API
   */
  private async performHybridOCR(imageBuffer: Buffer): Promise<EnhancedOCRResult> {
    const startTime = Date.now();
    
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    try {
      // Enhanced image preprocessing for better OCR accuracy
      const preprocessedBuffer = await sharp(imageBuffer)
        .resize(1600, null, { fit: 'inside', withoutEnlargement: true }) // Higher resolution for clarity
        .greyscale()
        .normalize() // Better contrast
        .sharpen() // Enhance text edges
        .threshold(160) // Binary threshold for text clarity
        .png() // PNG for better text preservation
        .toBuffer();

      // Try Google Cloud Vision first for best accuracy
      logger.info('Attempting Google Cloud Vision OCR first');
      const cloudResult = await this.performCloudOCR(preprocessedBuffer);
      
      // Check if cloud OCR was successful
      if (cloudResult.confidence > 0.5 && cloudResult.text.length > 0) {
        const processingTime = Date.now() - startTime;
        logger.info('Google Cloud Vision OCR successful', { confidence: cloudResult.confidence, processingTime, source: 'cloud' });
        return {
          text: cloudResult.text,
          boundingBoxes: cloudResult.boundingBoxes || [],
          confidence: cloudResult.confidence,
          source: 'cloud',
          processingTime
        };
      }
      
      // Fallback to local OCR if cloud OCR failed or returned poor results
      logger.info('Cloud OCR insufficient, falling back to local OCR', { cloudConfidence: cloudResult.confidence });
      const localResult = await this.performLocalOCR(preprocessedBuffer);
      const processingTime = Date.now() - startTime;
      
      return {
        text: localResult.text,
        boundingBoxes: localResult.boundingBoxes || [],
        confidence: localResult.confidence,
        source: 'local',
        processingTime
      };
      
    } catch (error) {
      logger.error('Hybrid OCR failed completely:', { error });
      return {
        text: '',
        boundingBoxes: [],
        confidence: 0,
        source: 'local',
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Perform local OCR with Tesseract.js
   */
  private async performLocalOCR(imageBuffer: Buffer): Promise<{ text: string; confidence: number; boundingBoxes?: any[] }> {
    try {
      // Remove logger option to avoid DataCloneError with worker threads
      const ocrPromise = this.ocrWorker.recognize(imageBuffer);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Local OCR timeout')), 2000)
      );
      
      const result = await Promise.race([ocrPromise, timeoutPromise]);
      
      return {
        text: result.data.text.trim(),
        confidence: result.data.confidence / 100, // Convert to 0-1 scale
        boundingBoxes: result.data.words?.map((word: any) => ({
          text: word.text,
          bbox: {
            x: word.bbox.x0,
            y: word.bbox.y0,
            width: word.bbox.x1 - word.bbox.x0,
            height: word.bbox.y1 - word.bbox.y0
          },
          confidence: word.confidence / 100
        })) || []
      };
    } catch (error) {
      logger.warn('Local OCR failed:', { error });
      return { text: '', confidence: 0, boundingBoxes: [] };
    }
  }

  /**
   * Perform cloud OCR using Google Cloud Vision API
   */
  private async performCloudOCR(imageBuffer: Buffer): Promise<{ text: string; confidence: number; boundingBoxes?: any[] }> {
    try {
      if (!this.visionClient) {
        logger.warn('Google Cloud Vision client not available, falling back to enhanced local OCR');
        return this.performEnhancedLocalOCR(imageBuffer);
      }

      logger.info('Performing Google Cloud Vision OCR');
      const startTime = Date.now();

      // Convert buffer to base64 for Google Cloud Vision
      const imageBase64 = imageBuffer.toString('base64');
      
      // Perform text detection with Google Cloud Vision
      const [result] = await this.visionClient.textDetection({
        image: {
          content: imageBase64
        }
      });

      const detections = result.textAnnotations;
      const processingTime = Date.now() - startTime;

      if (!detections || detections.length === 0) {
        logger.warn('Google Cloud Vision returned no text detections');
        return { text: '', confidence: 0, boundingBoxes: [] };
      }

      // First detection contains the full text
      const fullText = detections[0]?.description || '';
      
      // Calculate average confidence from individual word detections
      let totalConfidence = 0;
      let wordCount = 0;
      
      // Extract bounding boxes from individual word detections (skip first which is full text)
      const boundingBoxes = detections.slice(1).map((detection) => {
        const vertices = detection.boundingPoly?.vertices || [];
        if (vertices.length >= 4) {
          const x = Math.min(...vertices.map(v => v.x || 0));
          const y = Math.min(...vertices.map(v => v.y || 0));
          const maxX = Math.max(...vertices.map(v => v.x || 0));
          const maxY = Math.max(...vertices.map(v => v.y || 0));
          
          // Google Cloud Vision doesn't provide per-word confidence, so we estimate high confidence
          const confidence = 0.95;
          totalConfidence += confidence;
          wordCount++;
          
          return {
            text: detection.description || '',
            bbox: {
              x,
              y,
              width: maxX - x,
              height: maxY - y
            },
            confidence
          };
        }
        return null;
      }).filter(Boolean);

      // Calculate overall confidence (Google Cloud Vision is generally very accurate)
      const overallConfidence = wordCount > 0 ? totalConfidence / wordCount : 0.9;

      logger.info('Google Cloud Vision OCR completed', {
        textLength: fullText.length,
        wordCount: boundingBoxes.length,
        confidence: overallConfidence,
        processingTime
      });

      return {
        text: fullText.trim(),
        confidence: overallConfidence,
        boundingBoxes
      };

    } catch (error) {
      logger.error('Google Cloud Vision OCR failed:', { error });
      
      // Fallback to enhanced local OCR if cloud fails
      logger.info('Falling back to enhanced local OCR due to cloud failure');
      return this.performEnhancedLocalOCR(imageBuffer);
    }
  }

  /**
   * Enhanced local OCR fallback with different Tesseract settings
   */
  private async performEnhancedLocalOCR(imageBuffer: Buffer): Promise<{ text: string; confidence: number; boundingBoxes?: any[] }> {
    try {
      // Remove logger to avoid DataCloneError, keep other tesseract options
      const fallbackResult = await this.ocrWorker.recognize(imageBuffer, {
        tessedit_pageseg_mode: '6', // Uniform block of text
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?-()[]{}:;"\'/'
      });
      
      return {
        text: fallbackResult.data.text.trim(),
        confidence: Math.min(0.85, (fallbackResult.data.confidence / 100) + 0.05), // Slightly boost confidence but keep realistic
        boundingBoxes: fallbackResult.data.words?.map((word: any) => ({
          text: word.text,
          bbox: {
            x: word.bbox.x0,
            y: word.bbox.y0,
            width: word.bbox.x1 - word.bbox.x0,
            height: word.bbox.y1 - word.bbox.y0
          },
          confidence: word.confidence / 100
        })) || []
      };
    } catch (error) {
      logger.error('Enhanced local OCR fallback failed:', { error });
      return { text: '', confidence: 0, boundingBoxes: [] };
    }
  }

  /**
   * Check if OCR text appears garbled or meaningless
   */
  private isTextGarbled(text: string): boolean {
    if (!text || text.length < 5) return true;
    
    // Check for excessive special characters or fragmented words
    const specialCharRatio = (text.match(/[^a-zA-Z0-9\s]/g) || []).length / text.length;
    const hasReasonableWords = /\b[a-zA-Z]{3,}\b/.test(text);
    
    return specialCharRatio > 0.5 || !hasReasonableWords;
  }

  /**
   * Ultra-fast task execution with parallel processing and aggressive optimization
   */
  async executeTaskFast(
    taskDescription: string,
    maxIterations: number = 2 // Further reduced for speed
  ): Promise<{
    success: boolean;
    iterations: number;
    executionTime: number;
    executionLog: string[];
  }> {
    const startTime = performance.now();
    const executionLog: string[] = [];
    let currentIteration = 0;

    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      executionLog.push(`🚀 Ultra-fast execution started: "${taskDescription}"`);

      while (currentIteration < maxIterations) {
        currentIteration++;
        const iterationStart = performance.now();
        
        executionLog.push(`\n--- Ultra-Fast Iteration ${currentIteration} ---`);

        // Step 1: Fast screenshot capture
        const screenshot = await this.captureScreenshotFast();
        
        // Step 2: Enhanced OCR processing with hybrid pipeline
        const ocrPromise = this.performHybridOCR(screenshot.buffer);
        
        // Ultra-aggressive image optimization for fastest LLM processing
        const optimizedImagePromise = sharp(screenshot.buffer)
          .resize(640, 480, { fit: 'inside', withoutEnlargement: true }) // Even smaller for speed
          .jpeg({ quality: 40 }) // Lower quality for speed
          .toBuffer()
          .then(buffer => buffer.toString('base64'));
        
        // Step 3: Prepare fast LLM prompt
        const prompt = this.createFastPrompt(taskDescription, screenshot);
        
        // Step 4: Wait for optimized image and start LLM call
        const [ocrResult, base64Image] = await Promise.all([
          ocrPromise,
          optimizedImagePromise
        ]);
        
        // Enhanced prompt with OCR bounding box information
        const enhancedPrompt = this.createEnhancedPrompt(taskDescription, screenshot, ocrResult);
        
        const llmPromise = fastLLMRouter.processVisionActionPrompt(
          enhancedPrompt, 
          base64Image, 
          500 // Increased tokens for enhanced OCR context
        );
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('LLM timeout')), 10000) // 10s timeout to match FastLLMRouter for complex vision tasks
        );
        
        const llmResponse = await Promise.race([llmPromise, timeoutPromise]) as any;
        
        executionLog.push(`OCR: ${ocrResult.text.substring(0, 50)}... (${ocrResult.source}, conf: ${Math.round(ocrResult.confidence * 100)}%)`);
        executionLog.push(`LLM (${llmResponse.latencyMs || 0}ms): ${llmResponse.provider || 'unknown'}`);

        // Step 6: Parse and execute action
        const action = this.parseActionFromResponse(llmResponse.text || '');
        executionLog.push(`Action: ${action.type} ${action.coordinates ? `at (${action.coordinates.x}, ${action.coordinates.y})` : ''}`);

        // Step 7: Execute action (no verification for speed)
        const actionResult = await this.executeActionFast(action);
        executionLog.push(`Result: ${actionResult.success ? '✅' : '❌'} ${actionResult.message}`);

        // Step 8: Quick completion check
        if (this.isTaskLikelyComplete(taskDescription, action, actionResult)) {
          const totalTime = performance.now() - startTime;
          executionLog.push(`✅ Task completed in ${totalTime.toFixed(0)}ms`);
          
          return {
            success: true,
            iterations: currentIteration,
            executionTime: totalTime,
            executionLog
          };
        }

        const iterationTime = performance.now() - iterationStart;
        executionLog.push(`Iteration ${currentIteration}: ${iterationTime.toFixed(0)}ms`);
        
        // Early exit if we're approaching 7 second limit (allowing for real-world execution)
        if (performance.now() - startTime > 6500) {
          executionLog.push(`⏱️ Time limit approaching, stopping execution`);
          break;
        }
      }

      const totalTime = performance.now() - startTime;
      executionLog.push(`⏱️ Execution completed. Total time: ${totalTime.toFixed(0)}ms`);
      
      return {
        success: false,
        iterations: currentIteration,
        executionTime: totalTime,
        executionLog
      };

    } catch (error) {
      const totalTime = performance.now() - startTime;
      executionLog.push(`💥 Error: ${error}`);
      
      return {
        success: false,
        iterations: currentIteration,
        executionTime: totalTime,
        executionLog
      };
    }
  }

  /**
   * Map enhanced action types to compatible Action interface
   */
  private mapToCompatibleAction(action: any): Action {
    // Map enhanced action types to compatible ones
    switch (action.type) {
      case 'keyboardShortcut':
      case 'pressKey':
        return {
          type: 'keyPress',
          key: action.text || action.key,
          coordinates: action.coordinates
        };
      case 'hover':
        return {
          type: 'moveMouse',
          coordinates: action.coordinates
        };
      case 'drag':
        return {
          type: 'drag',
          coordinates: action.coordinates,
          startCoordinates: action.dragTo // Use startCoordinates as per ActionSchema
        };
      default:
        // For compatible types, return as-is with proper ActionSchema properties
        return {
          type: action.type,
          coordinates: action.coordinates,
          text: action.text,
          startCoordinates: action.startCoordinates || action.dragTo,
          key: action.key,
          duration: action.duration,
          direction: action.direction,
          amount: action.amount
        };
    }
  }

  /**
   * Intelligently analyze OCR results to identify and prioritize UI elements based on task context
   */
  private analyzeUIElementsForTask(taskDescription: string, ocrResult: EnhancedOCRResult, screenshot: ScreenshotData) {
    const priorityInputFields: Array<{text: string, centerX: number, centerY: number, confidence: number, reason: string}> = [];
    const possibleInputFields: Array<{text: string, centerX: number, centerY: number, confidence: number, reason: string}> = [];
    const clickableElements: Array<{text: string, centerX: number, centerY: number, confidence: number, reason: string}> = [];

    if (!ocrResult.boundingBoxes || ocrResult.boundingBoxes.length === 0) {
      return { priorityInputFields, possibleInputFields, clickableElements };
    }

    const task = taskDescription.toLowerCase();
    const isTypingTask = task.includes('type') || task.includes('input') || task.includes('enter');
    const isPromptTask = task.includes('prompt') || task.includes('chat') || task.includes('message');
    const isSearchTask = task.includes('search') || task.includes('find');

    // Analyze each detected text element
    ocrResult.boundingBoxes.forEach((box: any) => {
      const text = box.text.toLowerCase().trim();
      const centerX = box.bbox.x + box.bbox.width / 2;
      const centerY = box.bbox.y + box.bbox.height / 2;
      const confidence = box.confidence;

      // Skip very low confidence or empty text
      if (confidence < 0.3 || text.length === 0) {
        return;
      }

      // Analyze text content for input field indicators
      const inputFieldKeywords = [
        'ask anything', 'ask', 'prompt', 'chat', 'message', 'type here', 'enter text',
        'search', 'find', 'input', 'placeholder', 'write', 'compose', 'reply'
      ];

      const buttonKeywords = [
        'button', 'click', 'submit', 'send', 'go', 'ok', 'cancel', 'yes', 'no',
        'save', 'delete', 'edit', 'add', 'remove', 'close', 'open', 'start', 'stop'
      ];

      const hasInputKeyword = inputFieldKeywords.some(keyword => text.includes(keyword));
      const hasButtonKeyword = buttonKeywords.some(keyword => text.includes(keyword));

      // Position analysis
      const isBottomArea = centerY > screenshot.height * 0.7; // Bottom 30% of screen
      const isTopArea = centerY < screenshot.height * 0.3;    // Top 30% of screen
      const isCenterArea = centerY >= screenshot.height * 0.3 && centerY <= screenshot.height * 0.7;

      // Classify elements based on content and context
      if (hasInputKeyword) {
        let reason = 'Contains input field keywords';
        
        // High priority for task-specific matches
        if (isPromptTask && (text.includes('ask') || text.includes('prompt') || text.includes('chat'))) {
          reason = 'PERFECT MATCH: Chat/prompt input field for typing task';
          priorityInputFields.push({ text: box.text, centerX, centerY, confidence, reason });
        } else if (isSearchTask && (text.includes('search') || text.includes('find'))) {
          reason = 'PERFECT MATCH: Search input field for search task';
          priorityInputFields.push({ text: box.text, centerX, centerY, confidence, reason });
        } else {
          reason = 'Contains input field keywords';
          possibleInputFields.push({ text: box.text, centerX, centerY, confidence, reason });
        }
      } else if (isTypingTask && isBottomArea && text.length > 3 && !hasButtonKeyword) {
        // Likely input field at bottom of screen for typing tasks
        const reason = 'Bottom area text likely input field for typing task';
        priorityInputFields.push({ text: box.text, centerX, centerY, confidence, reason });
      } else if (isTypingTask && isTopArea && text.includes('search')) {
        // Search field at top
        const reason = 'Top area search field';
        possibleInputFields.push({ text: box.text, centerX, centerY, confidence, reason });
      } else if (hasButtonKeyword || (text.length <= 15 && /^[a-z\s]+$/.test(text))) {
        // Clickable elements
        const reason = hasButtonKeyword ? 'Contains button keywords' : 'Short text likely clickable';
        clickableElements.push({ text: box.text, centerX, centerY, confidence, reason });
      } else if (isTypingTask && isCenterArea && text.length > 5 && confidence > 0.7) {
        // Potential input areas in center with good confidence
        const reason = 'Center area text with good confidence, possible input';
        possibleInputFields.push({ text: box.text, centerX, centerY, confidence, reason });
      }
    });

    // Sort by relevance and confidence
    priorityInputFields.sort((a, b) => {
      // Prioritize perfect matches, then confidence
      const aIsPerfect = a.reason.includes('PERFECT MATCH');
      const bIsPerfect = b.reason.includes('PERFECT MATCH');
      if (aIsPerfect && !bIsPerfect) return -1;
      if (!aIsPerfect && bIsPerfect) return 1;
      return b.confidence - a.confidence;
    });

    possibleInputFields.sort((a, b) => b.confidence - a.confidence);
    clickableElements.sort((a, b) => b.confidence - a.confidence);

    return { priorityInputFields, possibleInputFields, clickableElements };
  }

  /**
   * Build task-specific guidance for the LLM based on task description
   */
  private buildTaskGuidance(taskDescription: string): string {
    const task = taskDescription.toLowerCase();
    const guidanceList: string[] = [];

    if (task.includes('type') || task.includes('input') || task.includes('enter text')) {
      guidanceList.push(`- For typing tasks: STEP 1: Use "click" action on the input field/text area. STEP 2: Use "type" action with the exact text. This is a TWO-STEP process.`);
      
      // Generic guidance for common input field patterns
      if (task.includes('prompt') || task.includes('chat') || task.includes('message')) {
        guidanceList.push(`- CHAT/PROMPT INPUT: Look for text input areas commonly located at the bottom of the screen. Check for input fields, text areas, or prompt boxes near the bottom edge.`);
      }
      
      if (task.includes('search') || task.includes('find')) {
        guidanceList.push(`- SEARCH INPUT: Look for search boxes typically located at the top of the screen or in toolbars. Common indicators: magnifying glass icons, "Search" placeholder text.`);
      }
      
      if (task.includes('form') || task.includes('field')) {
        guidanceList.push(`- FORM INPUT: Look for labeled input fields, text boxes with borders, or areas with cursor indicators. Check for form elements with clear visual boundaries.`);
      }
    }
    if (task.includes('click') || task.includes('button')) {
      guidanceList.push(`- For clicks, use "click" or "doubleClick" at the element's center.`);
    }
    if (task.includes('move') || task.includes('cursor')) {
      guidanceList.push(`- For cursor movement, use "moveMouse" with the desired coordinates.`);
    }
    if (task.includes('drag') || task.includes('drop')) {
      guidanceList.push(`- For drag-and-drop, use "drag" with start and end coordinates.`);
    }
    if (task.includes('scroll')) {
      guidanceList.push(`- For scrolling, use "scroll" with direction and distance.`);
    }
    if (task.includes('keyboard') || task.includes('shortcut')) {
      guidanceList.push(`- For shortcuts, use "keyboardShortcut" and specify key combo (e.g., Ctrl+S).`);
    }
    if (task.includes('press') || task.includes('key')) {
      guidanceList.push(`- For single key presses, use "pressKey" with key name (e.g., "Escape").`);
    }

    return guidanceList.length > 0 ? `\n\nTASK GUIDANCE:\n${guidanceList.join('\n')}` : '';
  }

  /**
   * Create enhanced prompt with OCR bounding box information
   */
  private createEnhancedPrompt(taskDescription: string, screenshot: ScreenshotData, ocrResult: EnhancedOCRResult): string {
    const centerX = Math.round(screenshot.width / 2);
    const centerY = Math.round(screenshot.height / 2);
    
    // Build guidance based on task analysis
    const guidance = this.buildTaskGuidance(taskDescription);
    
    // Analyze OCR results to intelligently identify and prioritize UI elements
    const uiAnalysis = this.analyzeUIElementsForTask(taskDescription, ocrResult, screenshot);
    
    // Include intelligent OCR analysis for better element targeting
    let ocrInfo = '';
    if (ocrResult.boundingBoxes && ocrResult.boundingBoxes.length > 0) {
      ocrInfo = `\n\nINTELLIGENT UI ELEMENT ANALYSIS:\n`;
      
      // Prioritize input fields for typing tasks
      if (uiAnalysis.priorityInputFields.length > 0) {
        ocrInfo += `\nHIGH-PRIORITY INPUT FIELDS (for typing tasks):\n`;
        uiAnalysis.priorityInputFields.forEach((field, index) => {
          ocrInfo += `${index + 1}. "${field.text}" at (${field.centerX}, ${field.centerY}) [conf: ${Math.round(field.confidence * 100)}%] - ${field.reason}\n`;
        });
      }
      
      // Show other potential input areas
      if (uiAnalysis.possibleInputFields.length > 0) {
        ocrInfo += `\nPOSSIBLE INPUT AREAS:\n`;
        uiAnalysis.possibleInputFields.slice(0, 3).forEach((field, index) => {
          ocrInfo += `${index + 1}. "${field.text}" at (${field.centerX}, ${field.centerY}) [conf: ${Math.round(field.confidence * 100)}%] - ${field.reason}\n`;
        });
      }
      
      // Show clickable elements
      if (uiAnalysis.clickableElements.length > 0) {
        ocrInfo += `\nCLICKABLE ELEMENTS:\n`;
        uiAnalysis.clickableElements.slice(0, 5).forEach((element, index) => {
          ocrInfo += `${index + 1}. "${element.text}" at (${element.centerX}, ${element.centerY}) [conf: ${Math.round(element.confidence * 100)}%]\n`;
        });
      }
    } else {
      // Provide fallback guidance when OCR detection is minimal
      ocrInfo = `\n\nFALLBACK UI GUIDANCE (minimal OCR detected):\n`;
      if (taskDescription.toLowerCase().includes('type') || taskDescription.toLowerCase().includes('input') || taskDescription.toLowerCase().includes('enter')) {
        ocrInfo += `\nFOR TYPING TASKS:\n`;
        ocrInfo += `1. BOTTOM INPUT AREAS: Click at bottom center of screen (${centerX}, ${Math.round(screenshot.height * 0.9)}) then type\n`;
        ocrInfo += `2. GENERAL INPUT FIELDS: Look for text input areas, usually at bottom 20% of screen\n`;
        ocrInfo += `3. CHAT/PROMPT AREAS: Typically located at coordinates (${centerX}, ${Math.round(screenshot.height * 0.85)}) to (${centerX}, ${Math.round(screenshot.height * 0.95)})\n`;
      }
    }
    
    return `You are a desktop automation assistant for Thinkdrop AI. Analyze the screenshot and complete the task: "${taskDescription}"

Respond with ONLY valid JSON in this exact format:
{
  "actions": [{
    "type": "click|moveMouse|type|drag|scroll|keyboardShortcut|rightClick|doubleClick|hover|pressKey|screenshot",
    "coordinates": {"x": number, "y": number},
    "text": "optional text to type or key combo",
    "dragTo": {"x": number, "y": number}
  }],
  "confidence": 0.9,
  "reasoning": "brief explanation"
}

Screen size: ${screenshot.width}x${screenshot.height}. Center: ${centerX},${centerY}.${guidance}${ocrInfo}

CRITICAL INSTRUCTIONS:
- ANALYZE the screenshot carefully to identify UI elements (input fields, buttons, text areas)
- Use the DETECTED TEXT ELEMENTS above to find precise coordinates for UI elements
- For TEXT INPUT tasks: Return TWO actions - FIRST "click" to focus input field, THEN "type" to enter text
- If HIGH-PRIORITY INPUT FIELDS are detected above, use those coordinates for clicking
- If FALLBACK UI GUIDANCE is provided above (minimal OCR), use those suggested coordinates
- For prompt/chat input fields: Input fields are typically at bottom of screen (y: 800-900 range)
- NEVER use "screenshot" action for typing tasks - ALWAYS provide click + type actions
- When OCR detection is minimal, use visual reasoning and common UI patterns (input fields at bottom)
- Include detailed "reasoning" explaining what you see and your action choice
- MANDATORY: For typing tasks, you MUST return click action followed by type action - no exceptions

Return JSON only.`;
  }

  /**
   * Create comprehensive human-like interaction prompt for desktop automation
   */
  private createFastPrompt(taskDescription: string, screenshot: ScreenshotData): string {
    const centerX = Math.floor(screenshot.width / 2);
    const centerY = Math.floor(screenshot.height / 2);

    const task = taskDescription.toLowerCase();

    const guidanceList: string[] = [];

    if (task.includes('type') || task.includes('input') || task.includes('enter text')) {
      guidanceList.push(`- For typing tasks: STEP 1: Use "click" action on the input field/text area. STEP 2: Use "type" action with the exact text. This is a TWO-STEP process.`);
      
      // Specific guidance for Windsurf prompt input
      if (task.toLowerCase().includes('windsurf') && task.toLowerCase().includes('prompt')) {
        guidanceList.push(`- WINDSURF PROMPT INPUT: Look for the text input area at the bottom of the screen (usually around y: 800-900). Click there first, then type.`);
      }
    }
    if (task.includes('click') || task.includes('button')) {
      guidanceList.push(`- For clicks, use "click" or "doubleClick" at the element's center.`);
    }
    if (task.includes('move') || task.includes('cursor')) {
      guidanceList.push(`- For cursor movement, use "moveMouse" with the desired coordinates.`);
    }
    if (task.includes('drag') || task.includes('drop')) {
      guidanceList.push(`- For drag-and-drop, use "drag" with start and end coordinates.`);
    }
    if (task.includes('scroll')) {
      guidanceList.push(`- For scrolling, use "scroll" with direction and distance.`);
    }
    if (task.includes('keyboard') || task.includes('shortcut')) {
      guidanceList.push(`- For shortcuts, use "keyboardShortcut" and specify key combo (e.g., Ctrl+S).`);
    }
    if (task.includes('press') || task.includes('key')) {
      guidanceList.push(`- For single key presses, use "pressKey" with key name (e.g., "Escape").`);
    }
    if (task.includes('right click') || task.includes('context menu')) {
      guidanceList.push(`- For right-click, use "rightClick" at the target location.`);
    }
    if (task.includes('double click')) {
      guidanceList.push(`- For double-click, use "doubleClick" at the target location.`);
    }
    if (task.includes('hover')) {
      guidanceList.push(`- For hover actions, use "hover" at the target coordinates.`);
    }

    const guidance = guidanceList.length > 0 ? `\nGuidance:\n${guidanceList.join('\n')}` : '';

    return `You are a desktop automation assistant for Thinkdrop AI. Analyze the screenshot and complete the task: "${taskDescription}"

Respond with ONLY valid JSON in this exact format:
{
  "actions": [{
    "type": "click|moveMouse|type|drag|scroll|keyboardShortcut|rightClick|doubleClick|hover|pressKey|screenshot",
    "coordinates": {"x": number, "y": number},
    "text": "optional text to type or key combo",
    "dragTo": {"x": number, "y": number}
  }],
  "confidence": 0.9,
  "reasoning": "brief explanation"
}

Screen size: ${screenshot.width}x${screenshot.height}. Center: ${centerX},${centerY}.${guidance}

CRITICAL INSTRUCTIONS:
- ANALYZE the screenshot carefully to identify UI elements (input fields, buttons, text areas)
- For TEXT INPUT tasks: Return ONE action only - either "click" to focus input field OR "type" to enter text
- If OCR text is unclear but task involves typing: Look for common input field locations (bottom of screen for chat/prompt inputs)
- For Windsurf prompt input: Input field is typically at bottom of screen (y: 800-900 range)
- NEVER use "screenshot" action unless explicitly requested - always choose click or type for input tasks
- Use precise coordinates based on visual analysis, or reasonable estimates for common UI patterns
- Include detailed "reasoning" explaining what you see and your action choice

Return JSON only.`;
  }

  /**
   * Parse action from LLM response with error handling
   */
  private parseActionFromResponse(response: string): Action {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      logger.info('LLM Response JSON:', { parsed, rawResponse: response.substring(0, 200) });
      
      // Try flexible parsing first for enhanced action types
      if (parsed.actions && Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        const action = parsed.actions[0];
        const validTypes = ['click', 'moveMouse', 'type', 'screenshot', 'rightClick', 'doubleClick', 'drag', 'scroll', 'keyboardShortcut', 'hover', 'pressKey'];
        if (action.type && validTypes.includes(action.type)) {
          logger.info('Flexible parsing successful:', { action });
          return this.mapToCompatibleAction(action);
        }
      }
      
      // Single action format
      if (parsed.type && ['click', 'moveMouse', 'type', 'screenshot', 'rightClick', 'doubleClick', 'drag', 'scroll', 'keyboardShortcut', 'hover', 'pressKey'].includes(parsed.type)) {
        logger.info('Single action format detected:', { action: parsed });
        return this.mapToCompatibleAction(parsed);
      }
      
      // Try schema validation as fallback for basic types
      try {
        const validatedPlan = FastActionPlanSchema.parse(parsed);
        if (validatedPlan.actions && validatedPlan.actions.length > 0) {
          logger.info('Schema validation successful:', { action: validatedPlan.actions[0] });
          return this.mapToCompatibleAction(validatedPlan.actions[0]);
        }
        // If schema validation succeeds but no actions, throw error to trigger fallback
        throw new Error('Schema validation succeeded but no actions found');
      } catch (schemaError) {
        logger.warn('All parsing methods failed:', { error: schemaError });
        throw new Error(`Failed to parse LLM response: ${schemaError}`);
      }
    } catch (error) {
      logger.warn('Failed to parse LLM response, using intelligent fallback:', { error, response: response.substring(0, 200) });
      
      // Intelligent fallback based on response content
      if (response.toLowerCase().includes('mouse') && response.toLowerCase().includes('center')) {
        const fallbackAction = {
          type: 'moveMouse' as const,
          coordinates: { x: 1440, y: 900 }
        };
        logger.info('Using mouse center fallback:', { fallbackAction });
        return fallbackAction;
      }
      
      if (response.toLowerCase().includes('click')) {
        const fallbackAction = {
          type: 'click' as const,
          coordinates: { x: 500, y: 400 }
        };
        logger.info('Using click fallback:', { fallbackAction });
        return fallbackAction;
      }
      
      const fallbackAction = { type: 'screenshot' as const };
      logger.info('Using screenshot fallback:', { fallbackAction });
      return fallbackAction;
    }
  }

  /**
   * Execute action with comprehensive human-like interaction support
   */
  private async executeActionFast(action: any): Promise<{ success: boolean; message: string }> {
    try {
      switch (action.type) {
        case 'moveMouse':
          if (action.coordinates) {
            const moveAction = { type: 'moveMouse' as const, coordinates: action.coordinates };
            const result = await this.desktopAutomation.executeAction(moveAction);
            return { success: result.success, message: `Mouse moved to (${action.coordinates.x}, ${action.coordinates.y})` };
          }
          break;
          
        case 'click':
          if (action.coordinates) {
            const clickAction = { type: 'click' as const, coordinates: action.coordinates };
            const result = await this.desktopAutomation.executeAction(clickAction);
            return { success: result.success, message: `Clicked at (${action.coordinates.x}, ${action.coordinates.y})` };
          }
          break;
          
        case 'rightClick':
          if (action.coordinates) {
            const rightClickAction = { type: 'rightClick' as const, coordinates: action.coordinates };
            const result = await this.desktopAutomation.executeAction(rightClickAction);
            return { success: result.success, message: `Right-clicked at (${action.coordinates.x}, ${action.coordinates.y})` };
          }
          break;
          
        case 'doubleClick':
          if (action.coordinates) {
            const doubleClickAction = { type: 'doubleClick' as const, coordinates: action.coordinates };
            const result = await this.desktopAutomation.executeAction(doubleClickAction);
            return { success: result.success, message: `Double-clicked at (${action.coordinates.x}, ${action.coordinates.y})` };
          }
          break;
          
        case 'drag':
          if (action.coordinates && action.dragTo) {
            const dragAction = { 
              type: 'drag' as const, 
              coordinates: action.coordinates,
              dragTo: action.dragTo
            };
            const result = await this.desktopAutomation.executeAction(dragAction);
            return { success: result.success, message: `Dragged from (${action.coordinates.x}, ${action.coordinates.y}) to (${action.dragTo.x}, ${action.dragTo.y})` };
          }
          break;
          
        case 'type':
          if (action.text) {
            const typeAction = { type: 'type' as const, text: action.text };
            const result = await this.desktopAutomation.executeAction(typeAction);
            return { success: result.success, message: `Typed: ${action.text}` };
          }
          break;
          
        case 'keyboardShortcut':
        case 'pressKey':
          if (action.text) {
            // Map to keyPress action for compatibility with desktopAutomationService
            const keyAction = { type: 'keyPress' as const, key: action.text };
            const result = await this.desktopAutomation.executeAction(keyAction);
            return { success: result.success, message: `Key pressed: ${action.text}` };
          }
          break;
          
        case 'scroll':
          if (action.coordinates) {
            const scrollAction = { 
              type: 'scroll' as const, 
              coordinates: action.coordinates,
              direction: action.direction || 'down',
              amount: action.amount || 3
            };
            const result = await this.desktopAutomation.executeAction(scrollAction);
            return { success: result.success, message: `Scrolled ${action.direction || 'down'} at (${action.coordinates.x}, ${action.coordinates.y})` };
          }
          break;
          
        case 'hover':
          if (action.coordinates) {
            // Hover is essentially a mouse move without click
            const hoverAction = { type: 'moveMouse' as const, coordinates: action.coordinates };
            const result = await this.desktopAutomation.executeAction(hoverAction);
            return { success: result.success, message: `Hovered at (${action.coordinates.x}, ${action.coordinates.y})` };
          }
          break;
          
        case 'screenshot':
          await this.captureScreenshotFast();
          return { success: true, message: 'Screenshot captured' };
          
        default:
          return { success: false, message: `Unsupported action: ${action.type}` };
      }
      
      return { success: false, message: 'Action missing required parameters' };
    } catch (error) {
      return { success: false, message: `Action failed: ${error}` };
    }
  }

  /**
   * Quick heuristic to determine if task is likely complete
   */
  private isTaskLikelyComplete(taskDescription: string, action: Action, result: { success: boolean }): boolean {
    if (!result.success) return false;
    
    const task = taskDescription.toLowerCase();
    
    // Mouse movement tasks
    if (task.includes('mouse') && task.includes('center') && action.type === 'moveMouse') {
      return true;
    }
    
    // Click tasks
    if (task.includes('click') && action.type === 'click') {
      return true;
    }
    
    // Screenshot tasks
    if (task.includes('screenshot') && action.type === 'screenshot') {
      return true;
    }
    
    return false;
  }

  /**
   * Health check for fast service
   */
  async healthCheck(): Promise<{ healthy: boolean; latency: number; services: any }> {
    const startTime = performance.now();
    
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      // Quick screenshot test
      await this.captureScreenshotFast();
      
      // Quick LLM test
      const llmHealth = await fastLLMRouter.healthCheck();
      
      return {
        healthy: true,
        latency: performance.now() - startTime,
        services: {
          screenshot: true,
          ocr: true,
          llm: llmHealth.healthy,
          automation: true
        }
      };
    } catch (error) {
      return {
        healthy: false,
        latency: performance.now() - startTime,
        services: {
          screenshot: false,
          ocr: false,
          llm: false,
          automation: false
        }
      };
    }
  }
}

// Export singleton for performance
export const fastVisionAutomation = new FastVisionAutomationService();
