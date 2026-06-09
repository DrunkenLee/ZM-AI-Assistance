const OpenAI = require("openai");

const env = require("../../config/env");
const AiRequestLog = require("../../db/models/ai-request-log.model");
const { createHttpError } = require("../../utils/httpError");
const { getWorkshopGrounding } = require("./workshop-lookup");
const { getInternetGrounding } = require("./internet-lookup");
const { isServerStatusIntent, getLiveServerStatus } = require("./server-status");
const { isFleaUserIntent, getFleaUserDatabaseGrounding } = require("./flea-user-db");
const { getVectorGrounding } = require("./vector-lookup");
const { buildGrounding } = require("../chat/grounding");
const { redactSecrets } = require("../../utils/redact");

let client;

const DOMAIN_KEYWORDS = [
  "zm",
  "zona merah",
  "project zomboid",
  "zomboid",
  "pz",
  "community server",
  "whitelist",
  "steamid",
  "rcon",
  "workshop",
  "mod",
  "mods",
  "discord bot",
  "auction",
  "flea market",
  "raid point",
  "server",
  "safehouse",
  "loot",
  "vehicle",
  "craft",
  "map",
  "horde",
  "survival",
];

const LOGIN_TROUBLE_KEYWORDS = [
  "login",
  "loggin",
  "cannot login",
  "can't login",
  "cant login",
  "unable to login",
  "cannot join",
  "can't join",
  "cant join",
  "failed to connect",
  "connection failed",
  "authentication",
  "auth failed",
  "wrong password",
  "whitelist",
  "kick from server",
  "lost connection",
];

const JESSICA_GREETING_KEYWORDS = [
  "hi jessica",
  "hello jessica",
  "hey jessica",
  "hai jessica",
  "halo jessica",
  "yo jessica",
  "sup jessica",
  "wassup jessica",
  "whats up jessica",
  "what's up jessica",
  "good morning jessica",
  "good afternoon jessica",
  "good evening jessica",
  "good night jessica",
  "selamat pagi jessica",
  "selamat siang jessica",
  "selamat sore jessica",
  "selamat malam jessica",
  "pagi jessica",
  "siang jessica",
  "sore jessica",
  "malam jessica",
  "hi jess",
  "hello jess",
  "hey jess",
  "hai jess",
  "halo jess",
  "yo jess",
  "sup jess",
  "good morning jess",
  "good afternoon jess",
  "good evening jess",
  "selamat pagi jess",
  "selamat siang jess",
  "selamat sore jess",
  "selamat malam jess",
  "jessica hi",
  "jessica hello",
  "jessica hey",
  "jess hi",
  "jess hello",
  "jess hey",
  "halo kak jessica",
  "hai kak jessica",
  "halo mbak jessica",
  "hai mbak jessica",
];

const ZONA_MERAH_PERSONA = `
You are Zona Merah AI Assistant.

Primary role:
Gender: Female
Age: 23 years old
Soft Spoken Female
Name: Jessica

Help the Users error, troubleshoot, and understand all things related to and project zomboid general error
the Zona Merah Project Zomboid multiplayer server.

Zona Merah Server is Built on Project Zomboid Build 41.78.19 Stable Version, Hosted on Linux, and has a custom modpack with around 200 mods. The server has unique gameplay systems including a player-driven economy, custom crafting, and a whitelist application process. The server's community is active on Discord, where announcements, support, and discussions happen.
if user has trouble login or persistent error when trying to connect to the server, you can help them troubleshoot by asking about their game version, mod list, connection method, and any error messages they see. You can also provide guidance on how to check server status, verify game files, and ensure their account is whitelisted.
you can also ask them to upload console.txt file if they have connection issues, and guide them on how to find relevant error messages in that file. You can also help them understand the server's custom gameplay systems, like how the economy works, how to craft items, and how to join or create safehouses.

Tone:
- Direct
- Practical
- Admin/operator mindset
- Friendly but not too formal
- Use Indonesian-English mixed style when the user does

Formatting:
- For Discord announcements, use raw Markdown inside code blocks.
- Use minimal icons unless requested.
- For technical fixes, give commands first, explanation after.
- For configs, show exact before/after values.

Rules:
- Do not guess server settings if files are not provided.
- For performance issues, ask for logs/configs only when necessary.
- For urgent server issues, prioritize safe rollback/backup/check commands.
- Casual conversation is always allowed; stay warm, concise, and natural.
- Answer general questions too. Do not reject a user just because the topic is outside Zona Merah.
- For non-Zona Merah topics, answer normally as Jessica and avoid claiming server-specific facts unless evidence is provided.
- Use recent conversation context to continue the thread when user asks follow-ups.
`;

