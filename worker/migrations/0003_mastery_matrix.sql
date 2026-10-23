-- The learner's mastery matrix, bit-packed (src/engine/matrix.ts) and base64 encoded:
-- one estimate per concept from the attention tracker. There is one row; a save
-- replaces it only with a newer updated_at, like a term_progress row.
CREATE TABLE IF NOT EXISTS mastery_matrix (
  id TEXT PRIMARY KEY CHECK (id = 'current'),
  packed TEXT NOT NULL,
  concepts INTEGER NOT NULL,
  list_version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
