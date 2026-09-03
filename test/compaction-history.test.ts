import assert from "node:assert/strict";
import test from "node:test";
import {
  compactedEntries,
  formatCompactedHistory,
  listCompactions,
  type HistoryEntry,
} from "../src/compaction-history.ts";

function entry(value: HistoryEntry): HistoryEntry {
  return value;
}

const entries = [
  entry({
    type: "message",
    id: "user-1",
    parentId: null,
    timestamp: "2026-09-02T12:00:00.000Z",
    message: { role: "user", content: "请检查压缩前的对话" },
  }),
  entry({
    type: "message",
    id: "assistant-1",
    parentId: "user-1",
    timestamp: "2026-09-02T12:00:01.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "我会先检查会话。" },
        { type: "toolCall", name: "read", arguments: { path: "README.md" } },
      ],
    },
  }),
  entry({
    type: "message",
    id: "tool-result-1",
    parentId: "assistant-1",
    timestamp: "2026-09-02T12:00:02.000Z",
    message: { role: "toolResult", content: [{ type: "text", text: "README 内容" }] },
  }),
  entry({
    type: "message",
    id: "user-2",
    parentId: "tool-result-1",
    timestamp: "2026-09-02T12:00:03.000Z",
    message: { role: "user", content: "这是压缩后保留的提问" },
  }),
  entry({
    type: "compaction",
    id: "compaction-1",
    parentId: "user-2",
    timestamp: "2026-09-02T12:00:04.000Z",
    firstKeptEntryId: "user-2",
    tokensBefore: 273582,
    summary: "压缩摘要",
  }),
];

test("识别会话中的压缩检查点", () => {
  assert.deepEqual(listCompactions(entries).map((item) => item.id), ["compaction-1"]);
});

test("只恢复 compaction 的 firstKeptEntryId 之前的活跃分支", () => {
  const compaction = listCompactions(entries)[0]!;
  assert.deepEqual(
    compactedEntries(entries, compaction).map((item) => item.id),
    ["user-1", "assistant-1", "tool-result-1"],
  );
});

test("默认历史视图保留对话和工具调用摘要，但不展开工具结果", () => {
  const compaction = listCompactions(entries)[0]!;
  const output = formatCompactedHistory(compactedEntries(entries, compaction));

  assert.match(output, /请检查压缩前的对话/);
  assert.match(output, /我会先检查会话。/);
  assert.match(output, /\[工具调用\] read/);
  assert.doesNotMatch(output, /README 内容/);
});

test("raw 历史视图可按需显示工具结果", () => {
  const compaction = listCompactions(entries)[0]!;
  const output = formatCompactedHistory(compactedEntries(entries, compaction), { includeToolResults: true });

  assert.match(output, /README 内容/);
});
