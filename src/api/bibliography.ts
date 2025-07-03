/**
 * @swagger
 * tags:
 *   name: Bibliography
 *   description: Bibliography management and citation API
 */

import { Router, Request, Response, NextFunction } from 'express';
import expressAsyncHandler from '../utils/asyncHandler';
import { logger } from '../utils/logger';
import { authenticate, optionalAuth } from '../middleware/auth';

const router = Router();

// Apply authentication to all bibliography routes
router.use(authenticate);

/**
 * @swagger
 * components:
 *   schemas:
 *     BibliographyEntry:
 *       type: object
 *       required:
 *         - title
 *         - type
 *       properties:
 *         id:
 *           type: string
 *           description: Unique identifier
 *         title:
 *           type: string
 *           description: Title of the work
 *         authors:
 *           type: array
 *           items:
 *             type: string
 *           description: List of authors
 *         type:
 *           type: string
 *           enum: [book, article, website, journal, conference, thesis, report, other]
 *           description: Type of bibliography entry
 *         year:
 *           type: integer
 *           description: Publication year
 *         publisher:
 *           type: string
 *           description: Publisher name
 *         journal:
 *           type: string
 *           description: Journal name (for articles)
 *         volume:
 *           type: string
 *           description: Volume number
 *         issue:
 *           type: string
 *           description: Issue number
 *         pages:
 *           type: string
 *           description: Page range
 *         url:
 *           type: string
 *           description: URL or DOI
 *         abstract:
 *           type: string
 *           description: Abstract or summary
 *         keywords:
 *           type: array
 *           items:
 *             type: string
 *           description: Keywords or tags
 *         notes:
 *           type: string
 *           description: Personal notes
 *         projectId:
 *           type: string
 *           description: Associated project ID
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/bibliography:
 *   get:
 *     summary: Get all bibliography entries for authenticated user
 *     tags: [Bibliography]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema:
 *           type: string
 *         description: Filter by project ID
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [book, article, website, journal, conference, thesis, report, other]
 *         description: Filter by entry type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of entries to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of entries to skip
 *     responses:
 *       200:
 *         description: Bibliography entries retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entries:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BibliographyEntry'
 *                 total:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 offset:
 *                   type: integer
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.get('/', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { projectId, type, limit = 50, offset = 0 } = req.query;
  const userId = req.user?.id;

  try {
    // TODO: Implement database query
    // For now, return mock data structure
    const mockEntries = [
      {
        id: 'bib_1',
        title: 'The Art of Computer Programming',
        authors: ['Donald E. Knuth'],
        type: 'book',
        year: 1968,
        publisher: 'Addison-Wesley',
        keywords: ['algorithms', 'computer science'],
        projectId: projectId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    res.json({
      entries: mockEntries,
      total: mockEntries.length,
      limit: parseInt(String(limit)),
      offset: parseInt(String(offset))
    });

    logger.info('Bibliography entries retrieved', { userId, projectId, type });
  } catch (error) {
    logger.error('Error retrieving bibliography entries:', {
      error: error instanceof Error ? error.message : String(error),
      userId
    });
    res.status(500).json({ error: 'Failed to retrieve bibliography entries' });
  }
}));

/**
 * @swagger
 * /api/bibliography:
 *   post:
 *     summary: Create a new bibliography entry
 *     tags: [Bibliography]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BibliographyEntry'
 *     responses:
 *       201:
 *         description: Bibliography entry created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BibliographyEntry'
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.post('/', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { title, authors, type, year, publisher, journal, volume, issue, pages, url, abstract, keywords, notes, projectId } = req.body;
  const userId = req.user?.id;

  if (!title || !type) {
    res.status(400).json({ error: 'Title and type are required' });
    return;
  }

  try {
    // TODO: Implement database insertion
    const newEntry = {
      id: `bib_${Date.now()}`,
      title,
      authors: authors || [],
      type,
      year,
      publisher,
      journal,
      volume,
      issue,
      pages,
      url,
      abstract,
      keywords: keywords || [],
      notes,
      projectId,
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    res.status(201).json(newEntry);

    logger.info('Bibliography entry created', { userId, entryId: newEntry.id, title });
  } catch (error) {
    logger.error('Error creating bibliography entry:', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      title
    });
    res.status(500).json({ error: 'Failed to create bibliography entry' });
  }
}));

/**
 * @swagger
 * /api/bibliography/{id}:
 *   get:
 *     summary: Get a specific bibliography entry by ID
 *     tags: [Bibliography]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bibliography entry ID
 *     responses:
 *       200:
 *         description: Bibliography entry retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BibliographyEntry'
 *       404:
 *         description: Bibliography entry not found
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.get('/:id', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const userId = req.user?.id;

  try {
    // TODO: Implement database query
    // Mock response for now
    if (id === 'bib_1') {
      const entry = {
        id: 'bib_1',
        title: 'The Art of Computer Programming',
        authors: ['Donald E. Knuth'],
        type: 'book',
        year: 1968,
        publisher: 'Addison-Wesley',
        keywords: ['algorithms', 'computer science'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      res.json(entry);
    } else {
      res.status(404).json({ error: 'Bibliography entry not found' });
    }

    logger.info('Bibliography entry retrieved', { userId, entryId: id });
  } catch (error) {
    logger.error('Error retrieving bibliography entry:', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      entryId: id
    });
    res.status(500).json({ error: 'Failed to retrieve bibliography entry' });
  }
}));

/**
 * @swagger
 * /api/bibliography/{id}:
 *   put:
 *     summary: Update a bibliography entry
 *     tags: [Bibliography]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bibliography entry ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BibliographyEntry'
 *     responses:
 *       200:
 *         description: Bibliography entry updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BibliographyEntry'
 *       404:
 *         description: Bibliography entry not found
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.put('/:id', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const updateData = req.body;
  const userId = req.user?.id;

  try {
    // TODO: Implement database update
    const updatedEntry = {
      id,
      ...updateData,
      updatedAt: new Date().toISOString()
    };

    res.json(updatedEntry);

    logger.info('Bibliography entry updated', { userId, entryId: id });
  } catch (error) {
    logger.error('Error updating bibliography entry:', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      entryId: id
    });
    res.status(500).json({ error: 'Failed to update bibliography entry' });
  }
}));

/**
 * @swagger
 * /api/bibliography/{id}:
 *   delete:
 *     summary: Delete a bibliography entry
 *     tags: [Bibliography]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bibliography entry ID
 *     responses:
 *       200:
 *         description: Bibliography entry deleted successfully
 *       404:
 *         description: Bibliography entry not found
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.delete('/:id', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const userId = req.user?.id;

  try {
    // TODO: Implement database deletion
    res.json({ message: 'Bibliography entry deleted successfully', id });

    logger.info('Bibliography entry deleted', { userId, entryId: id });
  } catch (error) {
    logger.error('Error deleting bibliography entry:', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      entryId: id
    });
    res.status(500).json({ error: 'Failed to delete bibliography entry' });
  }
}));

/**
 * @swagger
 * /api/bibliography/search:
 *   get:
 *     summary: Search bibliography entries
 *     tags: [Bibliography]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: fields
 *         schema:
 *           type: string
 *         description: Comma-separated fields to search (title,authors,abstract,keywords)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of results
 *     responses:
 *       200:
 *         description: Search results retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/BibliographyEntry'
 *                       - type: object
 *                         properties:
 *                           relevanceScore:
 *                             type: number
 *                             description: Search relevance score
 *                 query:
 *                   type: string
 *                 total:
 *                   type: integer
 *       400:
 *         description: Missing search query
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.get('/search', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { q, fields = 'title,authors,abstract,keywords', limit = 20 } = req.query;
  const userId = req.user?.id;

  if (!q) {
    res.status(400).json({ error: 'Search query (q) is required' });
    return;
  }

  try {
    // TODO: Implement semantic search using vector database
    // For now, return mock search results
    const mockResults = [
      {
        id: 'bib_1',
        title: 'The Art of Computer Programming',
        authors: ['Donald E. Knuth'],
        type: 'book',
        year: 1968,
        publisher: 'Addison-Wesley',
        keywords: ['algorithms', 'computer science'],
        relevanceScore: 0.95,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    res.json({
      results: mockResults,
      query: String(q),
      total: mockResults.length,
      fields: String(fields).split(',')
    });

    logger.info('Bibliography search performed', { userId, query: q, resultsCount: mockResults.length });
  } catch (error) {
    logger.error('Error searching bibliography:', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      query: q
    });
    res.status(500).json({ error: 'Failed to search bibliography' });
  }
}));

/**
 * @swagger
 * /api/bibliography/{id}/citation:
 *   get:
 *     summary: Generate citation for a bibliography entry
 *     tags: [Bibliography]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bibliography entry ID
 *       - in: query
 *         name: style
 *         schema:
 *           type: string
 *           enum: [apa, mla, chicago, harvard, ieee]
 *           default: apa
 *         description: Citation style
 *     responses:
 *       200:
 *         description: Citation generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 citation:
 *                   type: string
 *                   description: Formatted citation
 *                 style:
 *                   type: string
 *                   description: Citation style used
 *                 entryId:
 *                   type: string
 *                   description: Bibliography entry ID
 *       404:
 *         description: Bibliography entry not found
 *       401:
 *         description: Authentication required
 *       500:
 *         description: Server error
 */
router.get('/:id/citation', expressAsyncHandler(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { id } = req.params;
  const { style = 'apa' } = req.query;
  const userId = req.user?.id;

  try {
    // TODO: Implement citation generation logic
    // Mock citation for now
    const mockCitation = `Knuth, D. E. (1968). The Art of Computer Programming. Addison-Wesley.`;

    res.json({
      citation: mockCitation,
      style: String(style),
      entryId: id
    });

    logger.info('Citation generated', { userId, entryId: id, style });
  } catch (error) {
    logger.error('Error generating citation:', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      entryId: id,
      style
    });
    res.status(500).json({ error: 'Failed to generate citation' });
  }
}));

export default router;
