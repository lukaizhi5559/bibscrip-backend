/**
 * DropRegistry API Routes
 * Agent capability catalog and discovery endpoints
 * Phase 2: Production-ready Drop management for Thinkdrop AI
 */

import { Router, Request, Response } from 'express';
import { dropRegistryService, DropSearchCriteria } from '../services/dropRegistryService';
import { Agent } from '../services/agentOrchestrationService';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

/**
 * @swagger
 * /api/drops/search:
 *   post:
 *     summary: Search for Drops (Agents) based on criteria
 *     tags: [DropRegistry]
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
 *                 description: Search query for Drop name/description
 *                 example: "spotify automation"
 *               category:
 *                 type: string
 *                 enum: [automation, communication, data, ai, integration, utility]
 *                 description: Drop category filter
 *               capabilities:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Required capabilities
 *                 example: ["desktop_automation", "music_control"]
 *               executionTarget:
 *                 type: string
 *                 enum: [frontend, backend]
 *                 description: Where the Drop should execute
 *               requiresDatabase:
 *                 type: boolean
 *                 description: Whether Drop requires database access
 *               maxComplexity:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 description: Maximum complexity level
 *               minReliability:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 1
 *                 description: Minimum reliability score
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       agent:
 *                         $ref: '#/components/schemas/Agent'
 *                       score:
 *                         type: number
 *                       matchReasons:
 *                         type: array
 *                         items:
 *                           type: string
 *                       capabilities:
 *                         type: array
 *                         items:
 *                           type: object
 *                       confidence:
 *                         type: number
 *                 count:
 *                   type: number
 */
router.post('/search', authenticate, async (req: Request, res: Response) => {
  try {
    const criteria: DropSearchCriteria = req.body;
    
    logger.info('Drop search request:', criteria);
    
    const results = await dropRegistryService.searchDrops(criteria);
    
    res.json({
      success: true,
      data: results,
      count: results.length
    });
  } catch (error) {
    logger.error('Error searching Drops:', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to search Drops',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/drops/find-best:
 *   post:
 *     summary: Find the best Drop for a specific task
 *     tags: [DropRegistry]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - taskDescription
 *             properties:
 *               taskDescription:
 *                 type: string
 *                 description: Description of the task to find a Drop for
 *                 example: "I need to automatically open Spotify when I start my computer"
 *               context:
 *                 type: object
 *                 description: Additional context for Drop selection
 *     responses:
 *       200:
 *         description: Best Drop found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     agent:
 *                       $ref: '#/components/schemas/Agent'
 *                     score:
 *                       type: number
 *                     matchReasons:
 *                       type: array
 *                       items:
 *                         type: string
 *                     capabilities:
 *                       type: array
 *                       items:
 *                         type: object
 *                     confidence:
 *                       type: number
 *       404:
 *         description: No suitable Drop found
 */
router.post('/find-best', authenticate, async (req: Request, res: Response) => {
  try {
    const { taskDescription, context } = req.body;
    
    if (!taskDescription) {
      res.status(400).json({
        success: false,
        error: 'Task description is required'
      });
      return;
    }
    
    logger.info('Finding best Drop for task:', taskDescription);
    
    const result = await dropRegistryService.findBestDrop(taskDescription, context as Record<string, any>);
    
    if (result) {
      res.json({
        success: true,
        data: result
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'No suitable Drop found for the given task'
      });
    }
  } catch (error) {
    logger.error('Error finding best Drop:', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to find best Drop',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/drops/register:
 *   post:
 *     summary: Register a new Drop with capability analysis
 *     tags: [DropRegistry]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Agent'
 *     responses:
 *       201:
 *         description: Drop registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Agent'
 *       400:
 *         description: Invalid Drop data
 */
router.post('/register', authenticate, async (req: Request, res: Response) => {
  try {
    const agentData: Agent = req.body;
    
    // Validate required fields
    if (!agentData.name || !agentData.description || !agentData.code) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: name, description, code'
      });
      return;
    }
    
    logger.info('Registering new Drop:', { name: agentData.name });
    
    const registeredAgent = await dropRegistryService.registerDrop(agentData);
    
    res.status(201).json({
      success: true,
      data: registeredAgent
    });
  } catch (error) {
    logger.error('Error registering Drop:', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to register Drop',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/drops/stats:
 *   get:
 *     summary: Get Drop registry statistics
 *     tags: [DropRegistry]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Registry statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalDrops:
 *                       type: number
 *                     categoryCounts:
 *                       type: object
 *                       additionalProperties:
 *                         type: number
 *                     averageReliability:
 *                       type: number
 *                     mostUsedCapabilities:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           capability:
 *                             type: string
 *                           count:
 *                             type: number
 *                     recentlyAdded:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Agent'
 */
router.get('/stats', authenticate, async (req: Request, res: Response) => {
  try {
    logger.info('Getting Drop registry statistics');
    
    const stats = await dropRegistryService.getRegistryStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting Drop registry stats:', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to get registry statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/drops/health:
 *   get:
 *     summary: Health check for DropRegistry service
 *     tags: [DropRegistry]
 *     responses:
 *       200:
 *         description: Service health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                 service:
 *                   type: string
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    // Test database connection by getting stats
    await dropRegistryService.getRegistryStats();
    
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'drop-registry'
    });
  } catch (error) {
    logger.error('DropRegistry health check failed:', error as Error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'drop-registry',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
