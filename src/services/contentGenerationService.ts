/**
 * Content Generation Service
 * 
 * Generates content using LLM for automation tasks
 * Supports different content types: resumes, emails, forms, documents, etc.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { ContentGenerationRequest, GeneratedContent } from '../types/contentGenerationTypes';

export class ContentGenerationService {
  private openai: OpenAI;
  private anthropic: Anthropic;
  private gemini: GoogleGenerativeAI;

  constructor() {
    // Initialize LLM clients
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    });

    this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }

  /**
   * Generate content based on request
   * Uses LLM to create appropriate content for the context
   */
  async generateContent(request: ContentGenerationRequest): Promise<GeneratedContent> {
    const startTime = Date.now();
    
    logger.info('🎨 [CONTENT_GEN] Generating content', {
      prompt: request.prompt.substring(0, 100),
      format: request.format,
      maxLength: request.maxLength,
    });

    try {
      // Build generation prompt
      const systemPrompt = this.buildSystemPrompt(request);
      const userPrompt = this.buildUserPrompt(request);

      // Try providers in order: Gemini → Claude → OpenAI
      let content: string;
      let provider: string;

      try {
        content = await this.generateWithGemini(systemPrompt, userPrompt, request);
        provider = 'gemini';
      } catch (geminiError: any) {
        logger.warn('⚠️ [CONTENT_GEN] Gemini failed, trying Claude', {
          error: geminiError.message,
        });

        try {
          content = await this.generateWithClaude(systemPrompt, userPrompt, request);
          provider = 'claude';
        } catch (claudeError: any) {
          logger.warn('⚠️ [CONTENT_GEN] Claude failed, trying OpenAI', {
            error: claudeError.message,
          });

          content = await this.generateWithOpenAI(systemPrompt, userPrompt, request);
          provider = 'openai';
        }
      }

      const latency = Date.now() - startTime;

      logger.info('✅ [CONTENT_GEN] Content generated successfully', {
        provider,
        latency,
        contentLength: content.length,
      });

      return {
        content,
        format: request.format || 'plain',
        metadata: {
          generatedAt: Date.now(),
          provider,
          tokenCount: this.estimateTokens(content),
          latencyMs: latency,
        },
      };
    } catch (error: any) {
      logger.error('❌ [CONTENT_GEN] All providers failed', {
        error: error.message,
        prompt: request.prompt.substring(0, 100),
      });

      throw new Error(`Content generation failed: ${error.message}`);
    }
  }

  /**
   * Build system prompt for content generation
   */
  private buildSystemPrompt(request: ContentGenerationRequest): string {
    const format = request.format || 'plain';

    let systemPrompt = `You are a professional content generator. Your task is to generate high-quality, appropriate content based on the user's request.

CRITICAL RULES:
1. Generate ONLY the content itself - no explanations, no meta-commentary
2. Be specific and detailed - avoid generic placeholder text
3. Match the requested format and tone exactly
4. Use proper formatting (line breaks, punctuation, structure)
5. Keep content concise but complete
`;

    // Add format-specific instructions
    switch (format) {
      case 'plain':
        systemPrompt += `\nFormat: Plain text with natural line breaks (\\n)`;
        break;
      
      case 'structured':
        systemPrompt += `\nFormat: Structured document with clear sections and headings`;
        break;
      
      case 'code':
        systemPrompt += `\nFormat: Clean, well-commented code without markdown code blocks`;
        break;
      
      case 'form_data':
        systemPrompt += `\nFormat: Concise, form-appropriate data (no full sentences unless needed)`;
        break;
    }

    // Add length constraints
    if (request.maxLength) {
      systemPrompt += `\n\nLength: Maximum ${request.maxLength} characters. Be concise but complete.`;
    }

    return systemPrompt;
  }

  /**
   * Build user prompt with context
   */
  private buildUserPrompt(request: ContentGenerationRequest): string {
    let prompt = request.prompt;

    // Add context if provided
    if (request.context) {
      prompt = `Context: ${request.context}\n\nTask: ${prompt}`;
    }

    return prompt;
  }

  /**
   * Generate content using Gemini
   */
  private async generateWithGemini(
    systemPrompt: string,
    userPrompt: string,
    request: ContentGenerationRequest
  ): Promise<string> {
    const model = this.gemini.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: request.temperature || 0.7,
        maxOutputTokens: request.maxLength ? Math.ceil(request.maxLength / 4) : 2048,
      },
    });

    const response = result.response;
    const content = response.text();

    if (!content || content.trim().length === 0) {
      throw new Error('Gemini returned empty content');
    }

    return content.trim();
  }

  /**
   * Generate content using Claude
   */
  private async generateWithClaude(
    systemPrompt: string,
    userPrompt: string,
    request: ContentGenerationRequest
  ): Promise<string> {
    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: request.maxLength ? Math.ceil(request.maxLength / 4) : 2048,
      temperature: request.temperature || 0.7,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Claude returned non-text content');
    }

    if (!content.text || content.text.trim().length === 0) {
      throw new Error('Claude returned empty content');
    }

    return content.text.trim();
  }

  /**
   * Generate content using OpenAI
   */
  private async generateWithOpenAI(
    systemPrompt: string,
    userPrompt: string,
    request: ContentGenerationRequest
  ): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: request.temperature || 0.7,
      max_tokens: request.maxLength ? Math.ceil(request.maxLength / 4) : 2048,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;

    if (!content || content.trim().length === 0) {
      throw new Error('OpenAI returned empty content');
    }

    return content.trim();
  }

  /**
   * Generate resume content
   */
  async generateResume(context?: string): Promise<string> {
    const prompt = `Generate a professional resume with the following sections:
- Professional Summary (2-3 sentences)
- Work Experience (2-3 positions with bullet points)
- Education (degree and institution)
- Skills (relevant technical and soft skills)

${context ? `Additional context: ${context}` : 'Use realistic example data for a software engineer.'}

Format with clear section headings and proper spacing.`;

    const result = await this.generateContent({
      prompt,
      format: 'structured',
      maxLength: 1500,
    });

    return result.content;
  }

  /**
   * Generate email content
   */
  async generateEmail(purpose: string, context?: string): Promise<string> {
    const prompt = `Generate a professional email for the following purpose: ${purpose}

${context ? `Context: ${context}` : ''}

Include:
- Appropriate greeting
- Clear, concise body (2-3 paragraphs)
- Professional closing

Use a professional but friendly tone.`;

    const result = await this.generateContent({
      prompt,
      format: 'plain',
      maxLength: 800,
    });

    return result.content;
  }

  /**
   * Generate form field data
   */
  async generateFormData(fieldType: string, fieldName: string, context?: string): Promise<string> {
    const prompt = `Generate appropriate data for a form field.

Field Type: ${fieldType}
Field Name: ${fieldName}
${context ? `Context: ${context}` : ''}

Generate realistic, appropriate data for this field. Return ONLY the data value, nothing else.`;

    const result = await this.generateContent({
      prompt,
      format: 'form_data',
      maxLength: 200,
    });

    return result.content;
  }

  /**
   * Generate document content
   */
  async generateDocument(topic: string, context?: string, length: 'short' | 'medium' | 'long' = 'medium'): Promise<string> {
    const lengthMap = {
      short: { chars: 500, desc: '1-2 paragraphs' },
      medium: { chars: 1500, desc: '3-5 paragraphs' },
      long: { chars: 3000, desc: '6-10 paragraphs' },
    };

    const lengthConfig = lengthMap[length];

    const prompt = `Write a well-structured document about: ${topic}

${context ? `Context: ${context}` : ''}

Length: ${lengthConfig.desc}

Include:
- Clear introduction
- Well-organized body with logical flow
- Conclusion or summary

Use professional language and proper formatting.`;

    const result = await this.generateContent({
      prompt,
      format: 'structured',
      maxLength: lengthConfig.chars,
    });

    return result.content;
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}

export const contentGenerationService = new ContentGenerationService();
