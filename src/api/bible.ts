/**
 * @swagger
 * tags:
 *   name: Bible
 *   description: Bible verse and translation API
 */

import { Router, Request, Response, NextFunction } from 'express';
import expressAsyncHandler from '../utils/asyncHandler';
import { 
  getBibleVerse, 
  getBiblePassage, 
  getBibleChapter,
  getBibleChapters,
  getAvailableTranslations 
} from '../utils/bible';
import { logger } from '../utils/logger';
import { BibleVerseCache } from '../services/bibleVerseCache';

const router = Router();

/**
 * @swagger
 * /api/bible/verse:
 *   get:
 *     summary: Get a Bible verse by reference
 *     tags: [Bible]
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: The verse reference (e.g., "John 3:16")
 *       - in: query
 *         name: translation
 *         required: false
 *         schema:
 *           type: string
 *         description: The Bible translation abbreviation to use (default NIV)
 *     responses:
 *       200:
 *         description: Verse data successfully retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BibleVerse'
 *       400:
 *         description: Missing required parameters
 *       404:
 *         description: Verse not found
 *       500:
 *         description: Server error
 */
router.get('/verse', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { reference, translation = 'NIV' } = req.query;
  
  if (!reference) {
    res.status(400).json({ error: 'Reference parameter is required' });
    return;
  }
  
  try {
    const result = await getBibleVerse(String(reference), String(translation));
    
    if (!result) {
      res.status(404).json({ error: 'Verse not found' });
      return;
    }
    
    res.json(result);
  } catch (error) {
    logger.error('Error in Bible verse API:', { 
      errorMessage: error instanceof Error ? error.message : String(error),
      reference,
      translation
    });
    res.status(500).json({ error: 'Failed to retrieve Bible verse' });
  }
}));

/**
 * @swagger
 * /api/bible/passage:
 *   get:
 *     summary: Get a Bible passage (multiple verses)
 *     tags: [Bible]
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: The verse reference range (e.g., "John 3:16-18")
 *       - in: query
 *         name: translation
 *         required: false
 *         schema:
 *           type: string
 *         description: The Bible translation abbreviation to use (default NIV)
 *     responses:
 *       200:
 *         description: Passage data successfully retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reference:
 *                   type: string
 *                 text:
 *                   type: string
 *                 translation:
 *                   type: string
 *                 verses:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BibleVerse'
 *       400:
 *         description: Missing required parameters
 *       404:
 *         description: Passage not found
 *       500:
 *         description: Server error
 */
router.get('/passage', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { reference, translation = 'NIV' } = req.query;
  
  if (!reference) {
    res.status(400).json({ error: 'Reference parameter is required' });
    return;
  }
  
  try {
    const result = await getBiblePassage(String(reference), String(translation));
    
    if (!result) {
      res.status(404).json({ error: 'Passage not found' });
      return;
    }
    
    res.json(result);
  } catch (error) {
    logger.error('Error in Bible passage API:', { 
      errorMessage: error instanceof Error ? error.message : String(error),
      reference,
      translation
    });
    res.status(500).json({ error: 'Failed to retrieve Bible passage' });
  }
}));

/**
 * @swagger
 * /api/bible/chapter/{book}/{chapter}:
 *   get:
 *     summary: Get an entire Bible chapter
 *     tags: [Bible]
 *     parameters:
 *       - in: path
 *         name: book
 *         required: true
 *         schema:
 *           type: string
 *         description: The book name (e.g., "John" or "1John")
 *       - in: path
 *         name: chapter
 *         required: true
 *         schema:
 *           type: integer
 *         description: The chapter number
 *       - in: query
 *         name: translation
 *         required: false
 *         schema:
 *           type: string
 *         description: The Bible translation abbreviation to use (default NIV)
 *     responses:
 *       200:
 *         description: Chapter data successfully retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reference:
 *                   type: string
 *                   example: "John 3"
 *                 translation:
 *                   type: string
 *                   example: "NIV"
 *                 translationName:
 *                   type: string
 *                   example: "New International Version"
 *                 book:
 *                   type: string
 *                   example: "John"
 *                 chapter:
 *                   type: integer
 *                   example: 3
 *                 verses:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BibleVerse'
 *                 copyright:
 *                   type: string
 *       400:
 *         description: Missing required parameters
 *       404:
 *         description: Chapter not found
 *       500:
 *         description: Server error
 */
router.get('/chapter/:book/:chapter', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { book, chapter } = req.params;
  const { translation = 'NIV' } = req.query;
  
  if (!book || !chapter) {
    res.status(400).json({ error: 'Book and chapter parameters are required' });
    return;
  }
  
  try {
    const result = await getBibleChapter(book, parseInt(chapter, 10), String(translation));
    
    if (!result) {
      res.status(404).json({ error: 'Chapter not found' });
      return;
    }
    
    res.json(result);
  } catch (error) {
    logger.error('Error in Bible chapter API:', { 
      errorMessage: error instanceof Error ? error.message : String(error),
      book,
      chapter,
      translation
    });
    res.status(500).json({ error: 'Failed to retrieve Bible chapter' });
  }
}));

/**
 * @route GET /api/bible/chapters/:book/:startChapter/:endChapter
 * @description Get multiple Bible chapters
 * @param {string} book - The book name (e.g., "Psalms")
 * @param {number} startChapter - The starting chapter number
 * @param {number} endChapter - The ending chapter number
 * @param {string} translation - The Bible translation to use (default: NIV)
 * @returns {Object} The Bible chapters data
 */
