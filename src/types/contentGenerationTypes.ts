/**
 * Content Generation Types
 * 
 * Extends intent system to support LLM-generated content for automation tasks
 */

export type ContentSource = 'literal' | 'generated' | 'stored';

export interface ContentGenerationRequest {
  prompt: string;              // What content to generate
  context?: string;            // Additional context for generation
  format?: 'plain' | 'structured' | 'code' | 'form_data';
  maxLength?: number;          // Max length in characters
  temperature?: number;        // LLM temperature (0-1)
}

export interface GeneratedContent {
  content: string;
  format: string;
  metadata?: {
    generatedAt: number;
    provider: string;
    tokenCount?: number;
    [key: string]: any;
  };
}

/**
 * Extended type_text modes
 */
export interface TypeTextConfig {
  mode: ContentSource;
  
  // For literal mode
  text?: string;
  
  // For generated mode
  generationRequest?: ContentGenerationRequest;
  
  // For stored mode
  storageKey?: string;
  
  // Common options
  submit?: boolean;
  clearFirst?: boolean;
}

/**
 * Form fill with generated content
 */
export interface FormFieldConfig {
  fieldName: string;
  fieldDescription: string;
  contentSource: ContentSource;
  
  // For literal
  value?: string;
  
  // For generated
  generationPrompt?: string;
  
  // For stored
  storageKey?: string;
}

export interface FormFillConfig {
  fields: FormFieldConfig[];
  submitAfter?: boolean;
  validateBefore?: boolean;
}
