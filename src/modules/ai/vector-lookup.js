function extractResponseText(response) {
  const directText = String(response?.output_text || "").trim();
  if (directText) return directText;

  const parts = [];
  const outputItems = Array.isArray(response?.output) ? response.output : [];

  for (const item of outputItems) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (typeof part?.text === "string" && part.text.trim()) {
          parts.push(part.text.trim());
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

function collectSourceFromAnnotation(annotations, sourcesMap) {
  for (const annotation of annotations || []) {
    const fileId = String(annotation?.file_id || "").trim();
    const filename = String(annotation?.filename || "").trim();
    if (!fileId && !filename) continue;

    const key = fileId || filename;
    if (sourcesMap.has(key)) continue;

    sourcesMap.set(key, {
      file: `vector/${filename || fileId}`,
      score: 100,
      sourceType: "vector_store",
      ...(fileId ? { fileId } : {}),
    });
  }
}

function collectSourceFromFileSearchCalls(outputItems, sourcesMap) {
  for (const item of outputItems) {
    if (item?.type !== "file_search_call") continue;

    const results = Array.isArray(item?.results) ? item.results : [];
    for (const result of results) {
      const fileId = String(result?.file_id || "").trim();
      const filename = String(result?.filename || "").trim();
      if (!fileId && !filename) continue;

      const key = fileId || filename;
      if (sourcesMap.has(key)) continue;

      const numericScore = Number(result?.score);
      const score = Number.isFinite(numericScore)
        ? Math.max(1, Math.min(100, Math.round(numericScore * 100)))
        : 90;

      sourcesMap.set(key, {
        file: `vector/${filename || fileId}`,
        score,
        sourceType: "vector_store",
        ...(fileId ? { fileId } : {}),
      });
    }
  }
}

function extractVectorSources(response) {
  const sourcesMap = new Map();
  const outputItems = Array.isArray(response?.output) ? response.output : [];

  for (const item of outputItems) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;

    for (const part of item.content) {
      const annotations = Array.isArray(part?.annotations) ? part.annotations : [];
      collectSourceFromAnnotation(annotations, sourcesMap);
    }
  }

  collectSourceFromFileSearchCalls(outputItems, sourcesMap);

  return Array.from(sourcesMap.values());
}

function normalizeUsage(usage) {
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

async function getVectorGrounding({
  openai,
  model,
  prompt,
  persona,
  conversationHistoryMessages,
  vectorStoreIds,
  maxOutputTokens,
  topK,
  samplingControl,
}) {
  const ids = Array.isArray(vectorStoreIds)
    ? vectorStoreIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  if (ids.length === 0) {
    return {
      enabled: false,
      reason: "vector_store_not_configured",
      content: "",
      usage: null,
      model,
      sources: [],
    };
  }

  const vectorTool = {
    type: "file_search",
    vector_store_ids: ids,
  };

  if (Number.isFinite(topK) && topK > 0) {
    vectorTool.max_num_results = topK;
  }

  const historyMessages = Array.isArray(conversationHistoryMessages)
    ? conversationHistoryMessages.filter((item) =>
        item && (item.role === "user" || item.role === "assistant") && item.content
      )
    : [];

  const inputMessages = [
    {
      role: "system",
      content: persona,
    },
    {
      role: "system",
      content:
        "Use vector-store results as primary knowledge. If retrieved evidence is weak, say what is missing instead of guessing.",
    },
  ];

  if (historyMessages.length > 0) {
    inputMessages.push({
      role: "system",
      content:
        "Conversation memory is provided below. Continue naturally from recent context unless user clearly changes topic.",
    });
    inputMessages.push(...historyMessages);
  }

  inputMessages.push({
    role: "user",
    content: String(prompt || ""),
  });

  const response = await openai.responses.create({
    model,
    input: inputMessages,
    tools: [vectorTool],
    max_output_tokens: maxOutputTokens,
    ...samplingControl,
  });

  const content = extractResponseText(response);
  const sources = extractVectorSources(response);

  return {
    enabled: true,
    reason: content ? "vector_answer" : "vector_empty",
    content,
    usage: normalizeUsage(response?.usage),
    model: String(response?.model || model),
    sources,
  };
}

module.exports = {
  getVectorGrounding,
};
