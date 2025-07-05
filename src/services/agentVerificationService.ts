import { logger } from '../utils/logger';
import { LLMOrchestratorService } from './llmOrchestrator';
import * as vm from 'vm';

export interface VerificationRequest {
  agentCode: string;
  agentMetadata: {
    name: string;
    description: string;
    execution_target?: string;
    dependencies?: string[];
  };
  desiredBehavior?: string;
  expectedParams?: string[];
  testCases?: TestCase[];
}

export interface TestCase {
  name: string;
  params: Record<string, any>;
  expectedResultIncludes?: string[];
  expectedResultExcludes?: string[];
  shouldSucceed?: boolean;
}

export interface VerificationResult {
  success: boolean;
  verified: boolean;
  enriched: boolean;
  issues: CodeIssue[];
  testResults: TestResult[];
  enrichmentSuggestions: EnrichmentSuggestion[];
  finalAgentCode?: string;
  modifications?: CodeModification[];
  dependencies?: string[];
  secrets?: string[];
}

export interface CodeIssue {
  type: 'placeholder' | 'syntax' | 'logic' | 'security' | 'dependency';
  severity: 'low' | 'medium' | 'high' | 'critical';
  line?: number;
  description: string;
  suggestion?: string;
}

export interface TestResult {
  testCase: string;
  passed: boolean;
  executionTime?: number;
  result?: any;
  error?: string;
  reason?: string;
}

export interface EnrichmentSuggestion {
  type: 'missing_logic' | 'incomplete_function' | 'add_dependency' | 'add_error_handling';
  description: string;
  suggestedCode?: string;
  confidence: number;
}

export interface CodeModification {
  type: 'addition' | 'replacement' | 'deletion';
  line: number;
  originalCode: string;
  newCode: string;
  reason: string;
}

export class AgentVerificationService {
  private llmOrchestrator: LLMOrchestratorService;

  constructor() {
    this.llmOrchestrator = new LLMOrchestratorService();
  }

