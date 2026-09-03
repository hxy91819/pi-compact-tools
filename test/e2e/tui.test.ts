/**
 * End-to-end tests: a real Pi process, in a real terminal, running a real agent
 * loop against a scripted model. The model is mocked because the tests must be
 * deterministic and offline; everything else — extension loading, tool
 * execution, transcript rendering, keyboard handling — is Pi's own code.
 *
 * These tests exist because turn folding patches Pi's display-component
 * prototypes, so unit tests over `TurnFoldingState` cannot catch the failure
 * that matters most: Pi changing the internals this extension depends on.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NOTE_CONTENT, Scenario } from "./harness/run.ts";

const threeToolCalls = [
  {
    toolCalls: [{ id: "call_1", name: "bash", arguments: { command: "cat note.txt" } }],
  },
  { toolCalls: [{ id: "call_2", name: "read", arguments: { path: "note.txt" } }] },
  { toolCalls: [{ id: "call_3", name: "ls", arguments: { path: "." } }] },
  { text: "E2E-FINAL-ANSWER" },
];

let active: Scenario | undefined;

after(async () => {
  await active?.finish();
  active = undefined;
});

async function start(options: Parameters<typeof Scenario.start>[0]): Promise<Scenario> {
  await active?.finish();
  const scenario = await Scenario.start(options);
  active = scenario;
  return scenario;
}

test(
  "工具调用渲染为单行，turn 完成后折叠过程并保留最终回复",
  { timeout: 120_000 },
  async () => {
    const scenario = await start({
      tuiMode: "fullscreen",
      responses: threeToolCalls,
      files: { "note.txt": `${NOTE_CONTENT}\n` },
    });

    await scenario.runTurn("run the scripted task");

    assert.ok(!scenario.screenContains("Extension error"), `unexpected extension error:\n${scenario.screen()}`);

    // The final response survives the fold, with a count of what was folded.
    assert.ok(scenario.screenContains("E2E-FINAL-ANSWER"), scenario.screen());
    assert.ok(scenario.screenContains("[过程已折叠：3 次 Tool Call · Ctrl+Shift+O 展开]"), scenario.screen());

    // Process rows and tool output are retracted, which is the point of the fold.
    assert.ok(!scenario.screenContains("[完成] bash"), scenario.screen());
    assert.ok(!scenario.screenContains(NOTE_CONTENT), scenario.screen());
  },
);

test(
  "Ctrl+Shift+O 展开已完成过程并可重新折叠",
  { timeout: 120_000 },
  async () => {
    const scenario = await start({
      tuiMode: "fullscreen",
      responses: threeToolCalls,
      files: { "note.txt": `${NOTE_CONTENT}\n` },
    });

    await scenario.runTurn("run the scripted task");
    assert.ok(!scenario.screenContains("[完成] bash"), scenario.screen());

    scenario.press("ctrlShiftO");
    await scenario.settle();

    // Expanding restores the compact one-line rows, not the raw tool output.
    assert.ok(scenario.screenContains("[过程已展开：3 次 Tool Call · Ctrl+Shift+O 折叠]"), scenario.screen());
    assert.ok(scenario.screenContains("[完成] bash · cat note.txt (ctrl+o 展开详情)"), scenario.screen());
    assert.ok(scenario.screenContains("[完成] read · note.txt (ctrl+o 展开详情)"), scenario.screen());
    assert.ok(!scenario.screenContains(NOTE_CONTENT), scenario.screen());

    scenario.press("ctrlShiftO");
    await scenario.settle();

    assert.ok(scenario.screenContains("[过程已折叠：3 次 Tool Call · Ctrl+Shift+O 展开]"), scenario.screen());
    assert.ok(!scenario.screenContains("[完成] bash"), scenario.screen());
  },
);

test(
  "非 fullscreen 模式仍紧凑渲染但不折叠，并给出提示",
  { timeout: 120_000 },
  async () => {
    const scenario = await start({
      tuiMode: "regular",
      responses: threeToolCalls,
      files: { "note.txt": `${NOTE_CONTENT}\n` },
    });

    await scenario.runTurn("run the scripted task");

    assert.ok(!scenario.screenContains("Extension error"), scenario.screen());
    assert.ok(scenario.screenContains("[完成] bash · cat note.txt"), scenario.screen());
    assert.ok(scenario.screenContains("E2E-FINAL-ANSWER"), scenario.screen());

    // Folding is fullscreen-only, so the transcript stays intact.
    assert.ok(!scenario.screenContains("过程已折叠"), scenario.screen());
    assert.ok(scenario.screenContains("过程折叠仅在 fullscreen TUI 可用"), scenario.screen());
  },
);
