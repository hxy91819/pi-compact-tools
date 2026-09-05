export const COMPACT_TOOL_NAMES = new Set([
  "bash",
  "powershell",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
]);

export type ToolBatchStatus = "running" | "completed" | "failed";

export type ToolBatchToolSummary = {
  toolName: string;
  completed: number;
  failed: number;
  running: number;
};

type ToolBatchCall = {
  id: string;
  toolName: string;
  status: ToolBatchStatus;
  batchId: string;
};

type ToolBatch = {
  id: string;
  callIds: string[];
  thinkingRuns: Map<string, number>;
  invalidate?: () => void;
};

type SessionEntryLike = {
  id?: unknown;
  message?: unknown;
};

type MessageLike = {
  role?: unknown;
  content?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  isError?: unknown;
};

type ToolCallLike = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
};

export function isCompactToolName(toolName: string): boolean {
  return COMPACT_TOOL_NAMES.has(toolName);
}

export function formatToolBatchSummary(summary: readonly ToolBatchToolSummary[], thinkingRuns = 0): string {
  const parts = summary.map((tool) => {
    const statuses: string[] = [];
    if (tool.completed > 0) statuses.push(`${tool.completed} 完成`);
    if (tool.failed > 0) statuses.push(`${tool.failed} 失败`);
    statuses.push(`${tool.running} 运行中`);
    return `${tool.toolName} ${statuses.join(" / ")}`;
  });
  if (thinkingRuns > 0) parts.unshift(`Thinking ${thinkingRuns} 次`);
  return parts.join(" · ");
}

/**
 * Tracks built-in calls issued during one agent run. Tool call IDs make
 * start/end events and restored session history converge on the same summary.
 */
export class ToolBatchState {
  private nextBatchId = 0;
  private nextAssistantMessageId = 0;
  private activeBatchId: string | undefined;
  private activeAssistantMessageId: string | undefined;
  private readonly batches = new Map<string, ToolBatch>();
  private readonly calls = new Map<string, ToolBatchCall>();

  reset(): void {
    this.nextBatchId = 0;
    this.nextAssistantMessageId = 0;
    this.activeBatchId = undefined;
    this.activeAssistantMessageId = undefined;
    this.batches.clear();
    this.calls.clear();
  }

  beginAgentRun(): string {
    const batchId = `live:${this.nextBatchId++}`;
    this.activeBatchId = batchId;
    this.activeAssistantMessageId = undefined;
    this.ensureBatch(batchId);
    return batchId;
  }

  beginAssistantMessage(messageId = `live-assistant:${this.nextAssistantMessageId++}`): string {
    this.activeAssistantMessageId = messageId;
    return messageId;
  }

