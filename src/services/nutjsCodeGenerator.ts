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

**CRITICAL RULES - READ CAREFULLY:**
1. Return ONLY executable Nut.js code - NO explanations, NO markdown, NO comments outside the code
2. Use the official Nut.js v4.x API from https://nutjs.dev/
3. **ABSOLUTELY MUST use CommonJS require() syntax - NEVER use ES6 import statements**
4. First line MUST be: const { keyboard, Key } = require('@nut-tree-fork/nut-js');
5. Code must be ready to run immediately with: node filename.js
6. Handle errors gracefully with try-catch blocks
7. Use async/await for all Nut.js operations
8. Wrap execution in an async IIFE: (async () => { ... })();
9. **IMPORTANT**: Always release keys immediately after pressing them before typing text
10. **OS Detection**: Check process.platform to determine OS ('darwin' = macOS, 'win32' = Windows)

**CRITICAL: Operating System Differences**
The code will receive context.os parameter ('darwin' for Mac, 'win32' for Windows). Use this to determine behavior:

**macOS (darwin):**
- Open apps/files: Cmd+Space (Spotlight) → type name → Enter
- Key for shortcuts: Key.LeftSuper (Cmd key)
- Example: Cmd+Space, Cmd+N, Cmd+K, Cmd+T

**Windows (win32):**
- Open apps/files: Win key → type name → Enter (Windows Search)
- Key for shortcuts: Key.LeftSuper (Windows key)
- Example: Win+S for search, Ctrl+N, Ctrl+K, Ctrl+T
- Note: Use Key.LeftControl instead of Key.LeftSuper for app shortcuts (Ctrl+C, Ctrl+V, etc.)

