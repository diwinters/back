-- Jetstream Post Search Index Migration
-- Run after Prisma migration to add PostgreSQL full-text search capabilities

-- Enable pg_trgm extension for fuzzy/partial text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add a generated tsvector column for full-text search (if not exists)
-- This uses 'simple' configuration to support multi-language content including Arabic
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'IndexedPost' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE "IndexedPost" ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('simple', coalesce(text, ''))) STORED;
  END IF;
END $$;

-- Create GIN index for full-text search (if not exists)
CREATE INDEX IF NOT EXISTS indexed_post_search_idx 
  ON "IndexedPost" USING GIN(search_vector);

-- Create trigram index for LIKE/ILIKE queries (partial matching)
CREATE INDEX IF NOT EXISTS indexed_post_text_trgm_idx 
  ON "IndexedPost" USING GIN(text gin_trgm_ops);

-- Create composite index for author + date queries
CREATE INDEX IF NOT EXISTS indexed_post_author_date_idx 
  ON "IndexedPost" ("authorDid", "createdAt" DESC);

-- Analyze the table for query optimizer
ANALYZE "IndexedPost";
