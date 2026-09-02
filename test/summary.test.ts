import assert from "node:assert/strict";
import test from "node:test";
import { stringifyArguments, summarizeToolCall, textOutput } from "../src/summary.ts";

test("bash 摘要压缩为单行", () => {
  const summary = summarizeToolCall("bash", {
    command: "agent-browser eval 'first line'\n  | tail -1\n  | tee result.txt",
  });

  assert.equal(summary.includes("\n"), false);
  assert.match(summary, /^bash · agent-browser eval/);
});

test("编辑摘要只保留路径与编辑数量", () => {
  assert.equal(
    summarizeToolCall("edit", {
      path: "app/models/approval_request.rb",
      edits: [{ oldText: "old", newText: "new" }, { oldText: "before", newText: "after" }],
    }),
    "edit · app/models/approval_request.rb · 2 处",
  );
});

test("未知或缺失参数仍生成单行摘要", () => {
  assert.equal(summarizeToolCall("read", {}).includes("\n"), false);
  assert.equal(summarizeToolCall("external_tool", { payload: "value" }), "external_tool");
});

test("展开时保留文本输出并标示图像输出", () => {
  assert.equal(
    textOutput([
      { type: "text", text: "first" },
      { type: "image", data: "encoded" },
      { type: "text", text: "last" },
    ]),
    "first\n[image output]\nlast",
  );
});

test("参数序列化保留可展开的完整内容", () => {
  assert.equal(stringifyArguments({ path: "src/summary.ts", limit: 10 }), '{\n  "path": "src/summary.ts",\n  "limit": 10\n}');
});
