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
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { NOTE_CONTENT, Scenario } from "./harness/run.ts";

const oneAgentRun = [
  {
    text: "E2E-FIRST-INTERMEDIATE",
    toolCalls: [
      { id: "call_1", name: "bash", arguments: { command: "cat note.txt" } },
      { id: "call_2", name: "read", arguments: { path: "note.txt" } },
    ],
  },
  {
    text: "E2E-SECOND-INTERMEDIATE",
    toolCalls: [{ id: "call_3", name: "ls", arguments: { path: "." } }],
  },
  { text: "E2E-FINAL-ANSWER" },
];
const legacyTurnFoldingRuntime = fileURLToPath(
  new URL("./fixtures/legacy-turn-folding-runtime.ts", import.meta.url),
);

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
  "工具调用跨 assistant 消息汇总，turn 完成后折叠过程并保留最终回复",
  { timeout: 120_000 },
  async () => {
    const scenario = await start({
      tuiMode: "fullscreen",
      responses: oneAgentRun,
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
  "Ctrl+Shift+O 显示整轮汇总，Ctrl+O 显示逐调用明细",
  { timeout: 120_000 },
  async () => {
    const scenario = await start({
      tuiMode: "fullscreen",
      responses: oneAgentRun,
      files: { "note.txt": `${NOTE_CONTENT}\n` },
    });

    await scenario.runTurn("run the scripted task");
    assert.ok(!scenario.screenContains("[完成] bash"), scenario.screen());

    scenario.press("ctrlShiftO");
    await scenario.settle();

    // All tool calls in one agent run share one summary row, even across assistant messages.
    assert.ok(scenario.screenContains("[过程已展开：3 次 Tool Call · Ctrl+Shift+O 折叠]"), scenario.screen());
    assert.ok(
      scenario.screenContains(
        "bash 1 完成 / 0 运行中 · read 1 完成 / 0 运行中 · ls 1 完成 / 0 运行中 (ctrl+o 详情)",
      ),
      scenario.screen(),
    );
    assert.ok(!scenario.screenContains(NOTE_CONTENT), scenario.screen());

    scenario.press("ctrlO");
    await scenario.settle();

    // Pi's existing Ctrl+O action opens details for every visible tool call.
    assert.ok(scenario.screenContains("[完成] bash · cat note.txt"), scenario.screen());
    assert.ok(scenario.screenContains("[完成] read · note.txt"), scenario.screen());
    assert.ok(scenario.screenContains(NOTE_CONTENT), scenario.screen());
    assert.ok(!scenario.screenContains("bash 1 完成 / 0 运行中 · read 1 完成 / 0 运行中"), scenario.screen());

    scenario.press("ctrlO");
    await scenario.settle();
    assert.ok(
      scenario.screenContains(
        "bash 1 完成 / 0 运行中 · read 1 完成 / 0 运行中 · ls 1 完成 / 0 运行中 (ctrl+o 详情)",
      ),
      scenario.screen(),
    );

    scenario.press("ctrlShiftO");
    await scenario.settle();

    assert.ok(scenario.screenContains("[过程已折叠：3 次 Tool Call · Ctrl+Shift+O 展开]"), scenario.screen());
    assert.ok(!scenario.screenContains("bash 1 完成"), scenario.screen());
  },
);

test(
  "运行中压缩交替出现的 Thinking 和工具调用",
  { timeout: 120_000 },
  async () => {
    const scenario = await start({
      tuiMode: "fullscreen",
      responses: [
        {
          thinking: "E2E-FIRST-THINKING",
          toolCalls: [{ id: "call_1", name: "bash", arguments: { command: "sleep 0.1" } }],
        },
        {
          thinking: "E2E-SECOND-THINKING",
          toolCalls: [{ id: "call_2", name: "bash", arguments: { command: "sleep 0.1" } }],
        },
        {
          text: "E2E-LATEST-INTERMEDIATE",
          toolCalls: [{ id: "call_3", name: "bash", arguments: { command: "sleep 2" } }],
        },
        { text: "E2E-FINAL-ANSWER" },
      ],
    });

    await scenario.submitTurn("run alternating thinking and tools");
    const liveSummary = "Thinking 2 次 · bash 2 完成 / 1 运行中";
    await scenario.waitForScreenText(liveSummary);

    assert.ok(!scenario.screenContains("E2E-FIRST-THINKING"), scenario.screen());
    assert.ok(!scenario.screenContains("E2E-SECOND-THINKING"), scenario.screen());
    assert.equal(scenario.screen().match(new RegExp(liveSummary, "g"))?.length, 1, scenario.screen());
    assert.ok(
      scenario.screen().indexOf("E2E-LATEST-INTERMEDIATE") < scenario.screen().indexOf(liveSummary),
      scenario.screen(),
    );

    await scenario.waitForTurnEnd();
  },
);

test(
  "加载旧版全局 runtime 后仍可渲染工具过程",
  { timeout: 120_000 },
  async () => {
    const scenario = await start({
      tuiMode: "fullscreen",
      preloadExtensions: [legacyTurnFoldingRuntime],
      responses: [
        { toolCalls: [{ id: "call_1", name: "bash", arguments: { command: "true" } }] },
        { text: "E2E-RELOAD-FINAL" },
      ],
    });

    await scenario.submitTurn("exercise stale reload state");
    const outcome = await scenario.waitForScreenTextOrOutput(
      "E2E-RELOAD-FINAL",
      "shouldHideAssistantProcess is not a function",
    );

    assert.equal(outcome, "screen", scenario.screen());
  },
);

test(
  "非 fullscreen 模式仍紧凑渲染但不折叠，并给出提示",
  { timeout: 120_000 },
  async () => {
    const scenario = await start({
      tuiMode: "regular",
      responses: oneAgentRun,
      files: { "note.txt": `${NOTE_CONTENT}\n` },
    });

    await scenario.runTurn("run the scripted task");

    assert.ok(!scenario.screenContains("Extension error"), scenario.screen());
    assert.ok(
      scenario.screenContains(
        "bash 1 完成 / 0 运行中 · read 1 完成 / 0 运行中 · ls 1 完成 / 0 运行中 (ctrl+o 详情)",
      ),
      scenario.screen(),
    );
    assert.ok(scenario.screenContains("E2E-FINAL-ANSWER"), scenario.screen());

    // Folding is fullscreen-only, so the transcript stays intact.
    assert.ok(!scenario.screenContains("过程已折叠"), scenario.screen());
    assert.ok(scenario.screenContains("过程折叠仅在 fullscreen TUI 可用"), scenario.screen());
  },
);
