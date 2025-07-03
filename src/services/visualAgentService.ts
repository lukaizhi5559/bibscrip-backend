import screenshot from 'screenshot-desktop';
import { createWorker } from 'tesseract.js';
import clipboardy from 'clipboardy';
import sharp from 'sharp';
import { z } from 'zod';
import { logger } from '../utils/logger';

// BibScrip Action Schema for validation
const ActionSchema = z.object({
  type: z.enum(['moveMouse', 'click', 'type', 'wait', 'scroll', 'keyPress', 'screenshot']),
  coordinates: z.object({
    x: z.number(),
    y: z.number()
  }).optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  duration: z.number().optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  amount: z.number().optional()
});

const ActionPlanSchema = z.object({
  actions: z.array(ActionSchema),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
  expectedOutcome: z.string()
});

export type Action = z.infer<typeof ActionSchema>;
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

export interface ScreenshotData {
  buffer: Buffer;
  width: number;
  height: number;
  timestamp: string;
  format: string;
}

export interface OCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };
  }>;
}

export interface VisualContext {
  screenshot: ScreenshotData;
  ocrResult: OCRResult;
  clipboardContent?: string;
  userPrompt: string;
  timestamp: string;
}

/**
 * Visual Agent Service
 * Implements Option 1 workflow: screenshot capture, OCR, LLM planning, action execution
 */
export class VisualAgentService {
  private ocrWorker: any = null;
  private isInitialized = false;

  constructor() {
    this.initializeOCR();
  }

  /**
   * Initialize Tesseract.js OCR worker
   */
  private async initializeOCR(): Promise<void> {
    try {
      this.ocrWorker = await createWorker('eng');
      this.isInitialized = true;
      logger.info('Visual Agent OCR worker initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize OCR worker:', { error });
      this.isInitialized = false;
    }
  }

  /**
   * Capture full-screen screenshot
   */
  async captureScreenshot(): Promise<ScreenshotData> {
    try {
      logger.info('Capturing screenshot...');
      const imgBuffer = await screenshot({ format: 'png' });
      
      // Get image metadata using sharp
      const metadata = await sharp(imgBuffer).metadata();
      
      const screenshotData: ScreenshotData = {
        buffer: imgBuffer,
        width: metadata.width || 0,
        height: metadata.height || 0,
        timestamp: new Date().toISOString(),
        format: 'png'
      };

      logger.info('Screenshot captured successfully', {
        width: screenshotData.width,
        height: screenshotData.height,
        size: imgBuffer.length
      });

      return screenshotData;
    } catch (error) {
      logger.error('Failed to capture screenshot:', { error });
      throw new Error('Screenshot capture failed');
    }
  }

  /**
   * Process screenshot with OCR to extract text
   */
  async processWithOCR(screenshotBuffer: Buffer): Promise<OCRResult> {
    if (!this.isInitialized || !this.ocrWorker) {
      throw new Error('OCR worker not initialized');
    }

    try {
      logger.info('Processing screenshot with OCR...');
      const { data } = await this.ocrWorker.recognize(screenshotBuffer);
      
      const ocrResult: OCRResult = {
        text: data.text,
        confidence: data.confidence / 100, // Convert to 0-1 scale
        words: data.words.map((word: any) => ({
          text: word.text,
          confidence: word.confidence / 100,
          bbox: {
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1
          }
        }))
      };

      logger.info('OCR processing completed', {
        textLength: ocrResult.text.length,
        confidence: ocrResult.confidence,
        wordCount: ocrResult.words.length
      });

      return ocrResult;
    } catch (error) {
      logger.error('OCR processing failed:', { error });
      throw new Error('OCR processing failed');
    }
  }

  /**
   * Get current clipboard content
   */
  async getClipboardContent(): Promise<string> {
    try {
      const content = await clipboardy.read();
      logger.info('Clipboard content retrieved', { length: content.length });
      return content;
    } catch (error) {
      logger.error('Failed to read clipboard:', { error });
      return '';
    }
  }

