const OpenAI = require("openai");

const env = require("../../config/env");
const { createHttpError } = require("../../utils/httpError");

let client;

function getClient() {
  if (!env.aiApiKey) {
    throw createHttpError(500, "AI_API_KEY is missing on server.");
  }
  if (!client) {
    client = new OpenAI({ apiKey: env.aiApiKey });
  }
  return client;
}

// gpt-5 family uses `max_completion_tokens` and rejects a custom temperature.
function usesMaxCompletionTokens(model) {
  return String(model || "").trim().toLowerCase().startsWith("gpt-5");
}

function supportsCustomTemperature(model) {
  return !String(model || "").trim().toLowerCase().startsWith("gpt-5");
}

function extractAssistantText(message) {
  const content = message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        if (part?.type === "text" && typeof part?.text === "string") return part.text;
        if (part?.type === "output_text" && typeof part?.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

function resolveMaxTokens(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return env.chatMaxTokens;
}

/**
 * Send an already-built message array to OpenAI and return clean assistant text.
 * Stateless by design: callers are responsible for assembling history.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ model?: string, maxTokens?: number, temperature?: number }} [options]
 * @returns {Promise<{ content: string, model: string, usage: object|null, finishReason: string|null }>}
 */
async function generateChatResponse(messages, options = {}) {
  if (!env.aiEnabled) {
    throw createHttpError(403, "AI feature is disabled.");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw createHttpError(500, "Cannot call AI with an empty message list.");
  }

  const openai = getClient();
  const model = options.model || env.aiModel;
  const maxTokens = resolveMaxTokens(options.maxTokens);

  const tokenControl = usesMaxCompletionTokens(model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };

  const samplingControl = supportsCustomTemperature(model)
    ? { temperature: options.temperature ?? env.aiTemperature }
    : {};

  let completion;
  try {
    completion = await openai.chat.completions.create({
      model,
      messages,
      ...tokenControl,
      ...samplingControl,
    });
  } catch (error) {
    // Log only a short reason server-side; never echo upstream internals (or the
    // conversation) to the client.
    console.error("OpenAI chat completion failed:", error?.message || error);
    throw createHttpError(502, "AI service request failed. Please try again.");
  }

  const choice = completion.choices?.[0];
  const content = extractAssistantText(choice?.message);

  if (!content) {
    throw createHttpError(502, "AI service returned an empty response. Please try again.");
  }

  return {
    content,
    model: completion.model || model,
    usage: completion.usage || null,
    finishReason: choice?.finish_reason || null,
  };
}

module.exports = {
  generateChatResponse,
};
