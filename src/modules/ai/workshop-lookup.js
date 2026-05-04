const fs = require("fs/promises");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_KNOWLEDGE_FILES = [path.join(PROJECT_ROOT, "SKILL.md")];

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "your",
  "about",
  "what",
  "when",
  "where",
  "how",
  "are",
  "was",
  "were",
  "you",
  "tell",
  "can",
  "please",
]);

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(prompt) {
  const words = String(prompt || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));

  return Array.from(new Set(words)).slice(0, 16);
}

function scoreMatch(filePathLower, contentLower, keywords) {
  let score = 0;

  for (const keyword of keywords) {
    if (filePathLower.includes(keyword)) {
      score += 6;
    }

    const firstIdx = contentLower.indexOf(keyword);
    if (firstIdx !== -1) {
      score += 4;
      let count = 1;
      let seekFrom = firstIdx + keyword.length;
      while (count < 4) {
        const nextIdx = contentLower.indexOf(keyword, seekFrom);
        if (nextIdx === -1) break;
        score += 1;
        count += 1;
        seekFrom = nextIdx + keyword.length;
      }
    }
  }

  return score;
}

function buildExcerpt(contentRaw, contentLower, keywords, maxChars) {
  let matchIdx = -1;
  for (const keyword of keywords) {
    const idx = contentLower.indexOf(keyword);
    if (idx !== -1 && (matchIdx === -1 || idx < matchIdx)) {
      matchIdx = idx;
    }
  }

  if (matchIdx === -1) {
    return normalizeText(contentRaw.slice(0, maxChars));
  }

  const start = Math.max(0, matchIdx - Math.floor(maxChars * 0.35));
  const end = Math.min(contentRaw.length, start + maxChars);
  const excerpt = contentRaw.slice(start, end);
  return `${start > 0 ? "..." : ""}${normalizeText(excerpt)}${end < contentRaw.length ? "..." : ""}`;
}

async function addMatchFromFile({
  filePath,
  displayPath,
  keywords,
  maxFileSize,
  excerptChars,
  matches,
}) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return;
    if (stat.size > maxFileSize) return;

    const raw = await fs.readFile(filePath, "utf8");
    const rawNormalized = String(raw || "");
    if (!rawNormalized.trim()) return;

    const lower = rawNormalized.toLowerCase();
    const filePathLower = String(displayPath || filePath).toLowerCase();
    const score = scoreMatch(filePathLower, lower, keywords);
    if (score <= 0) return;

    const excerpt = buildExcerpt(rawNormalized, lower, keywords, excerptChars);

    matches.push({
      file: displayPath,
      score,
      excerpt,
    });
  } catch (_error) {
    // Ignore unreadable files and continue.
  }
}

async function getWorkshopGrounding(prompt, env) {
  if (!env.workshopLookupEnabled) {
    return {
      enabled: false,
      reason: "lookup_disabled",
      root: null,
      sources: [],
      context: "",
    };
  }

  const keywords = extractKeywords(prompt);
  if (keywords.length === 0) {
    return {
      enabled: true,
      reason: "no_keywords",
      root: null,
      sources: [],
      context: "",
    };
  }

  const maxFileSize = Math.max(4096, Number(env.workshopLookupMaxFileSizeBytes || 524288));
  const topK = Math.max(1, Number(env.workshopLookupTopK || 5));
  const excerptChars = Math.max(120, Number(env.workshopLookupExcerptChars || 500));

  // Policy: only scan SKILL.md and never scan workshop directories.
  const knowledgeMatches = [];
  for (const knowledgeFile of DEFAULT_KNOWLEDGE_FILES) {
    const baseName = path.basename(knowledgeFile);
    await addMatchFromFile({
      filePath: knowledgeFile,
      displayPath: `knowledge/${baseName}`,
      keywords,
      maxFileSize,
      excerptChars,
      matches: knowledgeMatches,
    });
  }

  knowledgeMatches.sort((a, b) => b.score - a.score);
  const sources = knowledgeMatches.slice(0, topK);

  const context = sources
    .map((source, index) => `[${index + 1}] ${source.file}\n${source.excerpt}`)
    .join("\n\n");

  const reason = sources.length > 0 ? "skill_only" : "skill_no_match";

  return {
    enabled: true,
    reason,
    root: null,
    sources,
    context,
    keywords,
  };
}

module.exports = {
  getWorkshopGrounding,
};
