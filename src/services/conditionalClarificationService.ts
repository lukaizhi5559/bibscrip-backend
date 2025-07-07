import { LLMRouter } from '../utils/llmRouter';

// Types and Interfaces
export interface ClarificationOptions {
  mode: 'lightweight' | 'full-blown';
  clientType: 'frontend' | 'microservice' | 'api-direct';
  skipFrontendClarification?: boolean;
  forceValidation?: boolean;
}

export interface OrchestrationRequest {
  description: string;
  requirements?: string[];
  availableServices?: string[];
  context?: Record<string, any>;
}

export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  enhancedPromptConstraints: string[];
  processingTime: 'fast' | 'medium' | 'slow';
  confidence?: number;
}

export interface ClarificationAnalysis {
  needsClarification: boolean;
  isVague: boolean;
  missingCriticalInfo: boolean;
  issues: string[];
  suggestedEnhancements: string[];
  requestType: string;
  complexity: 'low' | 'medium' | 'high';
  infrastructureNeeded: string[];
  riskLevel: 'low' | 'medium' | 'high';
  confidence: number;
}

export interface ClarificationQuestion {
  question: string;
  type: 'choice' | 'text' | 'multiple_choice';
  critical: boolean;
  options?: string[];
  context?: Record<string, any>;
}

export interface ClarificationResult {
  needsClarification?: boolean;
  questions?: ClarificationQuestion[];
  analysis?: ClarificationAnalysis;
  clarificationId?: string;
  enhancedRequest?: OrchestrationRequest;
  confidence?: number;
  isValid?: boolean;
  issues?: string[];
  enhancedPromptConstraints?: string[];
  processingTime?: 'fast' | 'medium' | 'slow';
}

/**
 * Conditional Clarification Service
 * 
 * Provides intelligent request processing with two modes:
 * - Lightweight: Fast validation for frontend clients (already clarified)
 * - Full-blown: Complete clarification system for API-only clients
 */
export class ConditionalClarificationService {
  private llmRouter: LLMRouter;

  constructor() {
    this.llmRouter = new LLMRouter();
  }

  /**
   * Main entry point - processes request based on clarification options
   */
  async processRequest(
    request: OrchestrationRequest, 
    options: ClarificationOptions
  ): Promise<ClarificationResult> {
    console.log(`🎯 Processing request with mode: ${options.mode}, client: ${options.clientType}`);
    
    if (options.mode === 'lightweight') {
      return await this.lightweightValidation(request);
    } else {
      return await this.fullBlownClarification(request, options);
    }
  }

  /**
   * Lightweight Validation Mode
   * Fast validation for frontend clients (already clarified)
   */
  private async lightweightValidation(request: OrchestrationRequest): Promise<ValidationResult> {
    const startTime = performance.now();
    console.log(`⚡ Running lightweight validation for: ${request.description}`);
    
    // Detect critical issues that would cause bad agent generation
    const issues = this.detectCriticalIssues(request);
    
    // Generate enhanced prompt constraints to prevent hallucination
    const constraints = this.generatePromptConstraints(request);
    
    const processingTime = performance.now() - startTime;
    console.log(`✅ Lightweight validation completed in ${Math.round(processingTime)}ms`);
    
    return {
      isValid: issues.length === 0,
      issues,
      enhancedPromptConstraints: constraints,
      processingTime: processingTime < 1000 ? 'fast' : 'medium',
      confidence: issues.length === 0 ? 0.9 : Math.max(0.3, 0.9 - (issues.length * 0.2))
    };
  }

  /**
   * Full-Blown Clarification Mode
   * Complete clarification system for microservices/API clients
   */
  private async fullBlownClarification(
    request: OrchestrationRequest, 
    options: ClarificationOptions
  ): Promise<ClarificationResult> {
    const startTime = performance.now();
    console.log(`🔄 Running full-blown clarification for: ${request.description}`);
    
    // Step 1: Analyze request clarity (similar to frontend logic)
    const analysis = await this.analyzeRequestClarity(request);
    
    if (analysis.needsClarification) {
      // Step 2: Generate clarifying questions using LLM
      const questions = await this.generateClarifyingQuestions(request, analysis);
      
      const processingTime = performance.now() - startTime;
      console.log(`❓ Clarification needed - generated ${questions.length} questions in ${Math.round(processingTime)}ms`);
      
      return {
        needsClarification: true,
        questions,
        analysis,
        clarificationId: this.generateClarificationId(),
        processingTime: processingTime < 5000 ? 'medium' : 'slow'
      };
    }
    
    // Step 3: Enhance request with context
    const enhancedRequest = await this.enhanceRequestWithContext(request);
    const constraints = this.generatePromptConstraints(enhancedRequest);
    
    const processingTime = performance.now() - startTime;
    console.log(`✅ Full clarification completed in ${Math.round(processingTime)}ms`);
    
    return {
      needsClarification: false,
      enhancedRequest,
      enhancedPromptConstraints: constraints,
      confidence: analysis.confidence,
      processingTime: processingTime < 5000 ? 'medium' : 'slow'
    };
  }