function isZonaMerahRelated(prompt) {
  const normalized = String(prompt || "").toLowerCase();
  return DOMAIN_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function usesMaxCompletionTokens(model) {
  return String(model || "").trim().toLowerCase().startsWith("gpt-5");
}

function supportsCustomTemperature(model) {
  return !String(model || "").trim().toLowerCase().startsWith("gpt-5");
}

// gpt-5 reasoning models accept `reasoning_effort`. Keeping it low/minimal makes
// the model emit visible answer text instead of consuming the whole token budget
// on hidden reasoning (which returns an empty completion).
function buildReasoningControl(model, effort) {
  if (!usesMaxCompletionTokens(model)) return {};
  const allowed = ["minimal", "low", "medium", "high"];
  const chosen = allowed.includes(effort) ? effort : "low";
  return { reasoning_effort: chosen };
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

function extractResponseText(response) {
  const directText = String(response?.output_text || "").trim();
  if (directText) return directText;

  const parts = [];
  const outputItems = Array.isArray(response?.output) ? response.output : [];

  for (const item of outputItems) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (typeof part === "string" && part.trim()) {
          parts.push(part.trim());
          continue;
        }

        if (typeof part?.text === "string" && part.text.trim()) {
          parts.push(part.text.trim());
          continue;
        }

        if (part?.text && typeof part.text.value === "string" && part.text.value.trim()) {
          parts.push(part.text.value.trim());
          continue;
        }

        if (typeof part?.content === "string" && part.content.trim()) {
          parts.push(part.content.trim());
        }
      }
      continue;
    }

    if (typeof item?.text === "string" && item.text.trim()) {
      parts.push(item.text.trim());
    }
  }

  return parts.join("\n").trim();
}

function normalizeResponsesUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  if (typeof usage.prompt_tokens === "number" || typeof usage.completion_tokens === "number") {
    return usage;
  }

  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const totalTokens = Number(usage.total_tokens || inputTokens + outputTokens);

  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: totalTokens,
    prompt_tokens_details: {
      cached_tokens: Number(usage.input_tokens_details?.cached_tokens || 0),
      audio_tokens: Number(usage.input_tokens_details?.audio_tokens || 0),
    },
    completion_tokens_details: {
      reasoning_tokens: Number(usage.output_tokens_details?.reasoning_tokens || 0),
      audio_tokens: Number(usage.output_tokens_details?.audio_tokens || 0),
      accepted_prediction_tokens: Number(
        usage.output_tokens_details?.accepted_prediction_tokens || 0
      ),
      rejected_prediction_tokens: Number(
        usage.output_tokens_details?.rejected_prediction_tokens || 0
      ),
    },
  };
}

// Delegates to the hardened, centralized redactor so every call site (server
// status, flea, vector, final output) gets full coverage: exact env secrets,
// connection strings, API keys, JWTs, and credential key=value fields.
function redactSensitiveText(value) {
  return redactSecrets(value);
}

function inferSourceType(fileName) {
  const name = String(fileName || "").toLowerCase();
  if (name.startsWith("knowledge/")) return "knowledge_doc";
  if (name.startsWith("internet/")) return "internet";
  if (name.startsWith("database/")) return "database";
  if (name.startsWith("live/")) return "live_check";
  if (name.startsWith("playbook/")) return "system_playbook";
  if (name.startsWith("vector/")) return "vector_store";
  return "other";
}

