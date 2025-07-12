// AI Memory Service for Intent Classification and Memory Storage
// Handles storage, retrieval, and analysis of AI memory data

import { Pool } from 'pg';
import { logger } from '../utils/logger';
import pool from '../config/postgres';
import {
  AIMemory,
  IntentCandidate,
  MemoryEntity,
  AIMemoryWithDetails,
  CreateAIMemoryRequest,
  UpdateAIMemoryRequest,
  AIMemoryFilter,
  IntentCandidateFilter,
  MemoryEntityFilter,
  UserMemoryInsights,
  IntentAnalytics,
  AIMemorySearchResult,
  WebSocketMemoryPayload,
  MemoryEnrichedContext
} from '../types/aiMemory';

export class AIMemoryService {
  constructor(private db: Pool) {}

  /**
   * Store AI memory from WebSocket intent classification
   */
  async storeWebSocketMemory(
    userId: string,
    payload: WebSocketMemoryPayload
  ): Promise<AIMemoryWithDetails> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // Insert main memory record
      const memoryResult = await client.query(`
        INSERT INTO memory (
          user_id, type, primary_intent, requires_memory_access, 
          requires_external_data, suggested_response, source_text, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        userId,
        'intent_classification',
        payload.primary_intent,
        payload.requires_memory_access,
        payload.requires_external_data,
        payload.suggested_response,
        payload.source_text,
        JSON.stringify(payload.session_metadata || {} as Record<string, any>)
      ]);

      const memory: AIMemory = memoryResult.rows[0];

      // Insert intent candidates
      const intents: IntentCandidate[] = [];
      for (const intent of payload.intents) {
        const intentResult = await client.query(`
          INSERT INTO intent_candidates (memory_id, intent, confidence, reasoning)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `, [memory.id, intent.intent, intent.confidence, intent.reasoning]);
        
        intents.push(intentResult.rows[0]);
      }

      // Insert entities
      const entities: MemoryEntity[] = [];
      for (const entity of payload.entities) {
        const entityResult = await client.query(`
          INSERT INTO memory_entities (memory_id, entity)
          VALUES ($1, $2)
          RETURNING *
        `, [memory.id, entity]);
        
        entities.push(entityResult.rows[0]);
      }

      await client.query('COMMIT');

      logger.info(`AI memory stored successfully`, {
        memoryId: memory.id,
        userId,
        primaryIntent: payload.primary_intent,
        intentsCount: intents.length,
        entitiesCount: entities.length
      });

      return { memory, intents, entities };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to store AI memory:', error as any);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create AI memory with full details
   */
  async createMemory(request: CreateAIMemoryRequest): Promise<AIMemoryWithDetails> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // Insert main memory record
      const memoryResult = await client.query(`
        INSERT INTO memory (
          user_id, type, primary_intent, requires_memory_access, 
          requires_external_data, suggested_response, source_text, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        request.user_id,
        request.type,
        request.primary_intent,
        request.requires_memory_access || false,
        request.requires_external_data || false,
        request.suggested_response,
        request.source_text,
        JSON.stringify((request.metadata as Record<string, any>) || {})
      ]);

      const memory: AIMemory = memoryResult.rows[0];

      // Insert intent candidates if provided
      const intents: IntentCandidate[] = [];
      if (request.intents) {
        for (const intent of request.intents) {
          const intentResult = await client.query(`
            INSERT INTO intent_candidates (memory_id, intent, confidence, reasoning)
            VALUES ($1, $2, $3, $4)
            RETURNING *
          `, [memory.id, intent.intent, intent.confidence, intent.reasoning]);
          
          intents.push(intentResult.rows[0]);
        }
      }

      // Insert entities if provided
      const entities: MemoryEntity[] = [];
      if (request.entities) {
        for (const entity of request.entities) {
          const entityResult = await client.query(`
            INSERT INTO memory_entities (memory_id, entity, entity_type)
            VALUES ($1, $2, $3)
            RETURNING *
          `, [memory.id, entity.entity, entity.entity_type]);
          
          entities.push(entityResult.rows[0]);
        }
      }

      await client.query('COMMIT');

      logger.info(`AI memory created successfully`, {
        memoryId: memory.id,
        userId: request.user_id,
        type: request.type
      });

