export interface ProcessTurn {
  epoch: number;
  turn: number;
}

export class TurnFoldingState {
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
    if (this.activeTurn <= this.completedTurn) {
      this.activeTurn += 1;
      this.pendingToolCalls = 0;
    }
  }

  settle(): void {
    this.completedTurn = this.activeTurn;
  }

  assignProcessTurn(): ProcessTurn {
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

  shouldHide(processTurn: ProcessTurn | undefined): boolean {
    if (this.expanded) return false;
    if (!processTurn || processTurn.epoch !== this.epoch) return true;
    return processTurn.turn <= this.completedTurn;
  }
}
