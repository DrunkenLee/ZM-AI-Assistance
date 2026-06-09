const env = require("../../config/env");
const ChatSession = require("../../db/models/chat-session.model");
const { createHttpError } = require("../../utils/httpError");

/**
 * Shape a ChatSession model instance into the API response contract.
 * user_id is left as a string because PostgreSQL BIGINT exceeds JS safe-integer
 * range; treat it as an opaque identifier on the client.
 */
function serializeSession(session) {
  if (!session) return null;
  const data = typeof session.toJSON === "function" ? session.toJSON() : session;
  return {
    id: data.id,
    user_id: data.userId != null ? String(data.userId) : null,
    title: data.title ?? null,
    model: data.model,
    system_prompt: data.systemPrompt ?? null,
    metadata: data.metadata || {},
    created_at: data.createdAt,
    updated_at: data.updatedAt,
  };
}

async function createSession({ userId, title, systemPrompt }) {
  const session = await ChatSession.create({
    userId,
    title: title ?? null,
    systemPrompt: systemPrompt ?? null,
    model: env.aiModel, // remember the model configured at creation time
    metadata: {},
  });
  return session;
}

async function listSessions(userId) {
  // paranoid mode excludes soft-deleted sessions automatically.
  return ChatSession.findAll({
    where: { userId },
    order: [["updatedAt", "DESC"]],
  });
}

/**
 * Fetch a session and assert it belongs to the caller. Throws 404 for both
 * "does not exist" and "owned by someone else" so we never reveal which sessions
 * exist for other users. Soft-deleted sessions are invisible (paranoid).
 */
async function getOwnedSession(sessionId, userId) {
  const session = await ChatSession.findOne({
    where: { id: sessionId, userId },
  });
  if (!session) {
    throw createHttpError(404, "Session not found.");
  }
  return session;
}

async function updateSession(sessionId, userId, { title, systemPrompt }) {
  const session = await getOwnedSession(sessionId, userId);

  if (title !== undefined) session.title = title;
  if (systemPrompt !== undefined) session.systemPrompt = systemPrompt;

  await session.save();
  return session;
}

async function softDeleteSession(sessionId, userId) {
  const session = await getOwnedSession(sessionId, userId);
  await session.destroy(); // paranoid: sets deleted_at instead of hard delete
  return session.id;
}

/**
 * Bump updated_at so the session sorts to the top of the list after new activity.
 * Uses Model.update (always issues an UPDATE), which also fires the DB trigger.
 */
async function touchSession(sessionId, userId, transaction) {
  await ChatSession.update(
    { updatedAt: new Date() },
    { where: { id: sessionId, userId }, transaction }
  );
}

module.exports = {
  serializeSession,
  createSession,
  listSessions,
  getOwnedSession,
  updateSession,
  softDeleteSession,
  touchSession,
};
