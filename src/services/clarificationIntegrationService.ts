import { ConditionalClarificationService, ClarificationOptions, OrchestrationRequest, ClarificationResult } from './conditionalClarificationService';
import { OrchestrationService } from './orchestrationService';

/**
 * Integration service that bridges conditional clarification with existing orchestration
 */
export class ClarificationIntegrationService {
  private clarificationService: ConditionalClarificationService;
  private orchestrationService: OrchestrationService;

  constructor() {
    this.clarificationService = new ConditionalClarificationService();
    this.orchestrationService = new OrchestrationService();
  }

  /**
   * Enhanced orchestration with conditional clarification
   */
  async orchestrateWithClarification(
    request: OrchestrationRequest,
    options: ClarificationOptions
  ): Promise<{
    success: boolean;
    needsClarification?: boolean;
    clarificationResult?: ClarificationResult;
    orchestrationResult?: any;
    error?: string;
    processingTime: number;
  }> {
    const startTime = performance.now();
    
    try {
      console.log(`🎯 Starting orchestration with clarification (${options.mode} mode)`);
      
      // Step 1: Process request through conditional clarification
      const clarificationResult = await this.clarificationService.processRequest(request, options);
      
      // Step 2: Handle clarification results
      if (clarificationResult.needsClarification) {
        console.log(`❓ Clarification needed - returning questions to client`);
        return {
          success: true,
          needsClarification: true,
          clarificationResult,
          processingTime: performance.now() - startTime
        };
      }
      
      // Step 3: Validate request (for lightweight mode)
      if ('isValid' in clarificationResult && !clarificationResult.isValid) {
        console.log(`❌ Request validation failed: ${clarificationResult.issues?.join(', ')}`);
        return {
          success: false,
          error: `Request validation failed: ${clarificationResult.issues?.join(', ')}`,
          clarificationResult,
          processingTime: performance.now() - startTime
        };
      }
      
      // Step 4: Use enhanced request or original request
      const finalRequest = clarificationResult.enhancedRequest || request;
      
      // Step 5: Add enhanced prompt constraints to orchestration
      const enhancedConstraints = clarificationResult.enhancedPromptConstraints || [];
      
      // Step 6: Proceed with orchestration
      console.log(`🚀 Proceeding with orchestration using ${enhancedConstraints.length} enhanced constraints`);
      
      // Create orchestration query from the request
      const requirements = finalRequest.requirements?.join(', ') || 'none specified';
      const services = finalRequest.availableServices?.join(', ') || 'none specified';
      const orchestrationQuery = `${finalRequest.description}. Requirements: ${requirements}. Available services: ${services}.`;
      
      const orchestrationResult = await this.orchestrationService.orchestrateRequest(orchestrationQuery);
      
      const processingTime = performance.now() - startTime;
      console.log(`✅ Orchestration completed in ${Math.round(processingTime)}ms`);
      
      return {
        success: true,
        needsClarification: false,
        clarificationResult,
        orchestrationResult,
        processingTime
      };
      
    } catch (error) {
      console.error(`❌ Orchestration with clarification failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        processingTime: performance.now() - startTime
      };
    }
  }

  /**
   * Enhanced agent generation with conditional clarification
   */
  async generateAgentWithClarification(
    request: OrchestrationRequest & { 
      agentName: string;
      agentType?: string;
    },
    options: ClarificationOptions
  ): Promise<{
    success: boolean;
    needsClarification?: boolean;
    clarificationResult?: ClarificationResult;
    agent?: any;
    error?: string;
    processingTime: number;
  }> {
    const startTime = performance.now();
    
    try {
      console.log(`🤖 Starting agent generation with clarification for: ${request.agentName}`);
      
      // Step 1: Process request through conditional clarification
      const clarificationResult = await this.clarificationService.processRequest(request, options);
      
      // Step 2: Handle clarification results
      if (clarificationResult.needsClarification) {
        console.log(`❓ Clarification needed for agent generation`);
        return {
          success: true,
          needsClarification: true,
          clarificationResult,
          processingTime: performance.now() - startTime
        };
      }
      
      // Step 3: Validate request (for lightweight mode)
      if ('isValid' in clarificationResult && !clarificationResult.isValid) {
        console.log(`❌ Agent generation request validation failed`);
        return {
          success: false,
          error: `Agent generation validation failed: ${clarificationResult.issues?.join(', ')}`,
          clarificationResult,
          processingTime: performance.now() - startTime
        };
      }
      
      // Step 4: Use enhanced request or original request
      const finalRequest = clarificationResult.enhancedRequest || request;
      
      // Step 5: Add enhanced prompt constraints to agent generation
      const enhancedConstraints = clarificationResult.enhancedPromptConstraints || [];
      
      // Step 6: Generate agent with enhanced constraints
      console.log(`🚀 Generating agent with ${enhancedConstraints.length} enhanced constraints`);
      
      // Create enhanced description that includes constraints
      let enhancedDescription = finalRequest.description;
      if (enhancedConstraints.length > 0) {
        enhancedDescription += `\n\nAdditional constraints: ${enhancedConstraints.join('; ')}`;
      }
      
      const agent = await this.orchestrationService.generateAgent(
        enhancedDescription,
        request.agentName,
        {
          requirements: finalRequest.requirements || [],
          type: request.agentType || 'automation',
          enhancedPromptConstraints: enhancedConstraints
        }
      );
      
      const processingTime = performance.now() - startTime;
      console.log(`✅ Agent generation completed in ${Math.round(processingTime)}ms`);
      
      return {
        success: true,
        needsClarification: false,
        clarificationResult,
        agent,
        processingTime
      };
      
    } catch (error) {
      console.error(`❌ Agent generation with clarification failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        processingTime: performance.now() - startTime
      };
    }
  }

