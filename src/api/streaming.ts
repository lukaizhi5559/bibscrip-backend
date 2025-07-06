/**
 * LLM API Routes
 * Clean, honest API for hybrid local/cloud LLM architecture
 * Real streaming only for long-running operations (agent orchestration)
 */

import { Router, Request, Response } from 'express';
import { LLMRouter } from '../utils/llmRouter';
import { userMemoryService } from '../services/userMemoryService';
import { buildPrompt } from '../services/promptBuilder';
import { authenticateAPIKey } from '../middleware/auth';

const router = Router();
const llmRouter = new LLMRouter();

interface StreamingRequest {
  question: string;
  userId?: string;
  enrichWithUserContext?: boolean;
  maxTokens?: number;
}

/**
 * POST /api/streaming/ask
 * Clean LLM API with user context enrichment
 * Recommends local LLM for simple queries, backend for complex ones
 */
router.post('/ask', authenticateAPIKey, async (req: Request, res: Response) => {
  try {
    const { question, userId, enrichWithUserContext = false, maxTokens = 2048 }: StreamingRequest = req.body;

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Question is required and must be a string' });
      return;
    }

    const startTime = Date.now();
    let userContext: any = null;
    let appliedMemories: any[] = [];

    // User context retrieval (if requested)
    if (userId && enrichWithUserContext) {
      try {
        const memories = await userMemoryService.getUserMemories(userId);
        appliedMemories = memories.slice(0, 10); // Limit for performance
        
        userContext = {
          userId,
          appliedMemories,
          memoryCount: memories.length
        };
      } catch (error) {
        console.warn('Could not load user context:', error);
        // Continue without context
      }
    }

    // Build enriched prompt
    const enrichedPrompt = buildPrompt('ask', {
      userQuery: question,
      context: {
        ragSources: [],
        knowledgeBase: [],
        userPreferences: userContext?.preferences || {}
      }
    });

    // Hybrid LLM routing recommendation
    const isSimpleQuery = /^(hello|hi|help|what|how|when|where|why|who)\s/i.test(question) && question.length < 100;
    
    try {
      // Backend LLM processing
      const response = await llmRouter.processPrompt(enrichedPrompt, {
        skipCache: false,
        taskType: 'ask'
      });

      const processingTime = Date.now() - startTime;
      const responseText = response.text || '';

      // Return clean JSON response
      res.json({
        success: true,
        ai: responseText,
        requiresAutomation: /\b(automate|schedule|remind|create agent|build|deploy|run|execute)\b/i.test(question),
        automationIntent: isSimpleQuery ? null : question,
        userContext: {
          userId: userId || null,
          appliedMemories: appliedMemories.length,
          totalMemories: userContext?.memoryCount || 0
        },
        metadata: {
          provider: response.provider || 'unknown',
          processingTime,
          tokenCount: responseText.length,
          cached: response.fromCache || false,
          recommendLocalLLM: isSimpleQuery,
          fallbackChain: response.fallbackChain || [],
          totalAttempts: response.totalAttempts || 1
        }
      });
      return;

    } catch (llmError) {
      console.error('LLM processing failed:', llmError);
      res.status(500).json({
        success: false,
        error: 'LLM processing failed',
        details: llmError instanceof Error ? llmError.message : 'Unknown LLM error',
        fallback: 'Please try rephrasing your question or try again later.'
      });
      return;
    }

  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: 'Request processing failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
    return;
  }
});

/**
 * POST /api/streaming/quick
 * Ultra-fast cached responses for common queries
 */
router.post('/quick', authenticateAPIKey, async (req: Request, res: Response) => {
  try {
    const { question }: { question: string } = req.body;

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Question is required and must be a string' });
      return;
    }

    const startTime = Date.now();

    // Quick response patterns for common queries
    const quickResponses: Record<string, string> = {
      'productivity tips': 'Here are some quick productivity tips: 1) Use time-blocking, 2) Eliminate distractions, 3) Take regular breaks, 4) Prioritize important tasks first.',
      'morning routine': 'A good morning routine includes: 1) Wake up early, 2) Hydrate immediately, 3) Light exercise or stretching, 4) Healthy breakfast, 5) Review daily goals.',
      'time management': 'Effective time management: 1) Use a calendar system, 2) Set clear priorities, 3) Batch similar tasks, 4) Say no to non-essential activities.',
      'focus better': 'To improve focus: 1) Remove distractions, 2) Use the Pomodoro technique, 3) Create a dedicated workspace, 4) Practice mindfulness.',
      'hello': 'Hello! I\'m Thinkdrop AI, your personal productivity assistant. How can I help you today?',
      'help': 'I can help you with productivity tips, automation workflows, personal organization, and much more. What would you like assistance with?'
    };

    // Find matching quick response
    const questionLower = question.toLowerCase();
    let quickResponse = null;
    
    for (const [pattern, response] of Object.entries(quickResponses)) {
      if (questionLower.includes(pattern)) {
        quickResponse = response;
        break;
      }
    }

    const processingTime = Date.now() - startTime;

    if (quickResponse) {
      res.json({
        success: true,
        ai: quickResponse,
        requiresAutomation: false,
        isQuickResponse: true,
        metadata: {
          provider: 'quick-cache',
          processingTime,
          cached: true
        }
      });
      return;
    }

    // If no quick response found, suggest using full API
    res.json({
      success: false,
      message: 'No quick response available, please use /api/llm/ask or /api/streaming/ask for full processing',
      suggestFullAPI: true
    });
    return;

  } catch (error) {
    console.error('Quick response API error:', error);
    res.status(500).json({
      error: 'Quick response processing failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
    return;
  }
});

export default router;
