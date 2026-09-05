/** Simulates the global runtime object retained when Pi reloads an older extension version. */
class LegacyTurnFoldingState {
  private epoch = 0;
  private activeTurn = 0;
  private completedTurn = 0;
  private pendingToolCalls = 0;
  private expanded = false;

  reset(): void {
    this.epoch += 1;
    this.activeTurn = 0;
    this.completedTurn = 0;
    this.pendingToolCalls = 0;
    this.expanded = false;
  }

  startUserTurn(): void {
    this.activeTurn += 1;
    this.pendingToolCalls = 0;
  }

  ensureActiveTurn(): void {
    if (this.activeTurn <= this.completedTurn) this.startUserTurn();
  }

  settle(): void {
    this.completedTurn = this.activeTurn;
  }

  assignProcessTurn(): { epoch: number; turn: number } {
    return { epoch: this.epoch, turn: this.activeTurn };
  }

  recordToolCalls(count: number): void {
    this.pendingToolCalls += count;
  }

  consumeToolCalls(): number {
    const count = this.pendingToolCalls;
    this.pendingToolCalls = 0;
    return count;
  }

  toggle(): boolean {
    this.expanded = !this.expanded;
    return this.expanded;
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  shouldHide(processTurn: { epoch: number; turn: number } | undefined): boolean {
    if (this.expanded) return false;
    if (!processTurn || processTurn.epoch !== this.epoch) return true;
    return processTurn.turn <= this.completedTurn;
  }
}

const runtimeKey = Symbol.for("pi-compact-tools.turn-folding.runtime");
const root = globalThis as typeof globalThis & { [runtimeKey]?: unknown };
root[runtimeKey] = {
  state: new LegacyTurnFoldingState(),
  enabled: false,
  outputPad: 1,
  patched: false,
  patchVersion: 3,
};

export default function (): void {}
