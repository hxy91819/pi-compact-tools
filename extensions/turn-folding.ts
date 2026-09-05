import {
  AssistantMessageComponent,
  SettingsManager,
  ToolExecutionComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  shouldHideAssistantProcess,
  TurnFoldingState,
  type ProcessTurn,
} from "../src/turn-folding.ts";

const PATCH_VERSION = 4;
const RUNTIME_KEY = Symbol.for("pi-compact-tools.turn-folding.runtime");
const PROCESS_TURN_KEY = Symbol.for("pi-compact-tools.turn-folding.process-turn");
const TOOL_CALL_COUNT_KEY = Symbol.for("pi-compact-tools.turn-folding.tool-call-count");
const FINAL_HINT_KEY = Symbol.for("pi-compact-tools.turn-folding.final-hint");
const HAS_ASSISTANT_TEXT_KEY = Symbol.for("pi-compact-tools.turn-folding.has-assistant-text");
const STATUS_KEY = "pi-compact-tools.turn-folding";

type FoldableComponent = Record<PropertyKey, unknown>;

type TranscriptRenderers = {
  assistantUpdateContent: (...args: unknown[]) => unknown;
  assistantRender: (width: number) => string[];
  toolRender: (width: number) => string[];
};

type TurnFoldingRuntime = {
  state: TurnFoldingState;
  enabled: boolean;
  outputPad: 0 | 1;
  patched: boolean;
  patchVersion?: number;
  originalRenderers?: TranscriptRenderers;
};

function runtime(): TurnFoldingRuntime {
  const root = globalThis as typeof globalThis & { [RUNTIME_KEY]?: TurnFoldingRuntime };
  root[RUNTIME_KEY] ??= {
    state: new TurnFoldingState(),
    enabled: false,
    outputPad: 1,
    patched: false,
  };
  return root[RUNTIME_KEY];
}

function processTurn(component: FoldableComponent, state: TurnFoldingState): ProcessTurn {
  const existing = component[PROCESS_TURN_KEY] as ProcessTurn | undefined;
  if (existing) return existing;

  const assigned = state.assignProcessTurn();
  component[PROCESS_TURN_KEY] = assigned;
  return assigned;
}

function toolCallCount(message: unknown): number {
  if (!message || typeof message !== "object") return 0;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return 0;
  return content.filter((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "toolCall").length;
}

function hasAssistantText(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string" &&
      (item as { text: string }).text.trim().length > 0,
  );
}

function processHint(toolCalls: number, expanded: boolean, outputPad: 0 | 1): string {
  const action = expanded ? "折叠" : "展开";
  const state = expanded ? "已展开" : "已折叠";
  return `${" ".repeat(outputPad)}\x1b[2m[过程${state}：${toolCalls} 次 Tool Call · Ctrl+Shift+O ${action}]\x1b[0m`;
}

/**
 * Pi exposes no public API for grouping transcript rows. Fullscreen mode owns the
 * viewport, so this display-only patch can retract completed process rows safely.
 */
function patchTranscriptRendering(current: TurnFoldingRuntime): void {
  if (current.patchVersion === PATCH_VERSION) return;

  const assistantPrototype = AssistantMessageComponent.prototype as unknown as {
    updateContent: (...args: unknown[]) => unknown;
    render: (width: number) => string[];
  };
  const toolPrototype = ToolExecutionComponent.prototype as unknown as {
    render: (width: number) => string[];
  };

  if (current.originalRenderers) {
    assistantPrototype.updateContent = current.originalRenderers.assistantUpdateContent;
    assistantPrototype.render = current.originalRenderers.assistantRender;
    toolPrototype.render = current.originalRenderers.toolRender;
  } else {
    current.originalRenderers = {
      assistantUpdateContent: assistantPrototype.updateContent,
      assistantRender: assistantPrototype.render,
      toolRender: toolPrototype.render,
    };
  }

  const originalAssistantUpdateContent = assistantPrototype.updateContent;
  const originalAssistantRender = assistantPrototype.render;

  assistantPrototype.updateContent = function (...args: unknown[]) {
    const result = originalAssistantUpdateContent.apply(this, args);
    const component = this as unknown as FoldableComponent;
    component[HAS_ASSISTANT_TEXT_KEY] = hasAssistantText(args[0]);
    const recordedToolCalls = (component[TOOL_CALL_COUNT_KEY] as number | undefined) ?? 0;
    const totalToolCalls = toolCallCount(args[0]);
    if (totalToolCalls > recordedToolCalls) {
      current.state.recordToolCalls(totalToolCalls - recordedToolCalls);
      component[TOOL_CALL_COUNT_KEY] = totalToolCalls;
    }

    if (component.hasToolCalls === true) {
      processTurn(component, current.state);
    } else if (args[1] !== true && current.enabled) {
      const toolCalls = current.state.consumeToolCalls();
      if (toolCalls > 0) component[FINAL_HINT_KEY] = toolCalls;
    }
    return result;
  };

  assistantPrototype.render = function (width: number): string[] {
    const component = this as unknown as FoldableComponent;
    if (current.enabled && component.hasToolCalls === true) {
      const hasText = component[HAS_ASSISTANT_TEXT_KEY] === true;
      if (shouldHideAssistantProcess(current.state, processTurn(component, current.state), hasText)) return [];
    }

    const rendered = originalAssistantRender.call(this, width);
    const toolCalls = component[FINAL_HINT_KEY] as number | undefined;
    if (!current.enabled || !toolCalls) return rendered;
    return ["", processHint(toolCalls, current.state.isExpanded(), current.outputPad), ...rendered];
  };

  const originalToolRender = toolPrototype.render;

  toolPrototype.render = function (width: number): string[] {
    const component = this as unknown as FoldableComponent;
    if (current.enabled && current.state.shouldHide(processTurn(component, current.state))) return [];
    return originalToolRender.call(this, width);
  };
  current.patched = true;
  current.patchVersion = PATCH_VERSION;
}

export function installTurnFolding(pi: ExtensionAPI): void {
  const current = runtime();
  patchTranscriptRendering(current);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const settings = SettingsManager.create(ctx.cwd, undefined, { projectTrusted: ctx.isProjectTrusted() });
    current.enabled = settings.getTuiMode() === "fullscreen";
    current.outputPad = settings.getOutputPad();
    current.state.reset();
    ctx.ui.setStatus(STATUS_KEY, current.enabled ? undefined : "过程折叠仅在 fullscreen TUI 可用");
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "user") current.state.startUserTurn();
  });

  pi.on("agent_start", () => {
    current.state.ensureActiveTurn();
  });

  pi.on("agent_end", (_event, ctx) => {
    if (!current.enabled) return;
    current.state.settle();
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.registerShortcut("ctrl+shift+o", {
    description: "展开或折叠已完成 turn 的过程",
    handler: (ctx) => {
      if (!current.enabled) {
        ctx.ui.notify("过程折叠仅在 fullscreen TUI 可用", "warning");
        return;
      }
      current.state.toggle();
      ctx.ui.setStatus(STATUS_KEY, undefined);
    },
  });
}
