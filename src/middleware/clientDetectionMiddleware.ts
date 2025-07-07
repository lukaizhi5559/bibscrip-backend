import { Request, Response, NextFunction } from 'express';
import { ClarificationOptions } from '../services/conditionalClarificationService';

// Extended Request interface to include clarification options
export interface ClarificationRequest extends Request {
  clarificationOptions?: ClarificationOptions;
}

/**
 * Client Detection Middleware
 * 
 * Intelligently detects client type and sets appropriate clarification options
 * based on headers, user agent, and request patterns.
 */
export class ClientDetectionMiddleware {
  
  /**
   * Main middleware function for Express
   */
  static detect() {
    return (req: ClarificationRequest, res: Response, next: NextFunction) => {
      const detector = new ClientDetectionMiddleware();
      req.clarificationOptions = detector.detectClientType(req);
      
      console.log(`🎯 Client detected: ${req.clarificationOptions.clientType} (${req.clarificationOptions.mode} mode)`);
      next();
    };
  }

  /**
   * Detect client type and determine appropriate clarification mode
   */
  private detectClientType(req: Request): ClarificationOptions {
    const headers = req.headers;
    const userAgent = headers['user-agent']?.toLowerCase() || '';
    const clientTypeHeader = headers['x-client-type']?.toString().toLowerCase();
    const apiKey = headers['x-api-key'];
    const contentType = headers['content-type']?.toLowerCase() || '';
    
    // Priority 1: Explicit client type header
    if (clientTypeHeader) {
      return this.getOptionsForClientType(clientTypeHeader, req);
    }
    
    // Priority 2: API key presence indicates microservice/API client
    if (apiKey) {
      console.log(`🔑 API key detected - treating as microservice client`);
      return {
        mode: 'full-blown',
        clientType: 'microservice',
        skipFrontendClarification: true,
        forceValidation: true
      };
    }
    
    // Priority 3: User agent analysis
    const clientType = this.analyzeUserAgent(userAgent);
    if (clientType !== 'unknown') {
      return this.getOptionsForClientType(clientType, req);
    }
    
    // Priority 4: Request pattern analysis
    const patternBasedType = this.analyzeRequestPattern(req);
    return this.getOptionsForClientType(patternBasedType, req);
  }

  /**
   * Get clarification options for specific client type
   */
  private getOptionsForClientType(clientType: string, req: Request): ClarificationOptions {
    const isForceValidation = req.query.forceValidation === 'true';
    const isSkipFrontend = req.query.skipFrontendClarification === 'true';
    
    switch (clientType) {
      case 'frontend':
      case 'electron':
      case 'browser':
        return {
          mode: 'lightweight',
          clientType: 'frontend',
          skipFrontendClarification: false,
          forceValidation: isForceValidation
        };
        
      case 'microservice':
      case 'api':
      case 'service':
        return {
          mode: 'full-blown',
          clientType: 'microservice',
          skipFrontendClarification: true,
          forceValidation: true
        };
        
      case 'api-direct':
      case 'direct':
      case 'curl':
      case 'postman':
        return {
          mode: 'full-blown',
          clientType: 'api-direct',
          skipFrontendClarification: isSkipFrontend,
          forceValidation: true
        };
        
      default:
        // Default to lightweight for unknown clients
        console.log(`⚠️ Unknown client type: ${clientType}, defaulting to lightweight mode`);
        return {
          mode: 'lightweight',
          clientType: 'frontend',
          skipFrontendClarification: false,
          forceValidation: isForceValidation
        };
    }
  }

  /**
   * Analyze user agent to determine client type
   */
  private analyzeUserAgent(userAgent: string): string {
    // Electron applications
    if (userAgent.includes('electron')) {
      return 'electron';
    }
    
    // Browser-based clients
    if (userAgent.includes('chrome') || userAgent.includes('firefox') || 
        userAgent.includes('safari') || userAgent.includes('edge')) {
      return 'browser';
    }
    
    // API testing tools
    if (userAgent.includes('postman')) {
      return 'postman';
    }
    
    if (userAgent.includes('curl')) {
      return 'curl';
    }
    
    if (userAgent.includes('insomnia')) {
      return 'api-direct';
    }
    
    // Programming language HTTP clients
    if (userAgent.includes('node') || userAgent.includes('axios') || 
        userAgent.includes('fetch') || userAgent.includes('request')) {
      return 'microservice';
    }
    
    if (userAgent.includes('python') || userAgent.includes('requests') || 
        userAgent.includes('urllib')) {
      return 'microservice';
    }
    
    if (userAgent.includes('java') || userAgent.includes('okhttp')) {
      return 'microservice';
    }
    
    // Mobile applications
    if (userAgent.includes('mobile') || userAgent.includes('android') || 
        userAgent.includes('ios')) {
      return 'frontend';
    }
    
    return 'unknown';
  }

