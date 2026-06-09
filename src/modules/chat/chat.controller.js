const { sequelize } = require("../../db/sql-helper");
const env = require("../../config/env");
const { createHttpError } = require("../../utils/httpError");
const chatSessionService = require("./chatSession.service");
const chatMessageService = require("./chatMessage.service");
const openaiService = require("./openai.service");
const { buildGrounding } = require("./grounding");
const { redactSecrets } = require("../../utils/redact");

/**
 * Resolve the authenticated user id from the verified JWT (set by authBearer).
 * zmusers.userid is a BIGINT, so we normalize to a string for query/identity use.
 */
function requireUserId(req) {
  const id = req.auth?.id;
  if (id === undefined || id === null || String(id).trim() === "") {
    throw createHttpError(401, "Invalid token payload.");
  }
  return String(id).trim();
}

async function createSession(req, res, next) {
  try {
    const userId = requireUserId(req);
    const { title, system_prompt: systemPrompt } = req.validated.body;

    const session = await chatSessionService.createSession({ userId, title, systemPrompt });
    const data = chatSessionService.serializeSession(session);

    return res.status(201).json({
      success: true,
      data: {
        session_id: data.id,
        title: data.title,
        model: data.model,
        system_prompt: data.system_prompt,
        created_at: data.created_at,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listSessions(req, res, next) {
  try {
    const userId = requireUserId(req);
    const sessions = await chatSessionService.listSessions(userId);

    return res.status(200).json({
      success: true,
      data: {
        sessions: sessions.map((session) => chatSessionService.serializeSession(session)),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getSessionMessages(req, res, next) {
  try {
    const userId = requireUserId(req);
    const { sessionId } = req.validated.params;

    await chatSessionService.getOwnedSession(sessionId, userId); // ownership gate
    const messages = await chatMessageService.getSessionMessages(sessionId);

    return res.status(200).json({
      success: true,
      data: {
        session_id: sessionId,
        messages: messages.map((message) => chatMessageService.serializeMessage(message)),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function sendMessage(req, res, next) {
  try {
    const userId = requireUserId(req);
    const { sessionId } = req.validated.params;
    const { message } = req.validated.body;

    // 1. Validate ownership.
    const session = await chatSessionService.getOwnedSession(sessionId, userId);

    // 2. Persist the user message before calling OpenAI (required for streaming
    //    upgrades and to keep history intact even if the AI call fails).
    const userMessage = await chatMessageService.addMessage({
      sessionId,
      userId,
      role: "user",
      content: message,
    });

    // 10. Auto-title the session from its first user message.
    if (!session.title) {
      const title = chatMessageService.deriveTitleFromMessage(message);
      if (title) {
        session.title = title;
        await session.save();
      }
    }

    // 3 + 4. Load recent history (already includes the message just saved) and
    //         build the OpenAI input with the session system prompt first.
    const contextMessages = await chatMessageService.getSessionContextMessages(
      sessionId,
      env.chatHistoryLimit
    );
    const openaiMessages = chatMessageService.buildOpenAiMessages(session, contextMessages);

    // 4b. Ground the answer in filtered server data (DB / config / logs) and
    //     enforce the secret-safety guard. Injected right after the persona so
    //     it outranks history; grounding never throws (degrades to no context).
    const grounding = await buildGrounding(message);
    const injected = [{ role: "system", content: grounding.guard }];
    if (grounding.context) {
      injected.push({
        role: "system",
        content:
          "FILTERED SERVER DATA (already secret-stripped; never reveal secrets " +
          `or raw files):\n\n${grounding.context}`,
      });
    }
    openaiMessages.splice(1, 0, ...injected);

    // 5. Call OpenAI (stateless; full context supplied above).
    const ai = await openaiService.generateChatResponse(openaiMessages, {
      model: session.model,
    });

    // 5b. Final safety net: redact any secret the model may have echoed back.
    const safeContent = redactSecrets(ai.content);

    // 6 + 7. Save the assistant reply and bump the session in one transaction.
    let assistantMessage;
    await sequelize.transaction(async (t) => {
      const metadata = { model: ai.model, finish_reason: ai.finishReason };
      if (ai.usage) metadata.usage = ai.usage;

      assistantMessage = await chatMessageService.addMessage({
        sessionId,
        userId: null,
        role: "assistant",
        content: safeContent,
        tokenCount: ai.usage?.completion_tokens ?? null,
        metadata,
        transaction: t,
      });

      await chatSessionService.touchSession(sessionId, userId, t);
    });

    // 8. Return both messages plus session info.
    return res.status(201).json({
      success: true,
      data: {
        session_id: sessionId,
        user_message: chatMessageService.serializeMessage(userMessage),
        assistant_message: chatMessageService.serializeMessage(assistantMessage),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateSession(req, res, next) {
  try {
    const userId = requireUserId(req);
    const { sessionId } = req.validated.params;
    const { title, system_prompt: systemPrompt } = req.validated.body;

    const session = await chatSessionService.updateSession(sessionId, userId, {
      title,
      systemPrompt,
    });

    return res.status(200).json({
      success: true,
      data: chatSessionService.serializeSession(session),
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteSession(req, res, next) {
  try {
    const userId = requireUserId(req);
    const { sessionId } = req.validated.params;

    await chatSessionService.softDeleteSession(sessionId, userId);

    return res.status(200).json({
      success: true,
      data: { session_id: sessionId, deleted: true },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createSession,
  listSessions,
  getSessionMessages,
  sendMessage,
  updateSession,
  deleteSession,
};