**Nut.js Quick Reference:**
- Mouse: \`await mouse.move(straightTo(point(x, y)))\`, \`await mouse.leftClick()\`, \`await mouse.rightClick()\`
- Keyboard: \`await keyboard.type("text")\`, \`await keyboard.pressKey(Key.Enter)\`
- Screen: \`await screen.find(imageResource("path/to/image.png"))\`, \`await screen.waitFor(imageResource(...))\`
- Regions: \`new Region(x, y, width, height)\`
- Wait: Use \`await new Promise(resolve => setTimeout(resolve, ms))\` for delays
- Search in app: Use \`Cmd+K\` (Key.LeftSuper + Key.K) for quick search in most apps

**IMPORTANT**: Use the forked package \`@nut-tree-fork/nut-js\` version 4.2.6+

**CRITICAL: Web Searches and Browser Queries**
When the command involves searching the web, shopping online, or visiting websites:
1. **DO NOT open Spotlight/Windows Search**
2. **Open the default browser directly** using system launcher
3. **macOS**: Open "Safari" or "Chrome" or "Firefox" via Spotlight
4. **Windows**: Open "Chrome" or "Edge" or "Firefox" via Windows Search
5. **After browser opens**: Wait 1000ms, then Cmd+L (Mac) or Ctrl+L (Windows) to focus address bar
6. **Type search query or URL**, then press Enter

**Examples of web/browser queries:**
- "search for winter clothes on Amazon" → Open browser → search on Amazon
- "find restaurants near me" → Open browser → Google search
- "go to youtube.com" → Open browser → navigate to URL
- "search for JavaScript tutorials" → Open browser → Google search
- "check my email" → Open browser → go to email provider

**Multi-Step Workflows:**
When a command requires multiple steps within an app (e.g., "open Slack, find user Chris, DM him hello"):
1. **Open the app first**
   - macOS: Cmd+Space, type app name, Enter
   - Windows: Win key, type app name, Enter
2. **Wait for app to load** (500-1000ms)
3. **Use in-app search**
   - macOS: Cmd+K or Cmd+F for most apps
   - Windows: Ctrl+K or Ctrl+F for most apps
4. **Type search query** (person name, channel name, etc.)
5. **Wait for results** (300-500ms)
6. **Navigate results** (Arrow keys: Key.Up, Key.Down)
7. **Select result** (Enter)
8. **Wait for view to load** (300-500ms)
9. **Type message/content** (keyboard.type())
10. **Send/Submit**
    - macOS: Enter or Cmd+Enter
    - Windows: Enter or Ctrl+Enter

**Slack-Specific Patterns:**
- **Open Slack search**:
  - macOS: Cmd+K (Key.LeftSuper + Key.K)
  - Windows: Ctrl+K (Key.LeftControl + Key.K)
- **Navigate to DM**: Search → type person name → Enter
- **Navigate to channel**: Search → type "#channel-name" → Enter
- **Send message**: Type message → Enter
- **New line without sending**:
  - macOS: Shift+Enter or Cmd+Enter
  - Windows: Shift+Enter or Ctrl+Enter
- **Always wait 500ms after opening search** before typing

**Outlook-Specific Patterns:**
- **New email**:
  - macOS: Cmd+N (Key.LeftSuper + Key.N)
  - Windows: Ctrl+N (Key.LeftControl + Key.N)
- **Search emails**:
  - macOS: Cmd+Option+F or Cmd+E
  - Windows: Ctrl+E or F3
- **Reply to email**:
  - macOS: Cmd+R
  - Windows: Ctrl+R
- **Reply all**:
  - macOS: Cmd+Shift+R
  - Windows: Ctrl+Shift+R
- **Forward email**:
  - macOS: Cmd+J
  - Windows: Ctrl+F
- **Send email**:
  - macOS: Cmd+Enter
  - Windows: Ctrl+Enter or Alt+S
- **To field**: Type recipient → wait 300ms → Arrow keys to select → Enter
- **Subject field**: Press Tab after adding recipient
- **Body field**: Press Tab again
- **Always wait 800ms after Cmd+N/Ctrl+N** for compose window to load

**VS Code-Specific Patterns:**
- **Quick Open (files)**:
  - macOS: Cmd+P (Key.LeftSuper + Key.P)
  - Windows: Ctrl+P (Key.LeftControl + Key.P)
- **Command Palette**:
  - macOS: Cmd+Shift+P
  - Windows: Ctrl+Shift+P
- **Search in files**:
  - macOS: Cmd+Shift+F
  - Windows: Ctrl+Shift+F
- **New file**:
  - macOS: Cmd+N
  - Windows: Ctrl+N
- **Save file**:
  - macOS: Cmd+S
  - Windows: Ctrl+S

**Discord-Specific Patterns:**
- **Quick Switcher (search)**:
  - macOS: Cmd+K (Key.LeftSuper + Key.K)
  - Windows: Ctrl+K (Key.LeftControl + Key.K)
- **Navigate to DM**: Search → type username → Enter
- **Navigate to server/channel**: Search → type server/channel name → Enter
- **Send message**: Type message → Enter
- **New line without sending**: Shift+Enter

**Microsoft Teams-Specific Patterns:**
- **Search**:
  - macOS: Cmd+E (Key.LeftSuper + Key.E)
  - Windows: Ctrl+E (Key.LeftControl + Key.E)
- **New chat**:
  - macOS: Cmd+N
  - Windows: Ctrl+N
- **Send message**:
  - macOS: Cmd+Enter
  - Windows: Ctrl+Enter
- **New line**: Shift+Enter

**Browser-Specific Patterns (Chrome, Firefox, Safari, Edge):**
- **New tab**:
  - macOS: Cmd+T
  - Windows: Ctrl+T
- **Close tab**:
  - macOS: Cmd+W
  - Windows: Ctrl+W
- **Address bar**:
  - macOS: Cmd+L
  - Windows: Ctrl+L or Alt+D
- **Search/Find in page**:
  - macOS: Cmd+F
  - Windows: Ctrl+F
- **Refresh**:
  - macOS: Cmd+R
  - Windows: Ctrl+R or F5

**File Explorer/Finder Patterns:**
- **New folder**:
  - macOS: Cmd+Shift+N
  - Windows: Ctrl+Shift+N
- **Search**:
  - macOS: Cmd+F
  - Windows: Ctrl+F or F3
- **Go to location**:
  - macOS: Cmd+Shift+G
  - Windows: Ctrl+L (address bar)

**User Command:** ${command}

**Output Format:**
Return ONLY the JavaScript code block without markdown fences. Start directly with the require statement.

**CORRECT Example for "search for winter clothes on Amazon" (Web Search):**
\`\`\`
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

(async () => {
  try {
    const isMac = process.platform === 'darwin';
    
    // Step 1: Open browser (Chrome as default)
    if (isMac) {
      // macOS: Use Spotlight
      await keyboard.pressKey(Key.LeftSuper, Key.Space);
      await keyboard.releaseKey(Key.LeftSuper, Key.Space);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("chrome");
    } else {
      // Windows: Use Windows Search
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.releaseKey(Key.LeftSuper);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("chrome");
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    // Step 2: Wait for browser to open
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Step 3: Focus address bar
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.L);
      await keyboard.releaseKey(Key.LeftSuper, Key.L);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.L);
      await keyboard.releaseKey(Key.LeftControl, Key.L);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 4: Type Amazon search URL
    await keyboard.type("amazon.com/s?k=winter+clothes");
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 5: Navigate to URL
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    console.log('Amazon search completed successfully');
  } catch (error) {
    console.error('Failed to search Amazon:', error);
    throw error;
  }
})();
\`\`\`

**CORRECT Example for "open terminal" (App Launch):**
\`\`\`
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

(async () => {
  try {
    const isMac = process.platform === 'darwin';
    
    if (isMac) {
      // macOS: Use Spotlight (Cmd+Space)
      await keyboard.pressKey(Key.LeftSuper, Key.Space);
      await keyboard.releaseKey(Key.LeftSuper, Key.Space);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("terminal");
    } else {
      // Windows: Use Windows Search (Win key)
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.releaseKey(Key.LeftSuper);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("cmd");  // Windows uses "cmd" or "powershell"
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    console.log('Terminal opened successfully');
  } catch (error) {
    console.error('Failed to open terminal:', error);
    throw error;
  }
})();
\`\`\`

**CORRECT Example for "open Slack, DM Chris saying hello" (Cross-Platform):**
\`\`\`
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

(async () => {
  try {
    const isMac = process.platform === 'darwin';
    
    // Step 1: Open Slack
    if (isMac) {
      // macOS: Spotlight
      await keyboard.pressKey(Key.LeftSuper, Key.Space);
      await keyboard.releaseKey(Key.LeftSuper, Key.Space);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("slack");
    } else {
      // Windows: Windows Search
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.releaseKey(Key.LeftSuper);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("slack");
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    // Step 2: Wait for Slack to fully load
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Step 3: Open Slack quick search
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.K);  // Cmd+K
      await keyboard.releaseKey(Key.LeftSuper, Key.K);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.K);  // Ctrl+K
      await keyboard.releaseKey(Key.LeftControl, Key.K);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 4: Search for user "Chris"
    await keyboard.type("Chris");
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 5: Select first result (usually the person)
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 6: Type message in DM
    await keyboard.type("hello");
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Step 7: Send message
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    console.log('Message sent to Chris successfully');
  } catch (error) {
    console.error('Failed to send Slack message:', error);
    throw error;
  }
})();
\`\`\`

**CORRECT Example for "open Outlook and email John saying 'Meeting at 3pm'" (Cross-Platform):**
\`\`\`
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

(async () => {
  try {
    const isMac = process.platform === 'darwin';
    
    // Step 1: Open Outlook
    if (isMac) {
      // macOS: Spotlight
      await keyboard.pressKey(Key.LeftSuper, Key.Space);
      await keyboard.releaseKey(Key.LeftSuper, Key.Space);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("outlook");
    } else {
      // Windows: Windows Search
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.releaseKey(Key.LeftSuper);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("outlook");
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    // Step 2: Wait for Outlook to fully load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 3: Open new email compose window
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.N);  // Cmd+N
      await keyboard.releaseKey(Key.LeftSuper, Key.N);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.N);  // Ctrl+N
      await keyboard.releaseKey(Key.LeftControl, Key.N);
    }
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Step 4: Type recipient name in To field
    await keyboard.type("John");
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 5: Select recipient from suggestions (first result)
    await keyboard.pressKey(Key.Down);
    await keyboard.releaseKey(Key.Down);
    await new Promise(resolve => setTimeout(resolve, 200));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 6: Tab to subject field
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Step 7: Type subject (optional, can skip to body)
    await keyboard.type("Quick Update");
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Step 8: Tab to body field
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Step 9: Type email body
    await keyboard.type("Meeting at 3pm");
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 10: Send email
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.Enter);  // Cmd+Enter
      await keyboard.releaseKey(Key.LeftSuper, Key.Enter);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.Enter);  // Ctrl+Enter
      await keyboard.releaseKey(Key.LeftControl, Key.Enter);
    }
    
    console.log('Email sent to John successfully');
  } catch (error) {
    console.error('Failed to send Outlook email:', error);
    throw error;
  }
})();
\`\`\`

**WRONG Example (DO NOT DO THIS):**
\`\`\`
// ❌ WRONG: Keys not released before typing
await keyboard.pressKey(Key.LeftSuper);
await keyboard.type("slack");  // This types Cmd+S, Cmd+L, etc. NOT "slack"!
await keyboard.releaseKey(Key.LeftSuper);

// ❌ WRONG: No wait times between steps
await keyboard.pressKey(Key.LeftSuper, Key.K);
await keyboard.type("Chris");  // Too fast! Search box not ready yet
await keyboard.pressKey(Key.Enter);

// ❌ WRONG: Trying to navigate to channel then DM (inefficient)
await keyboard.type("#dropaprayer");  // Don't need channel if DMing a person
\`\`\`

**Additional App-Specific Examples:**

**Outlook - Send email:**
- Cmd+N → type recipient → Down → Enter → Tab → type subject → Tab → type body → Cmd+Enter

**Outlook - Reply to email:**
- Select email → Cmd+R → type reply → Cmd+Enter

**Outlook - Search emails:**
- Cmd+Option+F → type search query → Enter

**Discord - DM user:**
- Cmd+K → type username → Enter → type message → Enter

**VS Code - Open file:**
- Cmd+P → type filename → Enter

**Browser - New tab and search:**
- Cmd+T → type search query → Enter

**Finder - Search for file:**
- Cmd+Space → type "finder" → Enter → Cmd+F → type filename

**Notes/Reminders - Create note:**
- Open app → Cmd+N → type title → Tab → type content

**Calendar - Create event:**
- Open Calendar → Cmd+N → type title → Tab → set date/time → Cmd+S

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

      // Try grok-2-latest as the current production model
      // grok-3 and grok-4 may not be available yet via API
      const model = this.useGrok4 ? 'grok-2-latest' : 'grok-2-latest';
      logger.info(`Using Grok model: ${model}`, { useGrok4: this.useGrok4 });
      
      const response = await this.grokClient.chat.completions.create({
        model, // grok-3 for speed, grok-2-latest for quality
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
        max_tokens: 3000, // Increased for complex multi-step workflows
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
        max_tokens: 3000, // Increased for complex multi-step workflows
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

    // Check for Nut.js require (CommonJS - forked version)
    const hasNutjsRequire = /require\s*\(\s*['"]@nut-tree-fork\/nut-js['"]\s*\)/.test(code);
    if (!hasNutjsRequire) {
      return { valid: false, reason: 'Missing Nut.js require statement (must use CommonJS)' };
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