  /**
   * Analyze request patterns to infer client type
   */
  private analyzeRequestPattern(req: Request): string {
    const path = req.path.toLowerCase();
    const method = req.method.toUpperCase();
    const hasJsonBody = req.headers['content-type']?.includes('application/json');
    const hasFormData = req.headers['content-type']?.includes('multipart/form-data');
    const hasUrlEncoded = req.headers['content-type']?.includes('application/x-www-form-urlencoded');
    
    // API-style requests (JSON, structured endpoints)
    if (hasJsonBody && (path.includes('/api/') || path.includes('/v1/') || path.includes('/v2/'))) {
      return 'microservice';
    }
    
    // Form-based requests (likely from frontend)
    if (hasFormData || hasUrlEncoded) {
      return 'frontend';
    }
    
    // Batch or bulk operations (likely microservice)
    if (path.includes('batch') || path.includes('bulk') || path.includes('generate/batch')) {
      return 'microservice';
    }
    
    // Interactive endpoints (likely frontend)
    if (path.includes('clarify') || path.includes('interactive') || path.includes('session')) {
      return 'frontend';
    }
    
    // Health checks and monitoring (likely microservice)
    if (path.includes('health') || path.includes('status') || path.includes('metrics')) {
      return 'microservice';
    }
    
    // Default based on HTTP method
    if (method === 'GET') {
      return 'frontend'; // GET requests often from browsers/frontend
    } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      return 'api-direct'; // Structured operations often from APIs
    }
    
    return 'frontend'; // Safe default
  }

  /**
   * Get client confidence score (for debugging/monitoring)
   */
  static getClientConfidence(req: ClarificationRequest): number {
    const headers = req.headers;
    const userAgent = headers['user-agent']?.toLowerCase() || '';
    const clientTypeHeader = headers['x-client-type'];
    const apiKey = headers['x-api-key'];
    
    let confidence = 0.5; // Base confidence
    
    // High confidence indicators
    if (clientTypeHeader) confidence += 0.4;
    if (apiKey) confidence += 0.3;
    if (userAgent.includes('electron')) confidence += 0.2;
    if (userAgent.includes('postman') || userAgent.includes('curl')) confidence += 0.3;
    
    // Medium confidence indicators
    if (userAgent.includes('chrome') || userAgent.includes('firefox')) confidence += 0.1;
    if (req.headers['content-type']?.includes('application/json')) confidence += 0.1;
    
    return Math.min(1.0, confidence);
  }

  /**
   * Debug information for client detection
   */
  static getDebugInfo(req: ClarificationRequest): Record<string, any> {
    return {
      userAgent: req.headers['user-agent'],
      clientTypeHeader: req.headers['x-client-type'],
      hasApiKey: !!req.headers['x-api-key'],
      contentType: req.headers['content-type'],
      path: req.path,
      method: req.method,
      detectedOptions: req.clarificationOptions,
      confidence: ClientDetectionMiddleware.getClientConfidence(req)
    };
  }
}

/**
 * Utility function to manually override client detection
 */
export function overrideClientType(
  req: ClarificationRequest, 
  clientType: 'frontend' | 'microservice' | 'api-direct',
  mode?: 'lightweight' | 'full-blown'
): void {
  const detector = new ClientDetectionMiddleware();
  req.clarificationOptions = detector['getOptionsForClientType'](clientType, req);
  
  if (mode) {
    req.clarificationOptions.mode = mode;
  }
  
  console.log(`🔧 Client type manually overridden to: ${clientType} (${req.clarificationOptions.mode} mode)`);
}

export default ClientDetectionMiddleware;