  /**
   * Process clarification response and continue with orchestration
   */
  async processClarificationResponse(
    clarificationId: string,
    responses: Record<string, any>,
    originalRequest: OrchestrationRequest,
    options: ClarificationOptions
  ): Promise<{
    success: boolean;
    orchestrationResult?: any;
    error?: string;
    processingTime: number;
  }> {
    const startTime = performance.now();
    
    try {
      console.log(`🔄 Processing clarification response for ID: ${clarificationId}`);
      
      // Step 1: Enhance original request with clarification responses
      const enhancedRequest = this.enhanceRequestWithResponses(originalRequest, responses);
      
      // Step 2: Generate enhanced prompt constraints based on responses
      const enhancedConstraints = this.generateConstraintsFromResponses(responses);
      
      // Step 3: Proceed with orchestration using enhanced request
      const requirements = enhancedRequest.requirements?.join(', ') || 'none specified';
      const services = enhancedRequest.availableServices?.join(', ') || 'none specified';
      const constraints = enhancedConstraints.length > 0 ? ` Enhanced constraints: ${enhancedConstraints.join('; ')}.` : '';
      const orchestrationQuery = `${enhancedRequest.description}. Requirements: ${requirements}. Available services: ${services}.${constraints}`;
      
      const orchestrationResult = await this.orchestrationService.orchestrateRequest(orchestrationQuery);
      
      const processingTime = performance.now() - startTime;
      console.log(`✅ Clarification response processed in ${Math.round(processingTime)}ms`);
      
      return {
        success: true,
        orchestrationResult,
        processingTime
      };
      
    } catch (error) {
      console.error(`❌ Clarification response processing failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        processingTime: performance.now() - startTime
      };
    }
  }

  /**
   * Enhance request with clarification responses
   */
  private enhanceRequestWithResponses(
    originalRequest: OrchestrationRequest,
    responses: Record<string, any>
  ): OrchestrationRequest {
    const enhanced: OrchestrationRequest = {
      ...originalRequest,
      context: {
        ...originalRequest.context,
        clarificationResponses: responses,
        enhanced: true
      }
    };
    
    // Add specific services based on responses
    const availableServices = [...(originalRequest.availableServices || [])];
    
    if (responses.smsService) {
      availableServices.push(`SMS: ${responses.smsService}`);
    }
    
    if (responses.emailService) {
      availableServices.push(`Email: ${responses.emailService}`);
    }
    
    if (responses.authMethod) {
      availableServices.push(`Auth: ${responses.authMethod}`);
    }
    
    enhanced.availableServices = availableServices;
    
    // Enhance description with clarification details
    let enhancedDescription = originalRequest.description;
    
    if (responses.specificDetails) {
      enhancedDescription += ` Additional details: ${responses.specificDetails}`;
    }
    
    if (responses.securityRequirements) {
      enhancedDescription += ` Security requirements: ${responses.securityRequirements}`;
    }
    
    enhanced.description = enhancedDescription;
    
    return enhanced;
  }

  /**
   * Generate enhanced prompt constraints from clarification responses
   */
  private generateConstraintsFromResponses(responses: Record<string, any>): string[] {
    const constraints: string[] = [];
    
    // Service-specific constraints
    if (responses.smsService === 'Twilio') {
      constraints.push("Use Twilio SDK for SMS functionality (npm install twilio)");
      constraints.push("Include Twilio account SID and auth token in configuration");
    }
    
    if (responses.emailService === 'Gmail') {
      constraints.push("Use nodemailer with Gmail OAuth2 for email functionality");
      constraints.push("Include Gmail API credentials in configuration");
    }
    
    if (responses.emailService === 'Custom SMTP') {
      constraints.push("Use nodemailer with custom SMTP configuration");
      constraints.push("Include SMTP host, port, and authentication in configuration");
    }
    
    // Security constraints
    if (responses.authMethod) {
      constraints.push(`Implement ${responses.authMethod} authentication`);
      constraints.push("Include proper error handling for authentication failures");
    }
    
    if (responses.securityRequirements) {
      if (Array.isArray(responses.securityRequirements)) {
        responses.securityRequirements.forEach((req: string) => {
          constraints.push(`Security requirement: ${req}`);
        });
      } else {
        constraints.push(`Security requirement: ${responses.securityRequirements}`);
      }
    }
    
    // Infrastructure constraints
    if (responses.infrastructureNeeds) {
      constraints.push(`Infrastructure requirements: ${responses.infrastructureNeeds}`);
    }
    
    return constraints;
  }

  /**
   * Get clarification service instance (for direct access if needed)
   */
  getClarificationService(): ConditionalClarificationService {
    return this.clarificationService;
  }

  /**
   * Get orchestration service instance (for direct access if needed)
   */
  getOrchestrationService(): OrchestrationService {
    return this.orchestrationService;
  }
}
