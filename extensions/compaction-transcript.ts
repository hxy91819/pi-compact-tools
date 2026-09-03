import { InteractiveMode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderCompleteSessionTranscript, type TranscriptView } from "../src/compaction-transcript.ts";

const PATCH_VERSION = 1;
const RUNTIME_KEY = Symbol.for("pi-compact-tools.compaction-transcript.runtime");

type TranscriptMode = TranscriptView<unknown> & {
  renderInitialMessages(): unknown;
  rebuildChatFromMessages(): unknown;
  handleEvent(event: unknown): Promise<unknown>;
  sessionManager: TranscriptView<unknown>["sessionManager"] & {
    buildContextEntries(): unknown[];
  };
  ui: {
    requestRender(): void;
  };
};

type OriginalRenderers = {
  renderInitialMessages: () => unknown;
  rebuildChatFromMessages: () => unknown;
  handleEvent: (event: unknown) => Promise<unknown>;
};

type CompactionTranscriptRuntime = {
  patchVersion?: number;
  originals?: OriginalRenderers;
};

function runtime(): CompactionTranscriptRuntime {
  const root = globalThis as typeof globalThis & { [RUNTIME_KEY]?: CompactionTranscriptRuntime };
  root[RUNTIME_KEY] ??= {};
  return root[RUNTIME_KEY];
}

function withFullBranch<Return>(component: TranscriptMode, render: () => Return): Return {
  const manager = component.sessionManager;
  const originalBuildContextEntries = manager.buildContextEntries;
  manager.buildContextEntries = () => manager.getBranch();
  try {
    return render();
  } finally {
    manager.buildContextEntries = originalBuildContextEntries;
  }
}

function isCompletedCompaction(event: unknown): boolean {
  return Boolean(
    event &&
      typeof event === "object" &&
      (event as { type?: unknown }).type === "compaction_end" &&
      (event as { result?: unknown }).result,
  );
}

/**
 * Pi intentionally rebuilds its transcript from compacted context entries. This
 * display adapter instead renders the full active branch after that rebuild;
 * the model's compaction path is never changed.
 */
function patchTranscriptRendering(current: CompactionTranscriptRuntime): void {
  if (current.patchVersion === PATCH_VERSION) return;

  const prototype = InteractiveMode.prototype as unknown as {
    renderInitialMessages: () => unknown;
    rebuildChatFromMessages: () => unknown;
    handleEvent: (event: unknown) => Promise<unknown>;
  };

  if (current.originals) {
    prototype.renderInitialMessages = current.originals.renderInitialMessages;
    prototype.rebuildChatFromMessages = current.originals.rebuildChatFromMessages;
    prototype.handleEvent = current.originals.handleEvent;
  } else {
    current.originals = {
      renderInitialMessages: prototype.renderInitialMessages,
      rebuildChatFromMessages: prototype.rebuildChatFromMessages,
      handleEvent: prototype.handleEvent,
    };
  }

  const originalRenderInitialMessages = prototype.renderInitialMessages;
  prototype.renderInitialMessages = function () {
    const component = this as unknown as TranscriptMode;
    return withFullBranch(component, () => originalRenderInitialMessages.call(component));
  };

  const originalRebuildChatFromMessages = prototype.rebuildChatFromMessages;
  prototype.rebuildChatFromMessages = function () {
    const component = this as unknown as TranscriptMode;
    return withFullBranch(component, () => originalRebuildChatFromMessages.call(component));
  };

  const originalHandleEvent = prototype.handleEvent;
  prototype.handleEvent = async function (event: unknown) {
    const component = this as unknown as TranscriptMode;
    const result = await originalHandleEvent.call(component, event);
    if (isCompletedCompaction(event)) {
      renderCompleteSessionTranscript(component);
      component.ui.requestRender();
    }
    return result;
  };

  current.patchVersion = PATCH_VERSION;
}

export function installCompactionTranscript(pi: ExtensionAPI): void {
  patchTranscriptRendering(runtime());
}
