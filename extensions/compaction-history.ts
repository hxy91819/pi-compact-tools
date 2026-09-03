import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  compactedEntries,
  formatCompactedHistory,
  listCompactions,
  type CompactionEntry,
  type HistoryEntry,
} from "../src/compaction-history.ts";

function formatCompactionLabel(compaction: CompactionEntry): string {
  return `${new Date(compaction.timestamp).toLocaleString()} · ${compaction.tokensBefore.toLocaleString()} tokens`;
}

function usageError(ctx: ExtensionCommandContext): void {
  ctx.ui.notify("用法：/compaction-history [--raw]", "warning");
}

async function openHistory(
  ctx: ExtensionContext,
  compaction: CompactionEntry,
  includeToolResults: boolean,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("压缩前历史浏览器仅在 TUI 可用", "warning");
    return;
  }

  const entries = ctx.sessionManager.getEntries() as HistoryEntry[];
  const compacted = compactedEntries(entries, compaction);
  if (compacted.length === 0) {
    ctx.ui.notify("这个压缩检查点没有可恢复的本地历史", "warning");
    return;
  }

  const transcript = formatCompactedHistory(compacted, { includeToolResults });
  if (includeToolResults && transcript.length > 200_000) {
    const confirmed = await ctx.ui.confirm(
      "打开完整压缩前历史？",
      `工具结果共 ${transcript.length.toLocaleString()} 个字符，打开可能较慢。`,
    );
    if (!confirmed) return;
  }

  await ctx.ui.editor(
    `压缩前对话 · ${formatCompactionLabel(compaction)} · Esc 关闭（不会写回会话）`,
    transcript,
  );
}

async function chooseAndOpenHistory(
  ctx: ExtensionCommandContext,
  includeToolResults: boolean,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("压缩前历史浏览器仅在 TUI 可用", "warning");
    return;
  }

  const compactions = listCompactions(ctx.sessionManager.getEntries() as HistoryEntry[]);
  if (compactions.length === 0) {
    ctx.ui.notify("当前会话尚未发生 compaction", "info");
    return;
  }

  let selected = compactions.at(-1)!;
  if (compactions.length > 1) {
    const labels = compactions.map(formatCompactionLabel);
    const choice = await ctx.ui.select("选择要查看的 compaction", labels);
    if (!choice) return;
    selected = compactions[labels.indexOf(choice)]!;
  }

  await openHistory(ctx, selected, includeToolResults);
}

export function installCompactionHistory(pi: ExtensionAPI): void {
  pi.registerCommand("compaction-history", {
    description: "查看被 compaction 隐藏的本地对话（--raw 含工具结果）",
    handler: async (args, ctx) => {
      const option = args.trim();
      if (option && option !== "--raw") {
        usageError(ctx);
        return;
      }
      await chooseAndOpenHistory(ctx, option === "--raw");
    },
  });

  pi.registerShortcut("ctrl+shift+h", {
    description: "查看最近一次 compaction 前的对话",
    handler: async (ctx) => {
      const compactions = listCompactions(ctx.sessionManager.getEntries() as HistoryEntry[]);
      const latest = compactions.at(-1);
      if (!latest) {
        ctx.ui.notify("当前会话尚未发生 compaction", "info");
        return;
      }
      await openHistory(ctx, latest, false);
    },
  });

  pi.on("session_compact", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.notify(
      `已压缩 ${event.compactionEntry.tokensBefore.toLocaleString()} tokens；Ctrl+Shift+H 可查看压缩前对话`,
      "info",
    );
  });
}
