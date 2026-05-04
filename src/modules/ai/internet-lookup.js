const DEFAULT_TIMEOUT_MS = 7000;

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

function scoreSnippet(text, keywords) {
  const lower = String(text || "").toLowerCase();
  if (!lower) return 0;

  let score = 0;
  for (const keyword of keywords) {
    if (lower.includes(keyword)) {
      score += 4;
    }
  }

  return score;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutHandle),
  };
}

async function fetchJson(url, timeoutMs) {
  if (typeof fetch !== "function") return null;

  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "ZM-AI-Assistance/1.0",
      },
      signal: timeout.signal,
    });

    if (!response.ok) return null;
    return await response.json();
  } catch (_error) {
    return null;
  } finally {
    timeout.clear();
  }
}

function flattenRelatedTopics(relatedTopics) {
  const flat = [];

  for (const topic of relatedTopics || []) {
    if (topic && Array.isArray(topic.Topics)) {
      flat.push(...flattenRelatedTopics(topic.Topics));
      continue;
    }

    if (topic && typeof topic.Text === "string") {
      flat.push(topic);
    }
  }

  return flat;
}

function buildDuckDuckGoSources(payload, keywords, topK) {
  if (!payload || typeof payload !== "object") return [];

  const sources = [];

  if (payload.AbstractText) {
    sources.push({
      file: "internet/duckduckgo/abstract",
      excerpt: normalizeText(payload.AbstractText),
      score: scoreSnippet(payload.AbstractText, keywords) + 5,
      url: String(payload.AbstractURL || "").trim() || undefined,
    });
  }

  const related = flattenRelatedTopics(payload.RelatedTopics || []);
  for (const topic of related.slice(0, Math.max(3, topK * 2))) {
    const text = normalizeText(topic.Text);
    if (!text) continue;

    sources.push({
      file: "internet/duckduckgo/related",
      excerpt: text,
      score: scoreSnippet(text, keywords) + 2,
      url: String(topic.FirstURL || "").trim() || undefined,
    });
  }

  return sources;
}

function buildWikipediaSources(payload, keywords) {
  if (!Array.isArray(payload) || payload.length < 4) return [];

  const titles = Array.isArray(payload[1]) ? payload[1] : [];
  const descriptions = Array.isArray(payload[2]) ? payload[2] : [];
  const urls = Array.isArray(payload[3]) ? payload[3] : [];

  const sources = [];
  for (let idx = 0; idx < titles.length; idx += 1) {
    const title = normalizeText(titles[idx]);
    if (!title) continue;

    const description = normalizeText(descriptions[idx]);
    const excerpt = description || title;

    sources.push({
      file: "internet/wikipedia/opensearch",
      excerpt,
      score: scoreSnippet(`${title} ${description}`, keywords) + 3,
      url: String(urls[idx] || "").trim() || undefined,
    });
  }

  return sources;
}

function dedupeSources(sources) {
  const seen = new Set();
  const result = [];

  for (const source of sources) {
    const key = `${source.file}|${source.url || ""}|${source.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }

  return result;
}

async function getInternetGrounding(prompt, env) {
  if (!env.internetLookupEnabled) {
    return {
      enabled: false,
      reason: "internet_lookup_disabled",
      root: null,
      sources: [],
      context: "",
    };
  }

  const query = String(prompt || "").trim();
  if (!query) {
    return {
      enabled: true,
      reason: "empty_prompt",
      root: null,
      sources: [],
      context: "",
    };
  }

  const keywords = extractKeywords(query);
  const topK = Math.max(1, Number(env.internetLookupTopK || 4));
  const timeoutMs = Math.max(1500, Number(env.internetLookupTimeoutMs || DEFAULT_TIMEOUT_MS));

  const duckUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${topK}&namespace=0&format=json`;

  const [duckPayload, wikiPayload] = await Promise.all([
    fetchJson(duckUrl, timeoutMs),
    fetchJson(wikiUrl, timeoutMs),
  ]);

  const matches = dedupeSources([
    ...buildDuckDuckGoSources(duckPayload, keywords, topK),
    ...buildWikipediaSources(wikiPayload, keywords),
  ]);

  matches.sort((a, b) => b.score - a.score);
  const sources = matches.slice(0, topK);

  const context = sources
    .map((source, index) => {
      const urlLine = source.url ? `\nURL: ${source.url}` : "";
      return `[${index + 1}] ${source.file}${urlLine}\n${source.excerpt}`;
    })
    .join("\n\n");

  return {
    enabled: true,
    reason: sources.length > 0 ? "internet_match" : "internet_no_match",
    root: null,
    sources,
    context,
    keywords,
  };
}

module.exports = {
  getInternetGrounding,
};
