/**
 * Read-only, allowlisted access to Project Zomboid server files under
 * /home/Zomboid. Two hard rules:
 *   1. Only an explicit allowlist of config keys is ever surfaced — credential
 *      keys (Password, RCONPassword, DiscordToken, ...) are dropped by omission.
 *   2. Files are never returned raw; we return curated summaries / short tails,
 *      and everything is passed through redactSecrets() as a final guarantee.
 */
const fs = require("fs");
const { execFile } = require("child_process");

const { redactSecrets } = require("../../../utils/redact");

const ZOMBOID_ROOT = "/home/pzserver/Zomboid";
const SERVER_INI = `${ZOMBOID_ROOT}/Server/pzserver.ini`;
const CONSOLE_LOG = `${ZOMBOID_ROOT}/server-console.txt`;

// Steam Workshop content (the mods). Overridable via MODS_PATH.
const MODS_PATH =
  process.env.MODS_PATH || "/home/pzserver/serverfiles/steamapps/workshop/content/108600";

// Config keys safe to surface. Anything not listed is silently dropped, so the
// server/RCON/admin passwords and the Discord token can never be returned.
const SAFE_INI_KEYS = [
  "PVP", "Open", "Public", "PublicName", "PublicDescription", "MaxPlayers",
  "PingLimit", "Map", "Mods", "WorkshopItems", "PauseEmpty", "GlobalChat",
  "SpawnPoint", "HoursForLootRespawn", "MaxItemsForLootRespawn",
  "ConstructionPreventsLootRespawn", "PlayerSafehouse", "AdminSafehouse",
  "SafehouseAllowTrepass", "SafehouseAllowFire", "SafehouseAllowLoot",
  "SafehouseAllowRespawn", "SafehouseDaySurvivedToClaim", "SafeHouseRemovalTime",
  "NoFire", "AnnounceDeath", "SaveWorldEveryMinutes", "AllowCoop", "SleepAllowed",
  "SleepNeeded", "Faction", "MaxAccountsPerUser", "SteamScoreboard", "SteamVAC",
  "VoiceEnable", "DefaultPort", "UDPPort", "DropOffWhiteListAfterDeath",
  "AutoCreateUserInWhiteList", "SafetySystem", "PlayerRespawnWithSelf",
  "DisableSafehouseWhenPlayerConnected",
];

function parseIni(path) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Curated, secret-free summary of the server config. */
function getServerConfigSummary() {
  const ini = parseIni(SERVER_INI);
  if (!Object.keys(ini).length) return null;

  const lines = [];
  for (const key of SAFE_INI_KEYS) {
    const value = ini[key];
    if (value === undefined || value === "") continue;
    if (key === "Mods" || key === "WorkshopItems") {
      const count = value.split(";").filter(Boolean).length;
      lines.push(`${key} = ${count} entries`);
    } else {
      lines.push(`${key} = ${value}`);
    }
  }
  if (!lines.length) return null;
  return redactSecrets(`Server config (pzserver.ini, filtered):\n${lines.join("\n")}`);
}

/** Read only the last `maxBytes` of a file without loading the whole thing. */
function readTailBytes(path, maxBytes) {
  const fd = fs.openSync(path, "r");
  try {
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** Redacted tail of the server console (never the full multi-MB file). */
function getServerLogTail(maxLines = 40) {
  let raw;
  try {
    raw = readTailBytes(CONSOLE_LOG, 64 * 1024);
  } catch {
    return null;
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-maxLines).join("\n");
  if (!tail.trim()) return null;
  return redactSecrets(`Recent server console (last ${maxLines} lines, filtered):\n${tail}`);
}

function humanBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes) || 0;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// du on multi-GB dirs is slow, so cache the result briefly.
let modCache = { at: 0, text: null };
const MOD_CACHE_TTL_MS = 10 * 60 * 1000;

function runDu() {
  return new Promise((resolve) => {
    // -s total, -b bytes. Timeout guards against a slow/huge tree.
    execFile("du", ["-sb", MODS_PATH], { timeout: 20000 }, (err, stdout) => {
      if (err) return resolve(null);
      const bytes = Number(String(stdout).split(/\s+/)[0]);
      resolve(Number.isFinite(bytes) ? bytes : null);
    });
  });
}

function countModEntries() {
  try {
    return fs.readdirSync(MODS_PATH, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  } catch {
    return null;
  }
}

/** Total on-disk size of the installed Workshop mods (cached, redacted). */
async function getModStorageSummary() {
  const now = Date.now();
  if (modCache.text && now - modCache.at < MOD_CACHE_TTL_MS) return modCache.text;

  const bytes = await runDu();
  if (bytes == null) return null;

  const count = countModEntries();
  const lines = [
    "Mods storage (Steam Workshop content, filtered):",
    `total size = ${humanBytes(bytes)}`,
    count != null ? `workshop items = ${count}` : null,
  ].filter(Boolean);

  const text = redactSecrets(lines.join("\n"));
  modCache = { at: now, text };
  return text;
}

module.exports = { getServerConfigSummary, getServerLogTail, getModStorageSummary };
