export type TranscriptView<Entry> = {
  sessionManager: {
    getBranch(): Entry[];
  };
  chatContainer: {
    clear(): void;
  };
  renderSessionEntries(entries: Entry[]): void;
};

/**
 * Pi's compaction-aware context is for LLM requests; the TUI can safely render
 * the complete active branch from the append-only session instead.
 */
export function renderCompleteSessionTranscript<Entry>(view: TranscriptView<Entry>): void {
  view.chatContainer.clear();
  view.renderSessionEntries(view.sessionManager.getBranch());
}
