/**
 * AI Memory REST API Routes
 * Provides endpoints for managing AI memory operations
 */

import express from 'express';
import { aiMemoryService } from '../services/aiMemoryService';
import { authenticateJWT } from '../middleware/auth';
import { logger } from '../utils/logger';
import {
  CreateAIMemoryRequest,
  UpdateAIMemoryRequest,
  AIMemorySearchResult,
  AIMemoryFilter
} from '../types/aiMemory';

const router = express.Router();

/**
 * POST /api/memory
 * Create a new AI memory entry
 */
router.post('/', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    const createRequest: CreateAIMemoryRequest = {
      ...req.body,
      user_id: userId
    };
    const result = await aiMemoryService.createMemory(createRequest);

    logger.info('AI memory created via REST API', {
      userId,
      memoryId: result.memory.id,
      memoryType: result.memory.type
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error('Failed to create AI memory:', error as any);
    res.status(500).json({ 
      error: 'Failed to create memory',
      message: (error as any)?.message 
    });
  }
});

/**
 * GET /api/memory/:id
 * Retrieve a specific AI memory by ID
 */
router.get('/:id', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    const memoryId = req.params.id;
    const memory = await aiMemoryService.getMemoryById(memoryId);

    if (!memory) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }

    res.json(memory);
  } catch (error) {
    logger.error('Failed to retrieve AI memory:', error as any);
    res.status(500).json({ 
      error: 'Failed to retrieve memory',
      message: (error as any)?.message 
    });
  }
});

/**
 * PUT /api/memory/:id
 * Update an existing AI memory
 */
router.put('/:id', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    const memoryId = req.params.id;
    const updateRequest: UpdateAIMemoryRequest = req.body;
    
    const result = await aiMemoryService.updateMemory(memoryId, updateRequest);

    if (!result) {
      res.status(404).json({ error: 'Memory not found or unauthorized' });
      return;
    }

    logger.info('AI memory updated via REST API', {
      userId,
      memoryId,
      memoryType: result.type
    });

    res.json(result);
  } catch (error) {
    logger.error('Failed to update AI memory:', error as any);
    res.status(500).json({ 
      error: 'Failed to update memory',
      message: (error as any)?.message 
    });
  }
});

/**
 * DELETE /api/memory/:id
 * Delete an AI memory
 */
router.delete('/:id', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    const memoryId = req.params.id;
    const deleted = await aiMemoryService.deleteMemory(memoryId);

    if (!deleted) {
      res.status(404).json({ error: 'Memory not found or access denied' });
      return;
    }

    logger.info('AI memory deleted via REST API', {
      userId,
      memoryId
    });

    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete AI memory:', error as any);
    res.status(500).json({ 
      error: 'Failed to delete memory',
      message: (error as any)?.message 
    });
  }
});

/**
 * POST /api/memory/search
 * Search AI memories with filters and full-text search
 */
router.post('/search', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    const searchRequest: AIMemoryFilter = req.body;
    const results = await aiMemoryService.searchMemories(searchRequest);

    logger.info('AI memory search performed via REST API', {
      userId,
      resultsCount: results.memories.length,
      totalCount: results.total_count,
      search: searchRequest.search
    });

    res.json(results);
  } catch (error) {
    logger.error('Failed to search AI memories:', error as any);
    res.status(500).json({ 
      error: 'Failed to search memories',
      message: (error as any)?.message 
    });
  }
});

/**
 * GET /api/memory/user/insights
 * Get user memory insights and analytics
 */
router.get('/user/insights', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    const insights = await aiMemoryService.getUserMemoryInsights(userId);

    res.json(insights);
  } catch (error) {
    logger.error('Failed to get user memory insights:', error as any);
    res.status(500).json({ 
      error: 'Failed to get insights',
      message: (error as any)?.message 
    });
  }
});

/**
 * POST /api/memory/context
 * Get memory-enriched context for AI prompt enhancement
 */
router.post('/context', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    const { query, limit = 10 } = req.body;
    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const context = await aiMemoryService.getMemoryEnrichedContext(userId, query, limit);

    res.json(context);
  } catch (error) {
    logger.error('Failed to get memory-enriched context:', error as any);
    res.status(500).json({ 
      error: 'Failed to get context',
      message: (error as any)?.message 
    });
  }
});

/**
 * GET /api/memory/stats
 * Get AI memory system statistics
 */
router.get('/stats', authenticateJWT, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    // Get user-specific memory stats
    const searchFilter: AIMemoryFilter = {
      user_id: userId,
      limit: 1 // We just want the count
    };
    
    const results = await aiMemoryService.searchMemories(searchFilter);
    const insights = await aiMemoryService.getUserMemoryInsights(userId);

    const stats = {
      totalMemories: results.total_count,
      insights: insights,
      lastUpdated: new Date().toISOString()
    };

    res.json(stats);
  } catch (error) {
    logger.error('Failed to get AI memory stats:', error as any);
    res.status(500).json({ 
      error: 'Failed to get stats',
      message: (error as any)?.message 
    });
  }
});

export default router;
