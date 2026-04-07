const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const { pipeline } = require("node:stream/promises");
const Fastify = require("fastify");
const multipart = require("@fastify/multipart");
const cors = require("@fastify/cors");
const { v4: uuidv4 } = require("uuid");
const { pool, ensureSchema } = require("./db");

const STREAM_HIGH_WATER_MARK = Number(
  process.env.STREAM_BUFFER_BYTES || 262144
);
const DELETE_WINDOW_MINUTES = Number(process.env.DELETE_WINDOW_MINUTES || 2);

const app = Fastify({ logger: true });
const uploadsDir = path.join(__dirname, "..", "uploads");

const parseConfiguredUsers = () => {
  let raw = process.env.DOWNLOAD_USERS_JSON;
  if (!raw) {
    throw new Error("DOWNLOAD_USERS_JSON is required in .env");
  }

  raw = raw.trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1);
  }
  raw = raw.replace(/\\"/g, '"');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DOWNLOAD_USERS_JSON must be valid JSON");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("DOWNLOAD_USERS_JSON must be a non-empty array");
  }

  const users = new Map();
  for (const item of parsed) {
    if (!item?.username || !item?.password) {
      throw new Error("Each DOWNLOAD_USERS_JSON item needs username and password");
    }
    users.set(String(item.username), String(item.password));
  }
  return users;
};

const configuredUsers = parseConfiguredUsers();
const requiredUsersCount = configuredUsers.size;
const passwordToUsername = new Map();
for (const [username, password] of configuredUsers.entries()) {
  if (passwordToUsername.has(password)) {
    throw new Error("Each user password must be unique in DOWNLOAD_USERS_JSON.");
  }
  passwordToUsername.set(password, username);
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.register(cors, {
  origin: process.env.CORS_ORIGIN || "*",
  exposedHeaders: ["X-Downloader-User"],
});

app.register(multipart, {
  limits: {
    fileSize: Number(process.env.MAX_FILE_SIZE_BYTES || 104857600),
  },
});

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/files", async (_request, reply) => {
  const result = await pool.query(
    `SELECT id, original_name, mime_type, size_bytes, created_at, delete_expires_at
     FROM shared_files
     ORDER BY created_at DESC`
  );
  reply.header("Cache-Control", "no-store");
  reply.send(result.rows);
});

