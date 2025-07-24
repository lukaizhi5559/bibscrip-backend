-- Migration: Add normalized_value column to memory_entities table
-- Description: Adds support for storing normalized/standardized values for entities
-- (e.g., "3pm" -> "15:00", "next week" -> "2025-07-28")

-- Add normalized_value column to memory_entities table
ALTER TABLE memory_entities 
ADD COLUMN IF NOT EXISTS normalized_value TEXT;

-- Add index for normalized_value for efficient querying
CREATE INDEX IF NOT EXISTS idx_memory_entities_normalized_value ON memory_entities(normalized_value);

-- Add comment to document the column purpose
COMMENT ON COLUMN memory_entities.normalized_value IS 'Standardized/normalized representation of the entity value (e.g., time normalization, date conversion, etc.)';
