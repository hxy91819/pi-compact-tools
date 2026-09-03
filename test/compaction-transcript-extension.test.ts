import assert from "node:assert/strict";
import test from "node:test";
import { InteractiveMode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installCompactionTranscript } from "../extensions/compaction-transcript.ts";

test("成功 compaction 后以完整 active branch 重建屏幕，但不改 context builder", async () => {
  const prototype = InteractiveMode.prototype as unknown as Record<string, unknown>;
  const originals = {
    renderInitialMessages: prototype.renderInitialMessages,
    rebuildChatFromMessages: prototype.rebuildChatFromMessages,
    handleEvent: prototype.handleEvent,
  };
  const runtimeKey = Symbol.for("pi-compact-tools.compaction-transcript.runtime");
  const root = globalThis as Record<PropertyKey, unknown>;
  delete root[runtimeKey];

  try {
    prototype.renderInitialMessages = function (this: FakeMode) {
      this.renderSessionEntries(this.sessionManager.buildContextEntries());
    };
    prototype.rebuildChatFromMessages = function (this: FakeMode) {
      this.chatContainer.clear();
      this.renderSessionEntries(this.sessionManager.buildContextEntries());
    };
    prototype.handleEvent = async function () {};

    installCompactionTranscript({} as ExtensionAPI);

    const compactedContext = ["compaction", "tail"];
    const fullBranch = ["history", "compaction", "tail"];
    const rendered: string[][] = [];
    let cleared = 0;
    let renders = 0;
    const mode: FakeMode = {
      sessionManager: {
        buildContextEntries: () => compactedContext,
        getBranch: () => fullBranch,
      },
      chatContainer: {
        clear: () => {
          cleared += 1;
        },
      },
      renderSessionEntries: (entries) => {
        renders += 1;
        rendered.push(entries);
      },
      ui: {
        requestRender: () => {},
      },
    };

    await (prototype.handleEvent as (this: FakeMode, event: unknown) => Promise<void>).call(mode, {
      type: "compaction_end",
      result: {},
    });

    assert.equal(cleared, 1);
    assert.equal(renders, 1);
    assert.deepEqual(rendered, [fullBranch]);
    assert.deepEqual(mode.sessionManager.buildContextEntries(), compactedContext);
  } finally {
    prototype.renderInitialMessages = originals.renderInitialMessages;
    prototype.rebuildChatFromMessages = originals.rebuildChatFromMessages;
    prototype.handleEvent = originals.handleEvent;
    delete root[runtimeKey];
  }
});

type FakeMode = {
  sessionManager: {
    buildContextEntries(): string[];
    getBranch(): string[];
  };
  chatContainer: {
    clear(): void;
  };
  renderSessionEntries(entries: string[]): void;
  ui: {
    requestRender(): void;
  };
};
