const env = require("../../config/env");
const ChatMessage = require("../../db/models/chat-message.model");

// Default persona used when a session has no explicit system_prompt. Keeps new
// sessions on-brand for Zona Merah while staying overridable per session.
const DEFAULT_SYSTEM_PROMPT = [
  "You are Jessica, the Zona Merah Project Zomboid community assistant.",
  "Be direct, practical, and friendly. Mirror the user's language (English/Indonesian mix is fine).",
  "Answer general questions too; do not reject a user just because the topic is outside Zona Merah.",
  "Use the prior conversation in this session as memory and continue the thread naturally.",
  "If you are unsure or lack the server-specific facts, say so instead of guessing.",
].join(" ");

function serializeMessage(message) {
  if (!message) return null;
  const data = typeof message.toJSON === "function" ? message.toJSON() : message;
  return {
    id: data.id,
    session_id: data.sessionId,
    user_id: data.userId != null ? String(data.userId) : null,
    role: data.role,
    content: data.content,
    token_count: data.tokenCount ?? null,
    metadata: data.metadata || {},
    created_at: data.createdAt,
  };
}

async function addMessage({ sessionId, userId, role, content, tokenCount, metadata, transaction }) {
  return ChatMessage.create(
    {
      sessionId,
      userId: userId ?? null,
      role,
      content,
      tokenCount: tokenCount ?? null,
      metadata: metadata || {},
    },
    { transaction }
  );
}

/** Full history for a session, oldest first (used by the GET messages endpoint). */
async function getSessionMessages(sessionId) {
  return ChatMessage.findAll({
    where: { sessionId },
    order: [
      ["createdAt", "ASC"],
      ["id", "ASC"],
    ],
  });
}

/**
 * Conversation memory: the last `limit` messages for a session, ordered oldest
 * to newest. We fetch the newest N (DESC + LIMIT) then reverse, so the most
 * recent turns — including the just-saved user message — are always kept.
 */
async function getSessionContextMessages(sessionId, limit) {
  const parsed = Number(limit);
  const safeLimit =
    Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : env.chatHistoryLimit;

  const rows = await ChatMessage.findAll({
    where: { sessionId },
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
    limit: safeLimit,
  });

  return rows.reverse();
}

/**
 * Build the OpenAI message array from a session + its recent messages.
 * The session system_prompt (or a sensible default) goes first; only user and
 * assistant turns are forwarded so the payload stays valid for chat.completions.
 */
function buildOpenAiMessages(session, messageRows) {
  const systemPrompt =
    (session.systemPrompt && session.systemPrompt.trim()) || DEFAULT_SYSTEM_PROMPT;

  const messages = [{ role: "system", content: systemPrompt }];

  for (const row of messageRows) {
    if (row.role === "user" || row.role === "assistant") {
      messages.push({ role: row.role, content: row.content });
    }
  }

  return messages;
}

/**
 * Derive a short session title from the first user message.
 * Trimmed to <= 50 characters on a word boundary; no extra OpenAI call.
 */
function deriveTitleFromMessage(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= 50) return text;

  const truncated = text.slice(0, 47);
  const lastSpace = truncated.lastIndexOf(" ");
  const base = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
  return `${base.trim()}...`;
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  serializeMessage,
  addMessage,
  getSessionMessages,
  getSessionContextMessages,
  buildOpenAiMessages,
  deriveTitleFromMessage,
};
