-- Migration: Create AI Memory System for Intent Classification Storage
-- Description: Implements DuckDB-style memory, intent_candidates, and memory_entities tables
-- for Thinkdrop AI's Intent Classification and Memory Architecture

-- 1. Create memory table (core AI memory store)
CREATE TABLE IF NOT EXISTS memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMP DEFAULT NOW(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'intent_classification', 'note', 'summary', 'command_result', 'conversation'
    primary_intent TEXT,
    requires_memory_access BOOLEAN DEFAULT FALSE,
    requires_external_data BOOLEAN DEFAULT FALSE,
    suggested_response TEXT,
    source_text TEXT NOT NULL, -- original input/prompt
    metadata JSONB DEFAULT '{}', -- flexible storage for additional context
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Create intent_candidates table (1:N relationship with memory)
CREATE TABLE IF NOT EXISTS intent_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
    intent TEXT NOT NULL, -- 'greeting', 'memory_store', 'command', 'question', etc.
    confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    reasoning TEXT, -- explanation of why this intent was detected
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Create memory_entities table (1:N relationship with memory)
CREATE TABLE IF NOT EXISTS memory_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
    entity TEXT NOT NULL, -- extracted entities like 'meeting note', 'quarterly review'
    entity_type TEXT, -- optional classification: 'topic', 'action', 'person', 'date', etc.
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_memory_user_id ON memory(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);
CREATE INDEX IF NOT EXISTS idx_memory_primary_intent ON memory(primary_intent);
CREATE INDEX IF NOT EXISTS idx_memory_timestamp ON memory(timestamp);
CREATE INDEX IF NOT EXISTS idx_memory_requires_memory_access ON memory(requires_memory_access);
CREATE INDEX IF NOT EXISTS idx_memory_requires_external_data ON memory(requires_external_data);

CREATE INDEX IF NOT EXISTS idx_intent_candidates_memory_id ON intent_candidates(memory_id);
CREATE INDEX IF NOT EXISTS idx_intent_candidates_intent ON intent_candidates(intent);
CREATE INDEX IF NOT EXISTS idx_intent_candidates_confidence ON intent_candidates(confidence);

CREATE INDEX IF NOT EXISTS idx_memory_entities_memory_id ON memory_entities(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity);
CREATE INDEX IF NOT EXISTS idx_memory_entities_type ON memory_entities(entity_type);

-- Create GIN indexes for JSONB columns for efficient querying
CREATE INDEX IF NOT EXISTS idx_memory_metadata_gin ON memory USING GIN(metadata);

-- Create full-text search indexes for text content
CREATE INDEX IF NOT EXISTS idx_memory_source_text_gin ON memory USING GIN(to_tsvector('english', source_text));
CREATE INDEX IF NOT EXISTS idx_memory_suggested_response_gin ON memory USING GIN(to_tsvector('english', suggested_response));
CREATE INDEX IF NOT EXISTS idx_intent_candidates_reasoning_gin ON intent_candidates USING GIN(to_tsvector('english', reasoning));

-- Add triggers for updated_at timestamps
CREATE TRIGGER update_memory_updated_at BEFORE UPDATE ON memory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_memory_user_type_timestamp ON memory(user_id, type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_memory_user_intent_timestamp ON memory(user_id, primary_intent, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_intent_candidates_intent_confidence ON intent_candidates(intent, confidence DESC);

-- Insert sample AI memory data for testing (based on your example)
-- Sample memory entry for intent classification
INSERT INTO memory (
    user_id, 
    type, 
    primary_intent, 
    requires_memory_access, 
    requires_external_data, 
    suggested_response, 
    source_text, 
    metadata
) 
SELECT 
    u.id,
    'intent_classification',
    'memory_store',
    TRUE,
    FALSE,
    'Hello! I''d be glad to help you with storing your meeting note about the quarterly review. Just to confirm, could you please provide the details you would like to save?',
    'Hello! Can you help me store this meeting note about our quarterly review?',
    '{"intents_count": 4, "entities_count": 2, "session_id": "sample_session", "client_id": "sample_client"}'::jsonb
FROM users u 
WHERE u.email = 'sam@thinkdrop.ai'
LIMIT 1
ON CONFLICT DO NOTHING;

-- Insert sample intent candidates for the memory entry
INSERT INTO intent_candidates (memory_id, intent, confidence, reasoning)
SELECT 
    m.id,
    'greeting',
    0.95,
    'The message starts with "Hello!" which is a clear greeting pattern'
FROM memory m 
WHERE m.source_text = 'Hello! Can you help me store this meeting note about our quarterly review?'
UNION ALL
SELECT 
    m.id,
    'memory_store',
    0.9,
    'The user explicitly asks to "store this meeting note" which indicates memory storage intent'
FROM memory m 
WHERE m.source_text = 'Hello! Can you help me store this meeting note about our quarterly review?'
UNION ALL
SELECT 
    m.id,
    'command',
    0.8,
    'The user is requesting an action to be performed (storing a note)'
FROM memory m 
WHERE m.source_text = 'Hello! Can you help me store this meeting note about our quarterly review?'
UNION ALL
SELECT 
    m.id,
    'question',
    0.75,
    'The user phrases their request as a question "Can you help me..."'
FROM memory m 
WHERE m.source_text = 'Hello! Can you help me store this meeting note about our quarterly review?'
ON CONFLICT DO NOTHING;

-- Insert sample entities for the memory entry
INSERT INTO memory_entities (memory_id, entity, entity_type)
SELECT 
    m.id,
    'meeting note',
    'document_type'
FROM memory m 
WHERE m.source_text = 'Hello! Can you help me store this meeting note about our quarterly review?'
UNION ALL
SELECT 
    m.id,
    'quarterly review',
    'topic'
FROM memory m 
WHERE m.source_text = 'Hello! Can you help me store this meeting note about our quarterly review?'
ON CONFLICT DO NOTHING;

-- Verification queries (commented out for production)
-- SELECT 'AI Memory entries created:' as info, COUNT(*) as count FROM memory;
-- SELECT 'Intent candidates created:' as info, COUNT(*) as count FROM intent_candidates;
-- SELECT 'Memory entities created:' as info, COUNT(*) as count FROM memory_entities;
-- SELECT 'AI Memory system created successfully' as status;
