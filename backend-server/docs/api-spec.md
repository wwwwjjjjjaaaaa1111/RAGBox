# Backend API Spec (MVP)

Base URL: `http://localhost:3001`

Version Prefix: `/v1`

Auth: Bearer session token

> **Identity model (since 2026-09):** users are accounts (`/v1/auth/register`,
> `/v1/auth/login`). Every business endpoint requires the header
> `Authorization: Bearer <token>`. The server derives `userId` from the session
> and **overwrites** any `userId` sent by the client, so `userId` fields shown in
> example bodies below are informational only. SSE endpoints (which cannot set
> headers) accept the token as `?token=<token>` instead.

Content-Type: `application/json` (except upload endpoint)

## Unified Response

Success:

```json
{
  "data": {}
}
```

Error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": [
      {
        "path": "userId",
        "message": "Required"
      }
    ]
  }
}
```

## Health

### GET /health

Response:

```json
{
  "ok": true
}
```

## Authentication

### POST /v1/auth/register

Description: create an account and immediately receive a session token.

Request Body:

```json
{
  "username": "demo_user",
  "password": "secret123"
}
```

Constraints: `username` 3-32 chars matching `[a-zA-Z0-9_-]+`; `password` 6-128 chars.

Response `201`:

```json
{
  "data": {
    "token": "64-char-hex-session-token",
    "expiresAt": "2026-09-06T10:00:00.000Z",
    "user": {
      "id": "uuid",
      "username": "demo_user"
    }
  }
}
```

Errors: `409 USERNAME_TAKEN`, `400 VALIDATION_ERROR`.

### POST /v1/auth/login

Description: verify username/password and issue a new session token.

Same request/response shape as register.

Errors: `401 INVALID_CREDENTIALS`.

### GET /v1/auth/me

Description: return the current user for the presented Bearer token.

Response `200`:

```json
{
  "data": {
    "id": "uuid",
    "username": "demo_user"
  }
}
```

Errors: `401 UNAUTHENTICATED` / `401 INVALID_SESSION`.

### POST /v1/auth/logout

Description: revoke the presented session token server-side.

Response `200`:

```json
{
  "data": { "success": true }
}
```

## Model Config (per user)

All endpoints require the Bearer token. API keys are stored server-side and are
never returned in plaintext — GET responses only expose `configured` and a
`maskedKey` (`****` + last 4 chars). Updating is overwrite-only: omit a key
field to keep the current value; there is no way to read it back.

### GET /v1/model-config

Response `200`:

```json
{
  "data": {
    "chatBaseUrl": "https://openrouter.ai/api/v1",
    "chatModel": "provider/model:free",
    "embeddingBaseUrl": null,
    "embeddingModel": "embedding-3",
    "chatApiKey": { "configured": true, "maskedKey": "****5678" },
    "embeddingApiKey": { "configured": false, "maskedKey": null }
  }
}
```

### PUT /v1/model-config

Semantics: omitted field = keep current value (URL/model fields also accept an
empty string as "keep"); `apiKey` fields with an empty string are rejected —
omit them to keep, send a new value to overwrite.

Request Body (all fields optional):

```json
{
  "chatBaseUrl": "https://openrouter.ai/api/v1",
  "chatApiKey": "sk-or-v1-...",
  "chatModel": "provider/model:free",
  "embeddingBaseUrl": "",
  "embeddingApiKey": "zk-...",
  "embeddingModel": "embedding-3"
}
```

Response: same shape as GET (masked).

The saved config overrides AI-server `.env` values per request: chat
completions forward the chat+embedding override; ingestion dispatch forwards
the embedding override. Fields left empty fall back to `.env`.

### DELETE /v1/model-config

Clears the user's custom config; subsequent requests fall back to `.env` defaults.

`GET/PUT` also carry optional tuning params (all nullable integers/float, no
masking): `chunkSize` (200-4000), `chunkOverlap` (0-1000), `retrievalTopK`
(1-20), `retrievalScoreThreshold` (0-1). Chunk params apply to files ingested
afterwards; retrieval params apply to subsequent questions.

### PUT /v1/chat/sessions/:id/files

Description: set the retrieval scope of a session. Empty array = search all of
the user's files. The scope is enforced server-side during chat completions.

Request Body:

```json
{ "fileIds": ["uuid", "..."] }
```

Response `200`: `{ "data": { "id": "uuid", "fileIds": [...] } }`

Also accepted on `POST /v1/chat/sessions` as optional `fileIds`.

## File + Ingestion Task

### POST /v1/files/precheck

Description: before uploading, check whether the signed-in user already has a file with the same MD5.

Request Body:

```json
{
  "contentMd5": "0f343b0931126a20f133d67c2b018a3b"
}
```

Response `200` (not exists):

```json
{
  "data": {
    "exists": false,
    "file": null
  }
}
```

Response `200` (exists):

```json
{
  "data": {
    "exists": true,
    "file": {
      "id": "uuid",
      "fileName": "manual.pdf",
      "parseStatus": "queued",
      "uploadedAt": "2026-03-31T10:00:00.000Z"
    }
  }
}
```

### POST /v1/files/upload

Description: upload binary file via multipart after precheck passes, then server computes MD5, persists the file, and creates an ingestion task asynchronously.

Request Content-Type:

- `multipart/form-data`

Form fields:

- `userId` (optional; derived from the session when omitted)
- `file` (required, binary)

Notes:

- `storagePath` is generated by server, not provided by frontend.
- Current implementation writes upload to disk temp path first, then computes MD5 by stream to support large files.
- Final persisted path is organized by user directory: `upload/<userId>/<contentMd5>.<ext>`.
- Duplicate validation should be done via `POST /v1/files/precheck` before calling this endpoint.

Example (conceptual):

```json
{
  "userId": "fp_xxx",
  "file": "<binary>"
}
```

Response `201`:

```json
{
  "data": {
    "file": {
      "id": "uuid",
      "fileName": "manual.pdf",
      "fileSizeBytes": 104857600,
      "parseStatus": "pending",
      "uploadedAt": "2026-04-01T12:00:00.000Z"
    }
  }
}
```

Error `409`:

- `FILE_ALREADY_EXISTS`

### Chunked Upload APIs (Large File / Resume)

#### POST /v1/files/upload/chunked/init

Description: initialize one resumable chunk upload session.

Request Body:

```json
{
  "userId": "fp_xxx",
  "uploadId": "0f343b0931126a20f133d67c2b018a3b",
  "fileName": "manual.pdf",
  "fileSizeBytes": 104857600,
  "totalChunks": 40
}
```

Response `201`:

```json
{
  "data": {
    "uploadId": "0f343b0931126a20f133d67c2b018a3b",
    "totalChunks": 40,
    "uploadedChunks": []
  }
}
```

#### POST /v1/files/upload/chunked/chunk

Description: upload one chunk file.

Request Content-Type:

- `multipart/form-data`

Form fields:

- `uploadId` (required, 32-char MD5 hex string)
- `chunkIndex` (required, integer, starts at 0)
- `file` (required, binary)

Response `200`:

```json
{
  "data": {
    "uploadId": "0f343b0931126a20f133d67c2b018a3b",
    "totalChunks": 40,
    "uploadedChunks": [0, 1, 2]
  }
}
```

#### GET /v1/files/upload/chunked/status

Description: query uploaded chunk indexes for resume.

Query Params:

- `uploadId` (required, 32-char MD5 hex string)

Response `200`:

```json
{
  "data": {
    "uploadId": "0f343b0931126a20f133d67c2b018a3b",
    "totalChunks": 40,
    "uploadedChunks": [0, 1, 2]
  }
}
```

#### POST /v1/files/upload/chunked/complete

Description: merge all uploaded chunks, then run server-side md5 persistence and ingestion dispatch.

Request Body:

```json
{
  "uploadId": "0f343b0931126a20f133d67c2b018a3b"
}
```

Response `201`: same as `/v1/files/upload` response shape.

### Frontend Upload Calling Protocol

This section defines the recommended client-side flow for large-file upload, resume, and retry.

1. Decide upload strategy

- Compute file MD5 in browser first.
- Call POST /v1/files/precheck with:
  - userId
  - contentMd5
- If `exists=true`, stop upload and reuse existing file state in UI.
- If file size is small (for example <= 20 MB), client can call POST /v1/files/upload directly.
- If file size is large, client should use the chunked upload APIs below.

1. Initialize upload session

- Call POST /v1/files/upload/chunked/init with:
  - userId
  - uploadId (file MD5)
  - fileName
  - fileSizeBytes
  - totalChunks
- Persist uploadId locally (memory + localStorage/IndexedDB) for resume.

1. Upload chunks (can be concurrent)

- Split file into fixed chunks.
- Recommended chunk size: 2 MB to 8 MB.
- Recommended parallelism: 3 to 5 concurrent requests.
- For each chunk call POST /v1/files/upload/chunked/chunk with:
  - uploadId
  - chunkIndex
  - file (binary)

1. Retry policy

- On network/server transient failure, retry current chunk.
- Recommended retry count: up to 3 times per chunk.
- Recommended backoff: 500 ms, 1000 ms, 2000 ms.
- If a chunk still fails after max retries, pause upload and keep uploadId for resume.

1. Resume policy (breakpoint continuation)

- On app refresh/reopen, call GET /v1/files/upload/chunked/status?uploadId=...
- Read uploadedChunks and skip uploaded indices.
- Continue uploading only missing chunk indices.

1. Complete upload

- After all indices [0..totalChunks-1] are uploaded, call POST /v1/files/upload/chunked/complete.
- Server merges chunks, computes MD5, writes metadata, and creates ingestion task.

1. Post-complete handling

- On success, response contains the created file summary only.
- The ingestion task is created internally and subsequent status changes are delivered through the file list plus SSE events.
- If client skipped precheck or a concurrent upload won the race, server may return `409 FILE_ALREADY_EXISTS`.

1. UI state recommendations

- Show upload progress during chunk transfer.
- After upload completes, refresh `/v1/files` and rely on SSE updates for later ingestion changes.
- Keep uploadId bound to a file fingerprint (name + size + lastModified) on client for resume UX.
- Server stores final files under `upload/<userId>/...`.

1. Suggested completion criteria

- Upload phase completed when complete API returns 201.
- Knowledge readiness completed when related file `parseStatus` becomes `indexed`.

### GET /v1/files

Description: list files for the signed-in user.

Query Params:

- `userId` (required, string)
- `parseStatus` (optional, enum: `queued|running|success|failed|cancelled`)
- `limit` (optional, int, default `50`, range `1-200`)

Compatibility:

- Query param `browserFingerprintHash` is still accepted for backward compatibility.

Response `200`:

```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "fp_xxx",
      "fileName": "manual.pdf",
      "fileSizeBytes": 2048,
      "storagePath": "upload/fp_xxx/0f343b0931126a20f133d67c2b018a3b.pdf",
      "parseStatus": "success",
      "uploadedAt": "2026-03-31T10:00:00.000Z"
    }
  ]
}
```

### GET /v1/tasks/:taskId

Description: get ingestion task status.

Path Params:

- `taskId` (required, UUID)

Response `200`:

```json
{
  "data": {
    "id": "uuid",
    "userId": "fp_xxx",
    "fileId": "uuid",
    "status": "running",
    "progress": 35,
    "errorMessage": null,
    "createdAt": "2026-03-31T10:00:00.000Z"
  }
}
```

Error `404`:

- `TASK_NOT_FOUND`

## AI Callback

### POST /v1/ai/ingestion/callback

Description: worker callback endpoint for ingestion status updates.

Request Body:

```json
{
  "taskId": "uuid",
  "status": "running",
  "progress": 55,
  "errorMessage": "optional"
}
```

Field rules:

- `taskId` required, UUID
- `status` required, enum: `queued|running|success|failed|cancelled`
- `progress` optional, number in `[0, 100]`
- `errorMessage` optional, string

Response `200`:

```json
{
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 5,
      "totalItems": 0,
      "totalPages": 1,
      "hasPreviousPage": false,
      "hasNextPage": false
    }
  }
}
```

## Chat Session + Message

### POST /v1/chat/sessions

Description: create chat session for the signed-in user.

Request Body:

```json
{
  "userId": "fp_xxx",
  "title": "My first session"
}
```

Response `201`:

```json
{
  "data": {
    "id": "uuid",
    "userId": "fp_xxx",
    "title": "My first session",
    "createdAt": "2026-03-31T10:00:00.000Z"
  }
}
```

### GET /v1/chat/sessions

Description: list sessions for the signed-in user.

Query Params:

- `userId` (required, string)
- `limit` (optional, int, default `50`, range `1-200`)

Compatibility:

- Query param `browserFingerprintHash` is still accepted for backward compatibility.

Response `200`:

```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "fp_xxx",
      "title": "My first session",
      "createdAt": "2026-03-31T10:00:00.000Z",
      "messageCount": 2
    }
  ]
}
```

### POST /v1/chat/sessions/:id/messages

Description: append one message to session.

Path Params:

- `id` (required, UUID)

Request Body:

```json
{
  "role": "user",
  "content": "hello"
}
```

Response `201`:

```json
{
  "data": {
    "id": "uuid",
    "sessionId": "uuid",
    "role": "user",
    "content": "hello",
    "createdAt": "2026-03-31T10:00:00.000Z"
  }
}
```

### GET /v1/chat/sessions/:id/messages

Description: list messages in session by creation order.

Path Params:

- `id` (required, UUID)

Query Params:

- `limit` (optional, int, default `50`, range `1-200`)

Response `200`:

```json
{
  "data": [
    {
      "id": "uuid",
      "sessionId": "uuid",
      "role": "user",
      "content": "hello",
      "createdAt": "2026-03-31T10:00:00.000Z"
    }
  ]
}
```

Error `404`:

- `SESSION_NOT_FOUND`

## Error Code Table

- `VALIDATION_ERROR`: request body/query/path does not satisfy schema.
- `TASK_NOT_FOUND`: task id not found.
- `SESSION_NOT_FOUND`: session id not found.
- `RESOURCE_NOT_FOUND`: generic DB not found fallback.
- `INTERNAL_SERVER_ERROR`: unhandled error.
- `UPLOAD_STORAGE_ERROR`: upload middleware did not produce file path.
- `FILE_ALREADY_EXISTS`: upload hit an existing `(userId, contentMd5)` record; caller should use precheck before upload.
- `UPLOAD_SESSION_NOT_FOUND`: chunk upload session not found.
- `CHUNK_UPLOAD_INCOMPLETE`: some chunk indexes are missing when completing upload.

## Ingestion State Transition

After `POST /v1/files/upload`, backend returns success immediately for new files, then relies on AI callback updates:

1. initial task `queued`, file `pending`
1. callback `running` -> file `processing`
1. callback `success` -> file `indexed`

Failure path:

- callback `failed` or `cancelled` -> file becomes `failed`
