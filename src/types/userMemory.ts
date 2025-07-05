// User Memory System Types for Thinkdrop AI Personal Intelligence Layer

export interface User {
  id: string;
  email: string;
  name?: string;
  created_at: Date;
  last_seen?: Date;
  is_active: boolean;
  preferences: Record<string, any>;
  metadata: Record<string, any>;
}

export interface UserAgent {
  id: string;
  user_id: string;
  agent_id: string;
  alias?: string;
  config: Record<string, any>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserMemory {
  id: string;
  user_id: string;
  memory_type: MemoryType;
  key: string;
  value: string;
  metadata: Record<string, any>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AgentRun {
  id: string;
  user_agent_id: string;
  run_time: Date;
  input: Record<string, any>;
  output: Record<string, any>;
  status: AgentRunStatus;
  logs?: string;
  execution_duration_ms?: number;
  error_message?: string;
  metadata: Record<string, any>;
}

export type MemoryType = 
  | 'reminder'
  | 'preference' 
  | 'belief'
  | 'habit'
  | 'verse'
  | 'prayer'
  | 'goal'
  | 'context';

export type AgentRunStatus = 
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled';

// Request/Response DTOs
export interface CreateUserRequest {
  email: string;
  name?: string;
  preferences?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface UpdateUserRequest {
  name?: string;
  preferences?: Record<string, any>;
  metadata?: Record<string, any>;
  is_active?: boolean;
}

export interface CreateUserMemoryRequest {
  memory_type: MemoryType;
  key: string;
  value: string;
  metadata?: Record<string, any>;
}

export interface UpdateUserMemoryRequest {
  value?: string;
  metadata?: Record<string, any>;
  is_active?: boolean;
}

export interface CreateUserAgentRequest {
  agent_id: string;
  alias?: string;
  config?: Record<string, any>;
}

export interface UpdateUserAgentRequest {
  alias?: string;
  config?: Record<string, any>;
  is_active?: boolean;
}

export interface CreateAgentRunRequest {
  user_agent_id: string;
  input?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface UpdateAgentRunRequest {
  output?: Record<string, any>;
  status: AgentRunStatus;
  logs?: string;
  execution_duration_ms?: number;
  error_message?: string;
  metadata?: Record<string, any>;
}

// Enhanced context for AI prompt enrichment
export interface UserContext {
  user: User;
  memories: UserMemory[];
  activeAgents: UserAgent[];
  recentRuns: AgentRun[];
}

export interface MemoryEnrichedPrompt {
  originalPrompt: string;
  enrichedPrompt: string;
  userContext: UserContext;
  appliedMemories: UserMemory[];
}

// Query filters
export interface UserMemoryFilter {
  memory_type?: MemoryType;
  key?: string;
  is_active?: boolean;
  search?: string; // for searching in value or metadata
}

export interface AgentRunFilter {
  status?: AgentRunStatus;
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  offset?: number;
}
