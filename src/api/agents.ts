import { Router, Request, Response } from 'express';
import { orchestrationService } from '../services/orchestrationService';
import { AgentOrchestrationService } from '../services/agentOrchestrationService';
import { llmOrchestratorService } from '../services/llmOrchestrator';
import { userMemoryService } from '../services/userMemoryService';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';
import { verifyAgent, enrichAgent, testAgent } from './agents/verify';
import { ClarificationIntegrationService } from '../services/clarificationIntegrationService';
import { ClientDetectionMiddleware, ClarificationRequest } from '../middleware/clientDetectionMiddleware';

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
 *               userId:
 *                 type: string
 *                 format: uuid
 *                 description: Optional user ID for context enrichment
 *               enrichWithUserContext:
 *                 type: boolean
 *                 description: Whether to enrich request with user memory context
 *                 default: false
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
router.post('/orchestrate', authenticate, ClientDetectionMiddleware.detect(), async (req: ClarificationRequest, res: Response): Promise<void> => {
  try {
    const { request, userId, enrichWithUserContext = false } = req.body;

    if (!request || typeof request !== 'string') {
      res.status(400).json({
        error: 'Request field is required and must be a string',
      });
      return;
    }

    let finalRequest = request;
    let userContext = null;

    // Enrich request with user context if requested and userId provided
    if (enrichWithUserContext && userId) {
      try {
        const enrichedPrompt = await userMemoryService.enrichPromptWithUserContext(userId, request);
        finalRequest = enrichedPrompt.enrichedPrompt;
        userContext = {
          originalPrompt: enrichedPrompt.originalPrompt,
          appliedMemories: enrichedPrompt.appliedMemories,
          userProfile: enrichedPrompt.userContext
        };
        logger.info(`Request enriched with user context for user ${userId}`);
      } catch (contextError) {
        logger.warn('Failed to enrich request with user context:', contextError as Error);
        // Continue with original request if context enrichment fails
      }
    }

    logger.info(`Orchestrating request with conditional clarification: ${finalRequest}`);

    // Use conditional clarification system
    const clarificationService = new ClarificationIntegrationService();
    const clarificationOptions = req.clarificationOptions!;
    
    const orchestrationRequest = {
      description: finalRequest,
      requirements: req.body.requirements || [],
      availableServices: req.body.availableServices || [],
      context: userContext ? { userContext } : {}
    };

    const result = await clarificationService.orchestrateWithClarification(
      orchestrationRequest,
      clarificationOptions
    );

    // Handle clarification needed response
    if (result.needsClarification) {
      res.json({
        status: 'clarification_needed',
        needsClarification: true,
        questions: result.clarificationResult?.questions || [],
        clarificationId: result.clarificationResult?.clarificationId,
        analysis: result.clarificationResult?.analysis,
        processingTime: result.processingTime,
        clientType: clarificationOptions.clientType,
        mode: clarificationOptions.mode
      });
      return;
    }

    // Handle validation errors
    if (!result.success) {
      res.status(400).json({
        status: 'validation_error',
        error: result.error,
        issues: result.clarificationResult?.issues || [],
        processingTime: result.processingTime,
        clientType: clarificationOptions.clientType,
        mode: clarificationOptions.mode
      });
      return;
    }

    // Success response with orchestration result
    const response = {
      status: result.orchestrationResult?.status || 'success',
      ...result.orchestrationResult,
      clarification: {
        mode: clarificationOptions.mode,
        clientType: clarificationOptions.clientType,
        confidence: result.clarificationResult?.confidence,
        constraintsApplied: result.clarificationResult?.enhancedPromptConstraints?.length || 0
      },
      processingTime: result.processingTime,
      ...(userContext && { userContext })
    };

    res.json(response);
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
    const agentOrchestrationService = AgentOrchestrationService.getInstance();
    const agents = await agentOrchestrationService.getAllAgents();
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
    const agentOrchestrationService = AgentOrchestrationService.getInstance();
    const agent = await agentOrchestrationService.getAgent(name);

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
router.post('/generate', authenticate, ClientDetectionMiddleware.detect(), async (req: ClarificationRequest, res: Response): Promise<void> => {
  try {
    const { name, description, context, requirements = [], agentType = 'automation' } = req.body;

    if (!name || !description) {
      res.status(400).json({
        error: 'Name and description are required',
      });
      return;
    }

    logger.info(`Generating agent with conditional clarification: ${name}`);

    // Use conditional clarification system for agent generation
    const clarificationService = new ClarificationIntegrationService();
    const clarificationOptions = req.clarificationOptions!;
    
    const agentRequest = {
      agentName: name,
      description,
      requirements: Array.isArray(requirements) ? requirements : [],
      availableServices: req.body.availableServices || [],
      context: context || {},
      agentType
    };

    const result = await clarificationService.generateAgentWithClarification(
      agentRequest,
      clarificationOptions
    );

    // Handle clarification needed response
    if (result.needsClarification) {
      res.json({
        status: 'clarification_needed',
        needsClarification: true,
        questions: result.clarificationResult?.questions || [],
        clarificationId: result.clarificationResult?.clarificationId,
        analysis: result.clarificationResult?.analysis,
        processingTime: result.processingTime,
        clientType: clarificationOptions.clientType,
        mode: clarificationOptions.mode
      });
      return;
    }

    // Handle validation errors
    if (!result.success) {
      res.status(400).json({
        status: 'validation_error',
        error: result.error,
        issues: result.clarificationResult?.issues || [],
        processingTime: result.processingTime,
        clientType: clarificationOptions.clientType,
        mode: clarificationOptions.mode
      });
      return;
    }

    if (!result.agent) {
      res.status(500).json({
        error: 'Failed to generate agent - no agent returned',
        processingTime: result.processingTime
      });
      return;
    }

    // Store the generated agent in the database
    const agentOrchestrationService = AgentOrchestrationService.getInstance();
    
    // Ensure the agent has all required properties for the Agent interface
    const completeAgent = {
      ...result.agent,
      parameters: result.agent.parameters || {}, // Preserve extracted parameters
      version: '1.0.0', // Default version
      config: {}, // Default empty config
      secrets: {}, // Default empty secrets
      orchestrator_metadata: {}, // Default empty orchestrator metadata
      database_type: (result.agent.database_type === 'sqlite' || result.agent.database_type === 'duckdb') 
        ? result.agent.database_type as 'sqlite' | 'duckdb'
        : undefined // Ensure database_type is valid or undefined
    };
    
    logger.info('Attempting to store agent in database', { agentName: completeAgent.name });
    
    let storedAgent;
    try {
      storedAgent = await agentOrchestrationService.storeAgent(completeAgent);
      logger.info('Agent stored in database successfully', { agentName: storedAgent.name, agentId: storedAgent.id });
    } catch (storageError) {
      logger.error('Failed to store agent in database', {
        agentName: completeAgent.name,
        error: storageError instanceof Error ? storageError.message : String(storageError),
        stack: storageError instanceof Error ? storageError.stack : undefined
      });
      
      // Continue with the response even if storage fails, but use the original agent
      storedAgent = completeAgent;
    }

    // Success response with conditional clarification metadata
    res.json({
      status: 'success',
      agent: storedAgent,
      clarification: {
        mode: clarificationOptions.mode,
        clientType: clarificationOptions.clientType,
        confidence: result.clarificationResult?.confidence,
        constraintsApplied: result.clarificationResult?.enhancedPromptConstraints?.length || 0
      },
      processingTime: result.processingTime
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
 * /api/agents/generate/batch:
 *   post:
 *     summary: Generate multiple agents in parallel for multi-agent workflows
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
 *               agents:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                       description: Agent name
 *                     description:
 *                       type: string
 *                       description: Agent description/role
 *                     context:
 *                       type: string
 *                       description: Additional context for agent generation
 *                   required:
 *                     - name
 *                     - description
 *             required:
 *               - agents
 *     responses:
 *       200:
 *         description: Batch agent generation results
 *       400:
 *         description: Invalid request or generation failed
 */
router.post('/generate/batch', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { agents } = req.body;

    if (!agents || !Array.isArray(agents) || agents.length === 0) {
      res.status(400).json({
        error: 'Agents array is required and must not be empty',
      });
      return;
    }

    // Validate each agent spec
    for (const [index, agent] of agents.entries()) {
      if (!agent.name || !agent.description) {
        res.status(400).json({
          error: `Agent at index ${index} is missing required name or description`,
        });
        return;
      }
    }

    logger.info('Starting batch agent generation', { 
      agentCount: agents.length,
      agentNames: agents.map((a: any) => a.name)
    });

    // Use orchestrationService batch generation
    const batchResult = await orchestrationService.generateAgentsBatch(agents);
    
    // Store successful agents in the database
    const agentOrchestrationService = AgentOrchestrationService.getInstance();
    const storedAgents = [];
    const storageErrors = [];
    
    for (const result of batchResult.successful) {
      try {
        const completeAgent = {
          ...result.agent,
          parameters: result.agent.parameters || {}, // Preserve extracted parameters
          version: '1.0.0',
          config: {},
          secrets: {},
          orchestrator_metadata: {},
          database_type: (result.agent.database_type === 'sqlite' || result.agent.database_type === 'duckdb') 
            ? result.agent.database_type as 'sqlite' | 'duckdb'
            : undefined
        };
        
        const storedAgent = await agentOrchestrationService.storeAgent(completeAgent);
        storedAgents.push({
          ...result,
          agent: storedAgent
        });
        
        logger.info('Successfully stored agent from batch', { agentName: storedAgent.name });
      } catch (storageError) {
        logger.error('Failed to store agent from batch', {
          agentName: result.agent.name,
          error: storageError instanceof Error ? storageError.message : String(storageError)
        });
        
        storageErrors.push({
          agentName: result.agent.name,
          error: storageError instanceof Error ? storageError.message : String(storageError)
        });
      }
    }

    // Return comprehensive batch results
    res.status(200).json({
      status: 'batch_completed',
      summary: {
        ...batchResult.summary,
        stored: storedAgents.length,
        storageErrors: storageErrors.length
      },
      results: {
        successful: storedAgents,
        failed: batchResult.failed,
        storageErrors
      },
      performance: {
        totalLatencyMs: batchResult.summary.totalLatency,
        averageLatencyMs: batchResult.summary.averageLatency,
        parallelSpeedup: `${((batchResult.summary.averageLatency * batchResult.summary.total) / batchResult.summary.totalLatency).toFixed(2)}x`
      }
    });
    return;
    
  } catch (error) {
    logger.error('Error in batch agent generation:', error as Error);
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

// Agent Verification Endpoints
router.use('/verify', verifyAgent);
router.use('/enrich', enrichAgent);
router.use('/test', testAgent);

// ========== PHASE 2: AGENT CONFIG, MEMORY, AND DEPENDENCIES ENDPOINTS ==========

/**
 * @swagger
 * /api/agents/{name}/config:
 *   get:
 *     summary: Get agent configuration
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
 *         description: Agent configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 config:
 *                   type: object
 *                 secrets:
 *                   type: object
 *                 orchestrator_metadata:
 *                   type: object
 *       404:
 *         description: Agent not found
 */
router.get('/:name/config', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const agentOrchestrationService = AgentOrchestrationService.getInstance();
    const agent = await agentOrchestrationService.getAgent(name);

    if (!agent) {
      res.status(404).json({
        error: 'Agent not found',
        name
      });
      return;
    }

    // Return configuration without sensitive data
    const config = {
      config: agent.config || {},
      secrets: agent.secrets ? Object.keys(agent.secrets).reduce((acc, key) => {
        // Mask sensitive values but show structure
        if (typeof agent.secrets[key] === 'object' && agent.secrets[key] !== null) {
          acc[key] = Object.keys(agent.secrets[key]).reduce((subAcc, subKey) => {
            subAcc[subKey] = '***MASKED***';
            return subAcc;
          }, {} as any);
        } else {
          acc[key] = '***MASKED***';
        }
        return acc;
      }, {} as any) : {},
      orchestrator_metadata: agent.orchestrator_metadata || {}
    };

    res.json(config);
    return;
  } catch (error) {
    logger.error('Error getting agent config:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/{name}/config:
 *   post:
 *     summary: Update agent configuration
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               config:
 *                 type: object
 *                 description: Agent configuration settings
 *               secrets:
 *                 type: object
 *                 description: Agent secrets (will be encrypted)
 *               orchestrator_metadata:
 *                 type: object
 *                 description: MCP and orchestration metadata
 *     responses:
 *       200:
 *         description: Configuration updated successfully
 *       404:
 *         description: Agent not found
 */
router.post('/:name/config', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const { config, secrets, orchestrator_metadata } = req.body;
    const agentOrchestrationService = AgentOrchestrationService.getInstance();
    
    const agent = await agentOrchestrationService.getAgent(name);
    if (!agent) {
      res.status(404).json({
        error: 'Agent not found',
        name
      });
      return;
    }

    // Update agent configuration
    const updatedAgent = {
      ...agent,
      config: config ? { ...agent.config, ...config } : agent.config,
      secrets: secrets ? { ...agent.secrets, ...secrets } : agent.secrets,
      orchestrator_metadata: orchestrator_metadata ? 
        { ...agent.orchestrator_metadata, ...orchestrator_metadata } : 
        agent.orchestrator_metadata
    };

    await agentOrchestrationService.storeAgent(updatedAgent);

    logger.info(`Updated configuration for agent: ${name}`);
    res.json({
      success: true,
      message: 'Agent configuration updated successfully',
      agent: name
    });
    return;
  } catch (error) {
    logger.error('Error updating agent config:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/{name}/memory:
 *   get:
 *     summary: Get agent memory context
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
 *         description: Agent memory context
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 memory:
 *                   type: object
 *                   properties:
 *                     userId:
 *                       type: string
 *                     sessionId:
 *                       type: string
 *                     conversationHistory:
 *                       type: array
 *                     entityMemory:
 *                       type: object
 *                     lastExecutionTime:
 *                       type: string
 *                     customContext:
 *                       type: object
 *                     executionState:
 *                       type: object
 *       404:
 *         description: Agent not found
 */
router.get('/:name/memory', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const agentOrchestrationService = AgentOrchestrationService.getInstance();
    const agent = await agentOrchestrationService.getAgent(name);

    if (!agent) {
      res.status(404).json({
        error: 'Agent not found',
        name
      });
      return;
    }

    res.json({
      memory: agent.memory || null,
      hasMemory: !!agent.memory
    });
    return;
  } catch (error) {
    logger.error('Error getting agent memory:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/{name}/memory:
 *   post:
 *     summary: Update agent memory context
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               memory:
 *                 type: object
 *                 properties:
 *                   userId:
 *                     type: string
 *                   sessionId:
 *                     type: string
 *                   conversationHistory:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         role:
 *                           type: string
 *                           enum: [user, agent, system]
 *                         content:
 *                           type: string
 *                         timestamp:
 *                           type: string
 *                           format: date-time
 *                   entityMemory:
 *                     type: object
 *                     description: Key-value pairs for entity memory
 *                   customContext:
 *                     type: object
 *                     description: Custom context data
 *                   executionState:
 *                     type: object
 *                     description: Current execution state
 *               operation:
 *                 type: string
 *                 enum: [replace, merge, append_conversation]
 *                 default: merge
 *                 description: How to update the memory
 *     responses:
 *       200:
 *         description: Memory updated successfully
 *       404:
 *         description: Agent not found
 */
router.post('/:name/memory', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const { memory, operation = 'merge' } = req.body;
    const agentOrchestrationService = AgentOrchestrationService.getInstance();
    
    const agent = await agentOrchestrationService.getAgent(name);
    if (!agent) {
      res.status(404).json({
        error: 'Agent not found',
        name
      });
      return;
    }

    let updatedMemory;
    
    switch (operation) {
      case 'replace':
        updatedMemory = memory;
        break;
      case 'append_conversation':
        updatedMemory = {
          ...agent.memory,
          conversationHistory: [
            ...(agent.memory?.conversationHistory || []),
            ...(memory.conversationHistory || [])
          ],
          lastExecutionTime: new Date().toISOString()
        };
        break;
      case 'merge':
      default:
        updatedMemory = {
          ...agent.memory,
          ...memory,
          conversationHistory: memory.conversationHistory || agent.memory?.conversationHistory || [],
          entityMemory: {
            ...agent.memory?.entityMemory,
            ...memory.entityMemory
          },
          customContext: {
            ...agent.memory?.customContext,
            ...memory.customContext
          },
          lastExecutionTime: new Date().toISOString()
        };
        break;
    }

    const updatedAgent = {
      ...agent,
      memory: updatedMemory
    };

    await agentOrchestrationService.storeAgent(updatedAgent);

    logger.info(`Updated memory for agent: ${name} (operation: ${operation})`);
    res.json({
      success: true,
      message: 'Agent memory updated successfully',
      agent: name,
      operation
    });
    return;
  } catch (error) {
    logger.error('Error updating agent memory:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/{name}/dependencies:
 *   get:
 *     summary: Get agent dependencies
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
 *         description: Agent dependencies
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dependencies:
 *                   type: array
 *                   items:
 *                     type: string
 *                 requires_database:
 *                   type: boolean
 *                 execution_target:
 *                   type: string
 *       404:
 *         description: Agent not found
 */
router.get('/:name/dependencies', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const agentOrchestrationService = AgentOrchestrationService.getInstance();
    const agent = await agentOrchestrationService.getAgent(name);

    if (!agent) {
      res.status(404).json({
        error: 'Agent not found',
        name
      });
      return;
    }

    res.json({
      dependencies: agent.dependencies || [],
      requires_database: agent.requires_database || false,
      execution_target: agent.execution_target || 'backend'
    });
    return;
  } catch (error) {
    logger.error('Error getting agent dependencies:', error as Error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
    return;
  }
});

/**
 * @swagger
 * /api/agents/{name}/dependencies:
 *   post:
 *     summary: Update agent dependencies
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dependencies:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of service dependencies
 *               requires_database:
 *                 type: boolean
 *                 description: Whether agent requires database access
 *               execution_target:
 *                 type: string
 *                 enum: [frontend, backend]
 *                 description: Where the agent should execute
 *               operation:
 *                 type: string
 *                 enum: [replace, add, remove]
 *                 default: replace
 *                 description: How to update dependencies
 *     responses:
 *       200:
 *         description: Dependencies updated successfully
 *       404:
 *         description: Agent not found
 */
router.post('/:name/dependencies', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const { dependencies, requires_database, execution_target, operation = 'replace' } = req.body;
    const agentOrchestrationService = AgentOrchestrationService.getInstance();
    
    const agent = await agentOrchestrationService.getAgent(name);
    if (!agent) {
      res.status(404).json({
        error: 'Agent not found',
        name
      });
      return;
    }

    let updatedDependencies = agent.dependencies || [];
    
    if (dependencies && Array.isArray(dependencies)) {
      switch (operation) {
        case 'add':
          updatedDependencies = [...new Set([...updatedDependencies, ...dependencies])];
          break;
        case 'remove':
          updatedDependencies = updatedDependencies.filter(dep => !dependencies.includes(dep));
          break;
        case 'replace':
        default:
          updatedDependencies = dependencies;
          break;
      }
    }

    const updatedAgent = {
      ...agent,
      dependencies: updatedDependencies,
      requires_database: requires_database !== undefined ? requires_database : agent.requires_database,
      execution_target: execution_target || agent.execution_target
    };

    await agentOrchestrationService.storeAgent(updatedAgent);

    logger.info(`Updated dependencies for agent: ${name} (operation: ${operation})`);
    res.json({
      success: true,
      message: 'Agent dependencies updated successfully',
      agent: name,
      dependencies: updatedDependencies,
      requires_database: updatedAgent.requires_database,
      execution_target: updatedAgent.execution_target
    });
    return;
  } catch (error) {
    logger.error('Error updating agent dependencies:', error as Error);
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
            latencyMs: 0,
            fromCache: false,
            timestamp: new Date().toISOString()
          };
        }
        break;
      case 'generate_agent':
        llmResponse = await llmOrchestratorService.processAgentGeneration(query, context);
        metadata = {
          provider: llmResponse.provider || 'unknown',
          latencyMs: llmResponse.latencyMs || 0,
          fromCache: llmResponse.fromCache || false,
          timestamp: new Date().toISOString()
        };
        break;
      case 'orchestrate':
        llmResponse = await llmOrchestratorService.processOrchestration(query, context);
        metadata = {
          provider: llmResponse.provider || 'unknown',
          latencyMs: llmResponse.latencyMs || 0,
          fromCache: llmResponse.fromCache || false,
          timestamp: new Date().toISOString()
        };
        break;
      case 'ask':
        llmResponse = await llmOrchestratorService.processAsk(query, context);
        metadata = {
          provider: llmResponse.provider || 'unknown',
          latencyMs: llmResponse.latencyMs || 0,
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