function normalizePromptForKeywordMatch(prompt) {
  return String(prompt || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isJessicaGreetingIntent(prompt) {
  const normalized = normalizePromptForKeywordMatch(prompt);
  if (!normalized) return false;

  if (JESSICA_GREETING_KEYWORDS.includes(normalized)) {
    return true;
  }

  const hasJessicaName = /\b(jessica|jess)\b/.test(normalized);
  const hasGreetingWord =
    /\b(hi|hello|hey|hai|halo|yo|sup|wassup|whats up|what's up|good morning|good afternoon|good evening|good night|selamat pagi|selamat siang|selamat sore|selamat malam|pagi|siang|sore|malam)\b/.test(
      normalized
    );

  return hasJessicaName && hasGreetingWord;
}

function buildJessicaCasualGreeting() {
  return [
    "Hi, aku Jessica. Senang ketemu kamu.",
    "Kalau mau casual chat boleh banget, atau kalau ada issue Zona Merah langsung spill aja detailnya.",
    "Aku bantu step-by-step, santai tapi tetap practical.",
  ].join(" ");
}

function normalizeConversationUserId(userId) {
  const normalized = String(userId || "").trim();
  return normalized || null;
}

function normalizeHistoryTurns(value, fallback = 6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.max(0, Math.min(20, Math.floor(parsed)));
}

function trimConversationText(value, maxChars = 1200) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

async function getRecentConversationMessages({ userId, maxTurns }) {
  if (!userId || maxTurns <= 0) return [];

  try {
    const rows = await AiRequestLog.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
      limit: maxTurns,
      attributes: ["prompt", "response"],
    });

    return rows
      .reverse()
      .flatMap((row) => {
        const prompt = trimConversationText(row?.prompt);
        const response = trimConversationText(row?.response);
        const messages = [];

        if (prompt) {
          messages.push({
            role: "user",
            content: prompt,
          });
        }

        if (response) {
          messages.push({
            role: "assistant",
            content: response,
          });
        }

        return messages;
      });
  } catch (_error) {
    return [];
  }
}

async function persistAiRequestLog({ prompt, response, model, userId }) {
  const payload = {
    prompt,
    response,
    model,
  };

  const normalizedUserId = normalizeConversationUserId(userId);
  if (normalizedUserId) {
    payload.userId = normalizedUserId;
  }

  try {
    await AiRequestLog.create(payload);
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    const missingUserColumn =
      Boolean(payload.userId) &&
      (message.includes("user_id") || message.includes("userid")) &&
      (message.includes("does not exist") ||
        message.includes("unknown column") ||
        message.includes("invalid column"));

    if (missingUserColumn) {
      await AiRequestLog.create({
        prompt,
        response,
        model,
      });
      return;
    }

    throw error;
  }
}

function pickRandom(items, fallback = "") {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items[Math.floor(Math.random() * items.length)] || fallback;
}

