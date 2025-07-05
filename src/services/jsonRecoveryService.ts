import { logger } from '../utils/logger';
import { getBestLLMResponse } from '../utils/llmRouter';

export interface JsonRecoveryResult {
  success: boolean;
  parsedData?: any;
  originalError?: string;
  recoveryMethod: 'direct' | 'basic_cleanup' | 'advanced_cleanup' | 'llm_fixed' | 'llm_extracted' | 'failed';
  confidence: number;
}

export class JsonRecoveryService {
  private static instance: JsonRecoveryService;

  public static getInstance(): JsonRecoveryService {
    if (!JsonRecoveryService.instance) {
      JsonRecoveryService.instance = new JsonRecoveryService();
    }
    return JsonRecoveryService.instance;
  }

  /**
   * Intelligent JSON recovery using multiple strategies including LLM assistance
   */
  async recoverJson(malformedJson: string, expectedSchema?: string): Promise<JsonRecoveryResult> {
    logger.info('Starting intelligent JSON recovery', {
      inputLength: malformedJson.length,
      hasSchema: !!expectedSchema
    });

    // Strategy 1: Direct parsing (fastest)
    try {
      const parsed = JSON.parse(malformedJson);
      return {
        success: true,
        parsedData: parsed,
        recoveryMethod: 'direct',
        confidence: 1.0
      };
    } catch (directError) {
      logger.debug('Direct JSON parsing failed', { error: (directError as Error).message });
    }

    // Strategy 2: Basic cleanup and retry
    const basicCleanup = this.performBasicCleanup(malformedJson);
    try {
      const parsed = JSON.parse(basicCleanup);
      return {
        success: true,
        parsedData: parsed,
        recoveryMethod: 'basic_cleanup',
        confidence: 0.9
      };
    } catch (cleanupError) {
      logger.debug('Basic cleanup parsing failed', { error: (cleanupError as Error).message });
    }

    // Strategy 2.5: Advanced cleanup and retry
    const advancedCleanup = this.performAdvancedCleanup(malformedJson);
    try {
      const parsed = JSON.parse(advancedCleanup);
      return {
        success: true,
        parsedData: parsed,
        recoveryMethod: 'advanced_cleanup',
        confidence: 0.85
      };
    } catch (advancedError) {
      logger.debug('Advanced cleanup parsing failed', { error: (advancedError as Error).message });
    }

    // Strategy 3: LLM-powered JSON fixing
    try {
      const llmFixed = await this.llmFixJson(malformedJson, expectedSchema);
      if (llmFixed.success) {
        return llmFixed;
      }
    } catch (llmError) {
      logger.warn('LLM JSON fixing failed', { error: (llmError as Error).message });
    }

    // Strategy 4: LLM-powered data extraction
    try {
      const llmExtracted = await this.llmExtractData(malformedJson, expectedSchema);
      if (llmExtracted.success) {
        return llmExtracted;
      }
    } catch (extractError) {
      logger.warn('LLM data extraction failed', { error: (extractError as Error).message });
    }

    // All strategies failed
    return {
      success: false,
      recoveryMethod: 'failed',
      confidence: 0,
      originalError: 'All recovery strategies failed'
    };
  }

  /**
   * Use LLM to fix malformed JSON
   */
  private async llmFixJson(malformedJson: string, expectedSchema?: string): Promise<JsonRecoveryResult> {
    const prompt = `Fix this malformed JSON and return only the corrected JSON:

MALFORMED JSON:
${malformedJson}

${expectedSchema ? `EXPECTED SCHEMA:
${expectedSchema}` : ''}

INSTRUCTIONS:
1. Fix syntax errors (missing quotes, brackets, commas)
2. Complete truncated strings and objects
3. Ensure proper JSON structure
4. Return ONLY the fixed JSON, no explanations
5. If the JSON contains agent code, preserve it exactly but ensure it's properly escaped

FIXED JSON:`;

    try {
      const response = await getBestLLMResponse(prompt);

      // Extract JSON from LLM response
      const cleanResponse = this.extractJsonFromLLMResponse(response);
      const parsed = JSON.parse(cleanResponse);

      return {
        success: true,
        parsedData: parsed,
        recoveryMethod: 'llm_fixed',
        confidence: 0.8
      };
    } catch (error) {
      logger.error('LLM JSON fixing failed', { error: (error as Error).message });
      return {
        success: false,
        recoveryMethod: 'llm_fixed',
        confidence: 0,
        originalError: (error as Error).message
      };
    }
  }

  /**
   * Use LLM to extract structured data from malformed response
   */
  private async llmExtractData(malformedResponse: string, expectedSchema?: string): Promise<JsonRecoveryResult> {
    const prompt = `Extract structured data from this malformed response and return as valid JSON:

MALFORMED RESPONSE:
${malformedResponse}

${expectedSchema ? `EXPECTED STRUCTURE:
${expectedSchema}` : `EXPECTED STRUCTURE (for agent generation):
{
  "name": "string",
  "description": "string", 
  "code": "string (complete TypeScript code)",
  "dependencies": ["array", "of", "strings"],
  "execution_target": "frontend|backend",
  "requires_database": boolean,
  "version": "string",
  "config": {},
  "secrets": {},
  "orchestrator_metadata": {}
}`}

INSTRUCTIONS:
1. Extract all available information from the malformed response
2. Generate reasonable defaults for missing required fields
3. If code is truncated or missing, create a functional placeholder
4. Return ONLY valid JSON, no explanations
5. Ensure all strings are properly escaped

EXTRACTED JSON:`;

    try {
      const response = await getBestLLMResponse(prompt);

      const cleanResponse = this.extractJsonFromLLMResponse(response);
      const parsed = JSON.parse(cleanResponse);

      return {
        success: true,
        parsedData: parsed,
        recoveryMethod: 'llm_extracted',
        confidence: 0.7
      };
    } catch (error) {
      logger.error('LLM data extraction failed', { error: (error as Error).message });
      return {
        success: false,
        recoveryMethod: 'llm_extracted',
        confidence: 0,
        originalError: (error as Error).message
      };
    }
  }

