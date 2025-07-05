// User Memory API Endpoints for Thinkdrop AI Personal Intelligence Layer
import { Router } from 'express';
import { Pool } from 'pg';
import { UserMemoryService } from '../services/userMemoryService';
import { authenticateAPIKey } from '../middleware/auth';
import pool from '../config/postgres';
import {
  CreateUserRequest,
  UpdateUserRequest,
  CreateUserMemoryRequest,
  UpdateUserMemoryRequest,
  CreateUserAgentRequest,
  UpdateUserAgentRequest,
  UserMemoryFilter
} from '../types/userMemory';

const router = Router();

// Initialize UserMemoryService with shared database pool
const userMemoryService = new UserMemoryService(pool);

// Apply API key authentication to all routes
router.use(authenticateAPIKey);

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               name:
 *                 type: string
 *               preferences:
 *                 type: object
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Invalid request data
 *       409:
 *         description: User already exists
 */
router.post('/', async (req: any, res: any) => {
  try {
    const userData: CreateUserRequest = req.body;
    
    // Check if user already exists
    const existingUser = await userMemoryService.getUserByEmail(userData.email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User already exists with this email'
      });
    }

    const user = await userMemoryService.createUser(userData);
    
    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user'
    });
  }
});

/**
 * @swagger
 * /api/users/{userId}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *       404:
 *         description: User not found
 */
router.get('/:userId', async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    const user = await userMemoryService.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error retrieving user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user'
    });
  }
});

/**
 * @swagger
 * /api/users/email/{email}:
 *   get:
 *     summary: Get user by email
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *       404:
 *         description: User not found
 */
router.get('/email/:email', async (req: any, res: any) => {
  try {
    const { email } = req.params;
    const user = await userMemoryService.getUserByEmail(decodeURIComponent(email));
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error retrieving user by email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user'
    });
  }
});

/**
 * @swagger
 * /api/users/{userId}:
 *   put:
 *     summary: Update user
 *     tags: [Users]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               preferences:
 *                 type: object
 *               metadata:
 *                 type: object
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User updated successfully
 *       404:
 *         description: User not found
 */
router.put('/:userId', async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    const updates: UpdateUserRequest = req.body;
    
    const user = await userMemoryService.updateUser(userId, updates);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user'
    });
  }
});

// ===== USER MEMORY ENDPOINTS =====

/**
 * @swagger
 * /api/users/{userId}/memories:
 *   post:
 *     summary: Create or update user memory
 *     tags: [User Memories]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - memory_type
 *               - key
 *               - value
 *             properties:
 *               memory_type:
 *                 type: string
 *                 enum: [reminder, preference, belief, habit, verse, prayer, goal, context]
 *               key:
 *                 type: string
 *               value:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Memory created/updated successfully
 */
router.post('/:userId/memories', async (req, res) => {
  try {
    const { userId } = req.params;
    const memoryData: CreateUserMemoryRequest = req.body;
    
    const memory = await userMemoryService.createUserMemory(userId, memoryData);
    
    res.status(201).json({
      success: true,
      data: memory
    });
  } catch (error) {
    console.error('Error creating user memory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user memory'
    });
  }
});

/**
 * @swagger
 * /api/users/{userId}/memories:
 *   get:
 *     summary: Get user memories with optional filtering
 *     tags: [User Memories]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: memory_type
 *         schema:
 *           type: string
 *           enum: [reminder, preference, belief, habit, verse, prayer, goal, context]
 *       - in: query
 *         name: key
 *         schema:
 *           type: string
 *       - in: query
 *         name: is_active
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Memories retrieved successfully
 */
router.get('/:userId/memories', async (req, res) => {
  try {
    const { userId } = req.params;
    const filter: UserMemoryFilter = {
      memory_type: req.query.memory_type as any,
      key: req.query.key as string,
      is_active: req.query.is_active ? req.query.is_active === 'true' : undefined,
      search: req.query.search as string
    };
    
    const memories = await userMemoryService.getUserMemories(userId, filter);
    
    res.json({
      success: true,
      data: memories,
      count: memories.length
    });
  } catch (error) {
    console.error('Error retrieving user memories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user memories'
    });
  }
});

