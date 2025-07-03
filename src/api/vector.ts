import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { vectorDbService } from '../services/vectorDbService';
import { NAMESPACE } from '../config/vectorDb';
import { logger } from '../utils';

const router = Router();

/**
 * @swagger
 * /api/vector/store:
 *   post:
 *     summary: Store document in vector database
 *     tags: [Vector Database]
 *     description: Store a single document with text content and metadata in the vector database for semantic search
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - text
 *             properties:
 *               text:
 *                 type: string
 *                 description: Text content to store and index
 *                 example: "For God so loved the world that he gave his one and only Son"
 *               metadata:
 *                 type: object
 *                 description: Additional metadata to associate with the document
 *                 example: { "reference": "John 3:16", "translation": "NIV" }
 *               namespace:
 *                 type: string
 *                 description: Vector database namespace
 *                 example: "bible_verses"
 *                 default: "bible_verses"
 *     responses:
 *       201:
 *         description: Document stored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: Generated document ID
 *                       example: "doc_12345"
 *                     namespace:
 *                       type: string
 *                       example: "bible_verses"
 *       400:
 *         description: Invalid request - text content required
 *       500:
 *         description: Failed to store document
 */
router.post('/store', asyncHandler(async (req: Request, res: Response) => {
  const { text, metadata = {}, namespace = NAMESPACE.BIBLE_VERSES } = req.body;
  
  if (!text) {
    res.status(400).json({ 
      success: false, 
      error: 'Text content is required' 
    });
  }
  
  try {
    // Store document in vector database
    const id = await vectorDbService.storeDocument({ text, metadata }, namespace);
    
    res.status(201).json({
      success: true,
      data: { id, namespace }
    });
  } catch (error: any) {
    logger.error('Error storing document in vector database', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to store document',
      message: error.message
    });
  }
}));

/**
 * @swagger
 * /api/vector/batch:
 *   post:
 *     summary: Store multiple documents in vector database
 *     tags: [Vector Database]
 *     description: Batch store multiple documents with text content and metadata in the vector database
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documents
 *             properties:
 *               documents:
 *                 type: array
 *                 description: Array of documents to store
 *                 items:
 *                   type: object
 *                   required:
 *                     - text
 *                   properties:
 *                     text:
 *                       type: string
 *                       description: Text content to store
 *                       example: "In the beginning was the Word"
 *                     metadata:
 *                       type: object
 *                       description: Document metadata
 *                       example: { "reference": "John 1:1" }
 *               namespace:
 *                 type: string
 *                 description: Vector database namespace
 *                 default: "bible_verses"
 *     responses:
 *       201:
 *         description: Documents stored successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: number
 *                       description: Number of documents stored
 *                       example: 5
 *                     ids:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Generated document IDs
 *                     namespace:
 *                       type: string
 *       400:
 *         description: Invalid request - documents array required or invalid documents
 *       500:
 *         description: Failed to store batch documents
 */
router.post('/batch', asyncHandler(async (req: Request, res: Response) => {
  const { documents, namespace = NAMESPACE.BIBLE_VERSES } = req.body;
  
  if (!documents || !Array.isArray(documents) || documents.length === 0) {
    res.status(400).json({ 
      success: false, 
      error: 'Valid documents array is required' 
    });
  }
  
  // Validate each document has text
  interface Document {
    text: string;
    metadata?: Record<string, any>;
  }
  
  const invalidDocs = documents.filter((doc: Document) => !doc.text);
  if (invalidDocs.length > 0) {
    res.status(400).json({
      success: false,
      error: 'All documents must have text content',
      invalidCount: invalidDocs.length
    });
  }
  
  try {
    // Store batch of documents
    const ids = await vectorDbService.storeBatchDocuments(documents, namespace);
    
    res.status(201).json({
      success: true,
      data: { 
        count: ids.length,
        ids,
        namespace
      }
    });
  } catch (error: any) {
    logger.error('Error storing batch documents in vector database', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to store batch documents',
      message: error.message
    });
  }
}));

/**
 * @swagger
 * /api/vector/search:
 *   post:
 *     summary: Search for similar documents
 *     tags: [Vector Database]
 *     description: Perform semantic search to find documents similar to the query text
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: Search query text
 *                 example: "love and forgiveness"
 *               namespace:
 *                 type: string
 *                 description: Vector database namespace to search
 *                 default: "bible_verses"
 *               topK:
 *                 type: number
 *                 description: Maximum number of results to return
 *                 example: 5
 *                 default: 5
 *                 minimum: 1
 *                 maximum: 100
 *               minScore:
 *                 type: number
 *                 description: Minimum similarity score threshold
 *                 example: 0.7
 *                 default: 0.7
 *                 minimum: 0
 *                 maximum: 1
 *     responses:
 *       200:
 *         description: Search completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: number
 *                       description: Number of results found
 *                       example: 3
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           score:
 *                             type: number
 *                             description: Similarity score (0-1)
 *                           text:
 *                             type: string
 *                           metadata:
 *                             type: object
 *                     namespace:
 *                       type: string
 *       400:
 *         description: Invalid request - search query required
 *       500:
 *         description: Failed to search for similar documents
 */
