export type HistoryMessage = {
  role?: unknown;
  content?: unknown;
};

export type HistoryEntry = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: HistoryMessage;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  summary?: string;
};

export type CompactionEntry = HistoryEntry & {
  type: "compaction";
  firstKeptEntryId: string;
  tokensBefore: number;
  summary: string;
};

export type HistoryFormatOptions = {
  includeToolResults?: boolean;
  includeThinking?: boolean;
};

export function listCompactions(entries: readonly HistoryEntry[]): CompactionEntry[] {
  return entries.filter(
    (entry): entry is CompactionEntry =>
      entry.type === "compaction" &&
      typeof entry.firstKeptEntryId === "string" &&
      typeof entry.tokensBefore === "number" &&
      typeof entry.summary === "string",
  );
}

export function compactedEntries(entries: readonly HistoryEntry[], compaction: CompactionEntry): HistoryEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: HistoryEntry[] = [];
  let entryId = compaction.parentId;

  while (entryId) {
    const entry = byId.get(entryId);
    if (!entry) return [];
    path.unshift(entry);
    entryId = entry.parentId;
  }

  const firstKeptIndex = path.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
  return firstKeptIndex === -1 ? [] : path.slice(0, firstKeptIndex);
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((part) => {
      if (typeof part === "string") return [part];
      if (!part || typeof part !== "object") return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

function contentBlocks(content: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(content)) return [];
  return content.filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === "object");
}

function formatArguments(argumentsValue: unknown): string {
  if (argumentsValue === undefined) return "";
  try {
    return ` ${JSON.stringify(argumentsValue)}`;
  } catch {
    return "";
  }
}

function formatAssistant(message: HistoryMessage, options: HistoryFormatOptions): string[] {
  const lines: string[] = [];
  const blocks = contentBlocks(message.content);

  if (blocks.length === 0) {
    const text = textContent(message.content);
    if (text) lines.push(`[助手]\n${text}`);
    return lines;
  }

  const text = blocks
    .filter((block) => block.type === "text")
    .flatMap((block) => (typeof block.text === "string" ? [block.text] : []))
    .join("\n");
  if (text) lines.push(`[助手]\n${text}`);

  if (options.includeThinking) {
    const thinking = blocks
      .filter((block) => block.type === "thinking")
      .flatMap((block) => (typeof block.thinking === "string" ? [block.thinking] : typeof block.text === "string" ? [block.text] : []))
      .join("\n");
    if (thinking) lines.push(`[思考]\n${thinking}`);
  }

  for (const block of blocks) {
    if (block.type !== "toolCall") continue;
    const name = typeof block.name === "string" ? block.name : "unknown";
    lines.push(`[工具调用] ${name}${formatArguments(block.arguments)}`);
  }

  return lines;
}

function formatMessage(message: HistoryMessage, options: HistoryFormatOptions): string[] {
  const role = typeof message.role === "string" ? message.role : "unknown";

  if (role === "user") {
    const text = textContent(message.content);
    return text ? [`[用户]\n${text}`] : [];
  }

  if (role === "assistant") return formatAssistant(message, options);

  if (role === "toolResult") {
    if (!options.includeToolResults) return [];
    const text = textContent(message.content);
    return text ? [`[工具结果]\n${text}`] : [];
  }

  return [];
}

/**
 * Produces a local, display-only transcript of entries removed from Pi's active
 * context by a compaction. It never changes the compaction summary or model context.
 */
export function formatCompactedHistory(entries: readonly HistoryEntry[], options: HistoryFormatOptions = {}): string {
  const blocks = entries
    .filter((entry) => entry.type === "message" && entry.message)
    .flatMap((entry) => formatMessage(entry.message!, options));

  const rendered = blocks.length > 0 ? blocks.join("\n\n") : "（没有可显示的对话内容）";
  return `# 压缩前对话\n\n${rendered}`;
}
