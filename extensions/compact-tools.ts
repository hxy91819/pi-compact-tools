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
import { installTurnFolding } from "./turn-folding.ts";

function compactTool(definition: ToolDefinition<any, any, any>, outputPad: 0 | 1): ToolDefinition<any, any, any> {
  return {
    ...definition,
    renderShell: "self",
    renderCall(args, theme, context) {
      const summary = summarizeToolCall(definition.name, args as ToolArguments);

      if (!context.expanded) {
        if (!context.isPartial) return new Container();
        return new Text(theme.fg("toolTitle", `[运行中] ${summary}`), outputPad, 0);
      }

      return new Text(
        `${theme.fg("toolTitle", definition.name)}\n${theme.fg("toolOutput", stringifyArguments(args as ToolArguments))}`,
        outputPad,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial) return new Container();

      const summary = summarizeToolCall(definition.name, context.args as ToolArguments);
      const status = context.isError ? "失败" : "完成";
      let display = theme.fg(context.isError ? "error" : "success", `[${status}] ${summary}`);

      if (!options.expanded) {
        display += ` ${theme.fg("muted", `(${keyHint("app.tools.expand", "展开详情")})`)}`;
      } else {
        const output = textOutput(result.content);
        if (output) display += `\n${theme.fg("toolOutput", output)}`;
      }

      return new Text(display, outputPad, 0);
    },
  };
}

export default function (pi: ExtensionAPI) {
  installTurnFolding(pi);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

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
        pi.registerTool(compactTool(definition, settings.getOutputPad()));
      }
    }
  });
}
