/**
 * Nut.js Code Generator Service
 * Specialized LLM service for generating ONLY Nut.js desktop automation code
 * Uses Grok as primary provider with Claude as fallback
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';

export interface NutjsCodeResponse {
  code: string;
  provider: 'grok' | 'claude';
  latencyMs: number;
  error?: string;
}

export class NutjsCodeGenerator {
  private grokClient: OpenAI | null = null;
  private claudeClient: Anthropic | null = null;
  private useGrok4: boolean = false; // Set to true for highest quality, false for speed

  constructor() {
    // Check if we should use Grok 4 (higher quality, slower) or grok-beta (faster)
    this.useGrok4 = process.env.USE_GROK_4 === 'true';
    // Initialize Grok client (uses OpenAI-compatible API)
    if (process.env.GROK_API_KEY) {
      this.grokClient = new OpenAI({
        apiKey: process.env.GROK_API_KEY,
        baseURL: 'https://api.x.ai/v1',
      });
      logger.info('Grok client initialized for Nut.js code generation');
    } else {
      logger.warn('GROK_API_KEY not found - Grok provider unavailable');
    }

    // Initialize Claude client as fallback
    if (process.env.ANTHROPIC_API_KEY) {
      this.claudeClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: 'https://api.anthropic.com',
      });
      logger.info('Claude client initialized as fallback for Nut.js code generation');
    } else {
      logger.warn('ANTHROPIC_API_KEY not found - Claude fallback unavailable');
    }
  }

  /**
   * Build the specialized prompt for Nut.js code generation
   */
  private buildNutjsPrompt(command: string): string {
    return `You are a Nut.js code generation expert. Your ONLY job is to generate pure Nut.js code for desktop automation tasks.

**CRITICAL RULES:**
1. Return ONLY executable Nut.js code - NO explanations, NO markdown, NO comments outside the code
2. Use the official Nut.js v4.x API from https://nutjs.dev/
3. Always import required modules: mouse, keyboard, screen, Key, Button from '@nut-tree-fork/nut-js'
4. Code must be ready to run immediately
5. Handle errors gracefully with try-catch blocks
6. Use async/await for all Nut.js operations

**Nut.js Quick Reference:**
- Mouse: \`await mouse.move(straightTo(point(x, y)))\`, \`await mouse.leftClick()\`, \`await mouse.rightClick()\`
- Keyboard: \`await keyboard.type("text")\`, \`await keyboard.pressKey(Key.Enter)\`
- Screen: \`await screen.find(imageResource("path/to/image.png"))\`, \`await screen.waitFor(imageResource(...))\`
- Regions: \`new Region(x, y, width, height)\`
- Wait: Use \`await new Promise(resolve => setTimeout(resolve, ms))\` for delays

**IMPORTANT**: Use the forked package \`@nut-tree-fork/nut-js\` version 4.2.6+

**User Command:** ${command}

**Output Format:**
Return ONLY the JavaScript code block without markdown fences. Start directly with the imports.

Example for "open terminal":
\`\`\`
import { keyboard, Key } from '@nut-tree-fork/nut-js';

async function openTerminal() {
  try {
    // macOS: Cmd+Space to open Spotlight
    await keyboard.pressKey(Key.LeftSuper, Key.Space);
    await keyboard.releaseKey(Key.LeftSuper, Key.Space);
    
    // Wait for Spotlight to open
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Type "terminal" and press Enter
    await keyboard.type("terminal");
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    console.log('Terminal opened successfully');
  } catch (error) {
    console.error('Failed to open terminal:', error);
    throw error;
  }
}

openTerminal();
\`\`\`

Now generate the code for: ${command}`;
  }

  /**
   * Generate Nut.js code using Grok (primary)
   */
  private async generateWithGrok(command: string): Promise<NutjsCodeResponse> {
    if (!this.grokClient) {
      throw new Error('Grok client not initialized');
    }

    const startTime = Date.now();
    const prompt = this.buildNutjsPrompt(command);

    try {
      logger.info('Generating Nut.js code with Grok', { command });

      const model = this.useGrok4 ? 'grok-4' : 'grok-beta';
      logger.info(`Using Grok model: ${model}`, { useGrok4: this.useGrok4 });
      
      const response = await this.grokClient.chat.completions.create({
        model, // grok-beta for speed, grok-4 for quality
        messages: [
          {
            role: 'system',
            content: 'You are a Nut.js code generation expert. Generate ONLY executable Nut.js code without any explanations or markdown.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.5, // Slightly higher for faster generation
        max_tokens: 1000, // Reduced for faster response (Nut.js code is typically short)
        stream: false, // Ensure non-streaming for predictable latency
      });

      const code = response.choices[0]?.message?.content?.trim() || '';
      const latencyMs = Date.now() - startTime;

      // Clean up markdown code fences if present
      const cleanedCode = this.cleanCodeOutput(code);

      logger.info('Grok generated Nut.js code successfully', {
        command,
        latencyMs,
        codeLength: cleanedCode.length,
      });

      return {
        code: cleanedCode,
        provider: 'grok',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Grok code generation failed', {
        command,
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate Nut.js code using Claude (fallback)
   */
  private async generateWithClaude(command: string): Promise<NutjsCodeResponse> {
    if (!this.claudeClient) {
      throw new Error('Claude client not initialized');
    }

    const startTime = Date.now();
    const prompt = this.buildNutjsPrompt(command);

    try {
      logger.info('Generating Nut.js code with Claude (fallback)', { command });

      const response = await this.claudeClient.messages.create({
        model: 'claude-sonnet-4.5-20250514', // Latest Claude 4.5 Sonnet
        max_tokens: 1000, // Reduced for faster response
        temperature: 0.5, // Slightly higher for faster generation
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const code = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
      const latencyMs = Date.now() - startTime;

      // Clean up markdown code fences if present
      const cleanedCode = this.cleanCodeOutput(code);

      logger.info('Claude generated Nut.js code successfully', {
        command,
        latencyMs,
        codeLength: cleanedCode.length,
      });

      return {
        code: cleanedCode,
        provider: 'claude',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Claude code generation failed', {
        command,
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Clean up code output by removing markdown fences and extra whitespace
   */
  private cleanCodeOutput(code: string): string {
    // Remove markdown code fences
    let cleaned = code.replace(/```(?:javascript|js|typescript|ts)?\n?/g, '').replace(/```\n?/g, '');
    
    // Trim whitespace
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  /**
   * Generate Nut.js code with automatic fallback
   * Tries Grok first, falls back to Claude if Grok fails
   */
  async generateCode(command: string): Promise<NutjsCodeResponse> {
    const errors: string[] = [];

    // Try Grok first
    if (this.grokClient) {
      try {
        return await this.generateWithGrok(command);
      } catch (error: any) {
        errors.push(`Grok: ${error.message}`);
        logger.warn('Grok failed, falling back to Claude', { error: error.message });
      }
    } else {
      errors.push('Grok: Client not initialized (missing GROK_API_KEY)');
    }

    // Fallback to Claude
    if (this.claudeClient) {
      try {
        return await this.generateWithClaude(command);
      } catch (error: any) {
        errors.push(`Claude: ${error.message}`);
        logger.error('All providers failed for Nut.js code generation', { errors });
      }
    } else {
      errors.push('Claude: Client not initialized (missing ANTHROPIC_API_KEY)');
    }

    // All providers failed
    throw new Error(`Failed to generate Nut.js code. Errors: ${errors.join('; ')}`);
  }

  /**
   * Validate that the generated code is actually Nut.js code
   */
  validateNutjsCode(code: string): { valid: boolean; reason?: string } {
    // Basic validation checks
    if (!code || code.trim().length === 0) {
      return { valid: false, reason: 'Empty code generated' };
    }

    // Check for Nut.js imports (forked version)
    const hasNutjsImport = /import\s+.*from\s+['"]@nut-tree-fork\/nut-js['"]/.test(code);
    if (!hasNutjsImport) {
      return { valid: false, reason: 'Missing Nut.js imports' };
    }

    // Check for async function or top-level await
    const hasAsyncPattern = /async\s+function|await\s+/.test(code);
    if (!hasAsyncPattern) {
      return { valid: false, reason: 'Missing async/await patterns (required for Nut.js)' };
    }

    return { valid: true };
  }
}

// Export singleton instance
export const nutjsCodeGenerator = new NutjsCodeGenerator();
