-- HAIP AI grounded explanation/suggestions cached per agent decision.
-- Generated on demand for decisions a human reviews; null = unexplained/model unavailable.
ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS explanation jsonb;
