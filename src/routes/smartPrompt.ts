/**
 * Smart Prompt Builder REST API Routes
 * Provides endpoints for intelligent prompt building with multi-intent classification
 */

import express from 'express';
import { smartPromptBuilder } from '../services/smartPromptBuilder';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = express.Router();

/**
 * POST /api/smart-prompt/build
 * Build an intelligent prompt with multi-intent classification and dynamic RAG weighting
 */
router.post('/build', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    const { message, useSemanticCache = true } = req.body;
    
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required and must be a string' });
      return;
    }

    logger.info('Building smart prompt via REST API', {
      userId,
      messageLength: message.length,
      useSemanticCache
    });

    const result = await smartPromptBuilder.buildSmartPrompt(message, {
      userId,
      useSemanticCache,
      useVectorSearch: true,
      maxContextDocuments: 10,
      hybridSearchWeight: { semantic: 0.7, lexical: 0.3 }
    });

    logger.info('Smart prompt built successfully via REST API', {
      userId,
      primaryIntent: result.intentClassification.primaryIntent,
      complexity: result.complexityAnalysis.level,
      memoryMatches: result.memoryMatches.length,
      processingTime: result.processingTime,
      cacheStatus: result.cacheStatus
    });

    res.json(result);
  } catch (error) {
    logger.error('Failed to build smart prompt:', error as any);
    res.status(500).json({ 
      error: 'Failed to build smart prompt',
      message: (error as any)?.message 
    });
  }
});

/**
 * POST /api/smart-prompt/analyze
 * Analyze message complexity and intent without full prompt building
 */
router.post('/analyze', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    const { message } = req.body;
    
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required and must be a string' });
      return;
    }

    // Build smart prompt to get analysis (we could optimize this later to only do analysis)
    const result = await smartPromptBuilder.buildSmartPrompt(message, {
      userId,
      useSemanticCache: false, // Skip cache for analysis-only requests
      useVectorSearch: true,
      maxContextDocuments: 5, // Fewer docs for analysis
      hybridSearchWeight: { semantic: 0.7, lexical: 0.3 }
    });

    // Return only analysis data
    const analysis = {
      intentClassification: result.intentClassification,
      complexityAnalysis: result.complexityAnalysis,
      ragWeighting: result.ragWeighting,
      processingTime: result.processingTime
    };

    logger.info('Message analysis completed via REST API', {
      userId,
      primaryIntent: result.intentClassification.primaryIntent,
      complexity: result.complexityAnalysis.level,
      processingTime: result.processingTime
    });

    res.json(analysis);
  } catch (error) {
    logger.error('Failed to analyze message:', error as any);
    res.status(500).json({ 
      error: 'Failed to analyze message',
      message: (error as any)?.message 
    });
  }
});

/**
 * POST /api/smart-prompt/memory-search
 * Perform hybrid memory search for a given query
 */
router.post('/memory-search', authenticate, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'User ID required' });
      return;
    }

    const { query, limit = 10 } = req.body;
    
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Query is required and must be a string' });
      return;
    }

    // Build smart prompt to get memory search results
    const result = await smartPromptBuilder.buildSmartPrompt(query, {
      userId,
      useSemanticCache: false,
      useVectorSearch: true,
      maxContextDocuments: 15, // More docs for memory search
      hybridSearchWeight: { semantic: 0.6, lexical: 0.4 } // More lexical weight for search
    });

    // Return memory search results
    const memorySearchResult = {
      memoryMatches: result.memoryMatches,
      intentClassification: result.intentClassification,
      processingTime: result.processingTime
    };

    logger.info('Memory search completed via REST API', {
      userId,
      queryLength: query.length,
      matchesFound: result.memoryMatches.length,
      processingTime: result.processingTime
    });

    res.json(memorySearchResult);
  } catch (error) {
    logger.error('Failed to perform memory search:', error as any);
    res.status(500).json({ 
      error: 'Failed to perform memory search',
      message: (error as any)?.message 
    });
  }
});

export default router;
