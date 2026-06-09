# ZM AI Assistance API

Modular and scalable Node.js backend starter for OpenAI-assisted features with Sequelize + PostgreSQL.

## Stack

- Express 5
- Sequelize 6 + PostgreSQL
- OpenAI Node SDK
- Zod request validation

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Ensure your existing `.env` has DB and OpenAI credentials.

3. Run migrations:

   ```bash
   npm run db:migrate
   ```

4. Start development server:

   ```bash
   npm run dev
   ```

## Scripts

- `npm run dev` - Start with nodemon
- `npm run start` - Start app
- `npm run db:check` - Test SQL connectivity
- `npm run db:migrate` - Run Sequelize migrations
- `npm run db:migrate:undo` - Revert latest migration

When you start the API with `node src/server.js` (or `npm start`), the Discord listener now starts automatically by default.
Set `DISCORD_LISTENER_WITH_SERVER=false` to disable auto-start and run listener separately.

## Discord Prompt Daily Limit

For the separate Discord listener (`npm run discord:listener`), non-admin users are rate limited per UTC day.

- Default limit: `10` prompts/day (configurable via `DISCORD_DAILY_PROMPT_LIMIT`)
- Admin bypass roles: configured by `DISCORD_ADMIN_ROLE_NAMES` and/or `DISCORD_ADMIN_ROLE_IDS`
- Admin bypass toggle: `DISCORD_ADMIN_BYPASS_ENABLED=true` (set to `false` to force admins through quota for testing)
- Disallowed-channel notice toggle: `DISCORD_NOTIFY_DISALLOWED_CHANNEL=true`
- Ignored-prompt log toggle: `DISCORD_LOG_IGNORED_PROMPTS=true`
- Usage is persisted in table: `discord_prompt_daily_limits`

Per-user limit can be changed directly in PostgreSQL:

```sql
UPDATE discord_prompt_daily_limits
SET daily_limit = 25
WHERE discord_user_id = '123456789012345678';
```

## API Endpoints

- `GET /api/v1/health` - Health + DB status
- `POST /api/v1/ai/chat` - Stateless AI chat completion (per-user rolling memory)
- `POST /api/v1/auth/login` - Login with username/password
- `POST /api/v1/auth/register` - Register account and receive token
- `GET /api/v1/auth/me` - Read authenticated user from Bearer token

Persistent chat sessions (all require a Bearer token; see below):

- `POST   /api/v1/chat/sessions` - Create a chat session
- `GET    /api/v1/chat/sessions` - List the caller's active sessions
- `GET    /api/v1/chat/sessions/:sessionId/messages` - Get a session's message history
- `POST   /api/v1/chat/sessions/:sessionId/messages` - Send a message and get the AI reply
- `PATCH  /api/v1/chat/sessions/:sessionId` - Rename / update system prompt
- `DELETE /api/v1/chat/sessions/:sessionId` - Soft-delete a session

Example request for AI:

```json
{
   "prompt": "Create a short welcome message for new server members",
   "userId": "discord-1234567890"
}
```

Use a stable `userId` value to enable conversation continuity (Jessica will remember recent turns for that user).

## Persistent Chat Sessions

`POST /api/v1/ai/chat` is stateless (it replays a short rolling window of a user's
recent prompts). The `chat` module adds **multi-session, database-backed memory**:
a user can keep many conversations, reopen old ones, and the AI sees that session's
own history on every turn.

### How it works

1. Conversation state lives in PostgreSQL (`chat_sessions`, `chat_messages`) — the
   OpenAI API itself stays stateless.
2. On each `POST .../messages` call the server: validates session ownership →
   saves the user message → loads the last `CHAT_HISTORY_LIMIT` messages (oldest →
   newest) → prepends the session `system_prompt` → calls OpenAI → saves the
   assistant reply and bumps `updated_at`.
3. Sessions are scoped to the authenticated user (`req.auth.id`, i.e.
   `zmusers.userid`). A session that is not yours — or is soft-deleted — returns
   `404 Session not found`.

### Environment variables

Reuses the existing OpenAI config and adds two optional knobs:

```bash
AI_API_KEY=sk-...          # OpenAI key (server-side only, never exposed)
AI_MODEL=gpt-5             # default model stored on new sessions
CHAT_HISTORY_LIMIT=30      # max messages replayed as memory per request (default 30)
CHAT_MAX_TOKENS=1024       # output token cap for session replies (default 1024)
```

> The migrations need `gen_random_uuid()` — available in PostgreSQL core (v13+);
> on older servers the `pgcrypto` extension provides it (the migration enables it
> with `CREATE EXTENSION IF NOT EXISTS`).

### Request / response examples (curl)

Get a token first (`/api/v1/auth/login` or `/register`), then:

```bash
TOKEN="<jwt-from-login>"
BASE="http://localhost:3002/api/v1/chat"

# Create a session
curl -s -X POST "$BASE/sessions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Server help","system_prompt":"You are Jessica, be concise."}'
# -> { "success": true, "data": { "session_id": "…", "title": "Server help", "model": "gpt-5", "system_prompt": "…", "created_at": "…" } }

# Send a message (SID = the session_id from above)
curl -s -X POST "$BASE/sessions/$SID/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"How do I check if the server is online?"}'
# -> { "success": true, "data": { "session_id": "…", "user_message": {…}, "assistant_message": {…} } }

# List sessions (most recently updated first)
curl -s "$BASE/sessions" -H "Authorization: Bearer $TOKEN"

# Get full history for a session
curl -s "$BASE/sessions/$SID/messages" -H "Authorization: Bearer $TOKEN"

# Rename / change system prompt
curl -s -X PATCH "$BASE/sessions/$SID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Whitelist troubleshooting"}'

# Soft-delete a session
curl -s -X DELETE "$BASE/sessions/$SID" -H "Authorization: Bearer $TOKEN"
```

Errors use the shared envelope `{ "success": false, "message": "…" }` (e.g. `401`
missing/invalid token, `400` validation, `404` session not found, `502` AI failure).

## Structure

```text
src/
  app.js
  server.js
  config/
  db/
    models/            # ChatSession, ChatMessage, ...
  middlewares/
  modules/
    ai/                # stateless /ai/chat
    auth/
    chat/              # session-based chat: routes, controller, schema, services
    health/
  utils/               # httpError helper
migrations/            # includes create-chat-sessions, create-chat-messages
scripts/
```
