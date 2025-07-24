// AI Memory System Types for Intent Classification and Memory Storage
// Complements the existing user memory system with DuckDB-style AI memory architecture

export interface AIMemory {
  id: string;
  timestamp: Date;
  user_id: string;
  type: AIMemoryType;
  primary_intent?: string;
  requires_memory_access: boolean;
  requires_external_data: boolean;
  suggested_response?: string;
  source_text: string;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface IntentCandidate {
  id: string;
  memory_id: string;
  intent: string;
  confidence: number; // 0.0 to 1.0
  reasoning?: string;
  created_at: Date;
}

export interface MemoryEntity {
  id: string;
  memory_id: string;
  entity: string;
  entity_type?: string; // 'topic', 'action', 'person', 'date', 'document_type', etc.
  created_at: Date;
}

export type AIMemoryType = 
  | 'intent_classification'
  | 'note'
  | 'summary'
  | 'command_result'
  | 'conversation'
  | 'context'
  | 'interaction';

export type IntentType = 
  | 'greeting'
  | 'memory_store'
  | 'memory_retrieve'
  | 'memory_update'
  | 'memory_delete'
  | 'question'
  | 'command'
  | 'external_data_required'
  | 'conversation'
  | 'farewell';

export type EntityType = 
  | 'topic'
  | 'action'
  | 'person'
  | 'date'
  | 'document_type'
  | 'location'
  | 'organization'
  | 'concept'
  | 'reference';

// Request/Response DTOs for AI Memory
export interface CreateAIMemoryRequest {
  user_id: string;
  type: AIMemoryType;
  primary_intent?: string;
  requires_memory_access?: boolean;
  requires_external_data?: boolean;
  suggested_response?: string;
  source_text: string;
  metadata?: Record<string, any>;
  intents?: CreateIntentCandidateRequest[];
  entities?: CreateMemoryEntityRequest[];
}

export interface CreateIntentCandidateRequest {
  intent: string;
  confidence: number;
  reasoning?: string;
}

export interface CreateMemoryEntityRequest {
  entity: string;
  entity_type?: string;
}

export interface UpdateAIMemoryRequest {
  type?: AIMemoryType;
  primary_intent?: string;
  requires_memory_access?: boolean;
  requires_external_data?: boolean;
  suggested_response?: string;
  metadata?: Record<string, any>;
}

// Complete AI Memory with related data
export interface AIMemoryWithDetails {
  memory: AIMemory;
  intents: IntentCandidate[];
  entities: MemoryEntity[];
}

// Query filters for AI Memory
export interface AIMemoryFilter {
  user_id?: string;
  type?: AIMemoryType;
  primary_intent?: string;
  requires_memory_access?: boolean;
  requires_external_data?: boolean;
  start_date?: Date;
  end_date?: Date;
  search?: string; // for full-text search in source_text or suggested_response
  limit?: number;
  offset?: number;
}

export interface IntentCandidateFilter {
  memory_id?: string;
  intent?: string;
  min_confidence?: number;
  max_confidence?: number;
}

export interface MemoryEntityFilter {
  memory_id?: string;
  entity?: string;
  entity_type?: string;
}

// Analytics and insights types
export interface IntentAnalytics {
  intent: string;
  count: number;
  average_confidence: number;
  last_occurrence: Date;
}

export interface UserMemoryInsights {
  user_id: string;
  total_memories: number;
  memory_types: Record<AIMemoryType, number>;
  top_intents: IntentAnalytics[];
  common_entities: Array<{
    entity: string;
    count: number;
    entity_type?: string;
  }>;
  memory_access_patterns: {
    requires_memory_access: number;
    requires_external_data: number;
  };
}

// Integration with WebSocket Intent Classification
export interface WebSocketMemoryPayload {
  source_text: string;
  primary_intent: string;
  intents: Array<{
    intent: string;
    confidence: number;
    reasoning?: string;
  }>;
  entities: Array<{
    value: string;
    type: string;
    normalized_value?: string | null;
  }> | string[]; // Support both new entity objects and legacy string arrays
  requires_memory_access: boolean;
  requires_external_data: boolean;
  suggested_response?: string;
  session_metadata?: Record<string, any>;
}

// Memory enrichment for AI prompts
export interface MemoryEnrichedContext {
  user_id: string;
  relevant_memories: AIMemoryWithDetails[];
  intent_patterns: IntentAnalytics[];
  entity_context: MemoryEntity[];
  memory_summary: string;
}

export interface AIMemorySearchResult {
  memories: AIMemoryWithDetails[];
  total_count: number;
  facets: {
    types: Record<AIMemoryType, number>;
    intents: Record<string, number>;
    entities: Record<string, number>;
  };
}
