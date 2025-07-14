// Vector Database Service for RAG system
import { Index } from '@pinecone-database/pinecone';
import { initVectorDb, getIndex as getConfigIndex, NAMESPACE } from '../config/vectorDb';
import { generateEmbedding } from './embeddingService';
import { prepareVectorForPinecone } from '../utils/vectorUtils';
import { logger } from '../utils';

// Type declarations for Pinecone SDK v6.1.0 to fix TypeScript errors
// These extend the base Index type to match the actual Pinecone API
declare module '@pinecone-database/pinecone' {
  interface Index {
    upsert(vectors: Array<Record<string, any>>, options?: { namespace?: string }): Promise<any>;
    query(queryParams: { vector: number[], topK?: number, includeMetadata?: boolean }, options?: { namespace?: string }): Promise<any>;
    deleteOne(id: string, options?: { namespace?: string }): Promise<any>;
    deleteMany(ids: string[], options?: { namespace?: string }): Promise<any>;
    deleteAll(options?: { namespace?: string }): Promise<any>;
  }
}

// Document structure for storing in vector database
interface Document {
  id?: string;
  text: string;
  metadata?: Record<string, any>;
}

// Search result interface
export interface SearchResult {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, any>;
}

// Class for interacting with the vector database
export class VectorDbService {
  private index: Index | null = null;
  private initialized = false;
  private fallbackMode = false;

  /**
   * Initialize connection to vector database
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Try to initialize index
      this.index = await initVectorDb();
      this.initialized = true;
      
      if (this.index) {
        logger.info('Vector database service initialized successfully');
      } else {
        this.fallbackMode = true;
        logger.warn('Vector database service initialized in fallback mode - some functionality will be limited');
      }
    } catch (error) {
      // Set fallback mode instead of throwing
      this.fallbackMode = true;
      this.initialized = true; // Mark as initialized to prevent repeated attempts
      logger.error('Failed to initialize vector database - running in fallback mode', { error });
    }
  }

  /**
   * Get index instance after ensuring initialization
   * @returns Index instance or null if in fallback mode
   */
  private async getIndex(): Promise<Index | null> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Try to get index from config if we don't have it yet
    if (!this.index && !this.fallbackMode) {
      this.index = await getConfigIndex();
      
      if (!this.index) {
        this.fallbackMode = true;
        logger.warn('Vector database unavailable - switching to fallback mode');
      }
    }
    
