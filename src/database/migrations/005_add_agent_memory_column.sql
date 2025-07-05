-- Migration: Add memory column to agents table for AgentMemoryContext support
-- Phase 1: Agent Model Extensions - Memory Context Support
-- Date: 2025-07-05
-- Description: Adds memory JSONB column to store AgentMemoryContext data including
--              conversation history, entity memory, execution state, and custom context

-- Add memory column to agents table
ALTER TABLE agents 
ADD COLUMN memory JSONB DEFAULT NULL;

-- Add comment for the memory column
COMMENT ON COLUMN agents.memory IS 'Agent memory context including conversation history, entity memory, execution state, and custom context for stateful agent operations';

-- Create GIN index for efficient JSONB queries on memory column
CREATE INDEX idx_agents_memory_gin ON agents USING gin (memory);

-- Create partial index for agents that have memory (non-null)
CREATE INDEX idx_agents_has_memory ON agents (id) WHERE memory IS NOT NULL;

-- Create index for memory userId for efficient user-specific queries (using btree for text)
CREATE INDEX idx_agents_memory_user_id ON agents ((memory->>'userId')) WHERE memory IS NOT NULL;

-- Create index for memory sessionId for efficient session-specific queries (using btree for text)
CREATE INDEX idx_agents_memory_session_id ON agents ((memory->>'sessionId')) WHERE memory IS NOT NULL;

-- Update existing agents to have empty memory context (optional - can remain NULL for backward compatibility)
-- Uncomment the following line if you want to initialize all existing agents with empty memory
-- UPDATE agents SET memory = '{}' WHERE memory IS NULL;

-- Verify the migration
DO $$
BEGIN
    -- Check if memory column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'agents' AND column_name = 'memory'
    ) THEN
        RAISE EXCEPTION 'Migration failed: memory column was not added to agents table';
    END IF;
    
    -- Check if GIN index exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'agents' AND indexname = 'idx_agents_memory_gin'
    ) THEN
        RAISE EXCEPTION 'Migration failed: idx_agents_memory_gin index was not created';
    END IF;
    
    RAISE NOTICE 'Migration 005_add_agent_memory_column.sql completed successfully';
END $$;
