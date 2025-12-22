/**
 * Nut.js Code Generator Service
 * Specialized LLM service for generating ONLY Nut.js desktop automation code
 * Priority: Gemini 3 Pro Preview (latest) → OpenAI GPT-4V → Claude → Grok (fallback)
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { 
  AutomationPlan, 
  AutomationStep,
  AutomationPlanRequest,
  AutomationPlanResponse
} from '../types/automationPlan';
import { 
  InteractiveGuide, 
  InteractiveGuideRequest,
  InteractiveGuideResponse,
  GuideRequest // legacy, deprecated
} from '../types/automationGuide';
import { randomUUID } from 'crypto';

export interface NutjsCodeResponse {
  code: string;
  provider: 'gemini' | 'claude' | 'openai' | 'grok';
  latencyMs: number;
  error?: string;
  usedVision?: boolean; // Indicates if screenshot was processed
}

export interface ScreenshotData {
  base64: string; // Base64 encoded image
  mimeType?: string; // e.g., 'image/png', 'image/jpeg'
}

// AutomationPlanResponse is now imported from '../types/automationPlan'

/** @deprecated Use InteractiveGuideResponse instead */
export interface AutomationGuideResponse {
  guide: InteractiveGuide;
  provider: 'gemini' | 'claude' | 'openai' | 'grok';
  latencyMs: number;
  error?: string;
}

export class NutjsCodeGenerator {
  private geminiClient: GoogleGenerativeAI | null = null;
  private claudeClient: Anthropic | null = null;
  private openaiClient: OpenAI | null = null;
  private grokClient: OpenAI | null = null;
  private useGrok4: boolean = false;

  constructor() {
    this.useGrok4 = process.env.USE_GROK_4 === 'true';
    
    // Priority 1: Gemini 3 Pro Preview (latest, best quality)
    if (process.env.GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      logger.info('Gemini 3 Pro Preview client initialized (Priority 1 - latest model)');
    } else {
      logger.warn('GEMINI_API_KEY not found - Gemini unavailable');
    }

    // Priority 2: OpenAI GPT-4 Vision (fast vision, 5-10s)
    if (process.env.OPENAI_API_KEY) {
      this.openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      logger.info('OpenAI client initialized (Priority 2 - fast vision)');
    } else {
      logger.warn('OPENAI_API_KEY not found - OpenAI unavailable');
    }

    // Priority 3: Claude (fast vision, 3-8s)
    if (process.env.ANTHROPIC_API_KEY) {
      this.claudeClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      logger.info('Claude client initialized (Priority 3 - fast vision)');
    } else {
      logger.warn('ANTHROPIC_API_KEY not found - Claude unavailable');
    }

    // Priority 3: Grok (slower vision 30s+, but good fallback)
    if (process.env.GROK_API_KEY) {
      this.grokClient = new OpenAI({
        apiKey: process.env.GROK_API_KEY,
        baseURL: 'https://api.x.ai/v1',
      });
      logger.info('Grok client initialized (Priority 3 - fallback)');
    } else {
      logger.warn('GROK_API_KEY not found - Grok unavailable');
    }
  }

