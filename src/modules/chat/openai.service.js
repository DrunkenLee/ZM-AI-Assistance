const OpenAI = require("openai");

const env = require("../../config/env");
const { createHttpError } = require("../../utils/httpError");

let client;

function getClient() {
  if (!env.aiApiKey) {
    throw createHttpError(500, "AI_API_KEY is missing on server.");
  }
  if (!client) {
    // Bound how long a single chat completion may hang. gpt-5 + replayed history
    // can be slow; without this the SDK default is 600s with 2 silent retries,
    // which stacks latency and lets requests outlive the nginx/Cloudflare proxy
    // timeouts (producing a 502/524 instead of a clean error).
    // Kept under Cloudflare's ~100s edge limit so we fail with a real 502 message.
    const timeout = Number(process.env.OPENAI_TIMEOUT_MS) || 90000;
    const maxRetries = Number.isFinite(Number(process.env.OPENAI_MAX_RETRIES))
      ? Number(process.env.OPENAI_MAX_RETRIES)
      : 1;
    client = new OpenAI({ apiKey: env.aiApiKey, timeout, maxRetries });
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
  const isReasoningModel = usesMaxCompletionTokens(model);

  let maxTokens = resolveMaxTokens(options.maxTokens);
  // gpt-5 spends part of the budget on hidden reasoning; ensure room for output.
  if (isReasoningModel) maxTokens = Math.max(maxTokens, 2000);

  const samplingControl = supportsCustomTemperature(model)
    ? { temperature: options.temperature ?? env.aiTemperature }
    : {};

  const runCompletion = async (tokenCap, effort) => {
    const tokenControl = isReasoningModel
      ? { max_completion_tokens: tokenCap }
      : { max_tokens: tokenCap };
    const reasoningControl = isReasoningModel && effort ? { reasoning_effort: effort } : {};

    try {
      return await openai.chat.completions.create({
        model,
        messages,
        ...tokenControl,
        ...samplingControl,
        ...reasoningControl,
      });
    } catch (error) {
      // Log only a short reason server-side; never echo upstream internals (or the
      // conversation) to the client.
      console.error("OpenAI chat completion failed:", error?.message || error);
      throw createHttpError(502, "AI service request failed. Please try again.");
    }
  };

  let completion = await runCompletion(maxTokens, isReasoningModel ? env.aiReasoningEffort : null);
  let choice = completion.choices?.[0];
  let content = extractAssistantText(choice?.message);

  // gpt-5 can return only hidden reasoning (empty visible text). Retry once with
  // minimal reasoning and extra headroom before surfacing an error.
  if (!content && isReasoningModel) {
    completion = await runCompletion(Math.max(maxTokens * 2, 4000), "minimal");
    choice = completion.choices?.[0];
    content = extractAssistantText(choice?.message);
  }

  if (!content) {
    // Surface why it was empty so this is diagnosable (e.g. finish_reason
    // "length" means the token budget was too small for a reasoning model).
    console.error(
      "OpenAI returned empty content:",
      JSON.stringify({
        model: completion.model || model,
        finish_reason: choice?.finish_reason || null,
        usage: completion.usage || null,
      })
    );
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