router.get('/chapters/:book/:startChapter/:endChapter', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { book, startChapter, endChapter } = req.params;
  const { translation = 'NIV' } = req.query;
  
  if (!book || !startChapter || !endChapter) {
    res.status(400).json({ error: 'Book, startChapter, and endChapter parameters are required' });
    return;
  }
  
  try {
    const result = await getBibleChapters(
      book, 
      parseInt(startChapter, 10), 
      parseInt(endChapter, 10), 
      String(translation)
    );
    
    if (!result) {
      res.status(404).json({ error: 'Chapters not found' });
      return;
    }
    
    res.json(result);
  } catch (error) {
    logger.error('Error in Bible chapters API:', { 
      errorMessage: error instanceof Error ? error.message : String(error),
      book,
      startChapter,
      endChapter,
      translation
    });
    res.status(500).json({ error: 'Failed to retrieve Bible chapters' });
  }
}));

/**
 * @swagger
 * /api/bible/translations:
 *   get:
 *     summary: Get available Bible translations with detailed information
 *     tags: [Bible]
 *     responses:
 *       200:
 *         description: Successfully retrieved list of Bible translations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                   description: Number of translations available
 *                 translations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TranslationInfo'
 *       404:
 *         description: No translations found
 *       500:
 *         description: Server error retrieving translations
 */
router.get('/translations', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const translations = await getAvailableTranslations();
    
    if (!translations || translations.length === 0) {
      res.status(404).json({ error: 'No translations found' });
      return;
    }
    
    // Return detailed translation information
    res.json({
      count: translations.length,
      translations: translations.map(t => ({
        id: t.id,
        name: t.name,
        abbreviation: t.abbreviation,
        language: t.language,
        description: t.description
      }))
    });
  } catch (error) {
    logger.error('Error in Bible translations API:', { 
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({ error: 'Failed to retrieve Bible translations' });
  }
}));

/**
 * @swagger
 * /api/bible/translations/abbreviations:
 *   get:
 *     summary: Get a simplified list of available Bible translation abbreviations
 *     tags: [Bible]
 *     responses:
 *       200:
 *         description: Successfully retrieved list of Bible translation abbreviations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                   description: Number of available translations with abbreviations
 *                 abbreviations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       abbreviation:
 *                         type: string
 *                         example: 'NIV'
 *                         description: Short form abbreviation of the translation
 *                       id:
 *                         type: string
 *                         description: Scripture API Bible ID for this translation
 *                       name:
 *                         type: string
 *                         description: Full name of the translation
 *                       language:
 *                         type: string
 *                         description: Language code
 *       404:
 *         description: No translations found
 *       500:
 *         description: Server error retrieving translations
 */
router.get('/translations/abbreviations', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const translations = await getAvailableTranslations();
    
    if (!translations || translations.length === 0) {
      res.status(404).json({ error: 'No translations found' });
      return;
    }
    
    // Return only the abbreviation information in a condensed format
    const abbreviations = translations
      .filter(t => t.abbreviation) // Only include translations with abbreviations
      .map(t => ({
        abbreviation: t.abbreviation,
        id: t.id,
        name: t.name,
        language: t.language
      }));
    
    res.json({
      count: abbreviations.length,
      abbreviations
    });
  } catch (error) {
    logger.error('Error in Bible abbreviations API:', { 
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({ error: 'Failed to retrieve Bible translation abbreviations' });
  }
}));

/**
 * @route GET /api/bible/cache/stats
 * @description Get Bible API usage statistics
 * @returns {Object} Cache and API usage statistics
 */
router.get('/cache/stats', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const redis = await import('../config/redis').then(m => m.getRedisClient());
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const dailyKey = `bible:api:daily_counter:${timestamp}`;
    
    // Get API calls for today
    const apiCallsToday = await redis.get(dailyKey);
    const apiUsage = apiCallsToday ? parseInt(apiCallsToday, 10) : 0;
    
    // Get cache keys count (approximate)
    const cacheKeys = await redis.keys('bible:verse:*');
    
    const stats = {
      apiUsage: {
        today: apiUsage,
        limit: 5000,
        percentUsed: (apiUsage / 5000 * 100).toFixed(2) + '%'
      },
      cache: {
        entries: cacheKeys.length,
        ttl: '30 days'
      },
      timestamp: new Date().toISOString()
    };
    
    res.json(stats);
  } catch (error) {
    logger.error('Error getting Bible cache stats:', { 
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({ error: 'Failed to retrieve cache statistics' });
  }
}));

/**
 * @route POST /api/bible/cache/clear
 * @description Clear Bible verse cache
 * @returns {Object} Result of the cache clear operation
 */
router.post('/cache/clear', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const redis = await import('../config/redis').then(m => m.getRedisClient());
    
    // Find all Bible verse cache keys
    const cacheKeys = await redis.keys('bible:verse:*');
    
    // Delete each key
    let deletedCount = 0;
    if (cacheKeys.length > 0) {
      deletedCount = await redis.del(...cacheKeys);
    }
    
    res.json({ 
      success: true, 
      message: `Cleared ${deletedCount} Bible verse cache entries`,
      clearedEntries: deletedCount
    });
  } catch (error) {
    logger.error('Error clearing Bible verse cache:', { 
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({ error: 'Failed to clear cache' });
  }
}));

export default router;
