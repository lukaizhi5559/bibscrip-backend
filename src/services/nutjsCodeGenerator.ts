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

**User Command:** ${command}

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
