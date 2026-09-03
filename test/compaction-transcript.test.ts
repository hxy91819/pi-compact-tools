import assert from "node:assert/strict";
import test from "node:test";
import { renderCompleteSessionTranscript } from "../src/compaction-transcript.ts";

test("重建屏幕 transcript 时保留 compaction 前的活跃分支条目", () => {
  const rendered: string[][] = [];
  let cleared = 0;
  const fullBranch = ["user-before", "assistant-before", "compaction", "user-after"];

  renderCompleteSessionTranscript({
    sessionManager: {
      getBranch: () => fullBranch,
    },
    chatContainer: {
      clear: () => {
        cleared += 1;
      },
    },
    renderSessionEntries: (entries) => {
      rendered.push(entries);
    },
  });

  assert.equal(cleared, 1);
  assert.deepEqual(rendered, [fullBranch]);
});
