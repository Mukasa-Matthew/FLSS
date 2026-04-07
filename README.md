# File Sharing App

Simple file sharing app with:

- Backend: Node.js + Fastify
- Database: PostgreSQL
- Frontend: React + Vite + modern dashboard UI
- Deployment: Docker Compose (VPS friendly)

## Features

- Upload a file from the browser
- Persist file metadata in PostgreSQL
- Persist uploaded files in a Docker volume
- List all shared files
- Download requires username + password from `.env`
- Each configured user can download a file up to 2 times
- File auto-deletes after every configured user downloads it at least once
- Uploader can delete only their own file within 2 minutes of upload

## Run with Docker (recommended)

Compose runs **PostgreSQL**, **backend**, and **frontend** on one Docker network. Nginx proxies `/api` to **`http://backend:5000`** (no host-gateway hacks).

1. Copy **`backend/.env.example`** → **`backend/.env`** and set **`DATABASE_URL`** with hostname **`db`**:

   ```env
   DATABASE_URL=postgresql://flss_user:YOUR_PASSWORD@db:5432/filesharing
   ```

2. Copy **`.env.example`** → **`.env`** in the **project root** (next to `docker-compose.yml`). Set **`FLSS_POSTGRES_PASSWORD`** to the **same** password as in `DATABASE_URL`.

3. From the project root:

   ```bash
   docker compose up --build -d
   ```

Open:

- App: `http://localhost/` or `http://YOUR_VPS_IP/` (port **80**). If **“port already allocated”**, stop whatever else uses port 80 (e.g. host nginx).

Stop:

```bash
docker compose down
```

Stop and remove **database + uploads** volumes (deletes Postgres data and uploaded files):

```bash
docker compose down -v
```

If you previously used Postgres **on the host**, migrate with `pg_dump` / `pg_restore` into the `db` container, or start fresh with the steps above.

## Local development (without Docker)

### 1) Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Then open Vite URL (typically `http://localhost:5173`).

## Default limits

- Max upload file size: `100MB` (`MAX_FILE_SIZE_BYTES`)

You can change this in Docker environment or backend `.env`.

## Download Access Configuration

Set users in `backend/.env`:

```env
DOWNLOAD_USERS_JSON=[{"username":"Ocen","password":"12345"},{"username":"Liz","password":"54321"},{"username":"Matt","password":"1100211Matt."},{"username":"Mwiza","password":"Mwiza"}]
```

Optional:

```env
DELETE_WINDOW_MINUTES=2
```
