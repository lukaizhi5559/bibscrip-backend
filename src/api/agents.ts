import { Router, Request, Response } from 'express';
import { orchestrationService } from '../services/orchestrationService';
import { llmOrchestratorService } from '../services/llmOrchestrator';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @swagger
 * /api/agents/orchestrate:
 *   post:
 *     summary: Orchestrate user request - parse intent and manage agents
 *     tags: [Agents]
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
 *                 example: "I want to open Spotify automatically if it's not already running"
 *     responses:
 *       200:
 *         description: Orchestration result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [created, exists, clarification_needed, error]
 *                 agent:
 *                   type: object
 *                 next_steps:
 *                   type: array
 *                 plan_summary:
 *                   type: string
 *                 estimated_success_rate:
 *                   type: number
 *                 clarification_questions:
 *                   type: array
 */
router.post('/orchestrate', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { request } = req.body;

    if (!request || typeof request !== 'string') {
      res.status(400).json({
        error: 'Request field is required and must be a string',
      });
      return;
    }

    logger.info(`Orchestrating request: ${request}`);

    const result = await orchestrationService.orchestrateRequest(request);

    res.json(result);
    return;
  } catch (error) {
    logger.error('Error orchestrating request:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents:
 *   get:
 *     summary: Get all agents
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all agents
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const agents = await orchestrationService.getAllAgents();
    res.json(agents);
  } catch (error) {
    logger.error('Error getting all agents:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/{name}:
 *   get:
 *     summary: Get specific agent by name
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent name
 *     responses:
 *       200:
 *         description: Agent details
 *       404:
 *         description: Agent not found
 */
router.get('/:name', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const agent = await orchestrationService.getAgentByName(name);

    if (!agent) {
      res.status(404).json({
        error: 'Agent not found',
        message: `Agent with name '${name}' does not exist`,
      });
      return;
    }

    res.json(agent);
  } catch (error) {
    logger.error(`Error getting agent ${req.params.name}:`, error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
  }
});

/**
 * @swagger
 * /api/agents/{name}:
 *   delete:
 *     summary: Delete agent by name
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent name
 *     responses:
 *       200:
 *         description: Agent deleted successfully
 *       404:
 *         description: Agent not found
 */
router.delete('/:name', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const deleted = await orchestrationService.deleteAgent(name);

    if (!deleted) {
      res.status(404).json({
        error: 'Agent not found',
        message: `Agent with name '${name}' does not exist`,
      });
      return;
    }

    res.json({ success: true, message: `Agent ${name} deleted successfully` });
  } catch (error) {
    logger.error(`Error deleting agent ${name}:`, error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/intent/parse:
 *   post:
 *     summary: Parse user intent without executing
 *     tags: [Agents]
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
 *         description: Parsed intent
 */
router.post('/intent/parse', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { request } = req.body;

    if (!request || typeof request !== 'string') {
      res.status(400).json({
        error: 'Request field is required and must be a string',
      });
      return;
    }

    const intent = await orchestrationService.parseIntent(request);
    res.json(intent);
    return;
  } catch (error) {
    logger.error('Error parsing intent:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/generate:
 *   post:
 *     summary: Generate new agent code
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Agent name
 *               description:
 *                 type: string
 *                 description: Agent description
 *               context:
 *                 type: string
 *                 description: User context for generation
 *     responses:
 *       200:
 *         description: Generated agent
 */
router.post('/generate', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, context } = req.body;

    if (!name || !description) {
      res.status(400).json({
        error: 'Name and description are required',
      });
      return;
    }

    logger.info('Generating agent with unified LLM core', { name, description });

    // Use unified LLM core for enhanced agent generation
    const llmResponse = await llmOrchestratorService.processAgentGeneration(description, { name, context });
    const result = await orchestrationService.generateAgent(description, { name, context });
    
    if (result.status === 'error') {
      res.status(400).json({
        error: 'Agent generation failed',
        issues: result.issues,
        llm_details: {
          provider: llmResponse.provider,
          latency: llmResponse.latencyMs,
          fromCache: llmResponse.fromCache
        }
      });
      return;
    }

    res.json({
      status: result.status,
      agent: result.agent,
      confidence: result.confidence,
      issues: result.issues,
      llm_details: {
        provider: llmResponse.provider,
        latency: llmResponse.latencyMs,
        fromCache: llmResponse.fromCache
      }
    });
    return;
  } catch (error) {
    logger.error('Error generating agent:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/communications:
 *   get:
 *     summary: Get agent communications log
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: agent
 *         schema:
 *           type: string
 *         description: Filter by specific agent name
 *     responses:
 *       200:
 *         description: Agent communications
 */
router.get('/communications', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { agent } = req.query;
    const communications = await orchestrationService.getCommunications({ agent_name: agent as string });
    res.json(communications);
    return;
  } catch (error) {
    logger.error('Error getting communications:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/communications:
 *   post:
 *     summary: Log agent communication
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               from:
 *                 type: string
 *                 description: Source agent name
 *               to:
 *                 type: string
 *                 description: Target agent name
 *               data:
 *                 type: object
 *                 description: Communication data
 *     responses:
 *       200:
 *         description: Communication logged
 */
router.post('/communications', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to, data } = req.body;

    if (!from || !to || !data) {
      res.status(400).json({
        error: 'From, to, and data fields are required',
      });
      return;
    }

    const communicationId = await orchestrationService.logCommunication({
      from_agent: from,
      to_agent: to,
      message: JSON.stringify(data),
      message_type: 'command'
    });

    res.json({ 
      success: true, 
      message: 'Communication logged successfully',
      id: communicationId
    });
    return;
  } catch (error) {
    logger.error('Error logging communication:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/llm/analyze:
 *   post:
 *     summary: Direct LLM analysis for agent intelligence
 *     tags: [Agents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               query:
 *                 type: string
 *                 description: Query for LLM analysis
 *               task_type:
 *                 type: string
 *                 enum: [intent, generate_agent, orchestrate, ask]
 *                 description: Type of LLM task
 *               context:
 *                 type: object
 *                 description: Additional context for analysis
 *     responses:
 *       200:
 *         description: LLM analysis result
 */
router.post('/llm/analyze', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, task_type, context } = req.body;

    if (!query || !task_type) {
      res.status(400).json({
        error: 'Query and task_type are required',
      });
      return;
    }

    logger.info('Direct LLM analysis request', { task_type, queryLength: query.length });

    let llmResponse: any;
    let metadata: any = {
      timestamp: new Date().toISOString()
    };

    switch (task_type) {
      case 'intent':
        llmResponse = await orchestrationService.parseIntent(query);
        // IntentResult has llm_response property with metadata
        if (llmResponse.llm_response) {
          metadata = {
            provider: llmResponse.llm_response.provider || 'unknown',
            latency: llmResponse.llm_response.latencyMs || 0,
            fromCache: llmResponse.llm_response.fromCache || false,
            timestamp: new Date().toISOString()
          };
        } else {
          metadata = {
            provider: 'unknown',
            latency: 0,
            fromCache: false,
            timestamp: new Date().toISOString()
          };
        }
        break;
      case 'generate_agent':
        llmResponse = await llmOrchestratorService.processAgentGeneration(query, context);
        metadata = {
          provider: llmResponse.provider || 'unknown',
          latency: llmResponse.latencyMs || 0,
          fromCache: llmResponse.fromCache || false,
          timestamp: new Date().toISOString()
        };
        break;
      case 'orchestrate':
        llmResponse = await llmOrchestratorService.processOrchestration(query, context);
        metadata = {
          provider: llmResponse.provider || 'unknown',
          latency: llmResponse.latencyMs || 0,
          fromCache: llmResponse.fromCache || false,
          timestamp: new Date().toISOString()
        };
        break;
      case 'ask':
        llmResponse = await llmOrchestratorService.processAsk(query, context);
        metadata = {
          provider: llmResponse.provider || 'unknown',
          latency: llmResponse.latencyMs || 0,
          fromCache: llmResponse.fromCache || false,
          timestamp: new Date().toISOString()
        };
        break;
      default:
        res.status(400).json({
          error: 'Invalid task_type. Must be one of: intent, generate_agent, orchestrate, ask',
        });
        return;
    }

    res.json({
      success: true,
      task_type,
      result: llmResponse,
      metadata
    });
    return;
  } catch (error) {
    logger.error('Error in LLM analysis:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

export default router;
