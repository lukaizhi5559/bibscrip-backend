/**
 * Unified LLM API Entrypoint
 * Centralizes all LLM, RAG, prompt engineering, and AI-driven capabilities
 * Serves both Bible/theology queries (/ask) and automation orchestration (/agents)
 */

import { Router, Request, Response } from 'express';
import { performance } from 'perf_hooks';
import { authenticate } from '../../middleware/auth';
import { rateLimiter, quotaChecker, requestLogger } from '../../middleware/rateLimiter';
import { logger } from '../../utils/logger';

// Import unified LLM infrastructure
import { llmOrchestratorService } from '../../services/llmOrchestrator';
import { orchestrationService } from '../../services/orchestrationService';
import { buildPrompt, validatePromptOptions, getPromptMetadata } from '../../services/promptBuilder';

// Import existing services for Bible/theology queries
import { ragService } from '../../services/ragService';
import { getBibleVerse, BibleVerse } from '../../utils/bible';
import { extractVerseReferences } from '../../utils/verse-parser';
import { analytics } from '../../utils/analytics';

const router = Router();

// Automation intent detection interface
interface AutomationIntent {
  requiresAutomation: boolean;
  type?: 'app_launcher' | 'file_management' | 'system_automation' | 'workflow' | 'integration' | 'monitoring';
  confidence: number;
  suggestedActions: string[];
  complexity: 'simple' | 'moderate' | 'complex';
}

