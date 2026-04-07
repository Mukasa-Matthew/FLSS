const path = require("node:path");
const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const ensureSchema = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_files (
      id UUID PRIMARY KEY,
      original_name TEXT NOT NULL,
      storage_name TEXT NOT NULL UNIQUE,
      mime_type TEXT,
      size_bytes BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delete_token_hash TEXT,
      delete_expires_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    ALTER TABLE shared_files
    ADD COLUMN IF NOT EXISTS delete_token_hash TEXT;
  `);

  await pool.query(`
    ALTER TABLE shared_files
    ADD COLUMN IF NOT EXISTS delete_expires_at TIMESTAMPTZ;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS file_downloads (
      file_id UUID NOT NULL REFERENCES shared_files(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      download_count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (file_id, username)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_shared_files_created_at
    ON shared_files (created_at DESC);
  `);
};

module.exports = {
  pool,
  ensureSchema,
};
