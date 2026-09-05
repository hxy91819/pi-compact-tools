import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  keyHint,
  SettingsManager,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { stringifyArguments, summarizeToolCall, textOutput, type ToolArguments } from "../src/summary.ts";
import { formatToolBatchSummary, ToolBatchState } from "../src/tool-batching.ts";
import { installCompactionHistory } from "./compaction-history.ts";
import { installCompactionTranscript } from "./compaction-transcript.ts";
import { installTurnFolding } from "./turn-folding.ts";

function collapsedBatch(
  batching: ToolBatchState,
  toolCallId: string,
  theme: Parameters<NonNullable<ToolDefinition<any, any, any>["renderCall"]>>[1],
  invalidate: () => void,
  outputPad: 0 | 1,
): Container | Text {
  if (!batching.isAnchor(toolCallId)) return new Container();

  const summary = batching.summaryFor(toolCallId);
  if (!summary) return new Container();

  batching.setAnchorInvalidator(toolCallId, invalidate);
  const display =
    theme.fg("dim", formatToolBatchSummary(summary, batching.thinkingRunsFor(toolCallId))) +
    ` ${theme.fg("muted", `(${keyHint("app.tools.expand", "详情")})`)}`;
  return new Text(display, outputPad, 0);
}

function compactTool(
  definition: ToolDefinition<any, any, any>,
  outputPad: 0 | 1,
  batching: ToolBatchState,
): ToolDefinition<any, any, any> {
  return {
    ...definition,
    renderShell: "self",
    renderCall(args, theme, context) {
      if (!context.expanded) {
        if (!context.isPartial) return new Container();
        return collapsedBatch(batching, context.toolCallId, theme, context.invalidate, outputPad);
      }

      return new Text(
        `${theme.fg("toolTitle", definition.name)}\n${theme.fg("toolOutput", stringifyArguments(args as ToolArguments))}`,
        outputPad,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial) return new Container();

      if (!options.expanded) {
        return collapsedBatch(batching, context.toolCallId, theme, context.invalidate, outputPad);
      }

      const summary = summarizeToolCall(definition.name, context.args as ToolArguments);
      const status = context.isError ? "失败" : "完成";
      let display = theme.fg(context.isError ? "error" : "success", `[${status}] ${summary}`);

      const output = textOutput(result.content);
      if (output) display += `\n${theme.fg("toolOutput", output)}`;

      return new Text(display, outputPad, 0);
    },
  };
}

export default function (pi: ExtensionAPI) {
  const batching = new ToolBatchState();

  installCompactionHistory(pi);
  installCompactionTranscript(pi);
  installTurnFolding(pi);

  pi.on("agent_start", () => {
    batching.beginAgentRun();
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") batching.beginAssistantMessage();
  });

  pi.on("message_update", (event) => {
    if (event.message.role === "assistant") batching.observeAssistantContent(event.message.content);
  });

  pi.on("tool_execution_start", (event) => {
    batching.observeToolExecutionStart(event.toolCallId, event.toolName);
  });

  pi.on("tool_execution_end", (event) => {
    batching.observeToolExecutionEnd(event.toolCallId, event.toolName, event.isError);
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    batching.hydrate(ctx.sessionManager.getBranch());
    const activeTools = new Set(pi.getActiveTools());
    const registeredTools = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
    const settings = SettingsManager.create(ctx.cwd, undefined, { projectTrusted: ctx.isProjectTrusted() });
    const definitions = [
      createBashToolDefinition(ctx.cwd, {
        commandPrefix: settings.getShellCommandPrefix(),
        shellPath: settings.getShellPath(),
      }),
      createPowerShellToolDefinition(ctx.cwd),
      createReadToolDefinition(ctx.cwd, { autoResizeImages: settings.getImageAutoResize() }),
      createWriteToolDefinition(ctx.cwd),
      createEditToolDefinition(ctx.cwd),
      createGrepToolDefinition(ctx.cwd),
      createFindToolDefinition(ctx.cwd),
      createLsToolDefinition(ctx.cwd),
    ];

    for (const definition of definitions) {
      const current = registeredTools.get(definition.name);
      if (activeTools.has(definition.name) && current?.sourceInfo.source === "builtin") {
        pi.registerTool(compactTool(definition, settings.getOutputPad(), batching));
      }
    }
  });
}