// Fast automation intent detection using regex patterns and LLM hints
async function detectAutomationIntent(question: string, llmResponse: string): Promise<AutomationIntent> {
  // Check for advice/question patterns first (these should NOT trigger automation)
  const advicePatterns = [
    /\b(what\s+is\s+the\s+best\s+way\s+to|how\s+do\s+i|how\s+can\s+i|what\s+should\s+i|how\s+to)\b/i,
    /\b(advice|tips|suggestions|recommendations|help\s+me\s+understand)\b/i,
    /\b(explain|tell\s+me|show\s+me)\b/i
  ];
  
  // If it's clearly an advice question, don't trigger automation
  const isAdviceQuestion = advicePatterns.some(pattern => pattern.test(question));
  if (isAdviceQuestion) {
    return {
      requiresAutomation: false,
      type: undefined,
      confidence: 0,
      complexity: 'simple',
      suggestedActions: []
    };
  }
  
  // Enhanced regex-based automation detection - more specific patterns
  const automationRegexes = [
    /\b(auto(mate|matically))\b/i,
    /\b(set\s+up\s+a\s+(schedule|scheduled|automation|workflow|script))\b/i,
    /\b(trigger(ed)?|set\s?up\s?a\s?trigger)\b/i,
    /\b(create\s+a\s+(workflow|script|automation))\b/i,
    /\b(automatically\s+(launch|start|run|execute|open))\b/i,
    /\b(monitor|watch)\s+(folder|file|system|process)\b/i,
    /\b(automatically\s+(backup|sync|organize|manage|clean\s?up))\b/i,
    /\b(integrate|connect|hook)\s+.+\s+(with|to)\b/i,
    /\b(automatically\s+(send|fetch|retrieve|collect))\b/i,
    /\b(set\s+up\s+(automatic|auto)\s+(update|notify|alert))\b/i,
    /\b(set\s?(up)?\s?(a)?\s?(timer|interval|cron|routine|job))\b/i
  ];
  
  const timeTriggerRegexes = [
    /\b(every|each)\s+(minute|hour|day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(at|on)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/i, // e.g. "at 5pm"
    /\b(cron\s+job|cron\s+expression)\b/i,
    /\b(once\s+(a|per)\s+(day|week|month))\b/i,
    /\b(daily|weekly|monthly|hourly)\b/i
  ];
  
  // Application/system detection regexes
  const appRegexes = [
    // Popular specific applications
    /\b(spotify|chrome|firefox|edge|safari|brave|opera)\b/i,
    /\b(vscode|intellij|pycharm|webstorm|sublime|atom|notepad\+\+?|notepad|android studio)\b/i,
    /\b(slack|teams|zoom|discord|skype|telegram|signal|whatsapp|wechat)\b/i,
    /\b(outlook|gmail|mail|apple mail|thunderbird)\b/i,
    /\b(calendar|google calendar|apple calendar)\b/i,
    /\b(word|excel|powerpoint|onenote|microsoft office|office)\b/i,
    /\b(photoshop|illustrator|lightroom|xd|premiere|after effects)\b/i,
    /\b(finder|file explorer|explorer)\b/i,
    /\b(terminal|powershell|cmd|iterm|terminal\.app)\b/i,
    /\b(onedrive|google drive|dropbox)\b/i,
    /\b(steam|epic games|battle\.net|riot client|game launcher)\b/i,
    /\b(calculator|paint|gallery|photos|sticky notes)\b/i,
    /\b(meet|facetime|zoom|teams)\b/i,
    /\b(power toys|powertoys|microsoft powertoys)\b/i,
  
    // Generic app keywords
    /\b(app|application|program|software|tool)\b/i,
  
    // Phrases like “launch Slack app”, “open Chrome browser”
    /\b(open|launch|start)\s+((the\s)?\w+\s+)*?(app|application|program|software|tool)\b/i
  ];  
  
  // File/system management regexes
  const fileSystemRegexes = [
    // Generic file/folder mentions
    /\b(file|folder|directory|document|image|photo|log|backup)\b/i,
  
    // OS-level locations
    /\b(desktop|downloads|documents|pictures|videos|music|cloud|drive)\b/i,
  
    // Common file operations
    /\b(open|close|delete|remove|rename|move|copy|cut|paste|zip|compress|extract)\b/i,
    
    // Combined with target nouns
    /\b(open|delete|remove|rename|move|copy)\s+(the\s+)?(file|folder|directory|document|image)s?\b/i,
    
    // Organize specific file types or folders
    /\b(organize|sort|clean\s?up|manage)\s+(files?|folders?|documents?|photos?|images?)\b/i,
  
    // Backup and sync operations
    /\b(backup|sync|mirror|archive)\s+(files?|folders?|directories)\b/i
  ];  
  
  // LLM response automation hints
  const responseHintRegexes = [
    /\b(you\s+can\s+automate|create\s+a\s+script|set\s+up\s+automation)\b/i,
    /\b(workflow|agent|schedule|trigger)\b/i,
    /\b(i\s+can\s+help\s+you\s+(automate|create|set\s+up))\b/i
  ];
  
  function testRegexArray(text: string, regexArray: RegExp[]): { matches: number; matchedPatterns: string[] } {
    const matchedPatterns: string[] = [];
    let matches = 0;
    
    for (const regex of regexArray) {
      if (regex.test(text)) {
        matches++;
        matchedPatterns.push(regex.source);
      }
    }
    
    return { matches, matchedPatterns };
  }
  
  let confidence = 0;
  let type: AutomationIntent['type'] = 'workflow';
  const suggestedActions: string[] = [];
  const detectedPatterns: string[] = [];
  
  // Test automation patterns
  const automationResults = testRegexArray(question, automationRegexes);
  if (automationResults.matches > 0) {
    confidence += 0.5; // Higher confidence for direct automation keywords
    suggestedActions.push('create_agent');
    detectedPatterns.push(...automationResults.matchedPatterns);
  }
  
  // Test time trigger patterns
  const timeResults = testRegexArray(question, timeTriggerRegexes);
  if (timeResults.matches > 0) {
    confidence += 0.4; // High confidence for time-based triggers
    type = 'system_automation';
    suggestedActions.push('setup_schedule');
    detectedPatterns.push(...timeResults.matchedPatterns);
  }
  
  // Test app-related patterns
  const appResults = testRegexArray(question, appRegexes);
  if (appResults.matches > 0) {
    confidence += 0.3;
    type = 'app_launcher';
    suggestedActions.push('setup_workflow');
    detectedPatterns.push(...appResults.matchedPatterns);
  }
  
  // Test file/system patterns
  const fileResults = testRegexArray(question, fileSystemRegexes);
  if (fileResults.matches > 0) {
    confidence += 0.3;
    type = 'file_management';
    suggestedActions.push('configure_automation');
    detectedPatterns.push(...fileResults.matchedPatterns);
  }
  
  // Test LLM response for automation hints
  const responseResults = testRegexArray(llmResponse, responseHintRegexes);
  if (responseResults.matches > 0) {
    confidence += 0.2;
    detectedPatterns.push(...responseResults.matchedPatterns);
  }
  
  // Determine complexity based on detected patterns and question content
  let complexity: AutomationIntent['complexity'] = 'simple';
  const totalMatches = automationResults.matches + timeResults.matches + appResults.matches + fileResults.matches;
  
  if (totalMatches > 2 || timeResults.matches > 0) {
    complexity = 'moderate';
  }
  
  // Check for complex automation indicators
  const complexityIndicators = [
    /\b(integrate|integration)\b/i,
    /\b(multiple|several|many)\b/i,
    /\b(complex|complicated|advanced)\b/i,
    /\b(chain|sequence|pipeline)\b/i,
    /\b(conditional|if.*then|when.*do)\b/i
  ];
  
  if (complexityIndicators.some(regex => regex.test(question))) {
    complexity = 'complex';
  }
  
  // Final decision threshold
  const requiresAutomation = confidence >= 0.3;
  
  if (requiresAutomation && suggestedActions.length === 0) {
    suggestedActions.push('analyze_requirements');
  }
  
  return {
    requiresAutomation,
    type: requiresAutomation ? type : undefined,
    confidence: Math.min(confidence, 1.0),
    suggestedActions,
    complexity
  };
}

// Initialize services
ragService.initialize().catch(error => {
  logger.error('Failed to initialize RAG service', { error });
});

/**
 * @swagger
 * /api/llm/ask:
 *   post:
 *     summary: AI-powered Bible verse query and analysis (unified)
 *     tags: [LLM Core]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               question:
 *                 type: string
 *                 description: Bible-related question
 *                 example: "What does John 3:16 mean?"
 *               forceRefresh:
 *                 type: boolean
 *                 description: Force refresh of cached responses
 *                 default: false
 *     responses:
 *       200:
 *         description: AI response with automation analysis
 */
router.post('/ask', [
  authenticate,
  rateLimiter('ask'),
  quotaChecker()
], async (req: Request, res: Response): Promise<void> => {
  const requestStartTime = performance.now();
  
  try {
    const { question, forceRefresh = false } = req.body;
    
    if (!question || typeof question !== 'string') {
      res.status(400).json({ 
        error: 'Question is required and must be a string' 
      });
      return;
    }

    // Check if quota was exceeded and adjust processing accordingly
    const quotaExceeded = req.quotaExceeded || false;
    const quotaInfo = req.quotaInfo;
    
    logger.info('Processing user query for automation intent', { 
      question: question.substring(0, 100),
      forceRefresh,
      quotaExceeded,
      quotaInfo: quotaExceeded ? quotaInfo : undefined
    });

    // If quota exceeded, prioritize cached responses and fallback providers
    const processOptions = {
      forceRefresh: quotaExceeded ? false : forceRefresh, // Don't force refresh if quota exceeded
      preferCache: quotaExceeded, // Prefer cached responses when quota exceeded
      useFallbackProviders: quotaExceeded // Use fallback providers when quota exceeded
    };

    // Use unified LLM orchestrator for automation-focused queries
    const llmResponse = await llmOrchestratorService.processAsk(question, processOptions);

    // Detect automation intent from the LLM response
    const automationIntent = await detectAutomationIntent(question, llmResponse.text);

    // Track analytics
    analytics.trackAIRequest({
      provider: llmResponse.provider,
      fromCache: llmResponse.fromCache || false,
      latencyMs: performance.now() - requestStartTime,
      status: 'success',
      query: question
    });

    const response: any = {
      ai: llmResponse.text,
      requiresAutomation: automationIntent.requiresAutomation,
      automationIntent: automationIntent.requiresAutomation ? {
        type: automationIntent.type,
        confidence: automationIntent.confidence,
        suggestedActions: automationIntent.suggestedActions,
        complexity: automationIntent.complexity
      } : null,
      provider: llmResponse.provider,
      fromCache: llmResponse.fromCache || false,
      latencyMs: Math.round(performance.now() - requestStartTime),
      // Enhanced fallback chain visibility
      fallbackChain: llmResponse.fallbackChain || [],
      totalAttempts: llmResponse.totalAttempts || 1,
      cacheType: llmResponse.cacheType || 'none'
    };
    
    // Add quota information if quota was exceeded
    if (quotaExceeded && quotaInfo) {
      response.quotaExceeded = true;
      response.quotaInfo = {
        message: 'Quota exceeded - using fallback providers and cached responses',
        resetIn: quotaInfo.resetIn,
        upgrade: quotaInfo.upgrade
      };
      response.fallbackMode = true;
    }
    
    res.json(response);

  } catch (error) {
    logger.error('Error in unified LLM ask endpoint', {
      error: error instanceof Error ? error.message : String(error),
      question: req.body?.question?.substring(0, 100)
    });

    analytics.trackAIRequest({
      provider: 'unknown',
      fromCache: false,
      latencyMs: performance.now() - requestStartTime,
      status: 'error',
      query: req.body?.question || ''
    });

    res.status(500).json({
      error: 'Failed to process Bible query',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @swagger
 * /api/llm/intent:
 *   post:
 *     summary: Parse user intent using unified LLM core
 *     tags: [LLM Core]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               request:
 *                 type: string
 *                 description: User's natural language request
 *     responses:
 *       200:
 *         description: Parsed intent with analysis
 */
router.post('/intent', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { request } = req.body;
    
    if (!request || typeof request !== 'string') {
      res.status(400).json({
        error: 'Request field is required and must be a string'
      });
      return;
    }

    logger.info('Parsing intent through unified LLM core', { 
      request: request.substring(0, 100) 
    });

    const intentResult = await orchestrationService.parseIntent(request);
    
    res.json(intentResult);

  } catch (error) {
    logger.error('Error parsing intent', {
      error: error instanceof Error ? error.message : String(error)
    });

    res.status(500).json({
      error: 'Failed to parse intent',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @swagger
 * /api/llm/orchestrate:
 *   post:
 *     summary: Orchestrate multi-agent workflow using unified LLM core
 *     tags: [LLM Core]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               request:
 *                 type: string
 *                 description: User's automation request
 *     responses:
 *       200:
 *         description: Orchestration plan with agents
 */
router.post('/orchestrate', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { request } = req.body;
    
    if (!request || typeof request !== 'string') {
      res.status(400).json({
        error: 'Request field is required and must be a string'
      });
      return;
    }

    logger.info('Orchestrating request through unified LLM core', { 
      request: request.substring(0, 100) 
    });

    const orchestrationResult = await orchestrationService.orchestrateRequest(request);
    
    res.json(orchestrationResult);

  } catch (error) {
    logger.error('Error orchestrating request', {
      error: error instanceof Error ? error.message : String(error)
    });

    res.status(500).json({
      error: 'Failed to orchestrate request',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @swagger
 * /api/llm/generate-agent:
 *   post:
 *     summary: Generate new agent using unified LLM core
 *     tags: [LLM Core]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *                 description: Agent description and requirements
 *               name:
 *                 type: string
 *                 description: Preferred agent name
 *               context:
 *                 type: string
 *                 description: Additional context for generation
 *     responses:
 *       200:
 *         description: Generated agent code and metadata
 */
router.post('/generate-agent', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { description, name, context } = req.body;
    
    if (!description || typeof description !== 'string') {
      res.status(400).json({
        error: 'Description field is required and must be a string'
      });
      return;
    }

    logger.info('Generating agent through unified LLM core', { 
      description: description.substring(0, 100),
      name 
    });

    const agentResult = await orchestrationService.generateAgent(description, { name, context });
    
    res.json(agentResult);

  } catch (error) {
    logger.error('Error generating agent', {
      error: error instanceof Error ? error.message : String(error)
    });

    res.status(500).json({
      error: 'Failed to generate agent',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @swagger
 * /api/llm/health:
 *   get:
 *     summary: Check health of unified LLM core services
 *     tags: [LLM Core]
 *     responses:
 *       200:
 *         description: Health status of all LLM services
 */
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const [orchestratorHealth, ragHealth] = await Promise.allSettled([
      llmOrchestratorService.testProviders(),
      Promise.resolve({ status: 'healthy' }) // RAG service health placeholder
    ]);

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        llmOrchestrator: {
          status: orchestratorHealth.status === 'fulfilled' ? 'healthy' : 'error',
          providers: orchestratorHealth.status === 'fulfilled' ? orchestratorHealth.value : null,
          error: orchestratorHealth.status === 'rejected' ? orchestratorHealth.reason : null
        },
        rag: {
          status: ragHealth.status === 'fulfilled' ? 'healthy' : 'error',
          details: ragHealth.status === 'fulfilled' ? ragHealth.value : null,
          error: ragHealth.status === 'rejected' ? ragHealth.reason : null
        },
        promptBuilder: {
          status: 'healthy',
          availablePrompts: ['intent', 'generate_agent', 'orchestrate', 'ask']
        }
      }
    };

    // Determine overall status
    const hasErrors = Object.values(health.services).some(service => service.status === 'error');
    if (hasErrors) {
      health.status = 'degraded';
    }

    res.json(health);

  } catch (error) {
    logger.error('Error checking LLM health', {
      error: error instanceof Error ? error.message : String(error)
    });

    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @swagger
 * /api/llm/stats:
 *   get:
 *     summary: Get processing statistics from unified LLM core
 *     tags: [LLM Core]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: LLM processing statistics
 */
router.get('/stats', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await llmOrchestratorService.getProcessingStats();
    
    res.json({
      timestamp: new Date().toISOString(),
      processingStats: stats,
      availableProviders: llmOrchestratorService.getAvailableProviders()
    });

  } catch (error) {
    logger.error('Error getting LLM stats', {
      error: error instanceof Error ? error.message : String(error)
    });

    res.status(500).json({
      error: 'Failed to get LLM statistics',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
