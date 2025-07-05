-- Migration: Create User-Centric Persistent Memory System
-- Description: Implements users, user_agents, user_memories, and agent_runs tables
-- for Thinkdrop AI's Personal Intelligence Layer

-- 1. Create users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    preferences JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}'
);

-- 2. Create user_agents table (many-to-many users ↔ agents)
CREATE TABLE IF NOT EXISTS user_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    alias TEXT, -- optional user-friendly name like "Email Blessing Agent"
    config JSONB DEFAULT '{}', -- per-user agent configuration (scheduling, params)
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, agent_id) -- prevent duplicate user-agent associations
);

-- 3. Create user_memories table for persistent personal context
CREATE TABLE IF NOT EXISTS user_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    memory_type TEXT NOT NULL, -- "reminder", "preference", "belief", "habit", "verse", "prayer"
    key TEXT NOT NULL, -- "daily_email_reminder", "favorite_verse", "prayer_time"
    value TEXT NOT NULL,
    metadata JSONB DEFAULT '{}', -- e.g. frequency, time, delivery method, tags
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, memory_type, key) -- prevent duplicate memories per user
);

-- 4. Create agent_runs table for execution logging and audit trail
CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_agent_id UUID NOT NULL REFERENCES user_agents(id) ON DELETE CASCADE,
    run_time TIMESTAMP DEFAULT NOW(),
    input JSONB DEFAULT '{}',
    output JSONB DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending', -- "success", "failed", "pending", "cancelled"
    logs TEXT,
    execution_duration_ms INTEGER,
    error_message TEXT,
    metadata JSONB DEFAULT '{}' -- additional context, device info, etc.
);

-- Create indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);

CREATE INDEX IF NOT EXISTS idx_user_agents_user_id ON user_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_agents_agent_id ON user_agents(agent_id);
CREATE INDEX IF NOT EXISTS idx_user_agents_active ON user_agents(is_active);

CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_type ON user_memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_user_memories_key ON user_memories(key);
CREATE INDEX IF NOT EXISTS idx_user_memories_active ON user_memories(is_active);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_agent_id ON agent_runs(user_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_run_time ON agent_runs(run_time);

-- Create GIN indexes for JSONB columns for efficient querying
CREATE INDEX IF NOT EXISTS idx_users_preferences_gin ON users USING GIN(preferences);
CREATE INDEX IF NOT EXISTS idx_users_metadata_gin ON users USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_user_agents_config_gin ON user_agents USING GIN(config);
CREATE INDEX IF NOT EXISTS idx_user_memories_metadata_gin ON user_memories USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_agent_runs_input_gin ON agent_runs USING GIN(input);
CREATE INDEX IF NOT EXISTS idx_agent_runs_output_gin ON agent_runs USING GIN(output);
CREATE INDEX IF NOT EXISTS idx_agent_runs_metadata_gin ON agent_runs USING GIN(metadata);

-- Add triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_agents_updated_at BEFORE UPDATE ON user_agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_memories_updated_at BEFORE UPDATE ON user_memories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert sample data for testing (optional - can be removed in production)
-- Sample user
INSERT INTO users (email, name, preferences, metadata) VALUES 
('sam@thinkdrop.ai', 'Sam', 
 '{"bible_version": "ESV", "prayer_time": "08:00", "worldview": "biblical_conservative"}',
 '{"timezone": "America/New_York", "created_by": "migration"}')
ON CONFLICT (email) DO NOTHING;

-- Sample user memories for Sam
INSERT INTO user_memories (user_id, memory_type, key, value, metadata) 
SELECT 
    u.id,
    'belief',
    'core_faith',
    'Jesus is my Lord and Savior',
    '{"importance": "high", "source": "personal_declaration"}'
FROM users u WHERE u.email = 'sam@thinkdrop.ai'
ON CONFLICT (user_id, memory_type, key) DO NOTHING;

INSERT INTO user_memories (user_id, memory_type, key, value, metadata) 
SELECT 
    u.id,
    'preference',
    'daily_blessing_time',
    '08:00 AM',
    '{"frequency": "daily", "method": "email", "timezone": "America/New_York"}'
FROM users u WHERE u.email = 'sam@thinkdrop.ai'
ON CONFLICT (user_id, memory_type, key) DO NOTHING;

INSERT INTO user_memories (user_id, memory_type, key, value, metadata) 
SELECT 
    u.id,
    'verse',
    'favorite_verse',
    'For I know the plans I have for you, declares the Lord, plans for welfare and not for evil, to give you a future and a hope. - Jeremiah 29:11',
    '{"reference": "Jeremiah 29:11", "version": "ESV", "category": "hope"}'
FROM users u WHERE u.email = 'sam@thinkdrop.ai'
ON CONFLICT (user_id, memory_type, key) DO NOTHING;

-- Verification queries (commented out for production)
-- SELECT 'Users created:' as info, COUNT(*) as count FROM users;
-- SELECT 'User memories created:' as info, COUNT(*) as count FROM user_memories;
-- SELECT 'Tables created successfully' as status;
