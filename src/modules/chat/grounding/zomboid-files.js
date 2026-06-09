/**
 * Read-only, allowlisted access to Project Zomboid server files under
 * /home/Zomboid. Two hard rules:
 *   1. Only an explicit allowlist of config keys is ever surfaced — credential
 *      keys (Password, RCONPassword, DiscordToken, ...) are dropped by omission.
 *   2. Files are never returned raw; we return curated summaries / short tails,
 *      and everything is passed through redactSecrets() as a final guarantee.
 */
const fs = require("fs");

const { redactSecrets } = require("../../../utils/redact");

const ZOMBOID_ROOT = "/home/pzserver/Zomboid";
const SERVER_INI = `${ZOMBOID_ROOT}/Server/pzserver.ini`;
const CONSOLE_LOG = `${ZOMBOID_ROOT}/server-console.txt`;

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

module.exports = { getServerConfigSummary, getServerLogTail };
