// User Memory Service for Thinkdrop AI Personal Intelligence Layer
import { Pool } from 'pg';
import { 
  User, 
  UserAgent, 
  UserMemory, 
  AgentRun,
  CreateUserRequest,
  UpdateUserRequest,
  CreateUserMemoryRequest,
  UpdateUserMemoryRequest,
  CreateUserAgentRequest,
  UpdateUserAgentRequest,
  CreateAgentRunRequest,
  UpdateAgentRunRequest,
  UserContext,
  MemoryEnrichedPrompt,
  UserMemoryFilter,
  AgentRunFilter,
  MemoryType
} from '../types/userMemory';

export class UserMemoryService {
  private db: Pool;

  constructor(database: Pool) {
    this.db = database;
  }

  // ===== USER MANAGEMENT =====
  
  async createUser(userData: CreateUserRequest): Promise<User> {
    const query = `
      INSERT INTO users (email, name, preferences, metadata)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    const values = [
      userData.email,
      userData.name || null,
      JSON.stringify(userData.preferences || {}),
      JSON.stringify(userData.metadata || {})
    ];

    const result = await this.db.query(query, values);
    return result.rows[0];
  }

  async getUserById(userId: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE id = $1';
    const result = await this.db.query(query, [userId]);
    return result.rows[0] || null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await this.db.query(query, [email]);
    return result.rows[0] || null;
  }

  async updateUser(userId: string, updates: UpdateUserRequest): Promise<User | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramCount++}`);
      values.push(updates.name);
    }
    if (updates.preferences !== undefined) {
      fields.push(`preferences = $${paramCount++}`);
      values.push(JSON.stringify(updates.preferences));
    }
    if (updates.metadata !== undefined) {
      fields.push(`metadata = $${paramCount++}`);
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.is_active !== undefined) {
      fields.push(`is_active = $${paramCount++}`);
      values.push(updates.is_active);
    }

    if (fields.length === 0) return null;

    fields.push(`last_seen = NOW()`);
    values.push(userId);

    const query = `
      UPDATE users 
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await this.db.query(query, values);
    return result.rows[0] || null;
  }

  // ===== USER MEMORY MANAGEMENT =====

  async createUserMemory(userId: string, memoryData: CreateUserMemoryRequest): Promise<UserMemory> {
    const query = `
      INSERT INTO user_memories (user_id, memory_type, key, value, metadata)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, memory_type, key) 
      DO UPDATE SET 
        value = EXCLUDED.value,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *
    `;

    const values = [
      userId,
      memoryData.memory_type,
      memoryData.key,
      memoryData.value,
      JSON.stringify(memoryData.metadata || {})
    ];

    const result = await this.db.query(query, values);
    return result.rows[0];
  }

  async getUserMemories(userId: string, filter?: UserMemoryFilter): Promise<UserMemory[]> {
    let query = 'SELECT * FROM user_memories WHERE user_id = $1';
    const values = [userId];
    let paramCount = 2;

    if (filter?.memory_type) {
      query += ` AND memory_type = $${paramCount++}`;
      values.push(filter.memory_type);
    }
    if (filter?.key) {
      query += ` AND key = $${paramCount++}`;
      values.push(filter.key);
    }
    if (filter?.is_active !== undefined) {
      query += ` AND is_active = $${paramCount++}`;
      values.push(filter.is_active.toString());
    }
    if (filter?.search) {
      query += ` AND (value ILIKE $${paramCount++} OR metadata::text ILIKE $${paramCount++})`;
      values.push(`%${filter.search}%`, `%${filter.search}%`);
      paramCount++;
    }

    query += ' ORDER BY created_at DESC';

    const result = await this.db.query(query, values);
    return result.rows;
  }

  async updateUserMemory(userId: string, memoryId: string, updates: UpdateUserMemoryRequest): Promise<UserMemory | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updates.value !== undefined) {
      fields.push(`value = $${paramCount++}`);
      values.push(updates.value);
    }
    if (updates.metadata !== undefined) {
      fields.push(`metadata = $${paramCount++}`);
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.is_active !== undefined) {
      fields.push(`is_active = $${paramCount++}`);
      values.push(updates.is_active);
    }

    if (fields.length === 0) return null;

    values.push(memoryId, userId);

    const query = `
      UPDATE user_memories 
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCount++} AND user_id = $${paramCount}
      RETURNING *
    `;

    const result = await this.db.query(query, values);
    return result.rows[0] || null;
  }

  async deleteUserMemory(userId: string, memoryId: string): Promise<boolean> {
    const query = 'DELETE FROM user_memories WHERE id = $1 AND user_id = $2';
    const result = await this.db.query(query, [memoryId, userId]);
    return (result.rowCount || 0) > 0;
  }

  // ===== USER-AGENT ASSOCIATIONS =====

  async createUserAgent(userId: string, agentData: CreateUserAgentRequest): Promise<UserAgent> {
    const query = `
      INSERT INTO user_agents (user_id, agent_id, alias, config)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, agent_id) 
      DO UPDATE SET 
        alias = EXCLUDED.alias,
        config = EXCLUDED.config,
        is_active = true,
        updated_at = NOW()
      RETURNING *
    `;

    const values = [
      userId,
      agentData.agent_id,
      agentData.alias || null,
      JSON.stringify(agentData.config || {})
    ];

    const result = await this.db.query(query, values);
    return result.rows[0];
  }

  async getUserAgents(userId: string, activeOnly: boolean = true): Promise<UserAgent[]> {
    let query = `
      SELECT ua.*, a.name as agent_name, a.description as agent_description
      FROM user_agents ua
      JOIN agents a ON ua.agent_id = a.id
      WHERE ua.user_id = $1
    `;
    
    if (activeOnly) {
      query += ' AND ua.is_active = true';
    }
    
    query += ' ORDER BY ua.created_at DESC';

    const result = await this.db.query(query, [userId]);
    return result.rows;
  }

  async updateUserAgent(userId: string, userAgentId: string, updates: UpdateUserAgentRequest): Promise<UserAgent | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updates.alias !== undefined) {
      fields.push(`alias = $${paramCount++}`);
      values.push(updates.alias);
    }
    if (updates.config !== undefined) {
      fields.push(`config = $${paramCount++}`);
      values.push(JSON.stringify(updates.config));
    }
    if (updates.is_active !== undefined) {
      fields.push(`is_active = $${paramCount++}`);
      values.push(updates.is_active);
    }

    if (fields.length === 0) return null;

    values.push(userAgentId, userId);

    const query = `
      UPDATE user_agents 
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCount++} AND user_id = $${paramCount}
      RETURNING *
    `;

    const result = await this.db.query(query, values);
    return result.rows[0] || null;
  }

  // ===== AGENT RUN LOGGING =====

  async createAgentRun(runData: CreateAgentRunRequest): Promise<AgentRun> {
    const query = `
      INSERT INTO agent_runs (user_agent_id, input, metadata)
      VALUES ($1, $2, $3)
      RETURNING *
    `;

    const values = [
      runData.user_agent_id,
      JSON.stringify(runData.input || {}),
      JSON.stringify(runData.metadata || {})
    ];

    const result = await this.db.query(query, values);
    return result.rows[0];
  }

  async updateAgentRun(runId: string, updates: UpdateAgentRunRequest): Promise<AgentRun | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updates.output !== undefined) {
      fields.push(`output = $${paramCount++}`);
      values.push(JSON.stringify(updates.output));
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${paramCount++}`);
      values.push(updates.status);
    }
    if (updates.logs !== undefined) {
      fields.push(`logs = $${paramCount++}`);
      values.push(updates.logs);
    }
    if (updates.execution_duration_ms !== undefined) {
      fields.push(`execution_duration_ms = $${paramCount++}`);
      values.push(updates.execution_duration_ms);
    }
    if (updates.error_message !== undefined) {
      fields.push(`error_message = $${paramCount++}`);
      values.push(updates.error_message);
    }
    if (updates.metadata !== undefined) {
      fields.push(`metadata = $${paramCount++}`);
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) return null;

    values.push(runId);

    const query = `
      UPDATE agent_runs 
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await this.db.query(query, values);
    return result.rows[0] || null;
  }

  async getAgentRuns(userAgentId: string, filter?: AgentRunFilter): Promise<AgentRun[]> {
    let query = 'SELECT * FROM agent_runs WHERE user_agent_id = $1';
    const values = [userAgentId];
    let paramCount = 2;

    if (filter?.status) {
      query += ` AND status = $${paramCount++}`;
      values.push(filter.status);
    }
    if (filter?.start_date) {
      query += ` AND run_time >= $${paramCount++}`;
      values.push(filter.start_date.toISOString());
    }
    if (filter?.end_date) {
      query += ` AND run_time <= $${paramCount++}`;
      values.push(filter.end_date.toISOString());
    }

    query += ' ORDER BY run_time DESC';

    if (filter?.limit) {
      query += ` LIMIT $${paramCount++}`;
      values.push(filter.limit.toString());
    }
    if (filter?.offset) {
      query += ` OFFSET $${paramCount++}`;
      values.push(filter.offset.toString());
    }

    const result = await this.db.query(query, values);
    return result.rows;
  }

  // ===== CONTEXT ENRICHMENT =====

  async getUserContext(userId: string): Promise<UserContext> {
    const user = await this.getUserById(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const [memories, activeAgents, recentRuns] = await Promise.all([
      this.getUserMemories(userId, { is_active: true }),
      this.getUserAgents(userId, true),
      this.getRecentAgentRuns(userId, 10)
    ]);

    return {
      user,
      memories,
      activeAgents,
      recentRuns
    };
  }

  async enrichPromptWithUserContext(userId: string, originalPrompt: string): Promise<MemoryEnrichedPrompt> {
    const userContext = await this.getUserContext(userId);
    
    // Build context enrichment based on user memories
    const contextParts = [];
    const appliedMemories: UserMemory[] = [];

    // Add core beliefs and worldview
    const beliefs = userContext.memories.filter(m => m.memory_type === 'belief');
    if (beliefs.length > 0) {
      contextParts.push('User\'s core beliefs and worldview:');
      beliefs.forEach(belief => {
        contextParts.push(`- ${belief.key}: ${belief.value}`);
        appliedMemories.push(belief);
      });
    }

    // Add preferences
    const preferences = userContext.memories.filter(m => m.memory_type === 'preference');
    if (preferences.length > 0) {
      contextParts.push('User preferences:');
      preferences.forEach(pref => {
        contextParts.push(`- ${pref.key}: ${pref.value}`);
        appliedMemories.push(pref);
      });
    }

    // Add favorite verses if available
    const verses = userContext.memories.filter(m => m.memory_type === 'verse');
    if (verses.length > 0) {
      contextParts.push('User\'s favorite Bible verses:');
      verses.forEach(verse => {
        contextParts.push(`- ${verse.value}`);
        appliedMemories.push(verse);
      });
    }

    // Build enriched prompt
    let enrichedPrompt = originalPrompt;
    if (contextParts.length > 0) {
      const contextString = contextParts.join('\n');
      enrichedPrompt = `Context about the user:\n${contextString}\n\nUser request: ${originalPrompt}`;
    }

    return {
      originalPrompt,
      enrichedPrompt,
      userContext,
      appliedMemories
    };
  }

  private async getRecentAgentRuns(userId: string, limit: number = 10): Promise<AgentRun[]> {
    const query = `
      SELECT ar.* 
      FROM agent_runs ar
      JOIN user_agents ua ON ar.user_agent_id = ua.id
      WHERE ua.user_id = $1
      ORDER BY ar.run_time DESC
      LIMIT $2
    `;

    const result = await this.db.query(query, [userId, limit]);
    return result.rows;
  }
}

// Import database pool for singleton instance
import pool from '../config/postgres';

// Export singleton instance
export const userMemoryService = new UserMemoryService(pool);

// Helper function to get user context (can be used standalone)
export async function getUserContext(userId: string): Promise<UserContext> {
  // Use the singleton instance
  return await userMemoryService.getUserContext(userId);
}
