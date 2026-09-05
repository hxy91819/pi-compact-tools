import assert from "node:assert/strict";
import test from "node:test";
import { formatToolBatchSummary, ToolBatchState } from "../src/tool-batching.ts";

test("同一 agent run 的工具调用按工具类型、首次出现顺序汇总", () => {
  const state = new ToolBatchState();
  state.beginAgentRun();
  state.beginAssistantMessage();
  state.observeAssistantContent([
    { type: "thinking", thinking: "inspect" },
    { type: "toolCall", id: "bash-1", name: "bash" },
    { type: "toolCall", id: "edit-1", name: "edit" },
    { type: "toolCall", id: "bash-2", name: "bash" },
  ]);
  state.observeToolExecutionEnd("bash-1", "bash", false);
  state.observeToolExecutionEnd("edit-1", "edit", true);

  assert.equal(state.isAnchor("bash-1"), false);
  assert.equal(state.isAnchor("edit-1"), false);
  assert.equal(state.isAnchor("bash-2"), true);
  assert.equal(
    formatToolBatchSummary(state.summaryFor("bash-1")!, state.thinkingRunsFor("bash-1")),
    "Thinking 1 次 · bash 1 完成 / 1 运行中 · edit 1 失败 / 0 运行中",
  );
});

test("同一 Thinking 流式更新只计一次，跨 assistant 消息累计", () => {
  const state = new ToolBatchState();
  state.beginAgentRun();
  state.beginAssistantMessage();
  state.observeAssistantContent([
    { type: "thinking", thinking: "first" },
    { type: "toolCall", id: "bash-1", name: "bash" },
  ]);
  state.observeAssistantContent([
    { type: "thinking", thinking: "first updated" },
    { type: "toolCall", id: "bash-1", name: "bash" },
  ]);

  state.beginAssistantMessage();
  state.observeAssistantContent([
    { type: "thinking", thinking: "second" },
    { type: "toolCall", id: "read-1", name: "read" },
  ]);

  state.beginAssistantMessage();
  state.observeAssistantContent([
    { type: "thinking", thinking: "final response reasoning" },
    { type: "text", text: "done" },
  ]);

  assert.equal(state.thinkingRunsFor("bash-1"), 2);
  assert.equal(
    formatToolBatchSummary(state.summaryFor("bash-1")!, state.thinkingRunsFor("bash-1")),
    "Thinking 2 次 · bash 1 运行中 · read 1 运行中",
  );
});

test("同一 agent run 内跨 assistant 消息合并，下一次 run 才开始新汇总行", () => {
  const state = new ToolBatchState();
  state.beginAgentRun();
  state.observeToolExecutionStart("bash-1", "bash");
  state.observeToolExecutionEnd("bash-1", "bash", false);

  state.observeAssistantContent([{ type: "toolCall", id: "read-1", name: "read" }]);
  state.observeToolExecutionEnd("read-1", "read", false);

  assert.equal(
    formatToolBatchSummary(state.summaryFor("bash-1")!),
    "bash 1 完成 / 0 运行中 · read 1 完成 / 0 运行中",
  );
  assert.equal(state.isAnchor("read-1"), true);

  state.beginAgentRun();
  state.observeToolExecutionStart("read-2", "read");
  state.observeToolExecutionStart("ls-1", "ls");
  state.observeToolExecutionEnd("ls-1", "ls", false);

  assert.equal(formatToolBatchSummary(state.summaryFor("read-2")!), "read 1 运行中 · ls 1 完成 / 0 运行中");
});

test("新增调用会把汇总移到最新工具位置，第三方工具不参与", () => {
  const state = new ToolBatchState();
  state.beginAgentRun();
  state.observeToolExecutionStart("bash-1", "bash");
  let invalidations = 0;
  state.setAnchorInvalidator("bash-1", () => {
    invalidations += 1;
  });

  state.observeToolExecutionStart("custom-1", "third_party");
  state.observeToolExecutionStart("read-1", "read");
  let latestInvalidations = 0;
  state.setAnchorInvalidator("read-1", () => {
    latestInvalidations += 1;
  });
  state.observeToolExecutionEnd("read-1", "read", false);

  assert.equal(invalidations, 1);
  assert.equal(latestInvalidations, 1);
  assert.equal(state.isAnchor("bash-1"), false);
  assert.equal(state.isAnchor("read-1"), true);
  assert.equal(state.summaryFor("custom-1"), undefined);
  assert.equal(formatToolBatchSummary(state.summaryFor("bash-1")!), "bash 1 运行中 · read 1 完成 / 0 运行中");
});

test("从活动会话分支恢复段落、完成和失败状态", () => {
  const state = new ToolBatchState();
  state.hydrate([
    {
      id: "user-1",
      message: { role: "user", content: [{ type: "text", text: "first" }] },
    },
    {
      id: "assistant-1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "first" },
          { type: "toolCall", id: "bash-1", name: "bash" },
          { type: "toolCall", id: "edit-1", name: "edit" },
        ],
      },
    },
    {
      id: "tool-1",
      message: { role: "toolResult", toolCallId: "bash-1", toolName: "bash", isError: false },
    },
    {
      id: "tool-2",
      message: { role: "toolResult", toolCallId: "edit-1", toolName: "edit", isError: true },
    },
    {
      id: "assistant-2",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "second" },
          { type: "toolCall", id: "read-1", name: "read" },
        ],
      },
    },
    {
      id: "user-2",
      message: { role: "user", content: [{ type: "text", text: "second" }] },
    },
    {
      id: "assistant-3",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "ls-1", name: "ls" }],
      },
    },
  ]);

  assert.equal(
    formatToolBatchSummary(state.summaryFor("bash-1")!, state.thinkingRunsFor("bash-1")),
    "Thinking 2 次 · bash 1 完成 / 0 运行中 · edit 1 失败 / 0 运行中 · read 1 运行中",
  );
  assert.equal(state.isAnchor("read-1"), true);
  assert.equal(formatToolBatchSummary(state.summaryFor("ls-1")!), "ls 1 运行中");
});
