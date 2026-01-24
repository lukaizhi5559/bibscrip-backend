# Shared Selector Documentation for Multi-Driver Automation

## Overview

This document defines the selector strategies available for UI automation. The system supports **three selector types** based on the target environment:

1. **Web Selectors** (Playwright/CDP) - For browser-based automation
2. **Desktop Selectors** (Accessibility APIs) - For native desktop apps
3. **Vision Fallback** - For canvases, games, or when structured selectors fail

---

## Selector Types

### 1. Web Selectors (Playwright/CDP)

Use these when automating **web pages in browsers** (Chrome, Safari, Firefox, Edge, Brave).

**Available strategies:**

```json
{
  "selector": {
    "css": "button.submit",              // CSS selector (preferred)
    "xpath": "//button[@id='submit']",   // XPath (when CSS insufficient)
    "text": "Submit",                     // Text content match
    "role": "button",                     // ARIA role
    "testId": "submit-btn"               // data-testid attribute
  }
}
```

**When to use each:**

- **CSS** (preferred): `"css": "button.submit"`, `"css": "input[name='email']"`
  - Fast, reliable, widely supported
  - Use for elements with classes, IDs, or attributes

- **Text**: `"text": "Submit"`, `"text": "Sign In"`
  - Use when element has unique visible text
  - Case-sensitive by default

- **Role**: `"role": "button"`, `"role": "searchbox"`, `"role": "textbox"`
  - Use for semantic HTML elements
  - Combines well with text: `{ "role": "button", "text": "Submit" }`

- **XPath**: `"xpath": "//button[contains(text(), 'Submit')]"`
  - Use when CSS cannot express the selector
  - More powerful but slower than CSS