  /**
   * Create visual context for LLM processing
   */
  async createVisualContext(userPrompt: string): Promise<VisualContext> {
    try {
      logger.info('Creating visual context for user prompt:', { prompt: userPrompt });
      
      // Capture screenshot
      const screenshot = await this.captureScreenshot();
      
      // Process with OCR
      const ocrResult = await this.processWithOCR(screenshot.buffer);
      
      // Get clipboard content
      const clipboardContent = await this.getClipboardContent();
      
      const context: VisualContext = {
        screenshot,
        ocrResult,
        clipboardContent,
        userPrompt,
        timestamp: new Date().toISOString()
      };

      logger.info('Visual context created successfully');
      return context;
    } catch (error) {
      logger.error('Failed to create visual context:', { error });
      throw new Error('Visual context creation failed');
    }
  }

  /**
   * Validate action plan against BibScrip schema
   */
  validateActionPlan(actionPlan: any): ActionPlan {
    try {
      return ActionPlanSchema.parse(actionPlan);
    } catch (error) {
      logger.error('Action plan validation failed:', { error });
      throw new Error('Invalid action plan format');
    }
  }

  /**
   * Convert screenshot to base64 for LLM processing
   */
  async screenshotToBase64(screenshotBuffer: Buffer): Promise<string> {
    try {
      // Optimize image for LLM processing (reduce size while maintaining quality)
      const optimizedBuffer = await sharp(screenshotBuffer)
        .resize(1920, 1080, { 
          fit: 'inside',
          withoutEnlargement: true 
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      
      return optimizedBuffer.toString('base64');
    } catch (error) {
      logger.error('Failed to convert screenshot to base64:', { error });
      throw new Error('Screenshot conversion failed');
    }
  }

  /**
   * Create LLM prompt with visual context
   */
  createLLMPrompt(context: VisualContext): string {
    const prompt = `
You are a Visual Interactive Agent for BibScrip, a research assistant application. 
Analyze the provided screenshot and OCR text to understand the current screen state, then generate a precise action plan to fulfill the user's request.

CURRENT SCREEN CONTEXT:
- Screenshot dimensions: ${context.screenshot.width}x${context.screenshot.height}
- OCR extracted text: "${context.ocrResult.text.substring(0, 1000)}${context.ocrResult.text.length > 1000 ? '...' : ''}"
- OCR confidence: ${(context.ocrResult.confidence * 100).toFixed(1)}%
- Clipboard content: "${context.clipboardContent?.substring(0, 200) || 'empty'}"
- Timestamp: ${context.timestamp}

USER REQUEST: "${context.userPrompt}"

INSTRUCTIONS:
1. Analyze the screenshot to understand the current application state
2. Use OCR text to identify clickable elements, buttons, text fields, etc.
3. Generate a sequence of actions to fulfill the user's request
4. Actions should be precise with exact coordinates when possible
5. Include reasoning for each action and expected outcome

AVAILABLE ACTIONS:
- moveMouse: Move cursor to coordinates {x, y}
- click: Click at coordinates {x, y}
- type: Type text string
- keyPress: Press specific key (Enter, Tab, Escape, etc.)
- wait: Wait for specified duration in milliseconds
- scroll: Scroll in direction (up/down/left/right) by amount
- screenshot: Take another screenshot for verification

RESPONSE FORMAT (JSON):
{
  "actions": [
    {
      "type": "moveMouse",
      "coordinates": {"x": 100, "y": 200}
    },
    {
      "type": "click",
      "coordinates": {"x": 100, "y": 200}
    },
    {
      "type": "type",
      "text": "example text"
    }
  ],
  "reasoning": "Explanation of the action sequence",
  "confidence": 0.95,
  "expectedOutcome": "What should happen after executing these actions"
}

Generate the action plan now:`;

    return prompt;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.ocrWorker) {
      try {
        await this.ocrWorker.terminate();
        logger.info('OCR worker terminated successfully');
      } catch (error) {
        logger.error('Failed to terminate OCR worker:', { error });
      }
    }
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.isInitialized && this.ocrWorker !== null;
  }
}

// Export singleton instance
export const visualAgentService = new VisualAgentService();