function isLoginTroubleshootIntent(prompt) {
  const normalized = String(prompt || "").toLowerCase();
  return LOGIN_TROUBLE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function buildLoginTroubleshootMessage(statusResult) {
  const statusLines = [];
  if (statusResult?.available) {
    if (statusResult.online) {
      statusLines.push(
        `Live check: server reachable at ${statusResult.host} (ports: ${statusResult.ports.join(", ")}, best latency ${statusResult.bestLatencyMs ?? "n/a"} ms).`
      );
    } else {
      statusLines.push(
        `Live check: server currently unreachable at ${statusResult.host} (ports checked: ${statusResult.ports.join(", ")}, last error: ${statusResult.lastError || "unknown"}).`
      );
    }
    statusLines.push(`Checked at: ${statusResult.checkedAt}`);
  }

  return [
    ...statusLines,
    "Run these steps in order:",
    "1) Verify game version is Build 41.78.19 (stable).",
    "2) Steam -> Project Zomboid -> Properties -> Installed Files -> Verify integrity.",
    "3) Remove stale client mods: clear Zomboid Workshop cache, then resubscribe/re-download required mods.",
    "4) Confirm whitelist/account status with your exact SteamID and Discord ID.",
    "5) Try direct connect using the official server IP/port from Zona Merah announcements.",
    "6) If still failing, send console.txt and the exact error line (do not send passwords/tokens).",
    "Quick info I need next: exact error text, your current build number, and whether failure happens before or after mod loading.",
  ].join("\n");
}

function getClient() {
  if (!env.aiApiKey) {
    throw createHttpError(500, "AI_API_KEY is missing");
  }

  if (!client) {
    client = new OpenAI({ apiKey: env.aiApiKey });
  }

  return client;
}

async function createChatCompletion(prompt, options = {}) {
  if (!env.aiEnabled) {
    throw createHttpError(403, "AI feature is disabled");
  }

  const normalizedPrompt = String(prompt || "").trim();
  if (!normalizedPrompt) {
    throw createHttpError(400, "prompt cannot be empty");
  }

  const conversationUserId = normalizeConversationUserId(options.userId);
  const historyTurns = normalizeHistoryTurns(env.aiConversationHistoryTurns, 6);
  const conversationHistoryMessages = await getRecentConversationMessages({
    userId: conversationUserId,
    maxTurns: historyTurns,
  });

  const hasZonaMerahContext = isZonaMerahRelated(normalizedPrompt);

  if (isJessicaGreetingIntent(normalizedPrompt)) {
    const content = buildJessicaCasualGreeting();

    await persistAiRequestLog({
      prompt: normalizedPrompt,
      response: content,
      model: "persona-casual-greeting",
      userId: conversationUserId,
    });

    return {
      content,
      model: "persona-casual-greeting",
      usage: null,
      blocked: false,
      grounded: true,
      sourceType: "system_playbook",
      sources: [
        {
          file: "playbook/jessica-casual-greeting",
          score: 100,
          sourceType: "system_playbook",
        },
      ],
    };
  }

  if (isServerStatusIntent(normalizedPrompt)) {
    try {
      const status = await getLiveServerStatus(env);
      const content = redactSensitiveText(status.content);

      await persistAiRequestLog({
        prompt: normalizedPrompt,
        response: content,
        model: "live-server-status",
        userId: conversationUserId,
      });

      return {
        content,
        model: "live-server-status",
        usage: null,
        blocked: false,
        grounded: true,
        sourceType: "live_check",
        checkedAt: status.checkedAt,
        sources: status.sources,
        status: {
          online: status.online,
          host: status.host,
          ports: status.ports,
          bestLatencyMs: status.bestLatencyMs,
        },
      };
    } catch (error) {
      console.error("Live server status check failed:", error?.message || error);
      throw createHttpError(502, "Live server status check failed. Please try again.");
    }
  }

  if (isFleaUserIntent(normalizedPrompt)) {
    try {
      const dbResult = await getFleaUserDatabaseGrounding(normalizedPrompt, {
        userId: options.userId,
      });

      if (dbResult.matched) {
        const content = redactSensitiveText(dbResult.content);
        await persistAiRequestLog({
          prompt: normalizedPrompt,
          response: content,
          model: "database-flea-user",
          userId: conversationUserId,
        });

        return {
          content,
          model: "database-flea-user",
          usage: null,
          blocked: Boolean(dbResult.blocked),
          grounded: true,
          sourceType: "database",
          checkedAt: dbResult.checkedAt,
          sources: dbResult.sources,
        };
      }
    } catch (error) {
      console.error("Flea market user lookup failed:", error?.message || error);
      throw createHttpError(502, "Flea market user lookup failed. Please try again.");
    }
  }

  if (hasZonaMerahContext && isLoginTroubleshootIntent(normalizedPrompt)) {
    let statusResult = null;

    try {
      statusResult = await getLiveServerStatus(env);
    } catch (_error) {
      statusResult = null;
    }

    const content = redactSensitiveText(buildLoginTroubleshootMessage(statusResult));
    const sources = [
      {
        file: "playbook/login-troubleshoot",
        score: 100,
        sourceType: "system_playbook",
      },
      ...(statusResult?.sources || []),
    ];

    await persistAiRequestLog({
      prompt: normalizedPrompt,
      response: content,
      model: "login-troubleshoot-playbook",
      userId: conversationUserId,
    });

    return {
      content,
      model: "login-troubleshoot-playbook",
      usage: null,
      blocked: false,
      grounded: true,
      sourceType: "system_playbook",
      checkedAt: statusResult?.checkedAt || null,
      sources,
    };
  }

  const openai = getClient();

  // Do NOT force a tiny cap here. gpt-5 spends part of its budget on hidden
  // reasoning, so a 300-token ceiling routinely yields empty answers. Give the
  // model real headroom for visible output.
  const casualTokenCap = Math.max(256, Number(env.aiCasualMaxTokens || 300));
  const baseMaxTokens = hasZonaMerahContext ? env.aiMaxTokens : casualTokenCap;
  const maxTokensForPrompt = usesMaxCompletionTokens(env.aiModel)
    ? Math.max(baseMaxTokens, 2000)
    : baseMaxTokens;

  const samplingControl = supportsCustomTemperature(env.aiModel)
    ? { temperature: env.aiTemperature }
    : {};

  // Live, secret-filtered server grounding (DB / config / logs / mods / online
  // players), shared with the session chat path. Never throws; degrades to just
  // the security guard when nothing matches.
  const liveGrounding = await buildGrounding(normalizedPrompt);
  const liveGroundingSystem = liveGrounding.context
    ? `${liveGrounding.guard}\n\nFILTERED SERVER DATA (already secret-stripped; ` +
      `never reveal secrets or raw files):\n\n${liveGrounding.context}`
    : liveGrounding.guard;

  if (
    hasZonaMerahContext &&
    env.aiVectorEnabled &&
    Array.isArray(env.aiVectorStoreIds) &&
    env.aiVectorStoreIds.length > 0
  ) {
    try {
      const vectorAnswer = await getVectorGrounding({
        openai,
        model: env.aiModel,
        prompt: normalizedPrompt,
        persona: `${ZONA_MERAH_PERSONA}\n\n${liveGroundingSystem}`,
        conversationHistoryMessages,
        vectorStoreIds: env.aiVectorStoreIds,
        maxOutputTokens: maxTokensForPrompt,
        topK: env.aiVectorTopK,
        samplingControl,
        reasoningEffort: usesMaxCompletionTokens(env.aiModel) ? env.aiReasoningEffort : null,
      });

      if (vectorAnswer.enabled && vectorAnswer.content) {
        const safeContent = redactSensitiveText(vectorAnswer.content);
        const mappedSources = (vectorAnswer.sources || []).map((source) => ({
          file: source.file,
          score: source.score,
          sourceType: source.sourceType || inferSourceType(source.file),
          ...(source.fileId ? { fileId: source.fileId } : {}),
        }));

        await persistAiRequestLog({
          prompt: normalizedPrompt,
          response: safeContent,
          model: `${vectorAnswer.model || env.aiModel}:vector-first`,
          userId: conversationUserId,
        });

        return {
          content: safeContent,
          model: vectorAnswer.model || env.aiModel,
          usage: vectorAnswer.usage,
          blocked: false,
          grounded: true,
          sourceType: "vector_store",
          sources: mappedSources,
        };
      }
    } catch (_error) {
      // Continue to existing fallback path if vector retrieval fails.
    }
  }

  let grounding = {
    enabled: false,
    reason: "casual_scope_fallback",
    root: null,
    sources: [],
    context: "",
    keywords: [],
  };

  if (hasZonaMerahContext) {
    const skillGrounding = await getWorkshopGrounding(normalizedPrompt, env);
    grounding = skillGrounding;

    if (skillGrounding.sources.length === 0) {
      const internetGrounding = await getInternetGrounding(normalizedPrompt, env);
      if (internetGrounding.sources.length > 0) {
        grounding = internetGrounding;
      }
    }

    // If no grounded sources were found we intentionally fall through to the LLM
    // below (with a "no grounded evidence" system note) instead of returning an
    // error. Jessica can still answer from the persona + general knowledge.
  }

  const tokenControl = usesMaxCompletionTokens(env.aiModel)
    ? { max_completion_tokens: maxTokensForPrompt }
    : { max_tokens: maxTokensForPrompt };

  const messages = [
    {
      role: "system",
      content: ZONA_MERAH_PERSONA,
    },
    {
      role: "system",
      content: liveGroundingSystem,
    },
  ];

  if (hasZonaMerahContext) {
    messages.push({
      role: "system",
      content:
        grounding.sources.length > 0
          ? `Use the grounded evidence below as your primary source. If evidence is insufficient, say that clearly and avoid guessing.\n\n${grounding.context}`
          : "No grounded evidence was provided for this request.",
    });
  }

  if (conversationHistoryMessages.length > 0) {
    messages.push({
      role: "system",
      content:
        "Use previous conversation turns as memory context. Continue naturally from recent context unless the user clearly changes topic.",
    });

    messages.push(...conversationHistoryMessages);
  }

  messages.push({
    role: "user",
    content: normalizedPrompt,
  });

  const reasoningControl = buildReasoningControl(env.aiModel, env.aiReasoningEffort);

  let completion = await openai.chat.completions.create({
    model: env.aiModel,
    messages,
    ...tokenControl,
    ...samplingControl,
    ...reasoningControl,
  });

  let firstChoice = completion.choices?.[0];
  let refusal = String(firstChoice?.message?.refusal || "").trim();
  let content = extractAssistantText(firstChoice?.message);
  let responseModel = completion.model || env.aiModel;
  let responseUsage = completion.usage || null;

  // Safety net: gpt-5 can spend its whole budget on hidden reasoning and return
  // no visible text. Retry once with minimal reasoning + extra headroom so the
  // user gets a real answer instead of a persona error message.
  if (!content && !refusal && usesMaxCompletionTokens(env.aiModel)) {
    try {
      completion = await openai.chat.completions.create({
        model: env.aiModel,
        messages,
        max_completion_tokens: Math.max(maxTokensForPrompt * 2, 4000),
        reasoning_effort: "minimal",
      });
      firstChoice = completion.choices?.[0];
      refusal = String(firstChoice?.message?.refusal || "").trim();
      content = extractAssistantText(firstChoice?.message);
      responseModel = completion.model || env.aiModel;
      responseUsage = completion.usage || null;
    } catch (_retryError) {
      // Keep the original (empty) result; handled by the fallback below.
    }
  }

  if (!content && !refusal && usesMaxCompletionTokens(env.aiModel)) {
    try {
      const response = await openai.responses.create({
        model: env.aiModel,
        input: messages,
        max_output_tokens: Math.max(maxTokensForPrompt * 2, 4000),
        reasoning: { effort: "minimal" },
      });
      content = extractResponseText(response);
      responseModel = String(response?.model || env.aiModel);
      responseUsage = normalizeResponsesUsage(response?.usage);
    } catch (responseError) {
      console.error("OpenAI responses fallback failed:", responseError?.message || responseError);
    }
  }

  if (!content && refusal) {
    content = `Request was refused by the model: ${refusal}`;
  }

  if (!content) {
    throw createHttpError(502, "AI service returned an empty response. Please try again.");
  }

  await persistAiRequestLog({
    prompt: normalizedPrompt,
    response: redactSensitiveText(content),
    model: env.aiModel,
    userId: conversationUserId,
  });

  return {
    content: redactSensitiveText(content),
    model: responseModel,
    usage: responseUsage,
    grounded: grounding.sources.length > 0,
    sourceType:
      grounding.sources.length > 0 ? inferSourceType(grounding.sources[0].file) : "other",
    sources: grounding.sources.map((source) => ({
      file: source.file,
      score: source.score,
      sourceType: source.sourceType || inferSourceType(source.file),
      ...(source.checkedAt ? { checkedAt: source.checkedAt } : {}),
      ...(source.url ? { url: source.url } : {}),
    })),
  };
}

module.exports = {
  createChatCompletion,
};