  /**
   * Extracts JSON from LLM response, handling various formats and fixing common syntax errors:
   * - Plain JSON
   * - JSON in markdown code blocks
   * - JSON with surrounding text
   * - Trailing commas
   * - Missing commas
   */
  private extractJsonFromResponse(response: string): any {
    let cleaned = response.trim();
    
    // Remove markdown code blocks
    cleaned = cleaned.replace(/```(?:json)?\n?/g, '').trim();
    
    // Try to parse as-is first
    try {
      return JSON.parse(cleaned);
    } catch (firstError) {
      // If that fails, try to find JSON object in the text
      // Look for { ... } pattern
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        let jsonStr = jsonMatch[0];
        
        // Fix common JSON syntax errors
        // 1. Remove trailing commas before closing braces/brackets
        jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
        
        // 2. Fix missing commas between properties (heuristic: newline between } and ")
        jsonStr = jsonStr.replace(/\}(\s*)"(\w+)":/g, '},$1"$2":');
        jsonStr = jsonStr.replace(/\](\s*)"(\w+)":/g, '],$1"$2":');
        
        // 3. Fix missing commas in arrays (heuristic: newline between } and {)
        jsonStr = jsonStr.replace(/\}(\s*)\{/g, '},$1{');
        
        try {
          return JSON.parse(jsonStr);
        } catch (secondError) {
          // If still fails, try to find the last complete JSON object
          const lastBraceIndex = jsonStr.lastIndexOf('}');
          if (lastBraceIndex !== -1) {
            const firstBraceIndex = jsonStr.indexOf('{');
            if (firstBraceIndex !== -1 && firstBraceIndex < lastBraceIndex) {
              const truncatedJson = jsonStr.substring(firstBraceIndex, lastBraceIndex + 1);
              
              // Apply fixes again to truncated JSON
              let fixedJson = truncatedJson.replace(/,(\s*[}\]])/g, '$1');
              fixedJson = fixedJson.replace(/\}(\s*)"(\w+)":/g, '},$1"$2":');
              fixedJson = fixedJson.replace(/\](\s*)"(\w+)":/g, '],$1"$2":');
              fixedJson = fixedJson.replace(/\}(\s*)\{/g, '},$1{');
              
              try {
                return JSON.parse(fixedJson);
              } catch (thirdError) {
                // Log all errors for debugging
                throw new Error(`Failed to parse JSON after multiple attempts. Original: ${firstError}. After fixes: ${secondError}. After truncation: ${thirdError}`);
              }
            }
          }
        }
      }
      
      // If all else fails, throw the original error
      throw new Error(`Failed to extract JSON from response: ${response.substring(0, 200)}...`);
    }
  }

  /**
   * Build the specialized prompt for Nut.js code generation
   * Enhanced with vision context when screenshot is provided
   */
  private buildNutjsPrompt(command: string, hasScreenshot: boolean = false, context?: any): string {
    // Add unique timestamp to prevent API caching
    const cacheBuster = hasScreenshot ? `\n[Request ID: ${Date.now()}-${Math.random().toString(36).substr(2, 9)}]` : '';
    
    // Add frontend instruction if provided
    const frontendInstruction = context?.instruction ? `\n\n**FRONTEND INSTRUCTION:** ${context.instruction}` : '';
    
    // Check if type-only mode is requested
    const isTypeOnlyMode = context?.responseMode === 'type-only';
    
    // Build type-only mode instructions if flag is set
    const typeOnlyInstructions = isTypeOnlyMode ? `
- **CRITICAL - TYPE ONLY MODE ENABLED**:
  * **NEVER use findAndClick() or any UI interaction functions**
  * **ONLY use keyboard.type() or typeWithNewlines() to type responses**
  * **DO NOT click, navigate, or interact with UI elements**
  * Your ONLY job is to TYPE the answer/solution into the active text field
  * This is a PROMPT-ANYWHERE request - just type the response, nothing else
` : '';
    
    const visionContext = hasScreenshot ? `
**VISION MODE:** Screenshot provided.${cacheBuster}
${typeOnlyInstructions}
**RULES:**
- Return ONLY executable code
- Analyze screenshot for context
- **CRITICAL - NO EMOJIS OR MARKDOWN**: 
  * NEVER use emojis (❌ 🎯 ✅ etc.) in typed responses
  * NEVER use markdown formatting (**, *, ~~, etc.) unless it's ALREADY in the screenshot
  * Type ONLY plain text - no special characters or formatting
  * Exception: If screenshot shows markdown, preserve it exactly as shown
- **COMMAND DETECTION**: Look for ">>" prefix in user input:
  * >>finish, >>complete - Complete incomplete content (code, sentences, math, lists)
  * >>continue, >>add - Continue from where content left off
  * When detected: Add ONLY missing parts, don't repeat existing content
  * Example: User types ">>finish" → Analyze screenshot → Complete the incomplete code/text
- **HIGHLIGHTED TEXT DETECTION**: If screenshot shows highlighted/selected text (different background color):
  * Analyze the highlighted text and surrounding context
  * If highlighted text is incomplete (e.g., "**Ba..." when context suggests "**Batching**"):
    - Complete the highlighted text based on context
    - Type the completion to replace the highlighted text
  * Example: Highlighted "**Ba..." in list about React → Complete to "**Batching**" based on context
- Respect language from screenshot (TypeScript/Python/SQL)
- Be concise, no fluff
- MUST use typeWithNewlines() helper for multi-line text

**NEWLINE DETECTION:**
- Chat apps/Search boxes (send/search button visible) → Use Shift+Enter
- Text editors (no submit button) → Use Enter


**PATTERN:**
\`\`\`javascript
async function typeWithNewlines(text, useShiftEnter = false) {
  for (const char of text) {
    if (char === '\\n') {
      if (useShiftEnter) {
        await keyboard.pressKey(Key.LeftShift);
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        await keyboard.releaseKey(Key.LeftShift);
      } else {
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
      }
    } else {
      await keyboard.type(char);
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

const answer = \`[Your solution]\`;
const isChatApp = /* detect from screenshot */;
await typeWithNewlines(answer, isChatApp);
\`\`\`
${frontendInstruction}
` : '';
    return `You are a Nut.js code generation expert. Your ONLY job is to generate pure Nut.js code for desktop automation tasks.

**CRITICAL RULES - READ CAREFULLY:**
1. Return ONLY executable Nut.js code - NO explanations, NO markdown, NO comments outside the code
2. Use the official Nut.js v4.x API from https://nutjs.dev/
3. **ABSOLUTELY MUST use CommonJS require() syntax - NEVER use ES6 import statements**
4. First line MUST be: const { keyboard, Key, mouse, straightTo, Point, screen, Region, Button } = require('@nut-tree-fork/nut-js');
5. **ALWAYS import vision service**: const { findAndClick } = require('../src/services/visionSpatialService');
6. Code must be ready to run immediately with: node filename.js
7. Handle errors gracefully with try-catch blocks
8. Use async/await for all Nut.js operations
9. Wrap execution in an async IIFE: (async () => { ... })();
10. **IMPORTANT**: Always release keys immediately after pressing them before typing text
11. **OS Detection**: Check process.platform to determine OS ('darwin' = macOS, 'win32' = Windows)

**🎯 VISION-FIRST STRATEGY (CRITICAL):**
**When to use VISION AI (findAndClick):**
- ✅ **ALL web browser interactions** (Gmail, YouTube, Amazon, any website)
- ✅ **ALL desktop GUI apps** (Slack, Outlook, Discord, Notion, VS Code, etc.)
- ✅ **ANY clickable UI element** (buttons, links, input fields, menus)
- ✅ **Reason**: UI layouts change, buttons move, different screen sizes, updates

**When to use KEYBOARD SHORTCUTS:**
- ✅ **OS-level operations** (open apps: Cmd+Space, switch windows: Cmd+Tab)
- ✅ **File operations** (save: Cmd+S, open: Cmd+O, close: Cmd+W)
- ✅ **Text operations** (copy: Cmd+C, paste: Cmd+V, select all: Cmd+A)
- ✅ **Reason**: OS shortcuts are standardized and never change

**NEVER use fixed coordinates** - they break on different screens and resolutions

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

**CRITICAL: Typing Large Text with Newlines**
When typing long text (answers, descriptions, multi-line content):
1. **CRITICAL**: keyboard.type() does NOT interpret \\n as Enter - it ignores them!
2. **MUST manually press Key.Enter** for every newline character
3. **Use this EXACT pattern for multi-line text:**

\`\`\`javascript
// Helper function to type text with proper newline handling
async function typeWithNewlines(text) {
  for (const char of text) {
    if (char === '\\n') {
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    } else {
      await keyboard.type(char);
    }
    await new Promise(resolve => setTimeout(resolve, 30)); // Delay per character
  }
}

// Multi-line answer with \\n for line breaks
const answer = \`TypeScript Solution:

function secondHighest(employees) {
  const salaries = [...new Set(employees.map(e => e.salary))].sort((a,b) => b-a);
  return salaries[1] || null;
}



Example:
Input: [{id:1, salary:100}]
Output: null\`;

// Type with proper newline handling
await typeWithNewlines(answer);
\`\`\`

**WHY THIS IS REQUIRED:**
- keyboard.type() does NOT convert \\n to Enter key presses
- Google Docs, Word, and most apps require ACTUAL Enter key events
- Without this, all newlines are ignored and text appears compressed

**CRITICAL: Answer Formatting Rules**
When generating answers to questions (coding problems, explanations, etc.):
- **BE CONCISE AND DIRECT**: No introductions, no verbose explanations
- **NO fluff**: Skip "Looking at this question...", "I can help...", "Let me explain..."
- **Start with the solution immediately** - code first, brief notes if needed
- **Keep it short**: Only include what's essential to answer the question
- **MUST use multi-line template literals** - the template literal MUST span multiple lines in your code
- **DO NOT write the template literal on one line** - it will appear compressed
- **Each section should be on its own line** with blank lines between sections

**FORMATTING STRUCTURE (adapt content to actual question):**
\`\`\`javascript
// Helper function - ALWAYS include this for multi-line text
async function typeWithNewlines(text) {
  for (const char of text) {
    if (char === '\\n') {
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    } else {
      await keyboard.type(char);
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

// Multi-line template literal - notice it spans many lines
const answer = \`[Section 1 title or solution]

[Code, explanation, or details for section 1]

[Section 2 if needed]

[Code or explanation for section 2]

[Example or edge cases if relevant]\`;

// Type with proper newline handling
await typeWithNewlines(answer);
\`\`\`

**KEY POINTS:**
- ALWAYS include the typeWithNewlines() helper function
- **BE CONCISE**: Only essential information, no verbose explanations
- Replace the bracketed placeholders with your actual answer content
- Keep the multi-line format with blank lines between sections
- The helper will convert \\n to actual Enter key presses

**CONCISE ANSWER STRUCTURE:**
- Solution/Code (the actual answer)
- Brief explanation (only if absolutely necessary)
- Example (only if it adds clarity)
- Skip everything else

**IMPORTANT**: Use the forked package \`@nut-tree-fork/nut-js\` version 4.2.6+

**CRITICAL: Web Searches and Browser Queries**
When the command involves searching the web, shopping online, or visiting websites:
1. **DO NOT open Spotlight/Windows Search**
2. **Open the default browser directly** using system launcher
3. **macOS**: Open "Safari" or "Chrome" or "Firefox" via Spotlight
4. **Windows**: Open "Chrome" or "Edge" or "Firefox" via Windows Search
5. **After browser opens**: Wait 1000ms
6. **ALWAYS open new tab FIRST** - Cmd+T (Mac) or Ctrl+T (Windows)
7. **Wait 500ms for new tab to open**
8. **Then navigate**: Cmd+L/Ctrl+L to focus address bar, type URL, press Enter
9. **NEVER overwrite user's existing tabs** - always start with fresh new tab

**CRITICAL: Multi-Site Browser Workflows**
When visiting MULTIPLE websites in one command (e.g., "Go to YouTube then Gmail"):
1. **First site**: Open browser → **Cmd+T (new tab!)** → navigate to first URL
2. **Second site onwards**: **Cmd+T (new tab!)** → navigate to next URL
3. **NEVER use Cmd+L without Cmd+T first** - always open new tab before navigating
4. **Example**: YouTube → Gmail = Open browser → **Cmd+T** → YouTube → **Cmd+T** → Gmail

**Examples of web/browser queries:**
- "search for winter clothes on Amazon" → Open browser → search on Amazon
- "find restaurants near me" → Open browser → Google search
- "go to youtube.com" → Open browser → navigate to URL
- "search for JavaScript tutorials" → Open browser → Google search
- "check my email" → Open browser → go to email provider
- "go to YouTube then Gmail" → Open browser → YouTube → **Cmd+T (new tab!)** → Gmail

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
- **Copy URL**: Cmd+L (Mac) or Ctrl+L (Windows), then Cmd+C/Ctrl+C
- **Switch tabs**: Cmd+Option+Right/Left (Mac) or Ctrl+Tab (Windows)

**Gmail Web Interface Patterns - HYBRID APPROACH:**
- **Import vision service**: const { findAndClick } = require('../src/services/visionSpatialService')
- **Use vision AI for buttons** (Compose, Send) - they have clear labels
- **Use Tab navigation for fields** (To, Subject, Body) - they have NO labels or unreliable labels

**Gmail Compose Workflow:**
1. **Open Compose dialog**:
   - Wait 3000ms for Gmail to load
   - Use vision: await findAndClick('Compose', 'button') with 60s timeout
   - Wait 2000ms for compose dialog to render
   
2. **Fill "To" field**:
   - IMPORTANT: Gmail's "To" field has NO label - it's an empty textbox
   - After Compose opens, focus may be on dialog controls (minimize, close, etc.)
   - Press Tab key 2-3 times to ensure we reach the To input field
   - Alternative: Click in the upper area of compose dialog to focus To field
   - Wait 500ms, then type recipient email
   - Press Enter to confirm recipient (moves to next field)
   - Wait 500ms after typing
   
3. **Fill "Subject" field**:
   - Press Tab key to move to Subject field
   - Wait 300ms, then type subject
   - Wait 500ms after typing
   
4. **Fill message body**:
   - Press Tab key to move to message body
   - Wait 300ms, then type message content
   - Wait 500ms after typing
   
5. **Send email**:
   - Use vision: await findAndClick('Send', 'button') with 30s timeout
   - Alternative fallback: Use keyboard shortcut Cmd+Enter (Mac) or Ctrl+Enter (Windows)
   - Wait 1000ms to confirm send

**Why Hybrid Approach**:
- ✅ Vision AI for buttons: Compose and Send have clear, visible labels
- ✅ Tab navigation for fields: To/Subject/Body have no labels or are next to label buttons
- ✅ Faster: Tab is instant, vision takes 12-15 seconds per field
- ✅ More reliable: Tab always works, vision might fail on unlabeled fields

**Vision AI Timeout Pattern**:
- Always wrap findAndClick with Promise.race for timeout
- Use 60s timeout for Compose button (first interaction)
- Use 30s timeout for other fields (To, Subject, Body, Send)
- Check if result is false and throw error if element not found

**Why Vision-First**:
- Works regardless of Gmail UI updates or customization
- Handles different screen sizes and resolutions
- No brittle fixed coordinates that break
- Self-healing - adapts to layout changes
- More reliable than keyboard shortcuts (which can be disabled)

**🌐 WEB APPS & DESKTOP APPS - USE VISION AI:**

**Gmail (Web):**
- Use vision AI for: Compose button, To field, Subject field, Body, Send button
- Keyboard shortcuts ONLY for: Cmd+Enter to send (after filling fields)
- Wait times: 3s for Gmail to load, 2s after Compose click

**YouTube (Web):**
- Use vision AI for: Search box, video thumbnails, subscribe buttons
- Keyboard shortcuts: "/" to focus search (if already on page)
- Wait times: 2s for page load, 2s for search results

**Slack (Desktop App):**
- Use vision AI for: Channel names, user names, message buttons, emoji reactions
- Keyboard shortcuts: Cmd+K for quick switcher (OS-level), Cmd+T for threads
- Wait times: 1s for app to load, 500ms for channel switch

**Outlook (Desktop App):**
- Use vision AI for: New Email button, To field, Subject field, Body, Send button
- Keyboard shortcuts: Cmd+N for new email (OS-level), Cmd+Enter to send
- Wait times: 2s for Outlook to load, 1s for compose window

**Discord (Desktop App):**
- Use vision AI for: Server icons, channel names, user names, buttons
- Keyboard shortcuts: Cmd+K for quick switcher (OS-level)
- Wait times: 1s for server switch, 500ms for channel load

**VS Code (Desktop App):**
- Use vision AI for: File explorer items, buttons, menu items
- Keyboard shortcuts: Cmd+P for file search, Cmd+Shift+P for command palette
- Wait times: 500ms for file open, 300ms for command palette

**Notion (Desktop App):**
- Use vision AI for: Page titles, blocks, buttons, database items
- Keyboard shortcuts: Cmd+P for quick find (OS-level), "/" for slash commands
- Wait times: 1s for page load, 500ms for block creation

**General Rule for ALL Apps:**
- ✅ Use vision AI to FIND and CLICK UI elements
- ✅ Use keyboard shortcuts ONLY for OS-level operations (open, close, save, copy, paste)
- ✅ Use keyboard.type() to TYPE text after vision AI clicks the input field
- ❌ NEVER use fixed coordinates - they break on different screens

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

${visionContext}**User Command:** ${command}

**CRITICAL: Extract Values from User Command**
The examples below use placeholder values like "example@gmail.com" or "bitfarm stock" - these are TEMPLATES ONLY.
You MUST extract the actual values from the user's command above and use those in your generated code.

Examples:
- User says "email to me at john@company.com" → Use "john@company.com", NOT "example@gmail.com"
- User says "search for AI trends" → Use "AI trends", NOT "bitfarm stock"
- User says "subject line: Meeting Notes" → Use "Meeting Notes", NOT template subject
- ALWAYS use the user's actual values, NEVER use example placeholder values

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

**CORRECT Example for "Go to YouTube, search for bitfarm stock, copy link, email to me at example@gmail.com" (Web Workflow with Vision Fallback):**
**NOTE: This example uses "bitfarm stock" and "example@gmail.com" because that's what the example command asks for. YOU must use the actual values from YOUR user's command!**
\`\`\`
const { keyboard, Key, mouse, straightTo, Point, Region, Button } = require('@nut-tree-fork/nut-js');
const { findAndClick } = require('../src/services/visionSpatialService');

(async () => {
  try {
    const isMac = process.platform === 'darwin';
    
    // Step 1: Open browser
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.Space);
      await keyboard.releaseKey(Key.LeftSuper, Key.Space);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("chrome");
    } else {
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.releaseKey(Key.LeftSuper);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("chrome");
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Step 2: Open new tab FIRST (don't overwrite user's existing tabs!)
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.T);
      await keyboard.releaseKey(Key.LeftSuper, Key.T);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.T);
      await keyboard.releaseKey(Key.LeftControl, Key.T);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 3: Navigate to YouTube
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.L);
      await keyboard.releaseKey(Key.LeftSuper, Key.L);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.L);
      await keyboard.releaseKey(Key.LeftControl, Key.L);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.type("youtube.com");
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 4: Search on YouTube (use search box, NOT address bar!)
    await keyboard.type("/");  // Focus YouTube search box
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.type("bitfarm stock");
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 5: Copy current page URL (search results page)
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.L);
      await keyboard.releaseKey(Key.LeftSuper, Key.L);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.L);
      await keyboard.releaseKey(Key.LeftControl, Key.L);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.C);
      await keyboard.releaseKey(Key.LeftSuper, Key.C);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.C);
      await keyboard.releaseKey(Key.LeftControl, Key.C);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 6: Open Gmail in new tab (MUST open new tab, don't overwrite current!)
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.T);
      await keyboard.releaseKey(Key.LeftSuper, Key.T);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.T);
      await keyboard.releaseKey(Key.LeftControl, Key.T);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    await keyboard.type("mail.google.com");
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 7: Click Compose button - USE VISION AI with timeout
    console.log('[Gmail] Looking for Compose button...');
    
    // Add 60-second timeout to vision call (vision API can take 12-15 seconds + processing + retries)
    const composePromise = findAndClick('Compose', 'button');
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), 60000));
    const composeSuccess = await Promise.race([composePromise, timeoutPromise]);
    
    if (!composeSuccess) {
      console.error('[Gmail] Vision AI failed or timed out - check VISION_PROVIDER and API keys in .env');
      throw new Error('Could not find Gmail Compose button (vision timeout or API key missing)');
    }
    
    console.log('[Gmail] Compose button clicked, waiting for dialog...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for compose dialog to render
    
    // Step 8: Focus "To" field (Gmail's To field has NO label - use Tab to focus)
    console.log('[Gmail] Focusing To field with Tab key...');
    // Tab multiple times to ensure we reach the To input field (focus might be on dialog controls)
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 9: Type recipient (use actual email from user's command!)
    await keyboard.type("example@gmail.com");
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Press Enter to confirm recipient and move to Subject field
    console.log('[Gmail] Confirming recipient with Enter...');
    await keyboard.pressKey(Key.Return);
    await keyboard.releaseKey(Key.Return);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 10: Type subject (already in Subject field after Enter)
    console.log('[Gmail] Typing subject...');
    
    // Step 11: Type subject
    await keyboard.type("Bitfarm Stock Videos");
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 12: Focus message body (Tab to next field)
    console.log('[Gmail] Focusing message body with Tab key...');
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 13: Type body and paste YouTube link
    await keyboard.type("Here are the search results for bitfarm stock: ");
    await new Promise(resolve => setTimeout(resolve, 200));
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.V);  // Paste
      await keyboard.releaseKey(Key.LeftSuper, Key.V);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.V);
      await keyboard.releaseKey(Key.LeftControl, Key.V);
    }
    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait longer for compose dialog to fully render
    
    // Step 14: Send email using VISION AI
    console.log('[Gmail] Looking for Send button (forcing fresh screenshot)...');
    const sendPromise = findAndClick('Send', 'button');
    const sendTimeout = new Promise((resolve) => setTimeout(() => resolve(false), 30000));
    const sendSuccess = await Promise.race([sendPromise, sendTimeout]);
    
    if (!sendSuccess) {
      // Fallback to keyboard shortcut if vision fails
      console.log('[Gmail] Vision failed for Send button, using keyboard shortcut...');
      if (isMac) {
        await keyboard.pressKey(Key.LeftSuper, Key.Enter);
        await keyboard.releaseKey(Key.LeftSuper, Key.Enter);
      } else {
        await keyboard.pressKey(Key.LeftControl, Key.Enter);
        await keyboard.releaseKey(Key.LeftControl, Key.Enter);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('YouTube search results emailed successfully');
  } catch (error) {
    console.error('Failed to complete YouTube to Gmail workflow:', error);
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
   * Supports vision-enhanced generation with screenshot context
   */
  private async generateWithGrok(command: string, screenshot?: ScreenshotData): Promise<NutjsCodeResponse> {
    if (!this.grokClient) {
      throw new Error('Grok client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!screenshot;
    const prompt = this.buildNutjsPrompt(command, hasScreenshot);

    try {
      logger.info('Generating Nut.js code with Grok', { command, hasScreenshot });

      // Use vision model if screenshot provided, otherwise use standard model
      // grok-4 supports both text and vision (multimodal)
      // grok-2-latest is text-only but faster
      const model = hasScreenshot ? 'grok-4' : (this.useGrok4 ? 'grok-4' : 'grok-2-latest');
      logger.info(`Using Grok model: ${model}`, { useGrok4: this.useGrok4, vision: hasScreenshot });
      
      // Build message content - multimodal if screenshot provided
      // Using OpenAI-compatible format (xAI supports both OpenAI and native formats)
      const userContent: any = hasScreenshot ? [
        {
          type: 'image_url',
          image_url: {
            url: `data:${screenshot.mimeType || 'image/png'};base64,${screenshot.base64}`,
            detail: 'low', // Use 'low' for faster processing (vs 'high' or 'auto')
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ] : prompt;
      
      const response = await this.grokClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a Nut.js code generation expert. Generate ONLY executable Nut.js code without any explanations or markdown.',
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
        temperature: 0.2, // Very low for fastest generation
        max_tokens: hasScreenshot ? 1000 : 800, // Aggressive reduction for speed
        stream: false,
        top_p: 0.9, // Slightly reduce sampling space for faster generation
        // Add unique user identifier to prevent caching
        user: `nutjs_${Date.now()}`,
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
        usedVision: hasScreenshot,
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
   * Supports vision-enhanced generation with screenshot context
   */
  private async generateWithClaude(command: string, screenshot?: ScreenshotData, context?: any): Promise<NutjsCodeResponse> {
    if (!this.claudeClient) {
      throw new Error('Claude client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!screenshot;
    const prompt = this.buildNutjsPrompt(command, hasScreenshot, context);

    try {
      // Log screenshot hash for debugging (use middle section to avoid PNG header)
      const screenshotHash = screenshot ? screenshot.base64.substring(100, 132) : 'none';
      const screenshotSize = screenshot ? screenshot.base64.length : 0;
      logger.info('Generating Nut.js code with Claude (fallback)', { 
        command, 
        hasScreenshot,
        screenshotHash,
        screenshotSize,
        responseMode: context?.responseMode,
        isTypeOnly: context?.responseMode === 'type-only',
        timestamp: Date.now()
      });

      // Build message content - multimodal if screenshot provided
      const messageContent: any = hasScreenshot ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: screenshot.mimeType || 'image/png',
            data: screenshot.base64,
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ] : prompt;

      const response = await this.claudeClient.messages.create({
        model: 'claude-sonnet-4-20250514', // Latest Claude Sonnet 4
        max_tokens: hasScreenshot ? 1000 : 800, // Optimized for speed
        temperature: 0.2, // Lower for faster generation
        messages: [
          {
            role: 'user',
            content: messageContent,
          },
        ],
        // Add metadata to prevent caching
        metadata: {
          user_id: `nutjs_${Date.now()}`,
        },
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
        usedVision: hasScreenshot,
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
   * Generate Nut.js code using OpenAI GPT-4 Vision
   */
  private async generateWithOpenAI(command: string, screenshot?: ScreenshotData): Promise<NutjsCodeResponse> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!screenshot;
    const prompt = this.buildNutjsPrompt(command, hasScreenshot);

    try {
      logger.info('Generating Nut.js code with OpenAI GPT-4V', { command, hasScreenshot });

      // Use GPT-4o (supports vision) - faster and cheaper than gpt-4-turbo
      const model = 'gpt-4o'; // gpt-4o supports both text and vision
      
      // Build message content - multimodal if screenshot provided
      const userContent: any = hasScreenshot ? [
        {
          type: 'image_url',
          image_url: {
            url: `data:${screenshot.mimeType || 'image/png'};base64,${screenshot.base64}`,
            detail: 'low', // Use 'low' for faster processing
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ] : prompt;

      const response = await this.openaiClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a Nut.js code generation expert. Generate ONLY executable Nut.js code without any explanations or markdown.',
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
        temperature: 0.2,
        max_tokens: hasScreenshot ? 1000 : 800,
        // Add unique user identifier to prevent caching
        user: `nutjs_${Date.now()}`,
      });

      const code = response.choices[0]?.message?.content?.trim() || '';
      const latencyMs = Date.now() - startTime;

      // Clean up markdown code fences if present
      const cleanedCode = this.cleanCodeOutput(code);

      logger.info('OpenAI generated Nut.js code successfully', {
        command,
        latencyMs,
        codeLength: cleanedCode.length,
      });

      return {
        code: cleanedCode,
        provider: 'openai',
        latencyMs,
        usedVision: hasScreenshot,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('OpenAI code generation failed', {
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
   * Build context-aware prompt for automation plan generation
   * Supports replanning with feedback and multi-modal context
   * 
   * REFACTORED VERSION - Addresses expert feedback:
   * - Strict schema alignment with TypeScript types
   * - No markdown fences (prevents model mirroring)
   * - Deterministic delimiters for user input
   * - Single source of truth for enums
   * - Conditional openUrl based on domain match
   * - 272 lines vs 800+ (66% reduction)
   */
  private buildContextAwarePlanPrompt(request: AutomationPlanRequest): string {
    // Single source of truth for OS
    const os = request.context?.os || (process.platform === 'darwin' ? 'darwin' : 'win32');
    const isReplan = !!request.previousPlan || !!request.feedback;
    
    // Deterministic delimiters for user input (prevents injection)
    const userCommand = `<<USER_COMMAND>>\n${request.command}\n<</USER_COMMAND>>`;
    
    // Check if we need to navigate (domain mismatch)
    let navigationGuidance = '';
    if (request.context?.activeUrl) {
      navigationGuidance = `\n- Current URL: ${request.context.activeUrl}`;
      navigationGuidance += `\n- Navigation Rule: If target domain matches current URL domain, skip openUrl. Otherwise, use openUrl to navigate.`;
    }
    
    // Build context section
    let contextSection = '';
    if (request.context) {
      contextSection = '\n\n=== CONTEXT ===';
      if (request.context.screenshot) {
        contextSection += '\n- Screenshot: Available (analyze for UI state)';
      }
      if (request.context.activeApp) {
        contextSection += `\n- Active App: ${request.context.activeApp}`;
      }
      if (request.context.activeUrl) {
        contextSection += `\n- Active URL: ${request.context.activeUrl}`;
      }
      contextSection += `\n- OS: ${os}`;
      if (request.context.screenIntel) {
        contextSection += '\n- OCR Data: Available';
      }
    }
    
    // Clarification answers (if provided)
    let clarificationSection = '';
    if (request.clarificationAnswers && Object.keys(request.clarificationAnswers).length > 0) {
      clarificationSection = '\n\n=== CLARIFICATION ANSWERS ===';
      for (const [qid, answer] of Object.entries(request.clarificationAnswers)) {
        clarificationSection += `\n- ${qid}: ${answer}`;
      }
      clarificationSection += '\nUse these answers to resolve ambiguity.';
    }
    
    // Replan section
    let replanSection = '';
    if (isReplan) {
      replanSection = '\n\n=== REPLANNING MODE ===';
      if (request.feedback) {
        const feedbackMsg = `<<FEEDBACK>>\n${request.feedback.message}\n<</FEEDBACK>>`;
        replanSection += `\n- Reason: ${request.feedback.reason}`;
        replanSection += `\n- Feedback: ${feedbackMsg}`;
        if (request.feedback.stepId) {
          replanSection += `\n- Failed Step: ${request.feedback.stepId}`;
        }
      }
      if (request.previousPlan) {
        replanSection += `\n- Previous Version: ${request.previousPlan.version || 1}`;
        replanSection += `\n- Increment to: ${(request.previousPlan.version || 1) + 1}`;
        replanSection += '\n- Analyze failure, adapt strategy, modify/remove failed steps';
      }
    }

    return `You are an automation planner. Generate a structured JSON plan.

${userCommand}${contextSection}${clarificationSection}${replanSection}

=== CONTRACT ===

OUTPUT FORMAT: Return ONLY valid JSON. No markdown. No explanations. No code fences.

SCHEMA:
- Plan fields: goal (string), steps (array), retryPolicy (object), questions (array), version (number)
- Step fields: id (string), kind (object), description (string), status (string), retry (object), onError (object), dependsOn (array)
- Step.kind MUST have: type (enum) + type-specific fields
- Step.id MUST be unique and match pattern: step_N
- Step.dependsOn MUST reference existing step IDs only

ENUMS (single source of truth):
- kind.type: focusApp | openUrl | waitForElement | findAndClick | movePointer | click | typeText | pressKey | hotkey | scroll | pause | screenshot | apiAction | notifyUser | askUser | log | end
- locator.strategy: vision | textMatch | contains | bbox (bbox ONLY if provided by vision service, never guess)
- onError.strategy: fail_plan | skip_step | goto_step | ask_user | replan
- log.level: info | warn | error
- question.type: choice | freeform
- OS: ${os}

=== DECISION RULES ===

NAVIGATION:
- Web task + activeUrl matches target domain → Skip openUrl, use focusApp
- Web task + activeUrl mismatch or missing → Use openUrl first
- Desktop app task → Use focusApp${navigationGuidance}

ERROR STRATEGY:
- Login/CAPTCHA/Permissions/Payment → ask_user (never replan)
- UI layout change/Element not found → replan
- Impossible task → fail_plan

UI STATE CHANGES:
- After clicking toggles/buttons that change UI → Add pause (1000-1500ms) + waitForElement to verify
- Never assume success without verification

LOCATORS:
- Prefer: locator.strategy = "vision" with description
- Never invent bbox coordinates
- bbox only allowed if provided by vision service output

=== STEP PRIMITIVES ===

Each step has: { id, kind, description, status: "pending", retry?, onError?, dependsOn? }

kind.type options:

1. focusApp - Switch to desktop app
   Example: { "type": "focusApp", "appName": "Google Chrome" }

2. openUrl - Navigate to URL (required for web tasks unless domain matches)
   Example: { "type": "openUrl", "url": "https://chat.openai.com" }

3. findAndClick - Vision-based click
   Example: { "type": "findAndClick", "locator": { "strategy": "vision", "description": "blue Send button in bottom right" }, "timeoutMs": 5000 }

4. waitForElement - Wait for element to appear
   Example: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "expanded sidebar" }, "timeoutMs": 3000 }

5. click - Click at current pointer position
   Example: { "type": "click", "x": 100, "y": 200 }

6. typeText - Type literal text (NOT for shortcuts)
   Example: { "type": "typeText", "text": "Hello world", "submit": false }

7. pressKey - Keyboard shortcuts and special keys
   Example: { "type": "pressKey", "key": "A", "modifiers": ["Cmd"] }
   Example: { "type": "pressKey", "key": "Enter" }

8. scroll - Scroll in direction
   Example: { "type": "scroll", "direction": "down", "amount": 300 }

9. pause - Wait milliseconds
   Example: { "type": "pause", "ms": 1500 }

10. screenshot - Capture screen
    Example: { "type": "screenshot", "tag": "verify_state" }

11. log - Log message
    Example: { "type": "log", "level": "info", "message": "Starting task" }

12. end - End execution
    Example: { "type": "end", "reason": "completed" }

CRITICAL: typeText vs pressKey
- typeText: Literal text only (messages, filenames, search queries)
- pressKey: Keyboard shortcuts (Cmd+A, Cmd+C, Enter, Tab, etc.)
- WRONG: { "type": "typeText", "text": "Cmd+A" } → Types "C-m-d-+-A" literally
- CORRECT: { "type": "pressKey", "key": "A", "modifiers": ["Cmd"] } → Selects all

Modifiers: "Cmd" (macOS), "Ctrl" (Windows/Linux), "Shift", "Alt", "Option"

=== EXAMPLE ===

Task: "Open ChatGPT and send a message"

EXAMPLE_START
{
  "goal": "Open ChatGPT and send a message",
  "version": 1,
  "steps": [
    {
      "id": "step_1",
      "kind": { "type": "openUrl", "url": "https://chat.openai.com" },
      "description": "Navigate to ChatGPT",
      "status": "pending",
      "retry": { "maxAttempts": 2, "delayMs": 2000 },
      "onError": { "strategy": "fail_plan", "message": "Cannot reach ChatGPT" }
    },
    {
      "id": "step_2",
      "kind": { "type": "pause", "ms": 2000 },
      "description": "Wait for page load",
      "status": "pending"
    },
    {
      "id": "step_3",
      "kind": {
        "type": "waitForElement",
        "locator": { "strategy": "vision", "description": "chat input field at bottom" },
        "timeoutMs": 10000
      },
      "description": "Wait for chat interface",
      "status": "pending",
      "retry": { "maxAttempts": 2, "delayMs": 3000 },
      "onError": { "strategy": "ask_user", "questionId": "q1", "message": "ChatGPT not loading. Please log in if needed and click Retry." }
    },
    {
      "id": "step_4",
      "kind": {
        "type": "findAndClick",
        "locator": { "strategy": "vision", "description": "chat input field" },
        "timeoutMs": 5000
      },
      "description": "Click input field",
      "status": "pending",
      "retry": { "maxAttempts": 2, "delayMs": 1000 },
      "onError": { "strategy": "skip_step" }
    },
    {
      "id": "step_5",
      "kind": { "type": "typeText", "text": "Hello, how are you?", "submit": true },
      "description": "Type and send message",
      "status": "pending",
      "retry": { "maxAttempts": 1 },
      "onError": { "strategy": "replan", "reason": "Failed to send message" }
    }
  ],
  "retryPolicy": { "maxGlobalRetries": 2 },
  "questions": [
    {
      "id": "q1",
      "text": "ChatGPT is not loading. Please log in if needed and click Retry.",
      "type": "freeform",
      "required": false
    }
  ]
}
EXAMPLE_END

=== VERIFICATION PATTERN ===

When opening panels/sidebars/dialogs (UI state changes):

PATTERN_START
{
  "steps": [
    {
      "id": "step_N",
      "kind": { "type": "findAndClick", "locator": { "strategy": "vision", "description": "sidebar toggle button in top left" } },
      "description": "Click to open sidebar",
      "retry": { "maxAttempts": 3, "delayMs": 1000 }
    },
    {
      "id": "step_N+1",
      "kind": { "type": "pause", "ms": 1500 },
      "description": "Wait for animation"
    },
    {
      "id": "step_N+2",
      "kind": { "type": "waitForElement", "locator": { "strategy": "vision", "description": "expanded sidebar with content visible" }, "timeoutMs": 3000 },
      "description": "Verify sidebar opened",
      "retry": { "maxAttempts": 1 }
    }
  ]
}
PATTERN_END

Now generate the JSON plan for the user's command. Return ONLY the JSON object.`;
  }

  

  /**
   * STAGE 1: Check if user query needs clarification before planning
   * Uses a lightweight prompt to determine if the query is ambiguous
   */
  private async checkIfNeedsClarification(request: AutomationPlanRequest): Promise<AutomationPlanResponse> {
    // Build context including any previous answers
    let contextInfo = `User request: "${request.command}"`;
    
    if (request.clarificationAnswers && Object.keys(request.clarificationAnswers).length > 0) {
      contextInfo += `\n\nPrevious clarification answers provided:\n`;
      for (const [questionId, answer] of Object.entries(request.clarificationAnswers)) {
        contextInfo += `- ${questionId}: ${answer}\n`;
      }
    }

    const clarificationPrompt = `You are a query analyzer. Determine if this automation request is CLEAR or AMBIGUOUS.

${contextInfo}

**CRITICAL: Ask for clarification if the request has IMPORTANT missing information or ambiguity.**

🚨 **MUST ask for clarification if:**
- **Vague references**: "that project", "the thing", "something like", "I think", "maybe"
- **Missing critical target**: "open the file" (which file?), "check that project" (which project?)
- **Ambiguous actions**: "save it" (where?), "send to my team" (who specifically?), "update the numbers" (which numbers? to what?)
- **Impossible to identify what to automate**: "do that thing I mentioned"

⚠️ **SHOULD ask for clarification if:**
- **Important user preferences**: Save location, recipient lists, specific file paths
- **Ambiguous scope**: "top 3 articles" (from where? saved where?)
- **Missing context that affects outcome**: Which document? Which meeting? Which chapter?

✅ **DO NOT ask for clarification if:**
- **Minor styling preferences**: Color, font size, exact wording (can use reasonable defaults)
- **The request is fully specific**: "Generate Mickey Mouse in ChatGPT", "Create calendar event for dentist next Tuesday at 2pm"
- **Reasonable defaults exist and are obvious**: Search engine (Google), browser (Chrome), date format (MM/DD/YYYY)

**Examples:**

AMBIGUOUS (needs clarification):
- "I think I have a project about bible study" → Which project? Where?
- "Open that file" → Which file?
- "Process the document" → Which document? What processing?
- "Search for AI news and save top 3 articles" → Save WHERE? (important user preference)
- "Send email to my team" → WHO specifically? (important - affects recipients)

CLEAR (no clarification needed):
- "Generate Mickey Mouse in ChatGPT" → Clear task, app specified
- "Send email to john@example.com about meeting" → Clear recipient and topic
- "Create calendar event for dentist next Tuesday at 2pm" → Clear task and time
- "Search Google for Python tutorials" → Clear task, obvious defaults (Google, browser)

**Response format:**

CRITICAL: Return ONLY valid JSON. No explanations. No markdown. No extra text before or after.

If AMBIGUOUS (only if IMPOSSIBLE to execute):
{
  "needsClarification": true,
  "clarificationQuestions": [
    {
      "id": "q1",
      "text": "What is the exact name of your project?",
      "type": "freeform",
      "required": true
    }
  ],
  "partialContext": {
    "extractedInfo": {}
  }
}

If CLEAR (can be executed):
{
  "needsClarification": false
}

Analyze now:`;

    // Use Claude for fast clarification check
    if (this.claudeClient) {
      const message = await this.claudeClient.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: clarificationPrompt,
          },
        ],
      });

      const rawResponse = message.content[0]?.type === 'text' ? message.content[0].text : '';
      const result = this.extractJsonFromResponse(rawResponse);

      if (result.needsClarification) {
        return {
          success: true,
          needsClarification: true,
          clarificationQuestions: result.clarificationQuestions,
          partialContext: result.partialContext,
          provider: 'claude',
          latencyMs: 0,
        };
      }
    }

    // Query is clear, return null to indicate no clarification needed
    return {
      success: true,
      needsClarification: false,
    } as AutomationPlanResponse;
  }

  /**
   * Generate context-aware structured automation plan with automatic fallback
   * Supports replanning with feedback for adaptive automation
   * Tries OpenAI first (most reliable JSON), then Claude, then Grok
   * Note: Gemini skipped for plan generation - generates invalid step types and has JSON parsing errors
   */
  async generatePlan(request: AutomationPlanRequest | string): Promise<AutomationPlanResponse> {
    const errors: string[] = [];
    
    // Backward compatibility: accept string command
    const planRequest: AutomationPlanRequest = typeof request === 'string' 
      ? { command: request, intent: 'command_automate' }
      : request;

    // STAGE 0: Check if this is a partial fix plan request
    if (planRequest.context?.requestPartialPlan && planRequest.context?.isReplanning) {
      logger.info('Partial fix plan requested', {
        failedStepIndex: planRequest.context.failedStepIndex,
        hasPreviousPlan: !!planRequest.previousPlan,
        hasFeedback: !!planRequest.feedback,
      });
      return await this.generatePartialFixPlan(planRequest);
    }

    // STAGE 0.5: Validate screenshot context for initial plan generation
    const isReplanRequest = !!planRequest.previousPlan || !!planRequest.feedback;
    
    // Check for screenshot in multiple possible locations and formats
    const screenshot = planRequest.context?.screenshot as any;
    const hasScreenshot = !!(
      screenshot && (
        typeof screenshot === 'string' ||  // Direct base64 string
        screenshot.base64 ||                // Object with base64 property
        screenshot.data                     // Object with data property (alternative format)
      )
    );
    
    if (!isReplanRequest && !hasScreenshot) {
      logger.warn('Initial plan generation requested without screenshot context', {
        command: planRequest.command,
        hasContext: !!planRequest.context,
        contextKeys: planRequest.context ? Object.keys(planRequest.context) : [],
        screenshotType: screenshot ? typeof screenshot : 'undefined',
        screenshotKeys: screenshot && typeof screenshot === 'object' ? Object.keys(screenshot) : [],
      });
      
      // Return clarification asking for screenshot
      return {
        success: true,
        needsClarification: true,
        clarificationQuestions: [
          {
            id: 'screenshot_required',
            text: 'Screenshot context is required to generate an accurate automation plan. Please provide a screenshot of your current screen state.',
            type: 'freeform',
            required: true,
          },
        ],
      };
    }
    
    // Calculate screenshot size for logging
    let screenshotSize = 0;
    if (hasScreenshot && screenshot) {
      if (typeof screenshot === 'string') {
        screenshotSize = screenshot.length;
      } else if (screenshot.base64) {
        screenshotSize = screenshot.base64.length;
      } else if (screenshot.data) {
        screenshotSize = screenshot.data.length;
      }
    }
    
    logger.info('Screenshot validation passed', {
      hasScreenshot,
      isReplan: isReplanRequest,
      screenshotSize,
      screenshotFormat: typeof screenshot === 'string' ? 'string' : (screenshot?.base64 ? 'object.base64' : 'object.data'),
    });

    // STAGE 1: Check if query needs clarification (unless answers already provided)
    logger.info('Checking for clarification answers', {
      command: planRequest.command,
      hasClarificationAnswers: !!planRequest.clarificationAnswers,
      clarificationAnswersType: typeof planRequest.clarificationAnswers,
      clarificationAnswersKeys: planRequest.clarificationAnswers ? Object.keys(planRequest.clarificationAnswers) : [],
    });
    
    const hasAnswers = planRequest.clarificationAnswers && Object.keys(planRequest.clarificationAnswers).length > 0;
    
    if (hasAnswers) {
      logger.info('Clarification answers provided, skipping clarification check', {
        command: planRequest.command,
        answerCount: Object.keys(planRequest.clarificationAnswers!).length,
      });
    }
    
    if (!hasAnswers) {
      try {
        const clarificationCheck = await this.checkIfNeedsClarification(planRequest);
        // Only return if clarification is actually needed
        if (clarificationCheck.needsClarification === true) {
          logger.info('Query needs clarification', { 
            command: planRequest.command,
            questionCount: clarificationCheck.clarificationQuestions?.length 
          });
          return clarificationCheck;
        }
        // If needsClarification is false, continue to plan generation
        logger.info('Query is clear, proceeding with plan generation', { command: planRequest.command });
      } catch (error: any) {
        logger.warn('Clarification check failed, proceeding with plan generation', { error: error.message });
        // Continue to plan generation if clarification check fails
      }
    }

    // STAGE 2: Generate the actual plan
    // Try OpenAI first (Priority 1 - most reliable for JSON)
    if (this.openaiClient) {
      try {
        return await this.generatePlanWithOpenAI(planRequest);
      } catch (error: any) {
        errors.push(`OpenAI: ${error.message}`);
        logger.warn('OpenAI failed for plan generation, falling back to Claude', { error: error.message });
      }
    } else {
      errors.push('OpenAI: Client not initialized (missing OPENAI_API_KEY)');
    }

    // Fallback to Claude (Priority 2 - fast vision)
    if (this.claudeClient) {
      try {
        return await this.generatePlanWithClaude(planRequest);
      } catch (error: any) {
        errors.push(`Claude: ${error.message}`);
        logger.warn('Claude failed for plan generation, falling back to Grok', { error: error.message });
      }
    } else {
      errors.push('Claude: Client not initialized (missing ANTHROPIC_API_KEY)');
    }

    // Fallback to Grok (Priority 3 - last resort)
    if (this.grokClient) {
      try {
        return await this.generatePlanWithGrok(planRequest);
      } catch (error: any) {
        errors.push(`Grok: ${error.message}`);
        logger.error('All providers failed for plan generation', { errors });
      }
    } else {
      errors.push('Grok: Client not initialized (missing GROK_API_KEY)');
    }

    // All providers failed
    throw new Error(`Failed to generate automation plan. Errors: ${errors.join('; ')}`);
  }

  /**
   * Generate a partial fix plan for a failed step
   * Returns a mini plan (2-5 steps) that resolves the immediate issue
   */
  private async generatePartialFixPlan(request: AutomationPlanRequest): Promise<AutomationPlanResponse> {
    const errors: string[] = [];
    const failedStepIndex = request.context?.failedStepIndex ?? -1;
    const previousPlan = request.previousPlan;
    const feedback = request.feedback?.message || 'Step failed';
    
    if (!previousPlan || failedStepIndex < 0) {
      throw new Error('Partial fix plan requires previousPlan and failedStepIndex');
    }

    const failedStep = previousPlan.steps[failedStepIndex];
    if (!failedStep) {
      throw new Error(`Failed step at index ${failedStepIndex} not found in previous plan`);
    }

    logger.info('Generating partial fix plan', {
      failedStepIndex,
      failedStepDescription: failedStep.description,
      originalGoal: previousPlan.goal,
      feedback,
    });

    // Try OpenAI first (Priority 1 - most reliable for JSON)
    if (this.openaiClient) {
      try {
        return await this.generatePartialFixPlanWithOpenAI(request, failedStep, failedStepIndex);
      } catch (error: any) {
        errors.push(`OpenAI: ${error.message}`);
        logger.warn('OpenAI failed for partial fix plan, falling back to Claude', { error: error.message });
      }
    } else {
      errors.push('OpenAI: Client not initialized (missing OPENAI_API_KEY)');
    }

    // Fallback to Claude (Priority 2 - fast vision)
    if (this.claudeClient) {
      try {
        return await this.generatePartialFixPlanWithClaude(request, failedStep, failedStepIndex);
      } catch (error: any) {
        errors.push(`Claude: ${error.message}`);
        logger.warn('Claude failed for partial fix plan, falling back to Grok', { error: error.message });
      }
    } else {
      errors.push('Claude: Client not initialized (missing ANTHROPIC_API_KEY)');
    }

    // Fallback to Grok (Priority 3 - last resort)
    if (this.grokClient) {
      try {
        return await this.generatePartialFixPlanWithGrok(request, failedStep, failedStepIndex);
      } catch (error: any) {
        errors.push(`Grok: ${error.message}`);
        logger.error('All providers failed for partial fix plan', { errors });
      }
    } else {
      errors.push('Grok: Client not initialized (missing GROK_API_KEY)');
    }

    // All providers failed
    throw new Error(`Failed to generate partial fix plan. Errors: ${errors.join('; ')}`);
  }

  /**
   * Generate structured plan using Gemini 3 Pro Preview with context awareness
   */
  private async generatePlanWithGemini(request: AutomationPlanRequest): Promise<AutomationPlanResponse> {
    if (!this.geminiClient) {
      throw new Error('Gemini client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!request.context?.screenshot?.base64;

    try {
      logger.info('Generating automation plan with Gemini 2.5 Pro', {
        command: request.command,
        hasScreenshot,
        isReplan: !!request.previousPlan || !!request.feedback
      });

      const model = this.geminiClient.getGenerativeModel({
        model: 'gemini-2.5-pro',
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
        systemInstruction: 'You are a JSON-only automation planner. Return ONLY valid JSON. No markdown, no explanations, no code fences, no additional text.'
      });

      const parts: any[] = [];

      // Add screenshot if provided
      if (hasScreenshot) {
        parts.push({
          inlineData: {
            mimeType: request.context!.screenshot!.mimeType || 'image/png',
            data: request.context!.screenshot!.base64,
          },
        });
      }

      // Add prompt
      parts.push({
        text: this.buildContextAwarePlanPrompt(request),
      });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts }],
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = result.response.text();

      // Parse JSON response (extractJsonFromResponse is called internally)
      const planData = this.parseAndValidatePlan(rawResponse, request);

      // Check if this is a clarification response
      if (planData.needsClarification) {
        logger.info('Gemini returned clarification questions', {
          latencyMs,
          questionCount: planData.clarificationQuestions?.length
        });

        return {
          success: true,
          needsClarification: true,
          clarificationQuestions: planData.clarificationQuestions,
          partialContext: planData.partialContext,
          provider: 'gemini',
          latencyMs,
        };
      }

      // Return successful plan
      logger.info('Gemini 2.5 Pro plan generation successful', {
        latencyMs,
        stepCount: planData.steps.length
      });

      return {
        success: true,
        plan: planData,
        provider: 'gemini',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Gemini plan generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate structured plan using Grok with context awareness
   */
  private async generatePlanWithGrok(request: AutomationPlanRequest): Promise<AutomationPlanResponse> {
    if (!this.grokClient) {
      throw new Error('Grok client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!request.context?.screenshot?.base64;
    
    // Use vision model if screenshot provided, otherwise use standard model
    const model = hasScreenshot ? 'grok-4' : (this.useGrok4 ? 'grok-4' : 'grok-2-latest');

    try {
      logger.info('Generating automation plan with Grok', { 
        model, 
        command: request.command,
        hasScreenshot,
        isReplan: !!request.previousPlan || !!request.feedback
      });

      // Build messages with optional vision
      const messages: any[] = [
        {
          role: 'system',
          content: 'You are an expert automation planner with vision capabilities. Analyze screenshots to understand UI state and generate precise automation plans. Return only valid JSON, no markdown or explanations.',
        },
      ];

      // Add user message with screenshot if provided
      if (hasScreenshot) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${request.context!.screenshot!.mimeType || 'image/png'};base64,${request.context!.screenshot!.base64}`,
                detail: 'low', // Use 'low' for faster processing
              },
            },
            {
              type: 'text',
              text: this.buildContextAwarePlanPrompt(request),
            },
          ],
        });
      } else {
        messages.push({
          role: 'user',
          content: this.buildContextAwarePlanPrompt(request),
        });
      }

      const completion = await this.grokClient.chat.completions.create({
        model,
        messages,
        temperature: 0.2, // Lower for faster generation
        max_tokens: hasScreenshot ? 4096 : 3072, // Optimize based on vision needs
        top_p: 0.9,
        user: `nutjs_plan_${Date.now()}`,
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = completion.choices[0]?.message?.content || '';

      // Parse JSON response
      const planData = this.parseAndValidatePlan(rawResponse, request);
      
      // Check if this is a clarification response
      if (planData.needsClarification) {
        logger.info('Grok returned clarification questions', { 
          latencyMs, 
          questionCount: planData.clarificationQuestions?.length 
        });
        
        return {
          success: true,
          needsClarification: true,
          clarificationQuestions: planData.clarificationQuestions,
          partialContext: planData.partialContext,
          provider: 'grok',
          latencyMs,
        };
      }
      
      // Update metadata with correct provider and generation time
      if (!planData.metadata) {
        planData.metadata = {};
      }
      planData.metadata.provider = 'grok';
      planData.metadata.generationTimeMs = latencyMs;

      logger.info('Grok plan generation successful', { latencyMs, stepCount: planData.steps.length });

      return {
        success: true,
        plan: planData,
        provider: 'grok',
        latencyMs,
      } as AutomationPlanResponse;
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Grok plan generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate structured plan using Claude with context awareness
   */
  private async generatePlanWithClaude(request: AutomationPlanRequest): Promise<AutomationPlanResponse> {
    if (!this.claudeClient) {
      throw new Error('Claude client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!request.context?.screenshot?.base64;

    try {
      logger.info('Generating automation plan with Claude', { 
        command: request.command,
        hasScreenshot,
        isReplan: !!request.previousPlan || !!request.feedback
      });

      // Build message content with optional vision
      const messageContent: any[] = [
        {
          type: 'text',
          text: this.buildContextAwarePlanPrompt(request),
        },
      ];

      // Add screenshot if provided
      if (hasScreenshot) {
        messageContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: request.context!.screenshot!.mimeType || 'image/png',
            data: request.context!.screenshot!.base64,
          },
        });
      }

      const message = await this.claudeClient.messages.create({
        model: 'claude-sonnet-4-20250514', // Latest Claude Sonnet 4
        max_tokens: hasScreenshot ? 4096 : 3072, // Optimize based on vision needs
        temperature: 0.2, // Lower for faster generation
        messages: [
          {
            role: 'user',
            content: messageContent,
          },
        ],
        // Add metadata to prevent caching
        metadata: {
          user_id: `nutjs_plan_${Date.now()}`,
        },
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = message.content[0]?.type === 'text' ? message.content[0].text : '';

      // Parse JSON response
      const planData = this.parseAndValidatePlan(rawResponse, request);
      
      // Check if this is a clarification response
      if (planData.needsClarification) {
        logger.info('Claude returned clarification questions', { 
          latencyMs, 
          questionCount: planData.clarificationQuestions?.length 
        });
        
        return {
          success: true,
          needsClarification: true,
          clarificationQuestions: planData.clarificationQuestions,
          partialContext: planData.partialContext,
          provider: 'claude',
          latencyMs,
        };
      }
      
      // Update metadata with correct provider and generation time
      if (!planData.metadata) {
        planData.metadata = {};
      }
      planData.metadata.provider = 'claude';
      planData.metadata.generationTimeMs = latencyMs;

      logger.info('Claude plan generation successful', { latencyMs, stepCount: planData.steps.length });

      return {
        success: true,
        plan: planData,
        provider: 'claude',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Claude plan generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate structured plan using OpenAI with context awareness
   */
  private async generatePlanWithOpenAI(request: AutomationPlanRequest): Promise<AutomationPlanResponse> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!request.context?.screenshot?.base64;

    try {
      logger.info('Generating automation plan with OpenAI', { 
        command: request.command,
        hasScreenshot,
        isReplan: !!request.previousPlan || !!request.feedback
      });

      // Build messages with optional vision
      const messages: any[] = [
        {
          role: 'system',
          content: 'You are an expert automation planner with vision capabilities. Analyze screenshots to understand UI state and generate precise automation plans. Return only valid JSON, no markdown or explanations.',
        },
      ];

      // Add user message with screenshot if provided
      if (hasScreenshot) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${request.context!.screenshot!.mimeType || 'image/png'};base64,${request.context!.screenshot!.base64}`,
                detail: 'low', // Use 'low' for faster processing
              },
            },
            {
              type: 'text',
              text: this.buildContextAwarePlanPrompt(request),
            },
          ],
        });
      } else {
        messages.push({
          role: 'user',
          content: this.buildContextAwarePlanPrompt(request),
        });
      }

      const completion = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o', // gpt-4o supports both text and vision
        messages,
        temperature: 0.2, // Lower for faster generation
        max_tokens: hasScreenshot ? 4096 : 3072, // Optimize based on vision needs
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = completion.choices[0]?.message?.content || '';

      // Parse JSON response
      const planData = this.parseAndValidatePlan(rawResponse, request);
      
      // Check if this is a clarification response
      if (planData.needsClarification) {
        logger.info('OpenAI returned clarification questions', { 
          latencyMs, 
          questionCount: planData.clarificationQuestions?.length 
        });
        
        return {
          success: true,
          needsClarification: true,
          clarificationQuestions: planData.clarificationQuestions,
          partialContext: planData.partialContext,
          provider: 'openai',
          latencyMs,
        };
      }
      
      // Update metadata with correct provider and generation time
      if (!planData.metadata) {
        planData.metadata = {};
      }
      planData.metadata.provider = 'openai';
      planData.metadata.generationTimeMs = latencyMs;

      logger.info('OpenAI plan generation successful', { latencyMs, stepCount: planData.steps.length });

      return {
        success: true,
        plan: planData,
        provider: 'openai',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('OpenAI plan generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate partial fix plan using Gemini 3 Pro Preview
   */
  private async generatePartialFixPlanWithGemini(
    request: AutomationPlanRequest,
    failedStep: any,
    failedStepIndex: number
  ): Promise<AutomationPlanResponse> {
    if (!this.geminiClient) {
      throw new Error('Gemini client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!request.context?.screenshot?.base64;
    const prompt = this.buildPartialFixPlanPrompt(request, failedStep, failedStepIndex);

    const model = this.geminiClient.getGenerativeModel({
      model: 'gemini-2.5-pro',
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
      systemInstruction: 'You are a JSON-only automation planner. Return ONLY valid JSON. No markdown, no explanations, no code fences, no additional text.'
    });

    const parts: any[] = [];

    if (hasScreenshot) {
      parts.push({
        inlineData: {
          mimeType: request.context!.screenshot!.mimeType || 'image/png',
          data: request.context!.screenshot!.base64,
        },
      });
    }

    parts.push({
      text: prompt,
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
    });

    const latencyMs = Date.now() - startTime;
    const rawResponse = result.response.text();
    
    // Parse JSON response (extractJsonFromResponse is called internally)
    const fixPlan = this.parseAndValidatePartialFixPlan(rawResponse, request, failedStepIndex);

    logger.info('Gemini 2.5 Pro partial fix plan generation successful', {
      latencyMs,
      stepCount: fixPlan.steps.length
    });

    return {
      success: true,
      plan: fixPlan,
      provider: 'gemini',
      latencyMs,
    };
  }

  /**
   * Generate partial fix plan using Claude
   */
  private async generatePartialFixPlanWithClaude(
    request: AutomationPlanRequest,
    failedStep: any,
    failedStepIndex: number
  ): Promise<AutomationPlanResponse> {
    if (!this.claudeClient) {
      throw new Error('Claude client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!request.context?.screenshot?.base64;
    const prompt = this.buildPartialFixPlanPrompt(request, failedStep, failedStepIndex);

    const messageContent: any[] = [{ type: 'text', text: prompt }];

    if (hasScreenshot) {
      messageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: request.context!.screenshot!.mimeType || 'image/png',
          data: request.context!.screenshot!.base64,
        },
      });
    }

    const message = await this.claudeClient.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      temperature: 0.2,
      messages: [{ role: 'user', content: messageContent }],
    });

    const latencyMs = Date.now() - startTime;
    const rawResponse = message.content[0]?.type === 'text' ? message.content[0].text : '';
    const fixPlan = this.parseAndValidatePartialFixPlan(rawResponse, request, failedStepIndex);

    logger.info('Claude partial fix plan generation successful', { 
      latencyMs, 
      stepCount: fixPlan.steps.length 
    });

    return {
      success: true,
      plan: fixPlan,
      provider: 'claude',
      latencyMs,
    };
  }

  /**
   * Generate partial fix plan using OpenAI
   */
  private async generatePartialFixPlanWithOpenAI(
    request: AutomationPlanRequest,
    failedStep: any,
    failedStepIndex: number
  ): Promise<AutomationPlanResponse> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!request.context?.screenshot?.base64;
    const prompt = this.buildPartialFixPlanPrompt(request, failedStep, failedStepIndex);

    const messages: any[] = [];

    if (hasScreenshot) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${request.context!.screenshot!.mimeType || 'image/png'};base64,${request.context!.screenshot!.base64}`,
            },
          },
        ],
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const completion = await this.openaiClient.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.2,
      max_tokens: 2048,
    });

    const latencyMs = Date.now() - startTime;
    const rawResponse = completion.choices[0]?.message?.content || '';
    const fixPlan = this.parseAndValidatePartialFixPlan(rawResponse, request, failedStepIndex);

    logger.info('OpenAI partial fix plan generation successful', { 
      latencyMs, 
      stepCount: fixPlan.steps.length 
    });

    return {
      success: true,
      plan: fixPlan,
      provider: 'openai',
      latencyMs,
    };
  }

  /**
   * Generate partial fix plan using Grok
   */
  private async generatePartialFixPlanWithGrok(
    request: AutomationPlanRequest,
    failedStep: any,
    failedStepIndex: number
  ): Promise<AutomationPlanResponse> {
    if (!this.grokClient) {
      throw new Error('Grok client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!request.context?.screenshot?.base64;
    const prompt = this.buildPartialFixPlanPrompt(request, failedStep, failedStepIndex);

    const messages: any[] = [];

    if (hasScreenshot) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${request.context!.screenshot!.mimeType || 'image/png'};base64,${request.context!.screenshot!.base64}`,
            },
          },
        ],
      });
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const completion = await this.grokClient.chat.completions.create({
      model: 'grok-4',
      messages,
      temperature: 0.2,
      max_tokens: 2048,
    });

    const latencyMs = Date.now() - startTime;
    const rawResponse = completion.choices[0]?.message?.content || '';
    const fixPlan = this.parseAndValidatePartialFixPlan(rawResponse, request, failedStepIndex);

    logger.info('Grok partial fix plan generation successful', { 
      latencyMs, 
      stepCount: fixPlan.steps.length 
    });

    return {
      success: true,
      plan: fixPlan,
      provider: 'grok',
      latencyMs,
    };
  }

  /**
   * Parse and validate automation plan JSON or clarification response
   */
  private parseAndValidatePlan(rawResponse: string, request: AutomationPlanRequest): AutomationPlan | any {
    // Parse JSON with robust extraction
    let planJson: any;
    try {
      planJson = this.extractJsonFromResponse(rawResponse);
    } catch (error) {
      throw new Error(`Failed to parse plan JSON: ${error}`);
    }

    // Check if this is a clarification response
    if (planJson.needsClarification === true) {
      // Validate clarification response
      if (!planJson.clarificationQuestions || !Array.isArray(planJson.clarificationQuestions)) {
        throw new Error('Clarification response must have "clarificationQuestions" array');
      }
      if (planJson.clarificationQuestions.length === 0) {
        throw new Error('Clarification response must have at least one question');
      }
      // Return as-is for clarification
      return planJson;
    }

    // Validate required fields for normal plan
    if (!planJson.steps || !Array.isArray(planJson.steps)) {
      throw new Error('Plan must have a "steps" array');
    }

    if (planJson.steps.length === 0) {
      throw new Error('Plan must have at least one step');
    }

    // Validate each step has required fields
    for (const step of planJson.steps) {
      if (!step.id || !step.description || !step.kind) {
        throw new Error(`Invalid step: missing required fields (id, description, kind)`);
      }
      // Ensure status is set
      if (!step.status) {
        step.status = 'pending';
      }
    }

    // Determine version (increment if replanning)
    const version = request.previousPlan ? (request.previousPlan.version || 1) + 1 : 1;

    // Build complete AutomationPlan object
    const plan: AutomationPlan = {
      planId: request.previousPlan?.planId || randomUUID(),
      version,
      intent: request.intent || 'command_automate',
      goal: planJson.goal || request.command,
      createdAt: new Date().toISOString(),
      contextSnapshot: request.context ? {
        // Don't include screenshot in response - it's huge and MCP already has it
        // screenshot: request.context.screenshot,
        screenIntel: request.context.screenIntel,
        activeApp: request.context.activeApp,
        activeUrl: request.context.activeUrl,
        os: request.context.os || (process.platform === 'darwin' ? 'darwin' : 'win32'),
        timestamp: new Date().toISOString(),
      } : undefined,
      steps: planJson.steps,
      retryPolicy: planJson.retryPolicy || { maxGlobalRetries: 2 },
      questions: planJson.questions || [],
      metadata: {
        provider: 'grok', // Will be overwritten by caller
        generationTimeMs: 0, // Will be overwritten by caller
        targetOS: process.platform === 'darwin' ? 'darwin' : 'win32',
        targetApp: this.detectTargetApp(request.command),
      },
    };

    return plan;
  }

  /**
   * Detect target application from command
   */
  private detectTargetApp(command: string): string | undefined {
    const lowerCommand = command.toLowerCase();
    
    if (lowerCommand.includes('gmail')) return 'gmail';
    if (lowerCommand.includes('outlook')) return 'outlook';
    if (lowerCommand.includes('slack')) return 'slack';
    if (lowerCommand.includes('youtube')) return 'youtube';
    if (lowerCommand.includes('discord')) return 'discord';
    if (lowerCommand.includes('notion')) return 'notion';
    if (lowerCommand.includes('vs code') || lowerCommand.includes('vscode')) return 'vscode';
    if (lowerCommand.includes('figma')) return 'figma';
    if (lowerCommand.includes('calendar')) return 'calendar';
    
    return undefined;
  }

  /**
   * Build prompt for partial fix plan generation
   * REFACTORED: Addresses expert feedback on schema consistency, blocker detection, and verification
   */
  private buildPartialFixPlanPrompt(
    request: AutomationPlanRequest,
    failedStep: any,
    failedStepIndex: number
  ): string {
    const previousPlan = request.previousPlan!;
    const feedback = request.feedback?.message || 'Step failed after retries';
    const hasScreenshot = !!request.context?.screenshot;
    
    // Additional context for better diagnosis
    const failedStepId = failedStep.id || 'unknown';
    const lastError = failedStep.lastError || 'No error details available';
    const activeUrl = request.context?.activeUrl || 'unknown';
    const activeApp = request.context?.activeApp || 'unknown';

    return `You are an automation expert. One step failed and needs a minimal fix.

<<ORIGINAL_GOAL>>
${previousPlan.goal}
<</ORIGINAL_GOAL>>

<<FAILED_STEP>>
index: ${failedStepIndex}
id: ${failedStepId}
description: ${failedStep.description}
kind: ${JSON.stringify(failedStep.kind)}
error_or_feedback: ${feedback}
last_error: ${lastError}
<</FAILED_STEP>>

<<CURRENT_CONTEXT>>
activeUrl: ${activeUrl}
activeApp: ${activeApp}
${hasScreenshot ? 'screenshot: Available - analyze it to understand current UI state' : 'screenshot: Not available'}
<</CURRENT_CONTEXT>>

TASK: Return a SHORT fix plan (2-5 steps) as JSON:
- Fix the immediate cause of failure
- Achieve what the failed step was trying to do
- Do NOT include remaining original steps (frontend continues after your fix)

RULES:
1) Return ONLY valid JSON. No markdown. No code fences. No explanations.
2) Use ONLY the step kinds listed below.
3) Locators MUST include a strategy field:
   - locator: { "strategy": "vision" | "textMatch" | "contains" | "bbox", "description": "..." }
4) Prefer strategy="vision" when screenshot is available.
5) If you perform a UI state change (open panel, navigate, expand menu), you MUST verify it:
   - Add a short pause (500-1500ms) AND a waitForElement step that confirms the new UI is visible.
6) Never guess coordinates. Do not output fixed coordinates unless provided externally.
7) BLOCKER DETECTION: If screenshot shows login/captcha/permission dialog → return a fix plan with ask_user strategy (do not try to bypass).

VALID STEP KINDS:
- { "type": "focusApp", "appName": "..." }
- { "type": "openUrl", "url": "..." }
- { "type": "findAndClick", "locator": { "strategy": "vision", "description": "..." }, "timeoutMs": 5000 }
- { "type": "waitForElement", "locator": { "strategy": "vision", "description": "..." }, "timeoutMs": 3000 }
- { "type": "movePointer", "target": { "strategy": "vision", "description": "..." } }
- { "type": "click", "button": "left", "clickCount": 1 }
- { "type": "typeText", "text": "...", "submit": false }
- { "type": "pressKey", "key": "Enter", "modifiers": ["Cmd"] }
- { "type": "scroll", "direction": "up" | "down" | "left" | "right", "amount": 300 }
- { "type": "pause", "ms": 1500 }
- { "type": "screenshot", "tag": "verify_state", "analyzeWithVision": true }
- { "type": "log", "level": "info" | "warn" | "error", "message": "..." }
- { "type": "end", "reason": "completed" }

COMMON FAILURE PATTERNS:

Pattern 1: "project in side panel" not found
Root Cause: Sidebar is collapsed/closed
Fix: Open sidebar first, VERIFY it opened, then find project
Example steps:
  fix_1: findAndClick sidebar toggle button (retry: 3x)
  fix_2: pause 1500ms for animation
  fix_3: waitForElement expanded sidebar (verify opened)
  fix_4: findAndClick target project in sidebar

Pattern 2: Element not found on web page
Root Cause: Wrong page loaded or page not fully loaded
Fix: Navigate to correct URL first
Example steps:
  fix_1: openUrl to correct page
  fix_2: pause 2000ms for page load
  fix_3: findAndClick target element

Pattern 3: Element needs scrolling to be visible
Fix: Scroll then find element
Example steps:
  fix_1: scroll direction="down" amount=300
  fix_2: pause 500ms
  fix_3: findAndClick target element

Pattern 4: Project not found in ChatGPT sidebar (after opening)
Root Cause: Project doesn't exist, different name, or scrolled out of view
Fix: Use ChatGPT's search feature
Example steps:
  fix_1: findAndClick search icon in sidebar
  fix_2: pause 500ms
  fix_3: typeText project name
  fix_4: pause 1000ms for results
  fix_5: findAndClick project from search results

Pattern 5: Project scrolled in sidebar list
Root Cause: Long list, target below visible area
Fix: Scroll in sidebar then find
Example steps:
  fix_1: findAndClick sidebar list area (to focus)
  fix_2: scroll direction="down" amount=300
  fix_3: pause 500ms
  fix_4: findAndClick target project

OUTPUT FORMAT (ONLY THIS JSON OBJECT):
{
  "steps": [
    {
      "id": "fix_1",
      "kind": { "type": "...", ... },
      "description": "...",
      "retry": { "maxAttempts": 2, "delayMs": 1000 },
      "onError": { "strategy": "replan" | "ask_user" | "fail_plan" | "skip_step", "message": "...", "reason": "...", "questionId": "q1" }
    }
  ]
}

Generate the fix plan now:`;
  }

  /**
   * Parse and validate partial fix plan JSON
   */
  private parseAndValidatePartialFixPlan(
    rawResponse: string,
    request: AutomationPlanRequest,
    failedStepIndex: number
  ): AutomationPlan {
    // Parse JSON with robust extraction
    let fixPlanJson: any;
    try {
      fixPlanJson = this.extractJsonFromResponse(rawResponse);
    } catch (error) {
      throw new Error(`Failed to parse fix plan JSON: ${error}`);
    }

    // Validate steps array
    if (!fixPlanJson.steps || !Array.isArray(fixPlanJson.steps)) {
      throw new Error('Fix plan must have a "steps" array');
    }

    if (fixPlanJson.steps.length === 0) {
      throw new Error('Fix plan must have at least one step');
    }

    if (fixPlanJson.steps.length > 10) {
      throw new Error('Fix plan should be concise (max 10 steps)');
    }

    // Validate each step
    // NOTE: Must match frontend interpreter valid types and backend AutomationStepKind
    const validStepTypes = [
      'focusApp', 'openUrl', 'typeText', 'hotkey', 'click', 'scroll', 
      'pause', 'apiAction', 'waitForElement', 'screenshot', 'findAndClick', 
      'log', 'pressKey', 'end', 'movePointer', 'notifyUser', 'askUser'
    ];
    
    for (const step of fixPlanJson.steps) {
      if (!step.id || !step.kind || !step.description) {
        throw new Error(`Invalid step structure: ${JSON.stringify(step)}`);
      }
      
      // Validate step type
      if (!step.kind.type || !validStepTypes.includes(step.kind.type)) {
        throw new Error(
          `Invalid step type: "${step.kind.type}". ` +
          `Valid types are: ${validStepTypes.join(', ')}.`
        );
      }
      
      // Validate scroll step has required fields
      if (step.kind.type === 'scroll') {
        if (typeof step.kind.amount !== 'number' || step.kind.amount <= 0) {
          throw new Error(
            `Invalid scroll step: "amount" must be a positive number, got: ${step.kind.amount}`
          );
        }
        if (!['up', 'down', 'left', 'right'].includes(step.kind.direction)) {
          throw new Error(
            `Invalid scroll step: "direction" must be one of: up, down, left, right, got: ${step.kind.direction}`
          );
        }
      }
    }

    const previousPlan = request.previousPlan!;
    const failedStep = previousPlan.steps[failedStepIndex];

    // Build the fix plan
    const fixPlan: AutomationPlan = {
      planId: randomUUID(),
      version: (previousPlan.version || 1) + 1,
      intent: previousPlan.intent,
      goal: `Fix: ${failedStep.description}`,
      createdAt: new Date().toISOString(),
      steps: fixPlanJson.steps,
      metadata: {
        isFixPlan: true,
        originalPlanId: previousPlan.planId,
        fixesStepIndex: failedStepIndex,
      },
    };

    return fixPlan;
  }

  /**
   * Build prompt for interactive guide generation with visual overlays
   * Generates step-by-step guidance with boundary coordinates for UI overlays
   */
  private buildInteractiveGuidePrompt(request: InteractiveGuideRequest): string {
    const os = process.platform === 'darwin' ? 'darwin' : 'win32';
    const hasScreenshot = !!request.context?.screenshot;
    const isReplan = !!request.previousGuide || !!request.feedback;
    
    let replanSection = '';
    if (isReplan) {
      replanSection = `\n\n**REPLANNING MODE:**`;
      if (request.feedback) {
        replanSection += `\n- Reason: ${request.feedback.reason}`;
        replanSection += `\n- User Feedback: "${request.feedback.message}"`;
        if (request.feedback.stepId) {
          replanSection += `\n- Issue at Step: ${request.feedback.stepId}`;
        }
      }
      if (request.previousGuide) {
        replanSection += `\n- Previous Guide Steps: ${request.previousGuide.steps.length}`;
        replanSection += `\n\n**INSTRUCTIONS FOR REPLANNING:**`;
        replanSection += `\n- Analyze the user's feedback and adapt the guide accordingly`;
        replanSection += `\n- If missing prerequisites (e.g., "Don't have n8n installed"), add installation/setup steps FIRST`;
        replanSection += `\n- If a step failed, provide alternative approaches or more detailed substeps`;
        replanSection += `\n- Keep successful steps from the previous guide when applicable`;
        replanSection += `\n- Address the specific issue raised in the feedback`;
      }
    }
    
    return `You are an expert at creating interactive visual guides that teach users step-by-step with overlay instructions.

**USER COMMAND:** "${request.command}"
${hasScreenshot ? '\n**SCREENSHOT PROVIDED:** Analyze the current screen state to provide contextual guidance\n' : ''}
${request.context?.activeApp ? `**ACTIVE APP:** ${request.context.activeApp}\n` : ''}
${request.context?.activeUrl ? `**ACTIVE URL:** ${request.context.activeUrl}\n` : ''}${replanSection}

**YOUR TASK:** Generate ${isReplan ? 'a REVISED' : 'an'} interactive guide with visual overlays as a JSON object.

**CRITICAL RULES:**
1. Return ONLY valid JSON - no markdown, no explanations, no code fences
2. This is INTERACTIVE GUIDANCE - user performs actions manually, NOT automated execution
3. Each step provides visual overlays (arrows, highlights, text boxes) to guide the user
4. ${hasScreenshot ? '**ANALYZE THE SCREENSHOT**: Generate accurate boundary coordinates based on what you SEE in the image' : 'Use nodeQuery for dynamic element location'}
5. Include verification strategies to detect when user completes each step
6. Target OS: ${os} (darwin = macOS, win32 = Windows)
7. Provide clear, educational descriptions of what to do and why
8. Include fallback instructions if vision can't locate elements
9. Use completionMode: "either" (vision + manual "Next" button) for flexibility
10. ${hasScreenshot ? '**COORDINATE GENERATION**: When screenshot is provided, use "screen" coordinateSpace with ACTUAL pixel coordinates from the image. Also include nodeQuery for validation.' : 'Use "node" coordinateSpace with nodeQuery for dynamic positioning'}

**INTERACTIVE GUIDE STRUCTURE:**
{
  "intro": "Brief introduction explaining what this guide will teach",
  "steps": [
    {
      "id": "step_1",
      "title": "Open Spotlight Search",
      "description": "Click on the magnifying glass icon in the top-right corner of your screen to open Spotlight Search. This is macOS's built-in search tool.",
      "overlays": [
        {
          "id": "highlight_spotlight",
          "type": "highlight",
          "boundary": { "x": 0, "y": 0, "width": 1, "height": 1 },
          "coordinateSpace": "node",
          "nodeQuery": { "textContains": "Spotlight", "role": "button", "context": "menu bar" },
          "message": "Click here to open Spotlight",
          "opacity": 0.4,
          "pulse": true
        },
        {
          "id": "arrow_spotlight",
          "type": "arrow",
          "boundary": { "x": 0.9, "y": 0.05, "width": 0.05, "height": 0.05 },
          "coordinateSpace": "normalized",
          "arrowDirection": "up",
          "message": "Step 1: Click the magnifying glass"
        }
      ],
      "pointerActions": [
        {
          "type": "moveToBoundary",
          "boundaryId": "highlight_spotlight",
          "easing": "easeOut",
          "durationMs": 600
        }
      ],
      "completionMode": "either",
      "visionCheck": {
        "strategy": "element_visible",
        "expectedElement": "Spotlight search box",
        "timeoutMs": 10000,
        "pollIntervalMs": 1000
      },
      "fallbackInstruction": "If you can't find the magnifying glass, press Cmd+Space on your keyboard to open Spotlight.",
      "expectedDuration": 3000,
      "waitAfter": 1000
    }
  ]
}

**OVERLAY TYPES:**
- "highlight": Semi-transparent box highlighting an element (use with pulse: true)
- "arrow": Arrow pointing to an element with optional message
- "callout": Text box with explanation, positioned relative to element
- "textBox": Floating instruction box
- "label": Small label tag on element

**COORDINATE SPACES:**
${hasScreenshot ? `- "screen": **USE THIS** - Absolute pixel coordinates from the screenshot you're analyzing (x, y, width, height in pixels)
- "normalized": 0-1 coordinates for resolution-independent elements (e.g., arrows, callouts)
- "node": Fallback only - uses nodeQuery when coordinates can't be determined` : `- "node": **USE THIS** - Dynamic, uses nodeQuery to find element (when no screenshot provided)
- "normalized": 0-1 coordinates, resolution-independent
- "screen": Not available (no screenshot provided)`}

**NODE QUERY FIELDS (always include for validation):**
- textContains: Text visible in/near the element
- role: UI role (button, input, link, etc.)
- app: Application name
- context: Additional context for disambiguation

${hasScreenshot ? `**IMPORTANT**: Analyze the screenshot carefully and provide REAL pixel coordinates for all UI elements you can see. The boundary should match the actual position and size of the element in the image.` : ''}

**COMPLETION MODES:**
- "vision": Auto-advance when vision detects completion
- "manual": User clicks "Next" button
- "either": Vision check OR manual (RECOMMENDED)

**POINTER ACTIONS (optional ghost cursor):**
- moveToBoundary: Animate cursor to element
- clickOnBoundary: Show click animation
- moveToPoint: Move to specific coordinates

**EXAMPLE: "Show me how to buy winter clothes on Amazon"**
${hasScreenshot ? `(With screenshot - use actual pixel coordinates):` : `(Without screenshot - use node coordinates):`}
{
  "intro": "I'll guide you through searching for and purchasing winter clothes on Amazon step-by-step.",
  "steps": [
    {
      "id": "step_1",
      "title": "Open Chrome Browser",
      "description": "First, we need to open Google Chrome. You can find it in your Applications folder or use Spotlight to search for it.",
      "overlays": [
        {
          "id": "chrome_icon",
          "type": "highlight",
          "boundary": ${hasScreenshot ? `{ "x": 145, "y": 1050, "width": 70, "height": 70 }` : `{ "x": 0, "y": 0, "width": 1, "height": 1 }`},
          "coordinateSpace": ${hasScreenshot ? `"screen"` : `"node"`},
          "nodeQuery": { "textContains": "Chrome", "role": "button", "context": "dock or applications" },
          "pulse": true,
          "opacity": 0.4
        },
        {
          "id": "instruction",
          "type": "callout",
          "boundary": { "x": 0.5, "y": 0.3, "width": 0.3, "height": 0.1 },
          "coordinateSpace": "normalized",
          "position": "top",
          "message": "Click on Chrome to open the browser"
        }
      ],
      "completionMode": "either",
      "visionCheck": {
        "strategy": "app_running",
        "expectedApp": "Google Chrome",
        "timeoutMs": 8000
      },
      "fallbackInstruction": "If Chrome isn't visible, press Cmd+Space, type 'Chrome', and press Enter.",
      "expectedDuration": 5000
    },
    {
      "id": "step_2",
      "title": "Navigate to Amazon",
      "description": "Type 'amazon.com' in the address bar at the top of the browser and press Enter.",
      "overlays": [
        {
          "id": "address_bar",
          "type": "highlight",
          "boundary": ${hasScreenshot ? `{ "x": 420, "y": 85, "width": 800, "height": 45 }` : `{ "x": 0, "y": 0, "width": 1, "height": 1 }`},
          "coordinateSpace": ${hasScreenshot ? `"screen"` : `"node"`},
          "nodeQuery": { "role": "input", "context": "address bar", "textContains": "Search" },
          "pulse": true
        },
        {
          "id": "type_instruction",
          "type": "textBox",
          "boundary": { "x": 0.3, "y": 0.15, "width": 0.4, "height": 0.08 },
          "coordinateSpace": "normalized",
          "message": "Type: amazon.com"
        }
      ],
      "completionMode": "either",
      "visionCheck": {
        "strategy": "element_visible",
        "expectedElement": "Amazon logo or amazon.com in URL",
        "timeoutMs": 10000
      },
      "fallbackInstruction": "Click the address bar, type 'amazon.com', and press Enter.",
      "expectedDuration": 8000
    },
    {
      "id": "step_3",
      "title": "Search for Winter Clothes",
      "description": "Find the search box and type 'winter clothes'. Then click the search button or press Enter.",
      "overlays": [
        {
          "id": "search_box",
          "type": "highlight",
          "boundary": { "x": 0, "y": 0, "width": 1, "height": 1 },
          "coordinateSpace": "node",
          "nodeQuery": { "role": "input", "textContains": "Search", "context": "Amazon search" },
          "pulse": true
        }
      ],
      "pointerActions": [
        {
          "type": "moveToBoundary",
          "boundaryId": "search_box",
          "easing": "easeOut",
          "durationMs": 800
        }
      ],
      "completionMode": "either",
      "visionCheck": {
        "strategy": "screenshot_comparison",
        "timeoutMs": 10000
      },
      "fallbackInstruction": "Look for the search box near the top of the page, type 'winter clothes', and press Enter.",
      "expectedDuration": 10000
    }
  ]
}

**IMPORTANT:**
${hasScreenshot ? `- **CRITICAL**: Analyze the screenshot and generate REAL pixel coordinates for coordinateSpace: "screen"
- Measure the actual position (x, y) and size (width, height) of each UI element you see
- Always include nodeQuery alongside screen coordinates for validation
- Use normalized coordinates (0-1) only for floating elements like arrows and callouts` : `- Use coordinateSpace: "node" with nodeQuery for ALL interactive elements
- Boundaries should be { "x": 0, "y": 0, "width": 1, "height": 1 } as placeholders`}
- Provide clear, beginner-friendly descriptions
- Always include fallbackInstruction for when vision fails
- Use completionMode: "either" for flexibility
- Keep overlay messages concise (under 10 words)
- Generate 3-7 steps depending on task complexity

Now generate the interactive guide JSON for the user's command. Return ONLY the JSON object, no other text.`;
  }

  /**
   * Generate Nut.js code from natural language command
   * Priority: Claude (3-8s) → OpenAI GPT-4V (5-10s) → Grok (30s+)
   * If vision fails, falls back to text-only generation
   */
  async generateCode(command: string, screenshot?: ScreenshotData, context?: any): Promise<NutjsCodeResponse> {
    const errors: string[] = [];
    const hasScreenshot = !!screenshot;
    
    // Extract context flags
    const responseMode = context?.responseMode;
    const instruction = context?.instruction;

    // Priority 1: Claude (fastest vision, 3-8s)
    if (this.claudeClient) {
      try {
        logger.info('Using Claude (Priority 1)', { hasScreenshot, responseMode });
        return await this.generateWithClaude(command, screenshot, context);
      } catch (error: any) {
        errors.push(`Claude: ${error.message}`);
        logger.warn('Claude failed, trying OpenAI', { error: error.message });
      }
    } else {
      errors.push('Claude: Client not initialized (missing ANTHROPIC_API_KEY)');
    }

    // Priority 2: OpenAI GPT-4 Vision (fast vision, 5-10s)
    if (this.openaiClient) {
      try {
        logger.info('Using OpenAI GPT-4V (Priority 2)', { hasScreenshot });
        return await this.generateWithOpenAI(command, screenshot);
      } catch (error: any) {
        errors.push(`OpenAI: ${error.message}`);
        logger.warn('OpenAI failed, trying Grok', { error: error.message });
      }
    } else {
      errors.push('OpenAI: Client not initialized (missing OPENAI_API_KEY)');
    }

    // Priority 3: Grok (slower vision 30s+, but good fallback)
    if (this.grokClient) {
      try {
        logger.info('Using Grok (Priority 3 - fallback)', { hasScreenshot });
        return await this.generateWithGrok(command, screenshot);
      } catch (error: any) {
        errors.push(`Grok: ${error.message}`);
        logger.warn('Grok failed', { error: error.message });
        
        // Last resort: Try without vision if we had a screenshot
        if (hasScreenshot && this.claudeClient) {
          try {
            logger.info('Last resort: Retrying Claude without vision');
            return await this.generateWithClaude(command, undefined);
          } catch (retryError: any) {
            errors.push(`Claude without vision: ${retryError.message}`);
          }
        }
      }
    } else {
      errors.push('Grok: Client not initialized (missing GROK_API_KEY)');
    }

    // All providers failed
    logger.error('All providers failed for Nut.js code generation', { errors });
    throw new Error(`Failed to generate Nut.js code. Errors: ${errors.join('; ')}`);
  }

  /**
   * Generate interactive guide with automatic fallback
   * Priority: Gemini 3 Pro Preview (latest) → OpenAI GPT-4V → Claude → Grok (fallback)
   */
  async generateGuide(request: InteractiveGuideRequest): Promise<InteractiveGuideResponse> {
    const errors: string[] = [];

    // Priority 1: Gemini 3 Pro Preview (latest, best quality)
    if (this.geminiClient) {
      try {
        return await this.generateInteractiveGuideWithGemini(request);
      } catch (error: any) {
        errors.push(`Gemini: ${error.message}`);
        logger.warn('Gemini failed for guide generation, falling back to OpenAI', { error: error.message });
      }
    } else {
      errors.push('Gemini: Client not initialized (missing GEMINI_API_KEY)');
    }

    // Priority 2: OpenAI GPT-4 Vision (fast vision, 5-10s)
    if (this.openaiClient) {
      try {
        return await this.generateInteractiveGuideWithOpenAI(request);
      } catch (error: any) {
        errors.push(`OpenAI: ${error.message}`);
        logger.warn('OpenAI failed for guide generation, falling back to Claude', { error: error.message });
      }
    } else {
      errors.push('OpenAI: Client not initialized (missing OPENAI_API_KEY)');
    }

    // Priority 3: Claude (fast vision, 3-8s)
    if (this.claudeClient) {
      try {
        return await this.generateInteractiveGuideWithClaude(request);
      } catch (error: any) {
        errors.push(`Claude: ${error.message}`);
        logger.warn('Claude failed for guide generation, falling back to Grok', { error: error.message });
      }
    } else {
      errors.push('Claude: Client not initialized (missing ANTHROPIC_API_KEY)');
    }

    // Priority 4: Grok (fallback, 30s+)
    if (this.grokClient) {
      try {
        return await this.generateInteractiveGuideWithGrok(request);
      } catch (error: any) {
        errors.push(`Grok: ${error.message}`);
        logger.error('All providers failed for guide generation', { errors });
      }
    } else {
      errors.push('Grok: Client not initialized (missing GROK_API_KEY)');
    }

    // All providers failed
    throw new Error(`Failed to generate interactive guide. Errors: ${errors.join('; ')}`);
  }

  /**
   * Generate interactive guide using Gemini 3 Pro Preview
   */
  private async generateInteractiveGuideWithGemini(request: InteractiveGuideRequest): Promise<InteractiveGuideResponse> {
    if (!this.geminiClient) {
      throw new Error('Gemini client not initialized');
    }

    const startTime = Date.now();

    try {
      logger.info('Generating interactive guide with Gemini 3 Pro Preview', { command: request.command });

      const model = this.geminiClient.getGenerativeModel({ 
        model: 'gemini-3-pro-preview',
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192,
        }
      });
      
      const parts: any[] = [];

      // Add screenshot if provided
      if (request.context?.screenshot) {
        parts.push({
          inlineData: {
            mimeType: request.context.screenshot.mimeType || 'image/png',
            data: request.context.screenshot.base64,
          },
        });
      }

      // Add prompt
      parts.push({
        text: this.buildInteractiveGuidePrompt(request),
      });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts }],
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = result.response.text();

      // Parse JSON response
      const guide = this.parseAndValidateInteractiveGuide(rawResponse, request);
      
      // Update metadata
      guide.metadata.provider = 'gemini' as any;
      guide.metadata.generationTime = latencyMs;

      logger.info('Gemini 3 Pro Preview interactive guide generation successful', { latencyMs, stepCount: guide.steps.length });

      return {
        success: true,
        guide,
        provider: 'gemini' as any,
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Gemini 3 Pro Preview interactive guide generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate interactive guide using Claude
   */
  private async generateInteractiveGuideWithClaude(request: InteractiveGuideRequest): Promise<InteractiveGuideResponse> {
    if (!this.claudeClient) {
      throw new Error('Claude client not initialized');
    }

    const startTime = Date.now();

    try {
      logger.info('Generating interactive guide with Claude', { command: request.command });

      const content: any[] = [];

      // Add screenshot if provided
      if (request.context?.screenshot) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: (request.context.screenshot.mimeType || 'image/png') as any,
            data: request.context.screenshot.base64,
          },
        });
      }

      // Add prompt
      content.push({
        type: 'text',
        text: this.buildInteractiveGuidePrompt(request),
      });

      const message = await this.claudeClient.messages.create({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 8192,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = message.content[0]?.type === 'text' ? message.content[0].text : '';

      // Parse JSON response
      const guide = this.parseAndValidateInteractiveGuide(rawResponse, request);
      
      // Update metadata
      guide.metadata.provider = 'claude';
      guide.metadata.generationTime = latencyMs;

      logger.info('Claude interactive guide generation successful', { latencyMs, stepCount: guide.steps.length });

      return {
        success: true,
        guide,
        provider: 'claude',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Claude interactive guide generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate interactive guide using OpenAI GPT-4 Vision
   */
  private async generateInteractiveGuideWithOpenAI(request: InteractiveGuideRequest): Promise<InteractiveGuideResponse> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const startTime = Date.now();

    try {
      logger.info('Generating interactive guide with OpenAI', { command: request.command });

      const messages: any[] = [
        {
          role: 'system',
          content: 'You are an expert at creating interactive visual guides. You MUST return ONLY valid JSON, no other text. Analyze screenshots carefully and provide accurate pixel coordinates for UI elements.'
        }
      ];

      // Add screenshot if provided
      if (request.context?.screenshot) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${request.context.screenshot.mimeType || 'image/png'};base64,${request.context.screenshot.base64}`,
              },
            },
            {
              type: 'text',
              text: this.buildInteractiveGuidePrompt(request),
            },
          ],
        });
      } else {
        messages.push({
          role: 'user',
          content: this.buildInteractiveGuidePrompt(request),
        });
      }

      const completion = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages,
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = completion.choices[0]?.message?.content || '';

      // Parse JSON response
      const guide = this.parseAndValidateInteractiveGuide(rawResponse, request);
      
      // Update metadata
      guide.metadata.provider = 'openai';
      guide.metadata.generationTime = latencyMs;

      logger.info('OpenAI interactive guide generation successful', { latencyMs, stepCount: guide.steps.length });

      return {
        success: true,
        guide,
        provider: 'openai',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('OpenAI interactive guide generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate interactive guide using Grok
   */
  private async generateInteractiveGuideWithGrok(request: InteractiveGuideRequest): Promise<InteractiveGuideResponse> {
    if (!this.grokClient) {
      throw new Error('Grok client not initialized');
    }

    const startTime = Date.now();
    const model = this.useGrok4 ? 'grok-2-1212' : 'grok-2-latest';

    try {
      logger.info('Generating automation guide with Grok', { model, command: request.command });

      const completion = await this.grokClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert automation guide creator. Return only valid JSON, no markdown or explanations.',
          },
          {
            role: 'user',
            content: this.buildInteractiveGuidePrompt(request),
          },
        ],
        temperature: 0.3,
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = completion.choices[0]?.message?.content || '';

      // Parse JSON response
      const guide = this.parseAndValidateInteractiveGuide(rawResponse, request);
      
      // Update metadata
      guide.metadata.provider = 'grok';
      guide.metadata.generationTime = latencyMs;

      logger.info('Grok interactive guide generation successful', { latencyMs, stepCount: guide.steps.length });

      return {
        success: true,
        guide,
        provider: 'grok',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Grok interactive guide generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Parse and validate interactive guide JSON
   */
  private parseAndValidateInteractiveGuide(rawResponse: string, request: InteractiveGuideRequest): InteractiveGuide {
    // Parse JSON with robust extraction
    let guideJson: any;
    try {
      guideJson = this.extractJsonFromResponse(rawResponse);
    } catch (error) {
      throw new Error(`Failed to parse interactive guide JSON: ${error}`);
    }

    // Validate required fields
    if (!guideJson.intro || typeof guideJson.intro !== 'string') {
      throw new Error('Interactive guide must have an "intro" string');
    }

    if (!guideJson.steps || !Array.isArray(guideJson.steps)) {
      throw new Error('Interactive guide must have a "steps" array');
    }

    if (guideJson.steps.length === 0) {
      throw new Error('Interactive guide must have at least one step');
    }

    // Validate each step has required fields for interactive guide
    for (const step of guideJson.steps) {
      if (!step.id || !step.title || !step.description) {
        throw new Error(`Invalid interactive step structure (missing id, title, or description): ${JSON.stringify(step)}`);
      }
      
      if (!step.overlays || !Array.isArray(step.overlays)) {
        throw new Error(`Step ${step.id} must have an "overlays" array`);
      }
      
      if (!step.completionMode) {
        throw new Error(`Step ${step.id} must have a "completionMode" field`);
      }
    }

    // Calculate estimated duration
    const estimatedDuration = guideJson.steps.reduce((total: number, step: any) => {
      return total + (step.expectedDuration || 5000) + (step.waitAfter || 0);
    }, 0);

    // Build complete interactive guide
    const guide: InteractiveGuide = {
      id: randomUUID(),
      command: request.command,
      intent: 'command_guide',
      intro: guideJson.intro,
      steps: guideJson.steps,
      totalSteps: guideJson.steps.length,
      metadata: {
        provider: 'grok', // Will be overwritten by caller
        generationTime: 0, // Will be overwritten by caller
        targetApp: this.detectTargetApp(request.command),
        targetOS: process.platform === 'darwin' ? 'darwin' : 'win32',
        estimatedDuration,
      },
    };

    return guide;
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
