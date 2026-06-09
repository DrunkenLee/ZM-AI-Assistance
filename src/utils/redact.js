/**
 * Centralized secret redaction.
 *
 * Every piece of grounded data (DB rows, config files, logs) AND every model
 * reply on the chat path is passed through redactSecrets() before it can reach a
 * user. This is the last line of defense, so it intentionally over-redacts:
 * losing a token in output is fine, leaking a credential is not.
 */

// Sensitive env keys whose *exact values* must never appear in output, in any
// formatting. This is the strongest guarantee: known secrets are removed
// regardless of how they show up.
const SECRET_ENV_KEYS = [
  "AI_API_KEY",
  "JWT_SECRET",
  "RCON_PASSWORD",
  "PANEL_PASSWORD",
  "SFTP_PASSWORD",
  "OVH_SG_PASSWORD",
  "PGPASSWORD",
  "SUPA_PASS",
  "SUPA_API_SECRET_KEY",
  "SUPA_PUBLIC_KEY",
  "DISCORD_BOT_TOKEN",
  "ClientSecret",
  "DISCORD_OAUTH_CLIENT_SECRET",
  "AUTOGOPAYKEY",
  "BATTLEMETRICS_API_KEY",
  "BATTLEMETRICS_API_KEY_BAK_FULLAKSES",
];

let envSecretsCache = null;

function buildEnvSecrets() {
  const set = new Set();

  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value && String(value).trim().length >= 6) {
      set.add(String(value).trim());
    }
  }

  // Pull the password component out of any connection-string style env var
  // (DATABASE_URL_*, SUPABASE_URL, etc.) so DB passwords are covered too.
  for (const value of Object.values(process.env)) {
    if (!value) continue;
    const match = String(value).match(/^[a-z][a-z0-9+.-]*:\/\/[^:/\s]+:([^@/\s]+)@/i);
    if (match && match[1] && match[1].length >= 4) {
      set.add(match[1]);
    }
  }

  // Longest first so we redact the most specific value before any substring.
  return [...set].sort((a, b) => b.length - a.length);
}

function envSecrets() {
  if (!envSecretsCache) envSecretsCache = buildEnvSecrets();
  return envSecretsCache;
}

const CREDENTIAL_FIELD =
  "passwords?|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|access[_-]?token|" +
  "client[_-]?secret|private[_-]?key|rcon[_-]?password|admin[_-]?password|" +
  "server[_-]?password|encryptedpwd|pwdencrypttype|jwt[_-]?secret|db[_-]?password|pgpassword";

/**
 * Redact secrets from arbitrary text. Safe to call on any string.
 * @param {*} input
 * @returns {string}
 */
function redactSecrets(input) {
  let text = String(input == null ? "" : input);
  if (!text) return text;

  // 1) Exact known secrets from this process's environment.
  for (const secret of envSecrets()) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }

  // 2) Password inside connection strings: proto://user:PASS@host
  text = text.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/[^:/\s]+:)([^@/\s]+)(@)/gi,
    "$1[REDACTED]$3"
  );

  // 3) OpenAI / generic "sk-" style keys.
  text = text.replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "[REDACTED_KEY]");

  // 4) JWTs (header.payload.signature).
  text = text.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    "[REDACTED_JWT]"
  );

  // 5) AWS access key IDs.
  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_KEY]");

  // 6) Discord bot tokens (rough shape).
  text = text.replace(
    /\b[MNO][A-Za-z0-9_-]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g,
    "[REDACTED_TOKEN]"
  );

  // 7) PEM private key blocks.
  text = text.replace(
    /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]"
  );

  // 8) key=value / "key": value where the key names a credential. Covers .ini
  //    (RCONPassword=, Password=, DiscordToken=) and JSON ("token": "...").
  const kvRegex = new RegExp(
    `(\\b(?:${CREDENTIAL_FIELD})\\b["']?\\s*[:=]\\s*)(["']?)([^\\s,;"']+)`,
    "gi"
  );
  text = text.replace(kvRegex, (_match, prefix, quote) => `${prefix}${quote}[REDACTED]`);

  return text;
}

/** Reset the cached env-secret list (used by tests). */
function _resetEnvSecretsCache() {
  envSecretsCache = null;
}

module.exports = { redactSecrets, _resetEnvSecretsCache };