router.post('/search', asyncHandler(async (req: Request, res: Response) => {
  const { 
    query,
    namespace = NAMESPACE.BIBLE_VERSES,
    topK = 5,
    minScore = 0.7
  } = req.body;
  
  if (!query) {
    res.status(400).json({ 
      success: false, 
      error: 'Search query is required' 
    });
  }
  
  try {
    // Search for similar documents
    const results = await vectorDbService.searchSimilar(query, namespace, topK, minScore);
    
    res.json({
      success: true,
      data: {
        count: results.length,
        results,
        namespace
      }
    });
  } catch (error: any) {
    logger.error('Error searching vector database', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to search for similar documents',
      message: error.message
    });
  }
}));

/**
 * @swagger
 * /api/vector/{id}:
 *   delete:
 *     summary: Delete document from vector database
 *     tags: [Vector Database]
 *     description: Delete a specific document from the vector database by its ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID to delete
 *         example: "doc_12345"
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               namespace:
 *                 type: string
 *                 description: Vector database namespace
 *                 default: "bible_verses"
 *     responses:
 *       200:
 *         description: Document deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "doc_12345"
 *                     namespace:
 *                       type: string
 *       500:
 *         description: Failed to delete document
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { namespace = NAMESPACE.BIBLE_VERSES } = req.body;
  
  try {
    // Delete document from vector database
    await vectorDbService.deleteDocuments([id], namespace);
    
    res.json({
      success: true,
      data: { id, namespace }
    });
  } catch (error: any) {
    logger.error('Error deleting document from vector database', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to delete document',
      message: error.message
    });
  }
}));

/**
 * @swagger
 * /api/vector/batch:
 *   delete:
 *     summary: Delete multiple documents from vector database
 *     tags: [Vector Database]
 *     description: Batch delete multiple documents from the vector database by their IDs
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ids
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of document IDs to delete
 *                 example: ["doc_1", "doc_2", "doc_3"]
 *               namespace:
 *                 type: string
 *                 description: Vector database namespace
 *                 default: "bible_verses"
 *     responses:
 *       200:
 *         description: Documents deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: number
 *                       description: Number of documents deleted
 *                       example: 3
 *                     namespace:
 *                       type: string
 *       400:
 *         description: Invalid request - document IDs array required
 *       500:
 *         description: Failed to delete batch documents
 */
router.delete('/batch', asyncHandler(async (req: Request, res: Response) => {
  const { ids, namespace = NAMESPACE.BIBLE_VERSES } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ 
      success: false, 
      error: 'Valid document IDs array is required' 
    });
  }
  
  try {
    // Delete multiple documents
    await vectorDbService.deleteDocuments(ids, namespace);
    
    res.json({
      success: true,
      data: { 
        count: ids.length,
        namespace 
      }
    });
  } catch (error: any) {
    logger.error('Error deleting batch documents from vector database', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to delete batch documents',
      message: error.message
    });
  }
}));

/**
 * @swagger
 * /api/vector/namespace/{namespace}:
 *   delete:
 *     summary: Clear all documents in namespace
 *     tags: [Vector Database]
 *     description: Delete all documents within a specific namespace
 *     parameters:
 *       - in: path
 *         name: namespace
 *         required: true
 *         schema:
 *           type: string
 *         description: Namespace to clear
 *         example: "bible_verses"
 *     responses:
 *       200:
 *         description: Namespace cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     namespace:
 *                       type: string
 *                       example: "bible_verses"
 *       400:
 *         description: Invalid request - namespace required
 *       500:
 *         description: Failed to clear namespace
 */
router.delete('/namespace/:namespace', asyncHandler(async (req: Request, res: Response) => {
  const { namespace } = req.params;
  
  if (!namespace) {
    res.status(400).json({ 
      success: false, 
      error: 'Namespace is required' 
    });
  }
  
  try {
    // Clear namespace
    await vectorDbService.clearNamespace(namespace);
    
    res.json({
      success: true,
      data: { namespace }
    });
  } catch (error: any) {
    logger.error('Error clearing namespace in vector database', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to clear namespace',
      message: error.message
    });
  }
}));

/**
 * @swagger
 * /api/vector/status:
 *   get:
 *     summary: Get vector database status
 *     tags: [Vector Database]
 *     description: Check the current status and availability of the vector database service
 *     responses:
 *       200:
 *         description: Vector database status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     available:
 *                       type: boolean
 *                       description: Whether vector database is available
 *                       example: true
 *                     mode:
 *                       type: string
 *                       description: Current operation mode
 *                       enum: [connected, fallback]
 *                       example: "connected"
 */
router.get('/status', (_req: Request, res: Response) => {
  const isAvailable = vectorDbService.isAvailable();
  
  res.json({
    success: true,
    data: {
      available: isAvailable,
      mode: isAvailable ? 'connected' : 'fallback'
    }
  });
});

export default router;