app.post("/api/files/upload", async (request, reply) => {
  const file = await request.file();

  if (!file) {
    return reply.code(400).send({ message: "No file uploaded." });
  }

  const id = uuidv4();
  const extension = path.extname(file.filename || "");
  const storageName = `${id}${extension}`;
  const targetPath = path.join(uploadsDir, storageName);

  await pipeline(
    file.file,
    fs.createWriteStream(targetPath, { highWaterMark: STREAM_HIGH_WATER_MARK })
  );

  const stat = fs.statSync(targetPath);
  const deleteToken = crypto.randomBytes(24).toString("hex");
  const deleteTokenHash = crypto
    .createHash("sha256")
    .update(deleteToken)
    .digest("hex");
  const deleteExpiresAt = new Date(
    Date.now() + DELETE_WINDOW_MINUTES * 60 * 1000
  );
  await pool.query(
    `INSERT INTO shared_files (
      id, original_name, storage_name, mime_type, size_bytes, delete_token_hash, delete_expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      file.filename,
      storageName,
      file.mimetype,
      stat.size,
      deleteTokenHash,
      deleteExpiresAt,
    ]
  );

  return reply.code(201).send({
    id,
    original_name: file.filename,
    mime_type: file.mimetype,
    size_bytes: stat.size,
    delete_token: deleteToken,
    delete_expires_at: deleteExpiresAt.toISOString(),
  });
});

app.delete("/api/files/:id", async (request, reply) => {
  const { id } = request.params;
  const { deleteToken } = request.body || {};

  if (!deleteToken) {
    return reply.code(400).send({ message: "Delete token is required." });
  }

  const result = await pool.query(
    `SELECT storage_name, delete_token_hash, delete_expires_at
     FROM shared_files
     WHERE id = $1`,
    [id]
  );

  if (result.rowCount === 0) {
    return reply.code(404).send({ message: "File not found." });
  }

  const fileRecord = result.rows[0];
  const incomingTokenHash = crypto
    .createHash("sha256")
    .update(deleteToken)
    .digest("hex");

  if (fileRecord.delete_token_hash !== incomingTokenHash) {
    return reply.code(403).send({ message: "Only uploader can delete this file." });
  }

  if (
    fileRecord.delete_expires_at &&
    new Date(fileRecord.delete_expires_at).getTime() < Date.now()
  ) {
    return reply
      .code(403)
      .send({ message: "Delete window has expired (2 minutes)." });
  }

  await pool.query("DELETE FROM shared_files WHERE id = $1", [id]);

  const filePath = path.join(uploadsDir, fileRecord.storage_name);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  return reply.send({ message: "File deleted." });
});

app.post("/api/files/:id/download", async (request, reply) => {
  const { id } = request.params;
  const { password } = request.body || {};

  if (!password) {
    return reply.code(400).send({ message: "Password is required." });
  }

  if (!passwordToUsername.has(password)) {
    return reply.code(401).send({ message: "Wrong wrong password try again." });
  }
  const username = passwordToUsername.get(password);

  await pool.query("BEGIN");
  let fileRecord;
  let shouldDeleteAfterDownload = false;
  try {
    const fileResult = await pool.query(
      `SELECT id, original_name, storage_name, mime_type
       FROM shared_files
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (fileResult.rowCount === 0) {
      await pool.query("ROLLBACK");
      return reply.code(404).send({ message: "File not found." });
    }

    fileRecord = fileResult.rows[0];

    const currentCountResult = await pool.query(
      `SELECT download_count
       FROM file_downloads
       WHERE file_id = $1 AND username = $2`,
      [id, username]
    );

    const currentCount =
      currentCountResult.rowCount > 0
        ? Number(currentCountResult.rows[0].download_count)
        : 0;

    if (currentCount >= 2) {
      await pool.query("ROLLBACK");
      return reply
        .code(403)
        .send({ message: "You have reached your 2-download limit for this file." });
    }

    if (currentCountResult.rowCount === 0) {
      await pool.query(
        `INSERT INTO file_downloads (file_id, username, download_count, updated_at)
         VALUES ($1, $2, 1, NOW())`,
        [id, username]
      );
    } else {
      await pool.query(
        `UPDATE file_downloads
         SET download_count = download_count + 1, updated_at = NOW()
         WHERE file_id = $1 AND username = $2`,
        [id, username]
      );
    }

    const completedUsersResult = await pool.query(
      `SELECT COUNT(*)::INT AS completed_count
       FROM file_downloads
       WHERE file_id = $1
         AND username = ANY($2::TEXT[])
         AND download_count >= 1`,
      [id, Array.from(configuredUsers.keys())]
    );

    shouldDeleteAfterDownload =
      Number(completedUsersResult.rows[0].completed_count) >= requiredUsersCount;

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }

  const filePath = path.join(uploadsDir, fileRecord.storage_name);

  if (!fs.existsSync(filePath)) {
    return reply.code(404).send({ message: "Stored file is missing." });
  }

  const fileStat = fs.statSync(filePath);
  reply.header(
    "Content-Type",
    fileRecord.mime_type || "application/octet-stream"
  );
  reply.header("Content-Length", String(fileStat.size));
  reply.header(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(fileRecord.original_name)}"`
  );
  reply.header("X-Downloader-User", username);
  reply.header("Cache-Control", "no-store");

  if (shouldDeleteAfterDownload) {
    reply.raw.on("finish", async () => {
      try {
        await pool.query("DELETE FROM shared_files WHERE id = $1", [id]);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (cleanupError) {
        app.log.error(cleanupError, "Failed post-download cleanup");
      }
    });
  }

  return reply.send(
    fs.createReadStream(filePath, { highWaterMark: STREAM_HIGH_WATER_MARK })
  );
});

const start = async () => {
  try {
    await ensureSchema();
    const port = Number(process.env.PORT || 5000);
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`Backend listening on ${port}`);
    app.log.info(
      `Download auth enabled for ${requiredUsersCount} configured users`
    );
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
