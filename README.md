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

PostgreSQL must be running on the **VPS host** (or another reachable host). Copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL` with **`host.docker.internal`** as the hostname (not `localhost`), so the backend container can reach the hosts Postgres:

```env
DATABASE_URL=postgresql://USER:PASSWORD@host.docker.internal:5432/DATABASE
```

Ensure Postgres accepts TCP connections from Docker (e.g. `listen_addresses = '*'` in `postgresql.conf` and `pg_hba.conf` allows the Docker bridge). The compose file maps `host.docker.internal` to the host gateway.

From the project root:

```bash
docker compose up --build -d
```

Open:

- App: `http://localhost/` or `http://YOUR_VPS_IP/` (compose maps **host port 80**). Port **6000** is avoided in browsers (`ERR_UNSAFE_PORT`). If **`docker compose up` fails** with “port already allocated”, something else is using port 80—stop that service (e.g. host nginx) or change the published port.

Stop:

```bash
docker compose down
```

Stop and remove the uploads volume:

```bash
docker compose down -v
```

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