  /**
   * Detect critical issues that would cause bad agent generation
   */
  private detectCriticalIssues(request: OrchestrationRequest): string[] {
    const issues: string[] = [];
    const description = request.description?.toLowerCase() || '';
    const requirements = request.requirements || [];
    
    // Check for vague infrastructure requests
    if (description.includes('text') && !description.includes('twilio') && !description.includes('sms service')) {
      issues.push('SMS service not specified - may cause hallucinated dependencies');
    }
    
    if (description.includes('email') && !description.includes('@') && !description.includes('gmail') && !description.includes('outlook')) {
      issues.push('Email service not specified - may cause hallucinated dependencies');
    }
    
    // Check for missing authentication details for sensitive operations
    if ((description.includes('lock') || description.includes('unlock')) && !description.includes('auth')) {
      issues.push('Authentication method not specified for security-sensitive operation');
    }
    
    // Check for overly complex requirements that might confuse LLM
    if (requirements.length > 8) {
      issues.push('Too many requirements - may cause LLM confusion and hallucinated dependencies');
    }
    
    // Check for machine learning references without specific libraries
    if (description.includes('ml') || description.includes('machine learning')) {
      if (!description.includes('tensorflow') && !description.includes('pytorch')) {
        issues.push('ML functionality requested without specific library - may cause hallucinated imports');
      }
    }
    
    return issues;
  }

  /**
   * Generate enhanced prompt constraints to prevent hallucination
   */
  private generatePromptConstraints(request: OrchestrationRequest): string[] {
    const baseConstraints = [
      "Use only standard npm packages and Node.js built-in modules",
      "Do not import from relative paths unless explicitly provided",
      "List all required dependencies in the dependencies array",
      "Include proper error handling with try/catch blocks",
      "Do not assume external services exist without explicit configuration",
      "Validate all parameters before use",
      "Return structured results with success/error status"
    ];
    
    // Add context-specific constraints
    const contextConstraints = [
      `Request context: ${request.description}`,
      `Available services: ${request.availableServices?.join(', ') || 'none specified'}`
    ];
    
    // Add requirement-specific constraints
    const requirements = request.requirements || [];
    if (requirements.some(req => req.toLowerCase().includes('email'))) {
      contextConstraints.push("For email functionality, use nodemailer or similar standard package");
    }
    
    if (requirements.some(req => req.toLowerCase().includes('sms') || req.toLowerCase().includes('text'))) {
      contextConstraints.push("For SMS functionality, use twilio or similar standard package");
    }
    
    if (requirements.some(req => req.toLowerCase().includes('database'))) {
      contextConstraints.push("For database functionality, use standard packages like pg, mysql2, or sqlite3");
    }
    
    return [...baseConstraints, ...contextConstraints];
  }

  /**
   * Analyze request clarity (similar to frontend logic)
   */
  private async analyzeRequestClarity(request: OrchestrationRequest): Promise<ClarificationAnalysis> {
    const analysis: ClarificationAnalysis = {
      needsClarification: false,
      isVague: false,
      missingCriticalInfo: false,
      issues: [],
      suggestedEnhancements: [],
      requestType: 'unknown',
      complexity: 'low',
      infrastructureNeeded: [],
      riskLevel: 'low',
      confidence: 1.0
    };
    
    const lowerInput = request.description?.toLowerCase() || '';
    
    // Detect request type and complexity
    if (lowerInput.includes('text') || lowerInput.includes('sms') || lowerInput.includes('phone')) {
      analysis.requestType = 'sms_integration';
      analysis.complexity = 'high';
      analysis.infrastructureNeeded.push('SMS service', 'phone number', 'webhook infrastructure');
    }
    
    if (lowerInput.includes('email')) {
      analysis.requestType = 'email_integration';
      analysis.complexity = 'medium';
      analysis.infrastructureNeeded.push('email service', 'email address', 'email processing');
    }
    
    if (lowerInput.includes('iot') || lowerInput.includes('smart home') || lowerInput.includes('nest') || lowerInput.includes('lock')) {
      analysis.requestType = 'iot_control';
      analysis.complexity = 'high';
      analysis.riskLevel = 'high';
      analysis.infrastructureNeeded.push('device API', 'authentication', 'security protocols');
    }
    
    // Check for vagueness and missing information
    const criticalIssues = this.detectCriticalIssues(request);
    if (criticalIssues.length > 0) {
      analysis.needsClarification = true;
      analysis.missingCriticalInfo = true;
      analysis.issues = criticalIssues;
      analysis.confidence = Math.max(0.3, 1.0 - (criticalIssues.length * 0.2));
    }
    
    return analysis;
  }