      return { memory, intents, entities };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create AI memory:', error as any);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get AI memory by ID with all related data
   */
  async getMemoryById(memoryId: string): Promise<AIMemoryWithDetails | null> {
    try {
      // Get memory
      const memoryResult = await this.db.query(
        'SELECT * FROM memory WHERE id = $1',
        [memoryId]
      );

      if (memoryResult.rows.length === 0) {
        return null;
      }

      const memory: AIMemory = memoryResult.rows[0];

      // Get intents
      const intentsResult = await this.db.query(
        'SELECT * FROM intent_candidates WHERE memory_id = $1 ORDER BY confidence DESC',
        [memoryId]
      );

      // Get entities
      const entitiesResult = await this.db.query(
        'SELECT * FROM memory_entities WHERE memory_id = $1',
        [memoryId]
      );

      return {
        memory,
        intents: intentsResult.rows,
        entities: entitiesResult.rows
      };

    } catch (error) {
      logger.error('Failed to get AI memory by ID:', error as any);
      throw error;
    }
  }

  /**
   * Search AI memories with filters
   */
  async searchMemories(filter: AIMemoryFilter): Promise<AIMemorySearchResult> {
    try {
      let query = `
        SELECT m.*, 
               COUNT(*) OVER() as total_count
        FROM memory m
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      // Apply filters
      if (filter.user_id) {
        query += ` AND m.user_id = $${paramIndex}`;
        params.push(filter.user_id);
        paramIndex++;
      }

      if (filter.type) {
        query += ` AND m.type = $${paramIndex}`;
        params.push(filter.type);
        paramIndex++;
      }

      if (filter.primary_intent) {
        query += ` AND m.primary_intent = $${paramIndex}`;
        params.push(filter.primary_intent);
        paramIndex++;
      }

      if (filter.requires_memory_access !== undefined) {
        query += ` AND m.requires_memory_access = $${paramIndex}`;
        params.push(filter.requires_memory_access);
        paramIndex++;
      }

      if (filter.requires_external_data !== undefined) {
        query += ` AND m.requires_external_data = $${paramIndex}`;
        params.push(filter.requires_external_data);
        paramIndex++;
      }

      if (filter.start_date) {
        query += ` AND m.timestamp >= $${paramIndex}`;
        params.push(filter.start_date);
        paramIndex++;
      }

      if (filter.end_date) {
        query += ` AND m.timestamp <= $${paramIndex}`;
        params.push(filter.end_date);
        paramIndex++;
      }

      if (filter.search) {
        query += ` AND (
          to_tsvector('english', m.source_text) @@ plainto_tsquery('english', $${paramIndex})
          OR to_tsvector('english', COALESCE(m.suggested_response, '')) @@ plainto_tsquery('english', $${paramIndex})
        )`;
        params.push(filter.search);
        paramIndex++;
      }

      query += ` ORDER BY m.timestamp DESC`;

      if (filter.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(filter.limit);
        paramIndex++;
      }

      if (filter.offset) {
        query += ` OFFSET $${paramIndex}`;
        params.push(filter.offset);
        paramIndex++;
      }

      const result = await this.db.query(query, params);
      const memories = result.rows;
      const totalCount = memories.length > 0 ? parseInt(memories[0].total_count) : 0;

      // Get related data for each memory
      const memoriesWithDetails: AIMemoryWithDetails[] = [];
      for (const memory of memories) {
        const details = await this.getMemoryById(memory.id);
        if (details) {
          memoriesWithDetails.push(details);
        }
      }

      // Calculate facets
      const facets = await this.calculateSearchFacets(filter);

      return {
        memories: memoriesWithDetails,
        total_count: totalCount,
        facets
      };

    } catch (error) {
      logger.error('Failed to search AI memories:', error as any);
      throw error;
    }
  }

  /**
   * Get user memory insights and analytics
   */
  async getUserMemoryInsights(userId: string): Promise<UserMemoryInsights> {
    try {
      // Get total memories and types
      const memoryStatsResult = await this.db.query(`
        SELECT 
          COUNT(*) as total_memories,
          type,
          COUNT(*) as type_count
        FROM memory 
        WHERE user_id = $1 
        GROUP BY type
      `, [userId]);

      const totalMemories = memoryStatsResult.rows.reduce((sum, row) => sum + parseInt(row.type_count), 0);
      const memoryTypes: Record<string, number> = {};
      memoryStatsResult.rows.forEach(row => {
        memoryTypes[row.type] = parseInt(row.type_count);
      });

      // Get top intents
      const topIntentsResult = await this.db.query(`
        SELECT 
          ic.intent,
          COUNT(*) as count,
          AVG(ic.confidence) as average_confidence,
          MAX(m.timestamp) as last_occurrence
        FROM intent_candidates ic
        JOIN memory m ON ic.memory_id = m.id
        WHERE m.user_id = $1
        GROUP BY ic.intent
        ORDER BY count DESC, average_confidence DESC
        LIMIT 10
      `, [userId]);

      const topIntents: IntentAnalytics[] = topIntentsResult.rows.map(row => ({
        intent: row.intent,
        count: parseInt(row.count),
        average_confidence: parseFloat(row.average_confidence),
        last_occurrence: row.last_occurrence
      }));

      // Get common entities
      const commonEntitiesResult = await this.db.query(`
        SELECT 
          me.entity,
          me.entity_type,
          COUNT(*) as count
        FROM memory_entities me
        JOIN memory m ON me.memory_id = m.id
        WHERE m.user_id = $1
        GROUP BY me.entity, me.entity_type
        ORDER BY count DESC
        LIMIT 20
      `, [userId]);

      const commonEntities = commonEntitiesResult.rows.map(row => ({
        entity: row.entity,
        count: parseInt(row.count),
        entity_type: row.entity_type
      }));

      // Get memory access patterns
      const accessPatternsResult = await this.db.query(`
        SELECT 
          SUM(CASE WHEN requires_memory_access THEN 1 ELSE 0 END) as requires_memory_access,
          SUM(CASE WHEN requires_external_data THEN 1 ELSE 0 END) as requires_external_data
        FROM memory
        WHERE user_id = $1
      `, [userId]);

      const accessPatterns = accessPatternsResult.rows[0] || { requires_memory_access: 0, requires_external_data: 0 };

      return {
        user_id: userId,
        total_memories: totalMemories,
        memory_types: memoryTypes,
        top_intents: topIntents,
        common_entities: commonEntities,
        memory_access_patterns: {
          requires_memory_access: parseInt(accessPatterns.requires_memory_access) || 0,
          requires_external_data: parseInt(accessPatterns.requires_external_data) || 0
        }
      };

    } catch (error) {
      logger.error('Failed to get user memory insights:', error as any);
      throw error;
    }
  }

  /**
   * Get memory-enriched context for AI prompts
   */
  async getMemoryEnrichedContext(
    userId: string,
    currentPrompt: string,
    limit: number = 10
  ): Promise<MemoryEnrichedContext> {
    try {
      // Find relevant memories using text search
      const relevantMemories = await this.searchMemories({
        user_id: userId,
        search: currentPrompt,
        limit
      });

      // Get intent patterns for this user
      const insights = await this.getUserMemoryInsights(userId);

      // Get relevant entities
      const entitiesResult = await this.db.query(`
        SELECT DISTINCT me.*
        FROM memory_entities me
        JOIN memory m ON me.memory_id = m.id
        WHERE m.user_id = $1
        ORDER BY me.created_at DESC
        LIMIT 50
      `, [userId]);

      // Generate memory summary
      const memorySummary = this.generateMemorySummary(relevantMemories.memories, insights);

      return {
        user_id: userId,
        relevant_memories: relevantMemories.memories,
        intent_patterns: insights.top_intents,
        entity_context: entitiesResult.rows,
        memory_summary: memorySummary
      };

    } catch (error) {
      logger.error('Failed to get memory-enriched context:', error as any);
      throw error;
    }
  }

  /**
   * Update AI memory
   */
  async updateMemory(memoryId: string, request: UpdateAIMemoryRequest): Promise<AIMemory | null> {
    try {
      const setParts: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (request.type !== undefined) {
        setParts.push(`type = $${paramIndex}`);
        params.push(request.type);
        paramIndex++;
      }

      if (request.primary_intent !== undefined) {
        setParts.push(`primary_intent = $${paramIndex}`);
        params.push(request.primary_intent);
        paramIndex++;
      }

      if (request.requires_memory_access !== undefined) {
        setParts.push(`requires_memory_access = $${paramIndex}`);
        params.push(request.requires_memory_access);
        paramIndex++;
      }

      if (request.requires_external_data !== undefined) {
        setParts.push(`requires_external_data = $${paramIndex}`);
        params.push(request.requires_external_data);
        paramIndex++;
      }

      if (request.suggested_response !== undefined) {
        setParts.push(`suggested_response = $${paramIndex}`);
        params.push(request.suggested_response);
        paramIndex++;
      }

      if (request.metadata !== undefined) {
        setParts.push(`metadata = $${paramIndex}`);
        params.push(JSON.stringify(request.metadata as Record<string, any>));
        paramIndex++;
      }

      if (setParts.length === 0) {
        return null;
      }

      setParts.push(`updated_at = NOW()`);
      params.push(memoryId);

      const query = `
        UPDATE memory 
        SET ${setParts.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await this.db.query(query, params);
      return result.rows[0] || null;

    } catch (error) {
      logger.error('Failed to update AI memory:', error as any);
      throw error;
    }
  }

  /**
   * Delete AI memory and all related data
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // Delete related data (cascading should handle this, but being explicit)
      await client.query('DELETE FROM intent_candidates WHERE memory_id = $1', [memoryId]);
      await client.query('DELETE FROM memory_entities WHERE memory_id = $1', [memoryId]);
      
      // Delete main memory record
      const result = await client.query('DELETE FROM memory WHERE id = $1', [memoryId]);

      await client.query('COMMIT');

      logger.info(`AI memory deleted successfully`, { memoryId });
      return (result.rowCount || 0) > 0;

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to delete AI memory:', error as any);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Calculate search facets for filtering
   */
  private async calculateSearchFacets(filter: AIMemoryFilter): Promise<any> {
    try {
      let baseQuery = 'FROM memory m WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      // Apply same filters as main search (excluding facet-specific filters)
      if (filter.user_id) {
        baseQuery += ` AND m.user_id = $${paramIndex}`;
        params.push(filter.user_id);
        paramIndex++;
      }

      // Get type facets
      const typeFacetsResult = await this.db.query(`
        SELECT m.type, COUNT(*) as count ${baseQuery} GROUP BY m.type
      `, params);

      // Get intent facets
      const intentFacetsResult = await this.db.query(`
        SELECT ic.intent, COUNT(*) as count
        FROM intent_candidates ic
        JOIN memory m ON ic.memory_id = m.id
        WHERE 1=1 ${filter.user_id ? 'AND m.user_id = $1' : ''}
        GROUP BY ic.intent
      `, filter.user_id ? [filter.user_id] : []);

      // Get entity facets
      const entityFacetsResult = await this.db.query(`
        SELECT me.entity, COUNT(*) as count
        FROM memory_entities me
        JOIN memory m ON me.memory_id = m.id
        WHERE 1=1 ${filter.user_id ? 'AND m.user_id = $1' : ''}
        GROUP BY me.entity
        ORDER BY count DESC
        LIMIT 20
      `, filter.user_id ? [filter.user_id] : []);

      return {
        types: Object.fromEntries(typeFacetsResult.rows.map(row => [row.type, parseInt(row.count)])),
        intents: Object.fromEntries(intentFacetsResult.rows.map(row => [row.intent, parseInt(row.count)])),
        entities: Object.fromEntries(entityFacetsResult.rows.map(row => [row.entity, parseInt(row.count)]))
      };

    } catch (error) {
      logger.error('Failed to calculate search facets:', error as any);
      return { types: {}, intents: {}, entities: {} };
    }
  }

  /**
   * Generate a summary of user's memory patterns
   */
  private generateMemorySummary(
    memories: AIMemoryWithDetails[],
    insights: UserMemoryInsights
  ): string {
    const parts: string[] = [];

    if (insights.total_memories > 0) {
      parts.push(`User has ${insights.total_memories} stored memories.`);
    }

    if (insights.top_intents.length > 0) {
      const topIntent = insights.top_intents[0];
      parts.push(`Most common intent: ${topIntent.intent} (${topIntent.count} occurrences).`);
    }

    if (insights.common_entities.length > 0) {
      const topEntities = insights.common_entities.slice(0, 3).map(e => e.entity);
      parts.push(`Frequently mentioned: ${topEntities.join(', ')}.`);
    }

    if (memories.length > 0) {
      parts.push(`${memories.length} relevant memories found for current context.`);
    }

    return parts.join(' ') || 'No memory patterns identified yet.';
  }
}

// Export singleton instance
export const aiMemoryService = new AIMemoryService(pool);