    return this.index;
  }

  /**
   * Store a document in the vector database
   * @param document Document to store
   * @param namespace Namespace to store the document in
   * @returns ID of the stored document
   */
  async storeDocument(
    document: Document,
    namespace: string = NAMESPACE.BIBLE_VERSES
  ): Promise<string> {
    // Generate ID if not provided
    const id = document.id || `${namespace}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    
    try {
      const index = await this.getIndex();
      if (!index) {
        logger.debug(`Document not stored (fallback mode)`, { id, namespace });
        return id; // Return ID even in fallback mode
      }

      // Generate embedding for the document
      const { embedding } = await generateEmbedding(document.text);
      
      // Prepare and normalize the vector for Pinecone (ensure correct dimension and unit length)
      const normalizedVector = prepareVectorForPinecone(embedding);
      
      logger.debug(`Storing document in vector DB with ID: ${id}`, {
        namespace,
        metadataFields: Object.keys(document.metadata || {}),
        vectorDimension: normalizedVector.length
      });
      
      // Use correct Pinecone SDK v6.1.0 upsert format based on successful test results
      const vectorRecord = {
        id,
        values: normalizedVector,
        metadata: {
          text: document.text,
          ...document.metadata,
          createdAt: new Date().toISOString(),
        }
      };
      await (index as any).upsert([vectorRecord], { namespace });
      
      return id;
    } catch (error) {
      logger.error('Error storing document in vector database', { error, documentId: id });
      return id; // Still return the ID even if storage failed
    }
  }

  /**
   * Store multiple documents in batch for efficiency
   * @param documents Array of documents to store
   * @param namespace Namespace to store the documents in
   * @returns Array of stored document IDs
   */
  async storeBatchDocuments(
    documents: Document[],
    namespace: string = NAMESPACE.BIBLE_VERSES
  ): Promise<string[]> {
    if (documents.length === 0) {
      return [];
    }
    
    try {
      const index = await this.getIndex();
      
      // Generate IDs for all documents
      const ids = documents.map((doc, i) => 
        doc.id || `${namespace}-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 10)}`
      );
      
      // In fallback mode, just return IDs without storing
      if (!index) {
        logger.info(`${documents.length} documents not stored (fallback mode)`, { namespace });
        return ids;
      }
      
      // Generate embeddings for all documents in batch
      const embeddings = await Promise.all(
        documents.map(doc => generateEmbedding(doc.text))
      );
      
      // Prepare vector records for upsertion
      const vectors = [];
      for (let i = 0; i < documents.length; i++) {
        const embedding = embeddings[i];
        const id = ids[i];
        const document = documents[i];
        
        // Normalize the vector for Pinecone
        const normalizedVector = prepareVectorForPinecone(embedding.embedding);
        
        // Create vector object with ID, normalized values, and metadata
        vectors.push({
          id,
          values: normalizedVector,
          metadata: {
            text: document.text,
            ...document.metadata,
            createdAt: new Date().toISOString(),
          }
        });
      }
      
      // Upsert documents in batches of 100 (Pinecone's limit)
      const batchSize = 100;
      for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, i + batchSize);
        // Use correct Pinecone SDK v6.1.0 upsert format based on successful test results
        await (index as any).upsert(batch, { namespace });
      }
      
      logger.info(`Stored ${documents.length} documents in vector database`, { namespace });
      return ids;
    } catch (error) {
      logger.error('Failed to store batch documents in vector database', { error, namespace, count: documents.length });
      // Return fallback IDs in case of failure
      return documents.map((_, i) => 
        `fallback-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 10)}`
      );
    }
  }

  /**
   * Search for similar documents based on query text
   * @param queryText The text to search for
   * @param namespace Namespace to search in
   * @param topK Number of results to return
   * @param minScore Minimum similarity score (0-1)
   * @returns Array of search results
   */
  async searchSimilar(
    queryText: string,
    namespace: string = NAMESPACE.BIBLE_VERSES,
    topK: number = 5,
    minScore: number = 0.7
  ): Promise<SearchResult[]> {
    try {
      const index = await this.getIndex();
      
      // In fallback mode, return empty results
      if (!index) {
        logger.warn(`Vector search unavailable (fallback mode)`, { namespace, queryLength: queryText.length });
        return [];
      }
      
      // Generate embedding for query
      const { embedding } = await generateEmbedding(queryText);
      
      // Prepare and normalize the vector for Pinecone
      const normalizedVector = prepareVectorForPinecone(embedding);
      
      // Query the vector database using confirmed working Pinecone SDK v6.1.0 format
      // This format was confirmed in our debug tests (TEST 5 succeeded)
      const queryResult = await (index as any).query({
        vector: normalizedVector,
        topK,
        includeMetadata: true
      }, { namespace });
      
      // Define match type to avoid TypeScript errors
      interface PineconeMatch {
        id: string;
        score?: number;
        metadata?: Record<string, any>;
      }
      
      // Filter and map results
      const results = queryResult.matches
        .filter((match: PineconeMatch) => match.score && match.score >= minScore)
        .map((match: PineconeMatch) => ({
          id: match.id,
          score: match.score || 0,
          text: match.metadata?.text as string,
          metadata: { ...match.metadata } as Record<string, any>,
        }));
      
      logger.debug(`Found ${results.length} similar documents`, { namespace, queryLength: queryText.length });
      return results;
    } catch (error) {
      logger.error('Failed to search for similar documents', { error, namespace });
      // Return empty results on error
      return [];
    }
  }

  /**
   * Delete documents from the vector database
   * @param ids Array of document IDs to delete
   * @param namespace Namespace to delete from
   */
  async deleteDocuments(ids: string[], namespace: string = NAMESPACE.BIBLE_VERSES): Promise<void> {
    try {
      const index = await this.getIndex();
      
      // In fallback mode, just log and return
      if (!index) {
        logger.debug(`Documents not deleted (fallback mode)`, { count: ids.length, namespace });
        return;
      }
      
      // Delete documents using Pinecone SDK v6.1.0 API
      // First try using deleteMany if available
      try {
        await (index as any).deleteMany(ids, { namespace });
        logger.debug(`Deleted ${ids.length} documents using deleteMany`, { namespace });
      } catch (error) {
        // If deleteMany fails, fall back to individual deletions using deleteOne
        logger.warn('deleteMany failed, falling back to individual deletions', { error, namespace });
        
        let successCount = 0;
        for (const id of ids) {
          try {
            await (index as any).deleteOne(id, { namespace });
            successCount++;
          } catch (err) {
            logger.warn(`Failed to delete document ${id}`, { error: err, namespace });
          }
        }
        logger.debug(`Successfully deleted ${successCount}/${ids.length} documents`, { namespace });
      }
      logger.debug(`Deleted ${ids.length} documents from vector database`, { namespace });
    } catch (error) {
      logger.error('Failed to delete documents from vector database', { error, namespace });
      // Don't throw error, just log it
    }
  }

  /**
   * Clear all documents from a namespace
   * @param namespace Namespace to clear
   */
  async clearNamespace(namespace: string): Promise<void> {
    try {
      const index = await this.getIndex();
      
      // In fallback mode, just log and return
      if (!index) {
        logger.debug(`Namespace not cleared (fallback mode)`, { namespace });
        return;
      }
      
      // Try clearing namespace using Pinecone SDK v6.1.0 API
      try {
        await (index as any).deleteAll({ namespace });
        logger.info(`Cleared namespace ${namespace} in vector database`);
      } catch (clearError) {
        // If deleteAll fails, try to use describeIndexStats to find all vectors in namespace
        // and delete them manually
        logger.warn('Failed to clear namespace with deleteAll, attempting alternative approach', { 
          namespace, 
          error: clearError 
        });
        
        try {
          // Get stats to see if we can identify vectors in this namespace
          const stats = await (index as any).describeIndexStats();
          logger.debug('Retrieved index stats for manual namespace clearing', { namespace, stats });
          
          // Check if we can find the namespace in the stats
          if (stats && stats.namespaces && stats.namespaces[namespace]) {
            // Log what we found and fall back to our fallback mode since we can't easily
            // retrieve all vector IDs in a namespace with the current SDK
            logger.warn(`Manual namespace clearing not implemented, falling back to fallback mode`, {
              namespace,
              vectorCount: stats.namespaces[namespace].vectorCount
            });
          }
          
          // Continue in fallback mode as we couldn't clear the namespace
        } catch (statsError) {
          logger.error('Failed to get index stats for manual namespace clearing', { 
            namespace, 
            error: statsError 
          });
        }
      }
    } catch (error) {
      logger.error('Failed to clear namespace', { error, namespace });
      // Don't throw error, just log it
    }
  }
  
  /**
   * Generate user-specific namespace for memory isolation
   * @param userId User ID
   * @param memoryType Type of memory (user, system, agent)
   * @returns Compound namespace string
   */
  generateUserNamespace(userId: string, memoryType: 'user' | 'system' | 'agent' = 'user'): string {
    return `user_${userId}_${memoryType}_memories`;
  }

  /**
   * Search across multiple namespaces with merge-and-rank capability
   * @param queryText The text to search for
   * @param namespaces Array of namespaces to search
   * @param topK Number of results to return per namespace
   * @param minScore Minimum similarity score (0-1)
   * @returns Merged and ranked search results
   */
  async searchMultipleNamespaces(
    queryText: string,
    namespaces: string[],
    topK: number = 5,
    minScore: number = 0.7
  ): Promise<SearchResult[]> {
    try {
      const index = await this.getIndex();
      
      if (!index) {
        logger.debug('Multi-namespace search not available (fallback mode)', { namespaces });
        return [];
      }

      // Generate embedding for the query
      const { embedding } = await generateEmbedding(queryText);
      const normalizedVector = prepareVectorForPinecone(embedding);

      // Search each namespace concurrently
      const searchPromises = namespaces.map(async (namespace) => {
        try {
          const response = await (index as any).query({
            vector: normalizedVector,
            topK,
            includeMetadata: true
          }, { namespace });

          // Define match type to avoid TypeScript errors
          interface PineconeMatch {
            id: string;
            score?: number;
            metadata?: Record<string, any>;
          }

          const matches: PineconeMatch[] = response.matches || [];
          
          return matches
            .filter((match: PineconeMatch) => (match.score || 0) >= minScore)
            .map((match: PineconeMatch): SearchResult => ({
              id: match.id,
              score: match.score || 0,
              text: match.metadata?.text || '',
              metadata: {
                ...match.metadata,
                namespace, // Add namespace info to metadata
                searchQuery: queryText
              }
            }));
        } catch (error) {
          logger.warn(`Failed to search namespace ${namespace}`, { error });
          return [];
        }
      });

      // Wait for all searches to complete
      const allResults = await Promise.all(searchPromises);
      
      // Flatten and merge results
      const mergedResults = allResults.flat();
      
      // Sort by score (highest first) and limit to topK total results
      const rankedResults = mergedResults
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      logger.debug(`Multi-namespace search completed`, {
        query: queryText,
        namespaces: namespaces.length,
        totalResults: mergedResults.length,
        rankedResults: rankedResults.length,
        topScore: rankedResults[0]?.score || 0
      });

      return rankedResults;
      
    } catch (error) {
      logger.error('Failed to search multiple namespaces', { error, namespaces });
      return [];
    }
  }

  /**
   * Store user memory in user-specific namespace
   * @param userId User ID
   * @param content Memory content
   * @param memoryType Type of memory
   * @param metadata Additional metadata
   * @returns ID of stored memory
   */
  async storeUserMemory(
    userId: string,
    content: string,
    memoryType: 'user' | 'system' | 'agent' = 'user',
    metadata: Record<string, any> = {}
  ): Promise<string> {
    const namespace = this.generateUserNamespace(userId, memoryType);
    const enhancedMetadata = {
      ...metadata,
      userId,
      memoryType,
      storedAt: new Date().toISOString(),
      text: content // Store text in metadata for retrieval
    };

    return this.storeDocument({
      text: content,
      metadata: enhancedMetadata
    }, namespace);
  }

  /**
   * Search user memories across memory types with dynamic weighting
   * @param userId User ID
   * @param queryText Search query
   * @param weights Weights for different memory types
   * @param topK Number of results to return
   * @param minScore Minimum similarity score
   * @returns Weighted and ranked search results
   */
  async searchUserMemories(
    userId: string,
    queryText: string,
    weights: { user?: number; system?: number; agent?: number } = { user: 1.0, system: 0.5, agent: 0.3 },
    topK: number = 10,
    minScore: number = 0.6
  ): Promise<SearchResult[]> {
    // Generate namespaces for enabled memory types
    const namespacesToSearch: string[] = [];
    
    if (weights.user && weights.user > 0) {
      namespacesToSearch.push(this.generateUserNamespace(userId, 'user'));
    }
    if (weights.system && weights.system > 0) {
      namespacesToSearch.push(this.generateUserNamespace(userId, 'system'));
    }
    if (weights.agent && weights.agent > 0) {
      namespacesToSearch.push(this.generateUserNamespace(userId, 'agent'));
    }

    if (namespacesToSearch.length === 0) {
      logger.debug('No namespaces to search for user memories', { userId, weights });
      return [];
    }

    // Search across namespaces
    const results = await this.searchMultipleNamespaces(queryText, namespacesToSearch, topK * 2, minScore);
    
    // Apply dynamic weighting based on memory type
    const weightedResults = results.map(result => {
      const memoryType = result.metadata?.memoryType as 'user' | 'system' | 'agent';
      const weight = weights[memoryType] || 1.0;
      
      return {
        ...result,
        score: result.score * weight,
        metadata: {
          ...result.metadata,
          originalScore: result.score,
          appliedWeight: weight,
          weightedScore: result.score * weight
        }
      };
    });

    // Re-sort by weighted score and limit to topK
    const finalResults = weightedResults
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    logger.debug(`User memory search completed`, {
      userId,
      query: queryText,
      namespacesSearched: namespacesToSearch.length,
      rawResults: results.length,
      weightedResults: finalResults.length,
      weights
    });

    return finalResults;
  }

  /**
   * Check if vector database is available
   * @returns true if vector database is available, false if in fallback mode
   */
  isAvailable(): boolean {
    return this.initialized && !this.fallbackMode && this.index !== null;
  }
}

// Create singleton instance
export const vectorDbService = new VectorDbService();
