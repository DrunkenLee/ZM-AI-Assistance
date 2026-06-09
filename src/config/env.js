const parseBoolean = (value, fallback = false) => {
  if (typeof value !== "string") return fallback;
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
};

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseNumberList = (value, fallback = []) => {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((num) => Number.isFinite(num) && num > 0);
  return parsed.length > 0 ? parsed : fallback;
};

const parseStringList = (value, fallback = []) => {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
};

const dbTarget = (process.env.DB_TARGET || "remote").toLowerCase();

const resolveDatabaseUrl = () => {
  if (dbTarget === "prod" && process.env.DATABASE_URL_PROD) {
    return process.env.DATABASE_URL_PROD;
  }

  if (dbTarget === "remote" && process.env.DATABASE_URL_REMOTE) {
    return process.env.DATABASE_URL_REMOTE;
  }

  if (process.env.DATABASE_URL_REMOTE) return process.env.DATABASE_URL_REMOTE;
  if (process.env.DATABASE_URL_PROD) return process.env.DATABASE_URL_PROD;

  const host =
    dbTarget === "prod"
      ? process.env.PGHOSTPROD || process.env.PGHOSTREMOTE || "127.0.0.1"
      : process.env.PGHOSTREMOTE || process.env.PGHOSTPROD || "127.0.0.1";

  const port = parseNumber(process.env.PGPORT, 5432);
  const database = process.env.PGDATABASE || "postgres";
  const user = process.env.PGUSER || "postgres";
  const password = process.env.PGPASSWORD || "postgres";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
};

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseNumber(process.env.PORT, 3000),
  rconHost: String(process.env.RCON_HOST || "").trim(),
  rconPort: parseNumber(process.env.RCON_PORT, 0),
  serverStatusHost: String(
    process.env.SERVER_STATUS_HOST || process.env.RCON_HOST || ""
  ).trim(),
  serverStatusPorts: parseNumberList(
    process.env.SERVER_STATUS_PORTS,
    parseNumber(process.env.SERVER_STATUS_PORT || process.env.RCON_PORT, 0) > 0
      ? [parseNumber(process.env.SERVER_STATUS_PORT || process.env.RCON_PORT, 0)]
      : []
  ),
  serverStatusTimeoutMs: parseNumber(process.env.SERVER_STATUS_TIMEOUT_MS, 2500),
  serverStatusAttempts: parseNumber(process.env.SERVER_STATUS_ATTEMPTS, 2),
  devWorkshopPath: String(process.env.DEV_WORKSHOP_PATH || "").trim(),
  liveWorkshopPath: String(process.env.LIVE_WORKSHOP_PATH || "").trim(),
  workshopLookupEnabled: parseBoolean(process.env.WORKSHOP_LOOKUP_ENABLED, true),
  workshopLookupMaxFiles: parseNumber(process.env.WORKSHOP_LOOKUP_MAX_FILES, 2000),
  workshopLookupMaxFileSizeBytes: parseNumber(
    process.env.WORKSHOP_LOOKUP_MAX_FILE_SIZE_BYTES,
    524288
  ),
  workshopLookupTopK: parseNumber(process.env.WORKSHOP_LOOKUP_TOP_K, 5),
  workshopLookupExcerptChars: parseNumber(
    process.env.WORKSHOP_LOOKUP_EXCERPT_CHARS,
    500
  ),
  workshopLookupKnowledgeFirstOnly: parseBoolean(
    process.env.WORKSHOP_LOOKUP_KNOWLEDGE_FIRST_ONLY,
    false
  ),
  internetLookupEnabled: parseBoolean(process.env.INTERNET_LOOKUP_ENABLED, true),
  internetLookupTopK: parseNumber(process.env.INTERNET_LOOKUP_TOP_K, 4),
  internetLookupTimeoutMs: parseNumber(process.env.INTERNET_LOOKUP_TIMEOUT_MS, 7000),
  jwtSecret: String(process.env.JWT_SECRET || "").trim(),
  authTokenExpiresIn: process.env.AUTH_TOKEN_EXPIRES_IN || "1h",
  aiEnabled: parseBoolean(process.env.AI_ENABLED, true),
  aiApiKey: process.env.AI_API_KEY || "",
  aiModel: process.env.AI_MODEL || "gpt-5",
  aiVectorEnabled: parseBoolean(process.env.AI_VECTOR_ENABLED, true),
  aiVectorStoreIds: parseStringList(process.env.OPENAI_VECTOR_STORE_IDS, []),
  aiVectorTopK: parseNumber(process.env.AI_VECTOR_TOP_K, 5),
  aiConversationHistoryTurns: parseNumber(process.env.AI_CONVERSATION_HISTORY_TURNS, 6),
  aiMaxTokens: parseNumber(process.env.AI_MAX_TOKENS, 150),
  // Session-based chat (src/modules/chat): how many recent messages to replay as
  // memory, and the output token cap for those (typically longer) replies.
  chatHistoryLimit: parseNumber(process.env.CHAT_HISTORY_LIMIT, 30),
  chatMaxTokens: parseNumber(process.env.CHAT_MAX_TOKENS, 1024),
  aiCasualMaxTokens: parseNumber(process.env.AI_CASUAL_MAX_TOKENS, 300),
  aiOperationalMaxTokens: parseNumber(process.env.AI_OPERATIONAL_MAX_TOKENS, 180),
  aiTemperature: Number(process.env.AI_TEMPERATURE || 1),
  dbSsl: parseBoolean(process.env.DB_SSL, false),
  databaseUrl: resolveDatabaseUrl(),
};