- **TestId**: `"testId": "submit-btn"`
  - Use when developers added data-testid attributes
  - Most stable selector (doesn't change with styling)

**Examples:**

```json
// Click submit button
{
  "type": "findAndClick",
  "selector": {
    "css": "button[type='submit']",
    "text": "Submit"
  }
}

// Type into email field
{
  "type": "typeText",
  "selector": {
    "css": "input[name='email']",
    "role": "textbox"
  },
  "text": "user@example.com"
}

// Click search icon
{
  "type": "findAndClick",
  "selector": {
    "role": "button",
    "text": "Search"
  }
}
```

---

### 2. Desktop Selectors (Accessibility APIs)

Use these when automating **native desktop applications** (Slack, Outlook, VS Code, Finder, etc.).

#### macOS (AXUIElement API)

```json
{
  "selector": {
    "axRole": "AXButton",      // Element role
    "axTitle": "Send"          // Element label/title
  }
}
```

**Common AX roles:**
- `AXButton` - Buttons
- `AXTextField` - Text input fields
- `AXStaticText` - Labels, text content
- `AXMenuItem` - Menu items
- `AXWindow` - Windows
- `AXScrollArea` - Scrollable areas
- `AXTable` - Tables, lists

#### Windows (UIAutomation API)

```json
{
  "selector": {
    "uiaType": "Button",       // Control type
    "uiaName": "Send"          // Element name
  }
}
```

**Common UIA types:**
- `Button` - Buttons
- `Edit` - Text input fields
- `Text` - Labels, text content
- `MenuItem` - Menu items
- `Window` - Windows
- `List` - Lists, tables

**Examples:**

```json
// Click Send button (macOS)
{
  "type": "findAndClick",
  "selector": {
    "axRole": "AXButton",
    "axTitle": "Send"
  }
}

// Type into message field (Windows)
{
  "type": "typeText",
  "selector": {
    "uiaType": "Edit",
    "uiaName": "Message"
  },
  "text": "Hello world"
}
```

---

### 3. Vision Fallback

Use this when:
- Target is a canvas, game, or custom-rendered UI
- Accessibility APIs are not available
- Structured selectors fail
- You need to click based on visual appearance only

```json
{
  "selector": {
    "description": "blue Send button in bottom right corner"
  }
}
```

**Best practices for vision descriptions:**
- Be specific: Include color, position, text
- Add context: "near the search field", "in the sidebar"
- Include visual details: "blue button", "magnifying glass icon"

**Examples:**

```json
// Click button in Figma canvas
{
  "type": "findAndClick",
  "selector": {
    "description": "blue circular play button in center of canvas"
  }
}

// Click game element
{
  "type": "findAndClick",
  "selector": {
    "description": "red enemy character in top left corner"
  }
}
```

---

## Target Type Detection

The LLM should choose selector strategy based on the **active application**:

### Web Targets (Use Web Selectors)
- **Browsers**: Chrome, Firefox, Safari, Edge, Brave, Arc
- **Indicators**: `activeUrl` is present, app name contains "Chrome", "Safari", etc.
- **Strategy**: Use CSS/XPath/ARIA selectors

### Desktop Targets (Use Desktop Selectors)
- **Native apps**: Slack, Outlook, Finder, VS Code, Discord, Notion
- **Indicators**: No `activeUrl`, app name is not a browser
- **Strategy**: Use AX/UIA selectors

### Unknown/Canvas Targets (Use Vision Fallback)
- **Custom UIs**: Figma, games, remote desktops, video players
- **Indicators**: Cannot determine target type, or structured selectors failed
- **Strategy**: Use vision description

---

## Decision Tree for Selector Choice

```
1. Check context.activeApp and context.activeUrl

2. IF activeApp is browser (Chrome, Safari, Firefox, Edge, Brave):
   → Use WEB SELECTORS (css, text, role, xpath, testId)
   → Prefer: css + text or css + role combinations
   
3. ELSE IF activeApp is desktop app (Slack, Outlook, Finder, etc.):
   → Use DESKTOP SELECTORS (axRole/axTitle or uiaType/uiaName)
   → Check OS: darwin → use AX, win32 → use UIA
   
4. ELSE (unknown target or canvas/game):
   → Use VISION FALLBACK (description)
   → Be specific with visual details
```

---

## Combining Selectors (Recommended)

For **maximum reliability**, combine multiple selector strategies:

```json
// Web: CSS + Text
{
  "selector": {
    "css": "button.submit",
    "text": "Submit"
  }
}

// Web: Role + Text
{
  "selector": {
    "role": "button",
    "text": "Sign In"
  }
}

// Desktop (macOS): Role + Title
{
  "selector": {
    "axRole": "AXButton",
    "axTitle": "Send"
  }
}
```

The frontend will try selectors in order of specificity and use the first match.

---

## Migration from Legacy Vision-Only Mode

**Legacy format (still supported):**
```json
{
  "type": "findAndClick",
  "locator": { "strategy": "vision", "description": "blue button" }
}
```

**New format (preferred):**
```json
{
  "type": "findAndClick",
  "selector": {
    "css": "button.submit",
    "text": "Submit"
  }
}
```

The system supports **both formats** for backward compatibility. When `USE_MULTI_DRIVER=true`, prefer the new `selector` format. When `USE_MULTI_DRIVER=false`, use the legacy `locator` format.

---

## Examples by Use Case

### Use Case 1: Click Submit Button on Web Page

```json
{
  "type": "findAndClick",
  "selector": {
    "css": "button[type='submit']",
    "text": "Submit"
  },
  "reasoning": "Click submit button using CSS selector and text match"
}
```

### Use Case 2: Type into Search Field on Web

```json
{
  "type": "typeText",
  "selector": {
    "css": "input[name='search']",
    "role": "searchbox"
  },
  "text": "winter clothes",
  "submit": true,
  "reasoning": "Type search query into search field"
}
```

### Use Case 3: Click Send Button in Slack (macOS)

```json
{
  "type": "findAndClick",
  "selector": {
    "axRole": "AXButton",
    "axTitle": "Send"
  },
  "reasoning": "Click Send button in Slack using accessibility API"
}
```

### Use Case 4: Click Element in Figma (Canvas)

```json
{
  "type": "findAndClick",
  "selector": {
    "description": "blue circular play button in center of canvas"
  },
  "reasoning": "Click play button in Figma canvas using vision fallback"
}
```

---

## Error Handling

If a selector fails to find an element:

1. **Try alternative selector**: If CSS fails, try text or role
2. **Wait for element**: Use `waitForElement` before clicking
3. **Fall back to vision**: If structured selectors fail, use vision description
4. **Report failure**: End with clear error message

Example retry flow:
```json
// Attempt 1: CSS selector
{ "selector": { "css": "button.submit" } }

// Attempt 2: Text selector (if CSS failed)
{ "selector": { "text": "Submit" } }

// Attempt 3: Vision fallback (if text failed)
{ "selector": { "description": "blue Submit button in bottom right" } }
```

---

## Summary

- **Web automation** → Use CSS, text, role, xpath, testId
- **Desktop automation** → Use axRole/axTitle (macOS) or uiaType/uiaName (Windows)
- **Canvas/games** → Use vision description
- **Combine selectors** for maximum reliability
- **Fall back gracefully** from structured → vision if needed