/**
 * @swagger
 * /api/users/{userId}/memories/{memoryId}:
 *   put:
 *     summary: Update user memory
 *     tags: [User Memories]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: memoryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               value:
 *                 type: string
 *               metadata:
 *                 type: object
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Memory updated successfully
 *       404:
 *         description: Memory not found
 */
router.put('/:userId/memories/:memoryId', async (req: any, res: any) => {
  try {
    const { userId, memoryId } = req.params;
    const updates: UpdateUserMemoryRequest = req.body;
    
    const memory = await userMemoryService.updateUserMemory(userId, memoryId, updates);
    
    if (!memory) {
      return res.status(404).json({
        success: false,
        error: 'Memory not found'
      });
    }

    res.json({
      success: true,
      data: memory
    });
  } catch (error) {
    console.error('Error updating user memory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user memory'
    });
  }
});

/**
 * @swagger
 * /api/users/{userId}/memories/{memoryId}:
 *   delete:
 *     summary: Delete user memory
 *     tags: [User Memories]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: memoryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Memory deleted successfully
 *       404:
 *         description: Memory not found
 */
router.get('/:userId/memories/:memoryId', async (req: any, res: any) => {
  try {
    const { userId, memoryId } = req.params;
    
    const deleted = await userMemoryService.deleteUserMemory(userId, memoryId);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Memory not found'
      });
    }

    res.json({
      success: true,
      message: 'Memory deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user memory:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user memory'
    });
  }
});

// ===== USER-AGENT ASSOCIATION ENDPOINTS =====

/**
 * @swagger
 * /api/users/{userId}/agents:
 *   post:
 *     summary: Associate agent with user
 *     tags: [User Agents]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agent_id
 *             properties:
 *               agent_id:
 *                 type: string
 *                 format: uuid
 *               alias:
 *                 type: string
 *               config:
 *                 type: object
 *     responses:
 *       201:
 *         description: User-agent association created successfully
 */
router.post('/:userId/agents', async (req, res) => {
  try {
    const { userId } = req.params;
    const agentData: CreateUserAgentRequest = req.body;
    
    const userAgent = await userMemoryService.createUserAgent(userId, agentData);
    
    res.status(201).json({
      success: true,
      data: userAgent
    });
  } catch (error) {
    console.error('Error creating user-agent association:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user-agent association'
    });
  }
});

/**
 * @swagger
 * /api/users/{userId}/agents:
 *   get:
 *     summary: Get user's associated agents
 *     tags: [User Agents]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: active_only
 *         schema:
 *           type: boolean
 *           default: true
 *     responses:
 *       200:
 *         description: User agents retrieved successfully
 */
router.get('/:userId/agents', async (req, res) => {
  try {
    const { userId } = req.params;
    const activeOnly = req.query.active_only !== 'false';
    
    const userAgents = await userMemoryService.getUserAgents(userId, activeOnly);
    
    res.json({
      success: true,
      data: userAgents,
      count: userAgents.length
    });
  } catch (error) {
    console.error('Error retrieving user agents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve user agents'
    });
  }
});

/**
 * @swagger
 * /api/users/{userId}/context:
 *   get:
 *     summary: Get enriched user context for AI prompt enhancement
 *     tags: [User Context]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: User context retrieved successfully
 *       404:
 *         description: User not found
 */
router.get('/:userId/context', async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    
    const userContext = await userMemoryService.getUserContext(userId);
    
    res.json({
      success: true,
      data: userContext
    });
  } catch (error: any) {
    console.error('Error retrieving user context:', error);
    if (error?.message?.includes('User not found')) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve user context'
      });
    }
  }
});

/**
 * @swagger
 * /api/users/{userId}/enrich-prompt:
 *   post:
 *     summary: Enrich prompt with user context and memories
 *     tags: [User Context]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *     responses:
 *       200:
 *         description: Prompt enriched successfully
 *       404:
 *         description: User not found
 */
router.post('/:userId/enrich-prompt', async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }
    
    const enrichedPrompt = await userMemoryService.enrichPromptWithUserContext(userId, prompt);
    
    res.json({
      success: true,
      data: enrichedPrompt
    });
  } catch (error: any) {
    console.error('Error enriching prompt:', error);
    if (error?.message?.includes('User not found')) {
      res.status(404).json({
        success: false,
        error: 'User not found'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to enrich prompt'
      });
    }
  }
});

export default router;
