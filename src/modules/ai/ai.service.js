const OpenAI = require("openai");

const env = require("../../config/env");
const AiRequestLog = require("../../db/models/ai-request-log.model");
const { getWorkshopGrounding } = require("./workshop-lookup");
const { getInternetGrounding } = require("./internet-lookup");
const { isServerStatusIntent, getLiveServerStatus } = require("./server-status");
const { isFleaUserIntent, getFleaUserDatabaseGrounding } = require("./flea-user-db");
const { getVectorGrounding } = require("./vector-lookup");

let client;

const DOMAIN_KEYWORDS = [
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

const SCOPE_REFUSAL_MESSAGE =
  "I can only answer questions related to Zona Merah Project Zomboid Community Server. Please ask about server features, workshop mods, gameplay systems, Discord bot, whitelist, auction, or server operations.";

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

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/(password\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/(secret\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]");
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

function pickRandom(items, fallback = "") {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items[Math.floor(Math.random() * items.length)] || fallback;
}

function buildJessicaPersonaErrorMessage(topic, extraLine = "") {
  const openers = [
    "Jessica here. I hit a small snag while processing that.",
    "Hey, Jessica here. I ran into a quick blocker.",
    "Aku Jessica, barusan ada kendala kecil waktu proses request kamu.",
    "Jessica checking in, I could not finish that step cleanly just now.",
  ];

  const topicHints = {
    live_status: [
      "I could not complete the live server status check right now.",
      "Live status verification is temporarily unavailable on my side.",
      "Aku belum bisa selesaikan pengecekan status server sekarang.",
    ],
    flea_lookup: [
      "I could not finish the flea market user lookup at the moment.",
      "Database lookup for flea user data is not responding cleanly right now.",
      "Pengecekan database user flea belum berhasil untuk saat ini.",
    ],
    no_evidence: [
      "I could not find enough trusted evidence for that request.",
      "I am missing solid source evidence for that exact question.",
      "Aku belum nemu evidence yang cukup kuat untuk pertanyaan itu.",
    ],
    empty_completion: [
      "The model returned no final answer text.",
      "I received an empty final response from the model.",
      "Model-nya tidak mengembalikan jawaban final kali ini.",
    ],
    default: [
      "I could not complete that step cleanly right now.",
      "That request did not finish properly this time.",
      "Permintaan ini belum berhasil selesai untuk saat ini.",
    ],
  };

  const retryLines = [
    "Please retry in a moment and I will continue from there.",
    "Please try again shortly and I will re-check it for you.",
    "Coba ulang sebentar lagi, nanti aku bantu cek lagi ya.",
    "Retry once more in a bit, I will handle it step-by-step.",
  ];

  const chosenTopic = pickRandom(topicHints[topic] || topicHints.default);
  const chosenExtra = String(extraLine || "").trim();

  return [
    pickRandom(openers),
    chosenTopic,
    chosenExtra,
    pickRandom(retryLines),
  ]
    .filter(Boolean)
    .join(" ");
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

function isReasoningOnlyCompletion(completion, content) {
  if (content) return false;
  const completionTokens = Number(completion?.usage?.completion_tokens || 0);
  const reasoningTokens = Number(completion?.usage?.completion_tokens_details?.reasoning_tokens || 0);
  return completionTokens > 0 && reasoningTokens >= completionTokens;
}

function buildGroundedFallbackMessage(prompt, grounding, completion) {

  if (isLoginTroubleshootIntent(prompt)) {
    return buildLoginTroubleshootMessage(null);
  }

  const sources = Array.isArray(grounding?.sources)
    ? grounding.sources.slice(0, 3).map((source) => source.file)
    : [];
  const sourceLine =
    sources.length > 0
      ? `Available source(s): ${sources.join(", ")}.`
      : "No source snippets were available.";
  const spentAllReasoning = isReasoningOnlyCompletion(completion, "");

  return buildJessicaPersonaErrorMessage(
    "empty_completion",
    [
      spentAllReasoning
        ? "I have spent completion budget on reasoning without getting final output."
        : "No final message text was produced.",
      sourceLine,
      "Try a narrower request like: step-by-step fix for whitelist/login failed.",
    ].join(" ")
  );
}

function getClient() {
  if (!env.aiApiKey) {
    const error = new Error("AI_API_KEY is missing");
    error.status = 500;
    throw error;
  }

  if (!client) {
    client = new OpenAI({ apiKey: env.aiApiKey });
  }

  return client;
}

async function createChatCompletion(prompt, options = {}) {
  if (!env.aiEnabled) {
    const error = new Error("AI feature is disabled");
    error.status = 403;
    throw error;
  }

  const normalizedPrompt = String(prompt || "").trim();
  if (!normalizedPrompt) {
    const error = new Error("prompt cannot be empty");
    error.status = 400;
    throw error;
  }

  const isInValidationScope = isZonaMerahRelated(normalizedPrompt);
  const isOutOfScopeCasualPrompt = !isInValidationScope;

  if (isJessicaGreetingIntent(normalizedPrompt)) {
    const content = buildJessicaCasualGreeting();

    await AiRequestLog.create({
      prompt: normalizedPrompt,
      response: content,
      model: "persona-casual-greeting",
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

  if (isInValidationScope && isServerStatusIntent(normalizedPrompt)) {
    try {
      const status = await getLiveServerStatus(env);
      const content = redactSensitiveText(status.content);

      await AiRequestLog.create({
        prompt: normalizedPrompt,
        response: content,
        model: "live-server-status",
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
    } catch (_error) {
      const failMessage = buildJessicaPersonaErrorMessage("live_status");

      await AiRequestLog.create({
        prompt: normalizedPrompt,
        response: failMessage,
        model: "live-server-status",
      });

      return {
        content: failMessage,
        model: "live-server-status",
        usage: null,
        blocked: false,
        grounded: false,
        sourceType: "live_check",
        sources: [],
      };
    }
  }

  if (isInValidationScope && isFleaUserIntent(normalizedPrompt)) {
    try {
      const dbResult = await getFleaUserDatabaseGrounding(normalizedPrompt, {
        userId: options.userId,
      });

      if (dbResult.matched) {
        const content = redactSensitiveText(dbResult.content);
        await AiRequestLog.create({
          prompt: normalizedPrompt,
          response: content,
          model: "database-flea-user",
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
    } catch (_error) {
      const failMessage = buildJessicaPersonaErrorMessage("flea_lookup");

      await AiRequestLog.create({
        prompt: normalizedPrompt,
        response: failMessage,
        model: "database-flea-user",
      });

      return {
        content: failMessage,
        model: "database-flea-user",
        usage: null,
        blocked: false,
        grounded: false,
        sourceType: "database",
        sources: [],
      };
    }
  }

  if (isInValidationScope && isLoginTroubleshootIntent(normalizedPrompt)) {
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

    await AiRequestLog.create({
      prompt: normalizedPrompt,
      response: content,
      model: "login-troubleshoot-playbook",
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

  const casualTokenCap = Math.max(1, Math.min(300, Number(env.aiCasualMaxTokens || 300)));
  const maxTokensForPrompt = isOutOfScopeCasualPrompt ? casualTokenCap : env.aiMaxTokens;

  const samplingControl = supportsCustomTemperature(env.aiModel)
    ? { temperature: env.aiTemperature }
    : {};

  if (env.aiVectorEnabled && Array.isArray(env.aiVectorStoreIds) && env.aiVectorStoreIds.length > 0) {
    try {
      const vectorAnswer = await getVectorGrounding({
        openai,
        model: env.aiModel,
        prompt: normalizedPrompt,
        persona: ZONA_MERAH_PERSONA,
        vectorStoreIds: env.aiVectorStoreIds,
        maxOutputTokens: maxTokensForPrompt,
        topK: env.aiVectorTopK,
        samplingControl,
      });

      if (vectorAnswer.enabled && vectorAnswer.content) {
        const safeContent = redactSensitiveText(vectorAnswer.content);
        const mappedSources = (vectorAnswer.sources || []).map((source) => ({
          file: source.file,
          score: source.score,
          sourceType: source.sourceType || inferSourceType(source.file),
          ...(source.fileId ? { fileId: source.fileId } : {}),
        }));

        await AiRequestLog.create({
          prompt: normalizedPrompt,
          response: safeContent,
          model: `${vectorAnswer.model || env.aiModel}:vector-first`,
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

  if (isInValidationScope) {
    const skillGrounding = await getWorkshopGrounding(normalizedPrompt, env);
    grounding = skillGrounding;

    if (skillGrounding.sources.length === 0) {
      const internetGrounding = await getInternetGrounding(normalizedPrompt, env);
      if (internetGrounding.sources.length > 0) {
        grounding = internetGrounding;
      }
    }

    if (grounding.enabled && grounding.sources.length === 0) {
      const noEvidenceMessage = buildJessicaPersonaErrorMessage(
        "no_evidence",
        "I checked SKILL.md and trusted internet sources but found no strong match. Please rephrase with clearer Zona Merah or Project Zomboid details."
      );

      await AiRequestLog.create({
        prompt: normalizedPrompt,
        response: noEvidenceMessage,
        model: "grounding-fallback",
      });

      return {
        content: noEvidenceMessage,
        model: "grounding-fallback",
        usage: null,
        blocked: false,
        grounded: false,
        sources: [],
      };
    }
  }

  const tokenControl = usesMaxCompletionTokens(env.aiModel)
    ? { max_completion_tokens: maxTokensForPrompt }
    : { max_tokens: maxTokensForPrompt };

  const messages = [
    {
      role: "system",
      content: ZONA_MERAH_PERSONA,
    },
  ];

  if (isOutOfScopeCasualPrompt) {
    messages.push({
      role: "system",
      content:
        "Prompt is outside Zona Merah validation keyword scope. Continue as casual chat, keep answer concise (max around 120 words), and do not claim server-specific facts unless explicitly provided by user.",
    });
  }

  if (isInValidationScope) {
    messages.push({
      role: "system",
      content:
        grounding.sources.length > 0
          ? `Use the grounded evidence below as your primary source. If evidence is insufficient, say that clearly and avoid guessing.\n\n${grounding.context}`
          : "No grounded evidence was provided for this request.",
    });
  }

  messages.push({
    role: "user",
    content: normalizedPrompt,
  });

  const completion = await openai.chat.completions.create({
    model: env.aiModel,
    messages,
    ...tokenControl,
    ...samplingControl,
  });

  const firstChoice = completion.choices?.[0];
  const refusal = String(firstChoice?.message?.refusal || "").trim();
  let content = extractAssistantText(firstChoice?.message);

  if (!content && refusal) {
    content = `Request was refused by the model: ${refusal}`;
  }

  if (!content) {
    content = buildGroundedFallbackMessage(normalizedPrompt, grounding, completion);
  }

  await AiRequestLog.create({
    prompt: normalizedPrompt,
    response: redactSensitiveText(content),
    model: env.aiModel,
  });

  return {
    content: redactSensitiveText(content),
    model: completion.model,
    usage: completion.usage,
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