  /**
   * Generate clarifying questions using LLM
   */
  private async generateClarifyingQuestions(
    request: OrchestrationRequest, 
    analysis: ClarificationAnalysis
  ): Promise<ClarificationQuestion[]> {
    console.log(`🤖 Generating clarifying questions using LLM`);
    
    try {
      const prompt = this.buildClarificationPrompt(request, analysis);
      const systemPrompt = this.getClarificationSystemPrompt();
      
      const llmResponse = await this.llmRouter.processPrompt(prompt, {
        taskType: 'clarification'
      });
      
      const questions = await this.parseLLMClarificationResponse(llmResponse.text, analysis);
      console.log(`✅ Generated ${questions.length} clarifying questions`);
      
      return questions;
      
    } catch (error) {
      console.error(`❌ LLM clarification generation failed:`, error);
      return this.generateFallbackQuestions(request, analysis);
    }
  }

  /**
   * Build context-aware prompt for LLM clarification generation
   */
  private buildClarificationPrompt(request: OrchestrationRequest, analysis: ClarificationAnalysis): string {
    return `
User Request: "${request.description}"

Analysis Results:
- Request Type: ${analysis.requestType}
- Complexity: ${analysis.complexity}
- Risk Level: ${analysis.riskLevel}
- Issues Found: ${analysis.issues.join(', ')}
- Infrastructure Needed: ${analysis.infrastructureNeeded.join(', ')}
- Confidence: ${analysis.confidence}

Generate 3-5 clarifying questions to help understand exactly what the user wants to accomplish. The questions should:

1. Be conversational and human-like, not robotic
2. Address the specific issues and missing information identified
3. Help gather technical details needed for implementation
4. Consider security and practical concerns
5. Be appropriate for the complexity and risk level

Format as JSON array with this structure:
[
  {
    "question": "Natural question text",
    "type": "choice|text|multiple_choice",
    "critical": true|false,
    "options": ["option1", "option2"] // if applicable
  }
]
`;
  }

  /**
   * System prompt for clarification question generation
   */
  private getClarificationSystemPrompt(): string {
    return `You are an expert technical assistant helping users clarify their automation and integration requests. Your goal is to ask the right questions to transform vague requests into detailed, implementable specifications.

Key principles:
- Be conversational and helpful, not interrogative
- Focus on practical implementation details
- Consider security implications for sensitive operations
- Adapt your language to the user's technical level
- Ask about specific services, tools, and infrastructure
- Prioritize critical information needed for success

Always respond with valid JSON containing an array of question objects.`;
  }

  /**
   * Parse LLM response into structured questions
   */
  private async parseLLMClarificationResponse(
    llmResponse: string, 
    analysis: ClarificationAnalysis
  ): Promise<ClarificationQuestion[]> {
    try {
      // Extract JSON from LLM response (handle markdown code blocks)
      const jsonMatch = llmResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, llmResponse];
      const jsonString = jsonMatch[1] || llmResponse;
      
      const questions = JSON.parse(jsonString.trim());
      
      // Validate and enhance questions
      return questions.map((q: any) => ({
        question: q.question || 'Please provide more details',
        type: q.type || 'text',
        critical: q.critical !== undefined ? q.critical : true,
        options: q.options || [],
        context: {
          requestType: analysis.requestType,
          riskLevel: analysis.riskLevel
        }
      }));
      
    } catch (error) {
      console.error(`❌ Failed to parse LLM clarification response:`, error);
      throw new Error('LLM response parsing failed');
    }
  }

  /**
   * Generate fallback questions when LLM fails
   */
  private generateFallbackQuestions(
    request: OrchestrationRequest, 
    analysis: ClarificationAnalysis
  ): ClarificationQuestion[] {
    const fallbackQuestions: ClarificationQuestion[] = [];
    
    // Add questions based on request type
    if (analysis.requestType === 'sms_integration') {
      fallbackQuestions.push({
        question: "Which SMS service would you like to use?",
        type: "choice",
        critical: true,
        options: ["Twilio", "AWS SNS", "Other"]
      });
    }
    
    if (analysis.requestType === 'email_integration') {
      fallbackQuestions.push({
        question: "Which email service should be used?",
        type: "choice", 
        critical: true,
        options: ["Gmail", "Outlook", "Custom SMTP", "Other"]
      });
    }
    
    if (analysis.riskLevel === 'high') {
      fallbackQuestions.push({
        question: "What security measures should be implemented?",
        type: "multiple_choice",
        critical: true,
        options: ["Two-factor authentication", "User verification", "Access controls", "Audit logging"]
      });
    }
    
    // Generic fallback question
    if (fallbackQuestions.length === 0) {
      fallbackQuestions.push({
        question: "Can you provide more specific details about your requirements?",
        type: "text",
        critical: true
      });
    }
    
    return fallbackQuestions;
  }

  /**
   * Enhance request with additional context
   */
  private async enhanceRequestWithContext(request: OrchestrationRequest): Promise<OrchestrationRequest> {
    // For now, return the original request
    // This can be enhanced later with context enrichment logic
    return {
      ...request,
      context: {
        ...request.context,
        enhanced: true,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Generate unique clarification ID
   */
  private generateClarificationId(): string {
    return `clarify_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