  observeAssistantContent(content: unknown): void {
    if (!Array.isArray(content)) return;

    const batchId = this.activeBatchId ?? this.beginAgentRun();
    const messageId = this.activeAssistantMessageId ?? this.beginAssistantMessage();
    const batch = this.ensureBatch(batchId);
    const thinkingRuns = content.some(
      (block) => block && typeof block === "object" && (block as { type?: unknown }).type === "toolCall",
    )
      ? countThinkingRuns(content)
      : 0;
    if (thinkingRuns !== (batch.thinkingRuns.get(messageId) ?? 0)) {
      if (thinkingRuns > 0) batch.thinkingRuns.set(messageId, thinkingRuns);
      else batch.thinkingRuns.delete(messageId);
      this.notify(batchId);
    }

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const toolCall = block as ToolCallLike;
      if (toolCall.type !== "toolCall" || typeof toolCall.id !== "string" || typeof toolCall.name !== "string") continue;
      this.observeToolCall(toolCall.id, toolCall.name, batchId);
    }
  }

  observeToolExecutionStart(toolCallId: string, toolName: string): void {
    this.observeToolCall(toolCallId, toolName, this.activeBatchId ?? this.beginAgentRun());
  }

  observeToolExecutionEnd(toolCallId: string, toolName: string, isError: boolean): void {
    this.observeToolCall(toolCallId, toolName, this.activeBatchId ?? this.beginAgentRun());
    const call = this.calls.get(toolCallId);
    if (!call || call.status !== "running") return;

    call.status = isError ? "failed" : "completed";
    this.notify(call.batchId);
  }

  isAnchor(toolCallId: string): boolean {
    const call = this.calls.get(toolCallId);
    if (!call) return false;
    return this.batches.get(call.batchId)?.callIds.at(-1) === toolCallId;
  }

  summaryFor(toolCallId: string): ToolBatchToolSummary[] | undefined {
    const call = this.calls.get(toolCallId);
    if (!call) return undefined;

    const batch = this.batches.get(call.batchId);
    if (!batch) return undefined;

    const summaries = new Map<string, ToolBatchToolSummary>();
    for (const callId of batch.callIds) {
      const batchCall = this.calls.get(callId);
      if (!batchCall) continue;

      let summary = summaries.get(batchCall.toolName);
      if (!summary) {
        summary = { toolName: batchCall.toolName, completed: 0, failed: 0, running: 0 };
        summaries.set(batchCall.toolName, summary);
      }
      summary[batchCall.status] += 1;
    }
    return [...summaries.values()];
  }

  thinkingRunsFor(toolCallId: string): number {
    const call = this.calls.get(toolCallId);
    if (!call) return 0;
    const batch = this.batches.get(call.batchId);
    if (!batch) return 0;
    return [...batch.thinkingRuns.values()].reduce((total, count) => total + count, 0);
  }

  setAnchorInvalidator(toolCallId: string, invalidate: () => void): void {
    const call = this.calls.get(toolCallId);
    if (!call || !this.isAnchor(toolCallId)) return;

    const batch = this.batches.get(call.batchId);
    if (batch) batch.invalidate = invalidate;
  }

  hydrate(entries: readonly unknown[]): void {
    this.reset();

    for (const value of entries) {
      if (!value || typeof value !== "object") continue;
      const entry = value as SessionEntryLike;
      const message = asMessage(entry.message);
      if (!message) continue;

      if (message.role === "user") {
        const batchId = `history:${typeof entry.id === "string" ? entry.id : this.nextBatchId++}`;
        this.activeBatchId = batchId;
        this.activeAssistantMessageId = undefined;
        this.ensureBatch(batchId);
        continue;
      }

      if (message.role === "assistant") {
        if (!this.activeBatchId) {
          const batchId = `history:${typeof entry.id === "string" ? entry.id : this.nextBatchId++}`;
          this.activeBatchId = batchId;
          this.ensureBatch(batchId);
        }
        this.beginAssistantMessage(
          `history-assistant:${typeof entry.id === "string" ? entry.id : this.nextAssistantMessageId++}`,
        );
        this.observeAssistantContent(message.content);
        continue;
      }

      if (
        message.role === "toolResult" &&
        typeof message.toolCallId === "string" &&
        typeof message.toolName === "string" &&
        typeof message.isError === "boolean"
      ) {
        this.observeToolExecutionEnd(message.toolCallId, message.toolName, message.isError);
      }
    }

    this.activeBatchId = undefined;
    this.activeAssistantMessageId = undefined;
  }

  private observeToolCall(toolCallId: string, toolName: string, batchId: string): void {
    if (!isCompactToolName(toolName)) return;
    if (this.calls.has(toolCallId)) return;

    const batch = this.ensureBatch(batchId);
    this.calls.set(toolCallId, { id: toolCallId, toolName, status: "running", batchId });
    batch.callIds.push(toolCallId);
    this.notify(batchId);
  }

  private ensureBatch(batchId: string): ToolBatch {
    let batch = this.batches.get(batchId);
    if (!batch) {
      batch = { id: batchId, callIds: [], thinkingRuns: new Map() };
      this.batches.set(batchId, batch);
    }
    return batch;
  }

  private notify(batchId: string): void {
    this.batches.get(batchId)?.invalidate?.();
  }
}

function countThinkingRuns(content: readonly unknown[]): number {
  let count = 0;
  let inThinkingRun = false;

  for (const block of content) {
    if (!block || typeof block !== "object") {
      inThinkingRun = false;
      continue;
    }

    const candidate = block as { type?: unknown; thinking?: unknown };
    const hasThinking =
      candidate.type === "thinking" &&
      typeof candidate.thinking === "string" &&
      candidate.thinking.trim().length > 0;
    if (hasThinking && !inThinkingRun) count += 1;
    inThinkingRun = hasThinking;
  }

  return count;
}

function asMessage(value: unknown): MessageLike | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as MessageLike;
}