  /**
   * Main verification method - performs static analysis, sandboxed testing, and enrichment
   */
  async verifyAgent(request: VerificationRequest): Promise<VerificationResult> {
    logger.info('Starting agent verification', { 
      agentName: request.agentMetadata.name,
      codeLength: request.agentCode.length 
    });

    const result: VerificationResult = {
      success: false,
      verified: false,
      enriched: false,
      issues: [],
      testResults: [],
      enrichmentSuggestions: [],
      dependencies: [],
      secrets: []
    };

    try {
      // Step 1: Static Analysis
      logger.info('Performing static analysis...');
      const staticIssues = await this.performStaticAnalysis(request);
      result.issues.push(...staticIssues);

      // Step 2: Dependency and Secret Detection
      logger.info('Detecting dependencies and secrets...');
      const deps = this.detectDependencies(request.agentCode);
      const secrets = this.detectSecrets(request.agentCode);
      result.dependencies = deps;
      result.secrets = secrets;

      // Step 3: Sandboxed Testing (if test cases provided)
      if (request.testCases && request.testCases.length > 0) {
        logger.info('Running sandboxed tests...');
        const testResults = await this.runSandboxedTests(request.agentCode, request.testCases);
        result.testResults = testResults;
      }

      // Step 4: Determine if enrichment is needed
      const needsEnrichment = this.needsEnrichment(result.issues, result.testResults);
      
      if (needsEnrichment) {
        logger.info('Agent needs enrichment, generating suggestions...');
        const enrichmentSuggestions = await this.generateEnrichmentSuggestions(request, result.issues);
        result.enrichmentSuggestions = enrichmentSuggestions;

        // Step 5: Auto-enrich if confidence is high
        const highConfidenceSuggestions = enrichmentSuggestions.filter(s => s.confidence > 0.8);
        if (highConfidenceSuggestions.length > 0) {
          logger.info('Auto-enriching agent code...');
          const enrichedCode = await this.enrichAgentCode(request, highConfidenceSuggestions);
          if (enrichedCode) {
            result.finalAgentCode = enrichedCode;
            result.enriched = true;
            result.modifications = this.generateModifications(request.agentCode, enrichedCode);
            
            // Include updated dependencies from enrichment process
            if (request.agentMetadata && request.agentMetadata.dependencies) {
              result.dependencies = request.agentMetadata.dependencies;
              logger.info('Updated dependencies included in verification result', {
                dependencies: result.dependencies
              });
            }
          }
        }
      }

      // Step 6: Final verification status
      const criticalIssues = result.issues.filter(i => i.severity === 'critical');
      const failedTests = result.testResults.filter(t => !t.passed);
      
      result.verified = criticalIssues.length === 0 && failedTests.length === 0;
      result.success = true;

      logger.info('Agent verification completed', {
        verified: result.verified,
        enriched: result.enriched,
        issuesFound: result.issues.length,
        testsRun: result.testResults.length
      });

      return result;

    } catch (error) {
      logger.error('Agent verification failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      result.success = false;
      result.issues.push({
        type: 'syntax',
        severity: 'critical',
        description: `Verification failed: ${error instanceof Error ? error.message : String(error)}`
      });
      return result;
    }
  }

  /**
   * Perform static analysis on agent code
   */
  private async performStaticAnalysis(request: VerificationRequest): Promise<CodeIssue[]> {
    const code = request.agentCode;
    const issues: CodeIssue[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // Check for placeholders
      if (this.isPlaceholderLine(line)) {
        issues.push({
          type: 'placeholder',
          severity: 'high',
          line: lineNumber,
          description: 'Found placeholder or TODO comment that needs implementation',
          suggestion: 'Replace placeholder with actual implementation'
        });
      }

      // Check for empty switch cases
      if (line.includes('case ') && lines[i + 1]?.trim() === 'break;') {
        issues.push({
          type: 'logic',
          severity: 'high',
          line: lineNumber,
          description: 'Empty switch case found',
          suggestion: 'Implement logic for this case or remove it'
        });
      }

      // Check for dangerous operations
      if (this.isDangerousOperation(line)) {
        issues.push({
          type: 'security',
          severity: 'medium',
          line: lineNumber,
          description: 'Potentially dangerous operation detected',
          suggestion: 'Review security implications and add proper validation'
        });
      }

      // Check for missing error handling
      if (line.includes('require(') && !this.hasErrorHandling(lines, i)) {
        issues.push({
          type: 'logic',
          severity: 'medium',
          line: lineNumber,
          description: 'Missing error handling for require statement',
          suggestion: 'Add try-catch block or error handling'
        });
      }
    }

    // Check for missing core functionality based on agent name/description
    const semanticIssues = this.detectMissingCoreFunctionality(request, code);
    issues.push(...semanticIssues);

    return issues;
  }

  /**
   * Check if a line contains placeholder content
   */
  private isPlaceholderLine(line: string): boolean {
    const placeholderPatterns = [
      /\/\/\s*(TODO|FIXME|PLACEHOLDER|IMPLEMENT)/i,
      /\/\*\s*(TODO|FIXME|PLACEHOLDER|IMPLEMENT)/i,
      /console\.log\(['"].*placeholder.*['"].*\)/i,
      /\/\/.*logic.*here/i,
      /\/\/.*implementation/i
    ];

    return placeholderPatterns.some(pattern => pattern.test(line));
  }

  /**
   * Check if operation is potentially dangerous
   */
  private isDangerousOperation(line: string): boolean {
    const dangerousPatterns = [
      /exec\s*\(/,
      /spawn\s*\(/,
      /eval\s*\(/,
      /Function\s*\(/,
      /process\.exit/,
      /fs\.unlink/,
      /fs\.rmdir/,
      /rm\s+-rf/
    ];

    return dangerousPatterns.some(pattern => pattern.test(line));
  }

  /**
   * Check if there's error handling around a line
   */
  private hasErrorHandling(lines: string[], index: number): boolean {
    // Look for try-catch within 5 lines before or after
    const start = Math.max(0, index - 5);
    const end = Math.min(lines.length, index + 5);
    
    for (let i = start; i < end; i++) {
      if (lines[i].includes('try') || lines[i].includes('catch')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Detect missing core functionality based on agent name and description
   */
  private detectMissingCoreFunctionality(request: VerificationRequest, code: string): CodeIssue[] {
    const issues: CodeIssue[] = [];
    const agentName = request.agentMetadata.name.toLowerCase();
    const agentDescription = request.agentMetadata.description.toLowerCase();
    const codeContent = code.toLowerCase();

    // Email-related agents
    if ((agentName.includes('email') || agentDescription.includes('email')) &&
        (agentDescription.includes('monitor') || agentDescription.includes('fetch') || agentDescription.includes('check'))) {
      
      const hasEmailLibraries = codeContent.includes('imap') || codeContent.includes('pop3') || 
                               codeContent.includes('nodemailer') || codeContent.includes('gmail') ||
                               codeContent.includes('outlook') || codeContent.includes('mail');
      
      const hasEmailLogic = codeContent.includes('connect') || codeContent.includes('login') ||
                           codeContent.includes('inbox') || codeContent.includes('message') ||
                           codeContent.includes('fetch') || codeContent.includes('retrieve');
      
      if (!hasEmailLibraries && !hasEmailLogic) {
        issues.push({
          type: 'logic',
          severity: 'high',
          line: 1,
          description: 'Missing core email functionality - agent claims to monitor emails but has no email-related code',
          suggestion: 'Add IMAP/POP3 connection logic, email fetching, and message processing functionality'
        });
      }
    }

    // File/Document processing agents
    if ((agentName.includes('file') || agentName.includes('document') || agentDescription.includes('file') || agentDescription.includes('document')) &&
        (agentDescription.includes('process') || agentDescription.includes('parse') || agentDescription.includes('extract'))) {
      
      const hasFileOperations = codeContent.includes('fs.') || codeContent.includes('readfile') ||
                               codeContent.includes('writefile') || codeContent.includes('path.');
      
      if (!hasFileOperations) {
        issues.push({
          type: 'logic',
          severity: 'high',
          line: 1,
          description: 'Missing core file processing functionality',
          suggestion: 'Add file system operations, file reading/writing, and document processing logic'
        });
      }
    }

    // API/Web service agents
    if ((agentName.includes('api') || agentName.includes('web') || agentDescription.includes('api') || agentDescription.includes('web')) &&
        (agentDescription.includes('call') || agentDescription.includes('request') || agentDescription.includes('fetch'))) {
      
      const hasHttpOperations = codeContent.includes('fetch') || codeContent.includes('axios') ||
                               codeContent.includes('request') || codeContent.includes('http') ||
                               codeContent.includes('curl') || codeContent.includes('get') ||
                               codeContent.includes('post');
      
      if (!hasHttpOperations) {
        issues.push({
          type: 'logic',
          severity: 'high',
          line: 1,
          description: 'Missing core API/web functionality',
          suggestion: 'Add HTTP request handling, API calls, and web service integration logic'
        });
      }
    }

    // Database agents
    if ((agentName.includes('database') || agentName.includes('db') || agentDescription.includes('database') || agentDescription.includes('db')) &&
        (agentDescription.includes('query') || agentDescription.includes('store') || agentDescription.includes('retrieve'))) {
      
      const hasDatabaseOperations = codeContent.includes('sql') || codeContent.includes('query') ||
                                   codeContent.includes('select') || codeContent.includes('insert') ||
                                   codeContent.includes('update') || codeContent.includes('delete') ||
                                   codeContent.includes('mongodb') || codeContent.includes('postgres');
      
      if (!hasDatabaseOperations) {
        issues.push({
          type: 'logic',
          severity: 'high',
          line: 1,
          description: 'Missing core database functionality',
          suggestion: 'Add database connection, query execution, and data manipulation logic'
        });
      }
    }

    return issues;
  }

  /**
   * Detect required dependencies from code
   */
  private detectDependencies(code: string): string[] {
    const dependencies = new Set<string>();
    const requirePattern = /require\(['"`]([^'"`]+)['"`]\)/g;
    const importPattern = /import.*from\s+['"`]([^'"`]+)['"`]/g;

    let match;
    while ((match = requirePattern.exec(code)) !== null) {
      const dep = match[1];
      if (!dep.startsWith('.') && !dep.startsWith('/')) {
        dependencies.add(dep);
      }
    }

    while ((match = importPattern.exec(code)) !== null) {
      const dep = match[1];
      if (!dep.startsWith('.') && !dep.startsWith('/')) {
        dependencies.add(dep);
      }
    }

    return Array.from(dependencies);
  }

  /**
   * Detect required secrets/environment variables
   */
  private detectSecrets(code: string): string[] {
    const secrets = new Set<string>();
    const envPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
    const configPattern = /(api[_-]?key|token|password|secret|credential)/gi;

    let match;
    while ((match = envPattern.exec(code)) !== null) {
      secrets.add(match[1]);
    }

    // Look for hardcoded secret-like strings
    const lines = code.split('\n');
    for (const line of lines) {
      if (configPattern.test(line) && (line.includes(':') || line.includes('='))) {
        const secretMatch = line.match(/['"`]([^'"`]*(?:key|token|password|secret)[^'"`]*)['"`]/i);
        if (secretMatch) {
          secrets.add(secretMatch[1]);
        }
      }
    }

    return Array.from(secrets);
  }

  /**
   * Run agent code in sandboxed environment with test cases
   */
  private async runSandboxedTests(code: string, testCases: TestCase[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const testCase of testCases) {
      const startTime = Date.now();
      
      try {
        // Create sandbox context with mocks
        const sandbox = this.createSandboxContext();
        
        // Execute the agent code in sandbox
        const script = new vm.Script(`
          ${code}
          
          // Execute the agent
          (async () => {
            if (typeof exports !== 'undefined' && exports.default) {
              return await exports.default.execute(${JSON.stringify(testCase.params)}, {});
            } else {
              throw new Error('Agent does not export default with execute method');
            }
          })();
        `);

        const result = await script.runInNewContext(sandbox, { timeout: 5000 });
        const executionTime = Date.now() - startTime;

        // Validate result
        const passed = this.validateTestResult(result, testCase);
        
        results.push({
          testCase: testCase.name,
          passed,
          executionTime,
          result,
          reason: passed ? 'Test passed' : 'Test validation failed'
        });

      } catch (error) {
        const executionTime = Date.now() - startTime;
        results.push({
          testCase: testCase.name,
          passed: false,
          executionTime,
          error: error instanceof Error ? error.message : String(error),
          reason: 'Execution error'
        });
      }
    }

    return results;
  }

  /**
   * Create sandbox context with mocks for common modules
   */
  private createSandboxContext(): any {
    return {
      console: {
        log: (...args: any[]) => logger.debug('Sandbox log:', args),
        error: (...args: any[]) => logger.debug('Sandbox error:', args),
        warn: (...args: any[]) => logger.debug('Sandbox warn:', args)
      },
      require: (module: string) => {
        // Mock common modules
        switch (module) {
          case 'os':
            return { platform: () => 'darwin' };
          case 'fs':
            return { writeFileSync: () => {}, readFileSync: () => 'mock content' };
          case 'path':
            return { join: (...args: string[]) => args.join('/') };
          case 'child_process':
            return { exec: (cmd: string, cb: Function) => cb(null, 'mock output', '') };
          default:
            return {};
        }
      },
      process: {
        env: { NODE_ENV: 'test' },
        platform: 'darwin'
      },
      exports: {},
      module: { exports: {} },
      __dirname: '/mock/dir',
      __filename: '/mock/dir/agent.js'
    };
  }

  /**
   * Validate test result against expected criteria
   */
  private validateTestResult(result: any, testCase: TestCase): boolean {
    if (testCase.shouldSucceed === false && (!result || !result.success)) {
      return true; // Expected to fail
    }

    if (!result || typeof result !== 'object') {
      return false;
    }

    // Check expected includes
    if (testCase.expectedResultIncludes) {
      const resultStr = JSON.stringify(result).toLowerCase();
      for (const include of testCase.expectedResultIncludes) {
        if (!resultStr.includes(include.toLowerCase())) {
          return false;
        }
      }
    }

    // Check expected excludes
    if (testCase.expectedResultExcludes) {
      const resultStr = JSON.stringify(result).toLowerCase();
      for (const exclude of testCase.expectedResultExcludes) {
        if (resultStr.includes(exclude.toLowerCase())) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Determine if agent needs enrichment based on issues and test results
   */
  private needsEnrichment(issues: CodeIssue[], testResults: TestResult[]): boolean {
    const hasHighSeverityIssues = issues.some(i => i.severity === 'high' || i.severity === 'critical');
    const hasMediumSeverityIssues = issues.some(i => i.severity === 'medium');
    const hasFailedTests = testResults.some(t => !t.passed);
    const hasPlaceholders = issues.some(i => i.type === 'placeholder');
    const hasMissingFunctionality = issues.some(i => 
      i.description.includes('Missing') || 
      i.description.includes('incomplete') ||
      i.description.includes('placeholder') ||
      i.description.includes('TODO')
    );

    // Enrich if there are any issues that could benefit from improvement
    return hasHighSeverityIssues || hasMediumSeverityIssues || hasFailedTests || hasPlaceholders || hasMissingFunctionality;
  }

  /**
   * Generate enrichment suggestions using LLM
   */
  private async generateEnrichmentSuggestions(
    request: VerificationRequest, 
    issues: CodeIssue[]
  ): Promise<EnrichmentSuggestion[]> {
    const suggestions: EnrichmentSuggestion[] = [];

    // Group issues by type
    const placeholderIssues = issues.filter(i => i.type === 'placeholder');
    const logicIssues = issues.filter(i => i.type === 'logic');

    // Generate suggestions for placeholder issues
    for (const issue of placeholderIssues) {
      const suggestion = await this.generatePlaceholderSuggestion(request, issue);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    // Generate suggestions for logic issues
    for (const issue of logicIssues) {
      const suggestion = await this.generateLogicSuggestion(request, issue);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    return suggestions;
  }

  /**
   * Generate suggestion for placeholder issue
   */
  private async generatePlaceholderSuggestion(
    request: VerificationRequest, 
    issue: CodeIssue
  ): Promise<EnrichmentSuggestion | null> {
    try {
      const prompt = `You are a code completion expert. The following agent code has a placeholder that needs implementation:

Agent Name: ${request.agentMetadata.name}
Agent Description: ${request.agentMetadata.description}
Desired Behavior: ${request.desiredBehavior || 'Not specified'}

Issue: ${issue.description} (Line ${issue.line})

Please provide a complete implementation for this placeholder. Return only the code that should replace the placeholder, without explanations.

Code Context:
${request.agentCode}`;

      const response = await this.llmOrchestrator.processPrompt('generate_agent', { userQuery: prompt });
      
      if (response.text) {
        let cleanCode = response.text.trim();
        
        // Remove any JSON wrapping if present
        if (cleanCode.startsWith('{') && cleanCode.includes('"code"')) {
          try {
            const parsed = JSON.parse(cleanCode);
            if (parsed.code) {
              cleanCode = parsed.code;
            }
          } catch {
            // If JSON parsing fails, use the original text
          }
        }
        
        // Remove markdown code blocks if present
        if (cleanCode.startsWith('```')) {
          cleanCode = cleanCode.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
        }
        
        // Unescape any escaped characters
        cleanCode = cleanCode.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
        
        return {
          type: 'missing_logic',
          description: `Complete implementation for: ${issue.description}`,
          suggestedCode: cleanCode,
          confidence: 0.85
        };
      }
    } catch (error) {
      logger.warn('Failed to generate placeholder suggestion', { error });
    }

    return null;
  }

  /**
   * Generate suggestion for logic issue
   */
  private async generateLogicSuggestion(
    request: VerificationRequest, 
    issue: CodeIssue
  ): Promise<EnrichmentSuggestion | null> {
    try {
      const prompt = `You are a code improvement expert. The following agent code has a logic issue that needs fixing:

Agent Name: ${request.agentMetadata.name}
Issue: ${issue.description} (Line ${issue.line})
Suggestion: ${issue.suggestion}

Please provide the corrected code for this issue. Return only the fixed code section.

Code Context:
${request.agentCode}`;

      const response = await this.llmOrchestrator.processPrompt('generate_agent', { userQuery: prompt });
      
      if (response.text) {
        // Set higher confidence for high-severity issues to trigger enrichment
        const confidence = issue.severity === 'high' ? 0.9 : 0.75;
        
        return {
          type: 'incomplete_function',
          description: `Fix for: ${issue.description}`,
          suggestedCode: response.text.trim(),
          confidence: confidence
        };
      }
    } catch (error) {
      logger.warn('Failed to generate logic suggestion', { error });
    }

    return null;
  }

  /**
   * Enrich agent code with high-confidence suggestions
   */
  private async enrichAgentCode(
    request: VerificationRequest, 
    suggestions: EnrichmentSuggestion[]
  ): Promise<string | null> {
    try {
      const enrichmentPrompt = `You are an expert code enrichment system. Please improve the following agent code by implementing COMPLETE, PRODUCTION-READY functionality:

Original Agent Code:
${request.agentCode}

Agent Metadata:
- Name: ${request.agentMetadata.name}
- Description: ${request.agentMetadata.description}
- Desired Behavior: ${request.desiredBehavior || 'Not specified'}
- Execution Target: ${request.agentMetadata.execution_target || 'frontend'}
- Dependencies: ${request.agentMetadata.dependencies ? request.agentMetadata.dependencies.join(', ') : 'None specified'}

Enrichment Requirements:
${suggestions.map(s => `- ${s.description}: ${s.suggestedCode}`).join('\n')}

CRITICAL REQUIREMENTS:
1. Replace ALL placeholder code with REAL implementations
2. Use actual file paths (e.g., __dirname, process.cwd(), or config-based paths)
3. Implement proper error handling and validation
4. Add realistic configuration options (use params/context for credentials)
5. Include proper async/await patterns and Promise handling
6. Add comprehensive logging and status reporting
7. Handle edge cases and failure scenarios
8. Use production-ready libraries and patterns

For EMAIL agents specifically:
- Use real IMAP/POP3 libraries (imap, node-imap, etc.)
- Handle authentication with OAuth2 or app passwords  
- Implement proper email parsing and filtering
- Add retry logic and connection management
- Include actual IMAP connection code with params.emailConfig
- Parse email headers, subjects, and body content
- Implement email filtering by date, sender, or keywords
- Add proper error handling for network failures
- Return structured email data (subject, from, date, body)

For STARTUP/AUTOMATION agents:
- Use absolute paths based on __dirname or process.cwd()
- Handle different OS environments properly
- Add validation for required permissions
- Implement proper service registration

IMPORTANT: You MUST return the complete agent code in this EXACT format:

export default {
  name: '${request.agentMetadata.name}',
  description: '${request.agentMetadata.description}',
  async execute(params, context) {
    // Your COMPLETE, PRODUCTION-READY implementation here
    // NO placeholders, NO TODO comments, NO setTimeout mocks
    // Include any helper functions INSIDE this execute method
    // or define them before the export default block
    
    // Use params for configuration:
    // - params.emailConfig (host, port, user, password, etc.)
    // - params.paths (for file operations)
    // - params.credentials (for API access)
    
    // Use context for runtime info:
    // - context.workingDirectory
    // - context.platform
    // - context.environment
  }
};

CRITICAL: Return ONLY the JavaScript code - no explanations, disclaimers, or additional text.
Do NOT include any text before or after the code.
Do NOT add security warnings or implementation notes.
Return ONLY the complete, executable JavaScript code with the export default structure.
Generate REAL, WORKING code that could be deployed to production immediately.`;

      // Use 'ask' task type for code enrichment with cache bypass for fresh responses
    const response = await this.llmOrchestrator.processPrompt('ask', { 
      userQuery: enrichmentPrompt
    }, {
      forceRefresh: true // Bypass cache for fresh enrichment
    });
    
    logger.info('Enrichment LLM response received', {
      responseLength: response.text?.length || 0,
      provider: response.provider,
      fromCache: response.fromCache,
      responsePreview: response.text?.substring(0, 200) + '...' // First 200 chars for debugging
    });
      
      if (response.text) {
        let enrichedCode = response.text.trim();
        
        // Handle JSON-wrapped responses from LLM
        if (enrichedCode.startsWith('{') && enrichedCode.includes('"code"')) {
          try {
            const parsed = JSON.parse(enrichedCode);
            if (parsed.code) {
              enrichedCode = parsed.code;
            }
          } catch {
            // If JSON parsing fails, try to extract code from the response
            const codeMatch = enrichedCode.match(/"code"\s*:\s*"([^"]+)"/s);
            if (codeMatch) {
              enrichedCode = codeMatch[1];
            }
          }
        }
        
        // Extract JavaScript code from markdown blocks, even with surrounding text
        const codeBlockMatch = enrichedCode.match(/```(?:javascript|js)?\n([\s\S]*?)\n```/);
        if (codeBlockMatch) {
          enrichedCode = codeBlockMatch[1];
        } else if (enrichedCode.startsWith('```')) {
          // Fallback for simple code blocks
          enrichedCode = enrichedCode.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
        }
        
        // Unescape any escaped characters
        enrichedCode = enrichedCode.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
        
        logger.info('Code extraction completed', {
          extractedCodeLength: enrichedCode.length,
          startsWithExport: enrichedCode.trim().startsWith('export default') || enrichedCode.trim().startsWith('const'),
          codePreview: enrichedCode.substring(0, 200) + '...'
        });
        
        // Validate that we have proper agent code structure
        if (!enrichedCode.includes('export default') || !enrichedCode.includes('async execute')) {
          logger.warn('Enriched code does not have proper agent structure, using original code');
          return null;
        }
        
        // Re-analyze dependencies from enriched code to ensure accuracy
        const enrichedDependencies = this.detectDependencies(enrichedCode);
        logger.info('Dependencies re-analyzed from enriched code', {
          originalDependencies: request.agentMetadata.dependencies || [],
          enrichedDependencies,
          dependenciesChanged: JSON.stringify(request.agentMetadata.dependencies || []) !== JSON.stringify(enrichedDependencies)
        });
        
        // Update the agent metadata with correct dependencies
        if (request.agentMetadata) {
          request.agentMetadata.dependencies = enrichedDependencies;
        }
        
        return enrichedCode;
      }
    } catch (error) {
      logger.error('Failed to enrich agent code', { error });
    }

    return null;
  }

  /**
   * Generate modification summary
   */
  private generateModifications(originalCode: string, enrichedCode: string): CodeModification[] {
    // Simple diff implementation - in production, use a proper diff library
    const modifications: CodeModification[] = [];
    
    if (originalCode !== enrichedCode) {
      modifications.push({
        type: 'replacement',
        line: 1,
        originalCode: 'Original agent code',
        newCode: 'Enriched agent code with complete implementations',
        reason: 'Replaced placeholders and incomplete logic with working implementations'
      });
    }

    return modifications;
  }
}
