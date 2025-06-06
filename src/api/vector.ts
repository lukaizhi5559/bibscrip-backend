import { Router, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import { vectorDbService } from '../services/vectorDbService';
import { NAMESPACE } from '../config/vectorDb';
import { logger } from '../utils';

const router = Router();

/**
 * @route POST /api/vector/store
 * @desc Store a document in the vector database
 * @access Public
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
 * @route POST /api/vector/batch
 * @desc Store multiple documents in the vector database
 * @access Public
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
 * @route POST /api/vector/search
 * @desc Search for similar documents in the vector database
 * @access Public
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
 * @route DELETE /api/vector/:id
 * @desc Delete a document from the vector database
 * @access Public
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
 * @route DELETE /api/vector/batch
 * @desc Delete multiple documents from the vector database
 * @access Public
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
 * @route DELETE /api/vector/namespace/:namespace
 * @desc Clear all documents in a namespace
 * @access Public
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
 * @route GET /api/vector/status
 * @desc Get vector database status
 * @access Public
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