  /**
   * Perform basic JSON cleanup operations
   */
  private performBasicCleanup(json: string): string {
    let cleaned = json.trim();
    
    // Remove markdown code blocks
    cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
    cleaned = cleaned.replace(/```\s*/g, '');
    
    // Remove text before first { and after last }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    
    // Fix common issues
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1'); // Remove trailing commas
    cleaned = cleaned.replace(/([^\\])\\n/g, '$1\\\\n'); // Fix newline escaping
    cleaned = cleaned.replace(/([^\\])\\t/g, '$1\\\\t'); // Fix tab escaping
    
    return cleaned;
  }

  /**
   * Perform advanced JSON cleanup for malformed LLM output
   */
  private performAdvancedCleanup(json: string): string {
    let cleaned = this.performBasicCleanup(json);
    
    try {
      // Strategy 1: Fix missing commas between properties
      cleaned = this.fixMissingCommas(cleaned);
      
      // Strategy 2: Fix unclosed strings and quotes
      cleaned = this.fixUnbalancedQuotes(cleaned);
      
      // Strategy 3: Fix truncated JSON by completing structure
      cleaned = this.fixTruncatedJson(cleaned);
      
      // Strategy 4: Fix malformed property values
      cleaned = this.fixMalformedValues(cleaned);
      
      return cleaned;
    } catch (error) {
      logger.debug('Advanced cleanup failed', { error: (error as Error).message });
      return json; // Return original if cleanup fails
    }
  }

  /**
   * Fix missing commas between JSON properties
   */
  private fixMissingCommas(json: string): string {
    // Pattern: "value"\s*"key" -> "value","key"
    // Pattern: }\s*"key" -> },"key"
    // Pattern: ]\s*"key" -> ],"key"
    let fixed = json
      .replace(/(["'}\]])\s*(["']\w)/g, '$1,$2') // Add comma between value and next property
      .replace(/(\d)\s*(["']\w)/g, '$1,$2') // Add comma between number and next property
      .replace(/(true|false|null)\s*(["']\w)/g, '$1,$2'); // Add comma between boolean/null and next property
    
    return fixed;
  }

  /**
   * Fix unbalanced quotes and unclosed strings
   */
  private fixUnbalancedQuotes(json: string): string {
    const lines = json.split('\n');
    const fixedLines: string[] = [];
    
    for (let line of lines) {
      // Count quotes in line
      const quotes = (line.match(/"/g) || []).length;
      
      // If odd number of quotes, likely unclosed string
      if (quotes % 2 === 1) {
        // Try to close the string at the end of the line
        if (line.trim().endsWith(',') || line.trim().endsWith('}') || line.trim().endsWith(']')) {
          // Insert quote before the ending character
          line = line.replace(/(.*)(,|\}|\])\s*$/, '$1"$2');
        } else {
          // Add quote at the end
          line += '"';
        }
      }
      
      fixedLines.push(line);
    }
    
    return fixedLines.join('\n');
  }

  /**
   * Fix truncated JSON by completing the structure
   */
  private fixTruncatedJson(json: string): string {
    let fixed = json.trim();
    
    // Count opening and closing braces/brackets
    const openBraces = (fixed.match(/\{/g) || []).length;
    const closeBraces = (fixed.match(/\}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/\]/g) || []).length;
    
    // Add missing closing braces
    for (let i = 0; i < openBraces - closeBraces; i++) {
      fixed += '}';
    }
    
    // Add missing closing brackets
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      fixed += ']';
    }
    
    // If the JSON ends with an incomplete string, try to close it
    if (fixed.match(/"[^"]*$/)) {
      fixed += '"';
    }
    
    return fixed;
  }

  /**
   * Fix malformed property values
   */
  private fixMalformedValues(json: string): string {
    let fixed = json;
    
    // Fix unquoted string values (except true, false, null, numbers)
    fixed = fixed.replace(/:\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\s+[a-zA-Z0-9_]+)*?)(?=\s*[,}])/g, (match, value) => {
      if (!['true', 'false', 'null'].includes(value.trim()) && isNaN(Number(value.trim()))) {
        return `: "${value.trim()}"`;
      }
      return match;
    });
    
    // Fix malformed arrays
    fixed = fixed.replace(/\[\s*([^\[\]"]*?)\s*\]/g, (match, content) => {
      if (content.trim() && !content.includes('"') && !content.includes(',')) {
        // Single unquoted value in array
        return `["${content.trim()}"]`;
      }
      return match;
    });
    
    return fixed;
  }

  /**
   * Extract JSON from LLM response that might contain explanations
   */
  private extractJsonFromLLMResponse(response: string): string {
    // Try multiple extraction strategies
    let cleaned = response.trim();
    
    // Remove markdown
    cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
    cleaned = cleaned.replace(/```\s*/g, '');
    
    // Find JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    
    // Fallback: extract between first { and last }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return cleaned.substring(firstBrace, lastBrace + 1);
    }
    
    return cleaned;
  }

  /**
   * Validate recovered JSON against expected schema
   */
  validateAgentSchema(data: any): boolean {
    const requiredFields = ['name', 'description', 'code'];
    return requiredFields.every(field => data[field] && typeof data[field] === 'string');
  }
}

export const jsonRecoveryService = JsonRecoveryService.getInstance();
