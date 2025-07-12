-- Migration: Add Anonymous User for WebSocket Memory Storage
-- Description: Creates a special anonymous user for storing memories from unauthenticated WebSocket connections

-- Create anonymous user with a fixed UUID for consistency
INSERT INTO users (
    id,
    email,
    name,
    is_active,
    preferences,
    metadata
) VALUES (
    '00000000-0000-0000-0000-000000000000', -- Fixed UUID for anonymous user
    'anonymous@bibscrip.ai',
    'Anonymous User',
    TRUE,
    '{"anonymous": true}',
    '{"description": "System user for unauthenticated WebSocket connections", "created_by": "migration"}'
)
ON CONFLICT (email) DO NOTHING;

-- Verification query (commented out for production)
-- SELECT 'Anonymous user created with ID:' as info, id as anonymous_user_id FROM users WHERE email = 'anonymous@bibscrip.ai';
