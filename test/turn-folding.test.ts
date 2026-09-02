import assert from "node:assert/strict";
import test from "node:test";
import { TurnFoldingState } from "../src/turn-folding.ts";

test("历史过程默认折叠", () => {
  const state = new TurnFoldingState();
  state.reset();

  assert.equal(state.shouldHide(state.assignProcessTurn()), true);
});

test("当前 turn 在 agent 运行期间保持可见，完成后自动折叠", () => {
  const state = new TurnFoldingState();
  state.reset();
  state.startUserTurn();
  const currentTurn = state.assignProcessTurn();

  assert.equal(state.shouldHide(currentTurn), false);

  state.settle();

  assert.equal(state.shouldHide(currentTurn), true);
});

test("在最终回复前累计并消费 Tool Call 数量", () => {
  const state = new TurnFoldingState();
  state.reset();
  state.startUserTurn();

  state.recordToolCalls(2);
  state.recordToolCalls(1);

  assert.equal(state.consumeToolCalls(), 3);
  assert.equal(state.consumeToolCalls(), 0);
});

test("新用户问题不会继承前一轮的 Tool Call 数量", () => {
  const state = new TurnFoldingState();
  state.reset();
  state.startUserTurn();
  state.recordToolCalls(2);
  state.startUserTurn();

  assert.equal(state.consumeToolCalls(), 0);
});

test("快捷键切换可展开和重新折叠已完成过程", () => {
  const state = new TurnFoldingState();
  state.reset();
  state.startUserTurn();
  const completedTurn = state.assignProcessTurn();
  state.settle();

  assert.equal(state.shouldHide(completedTurn), true);
  assert.equal(state.toggle(), true);
  assert.equal(state.shouldHide(completedTurn), false);
  assert.equal(state.toggle(), false);
  assert.equal(state.shouldHide(completedTurn), true);
});

test("新 turn 不会因前一 turn 已完成而提前折叠", () => {
  const state = new TurnFoldingState();
  state.reset();
  state.startUserTurn();
  const firstTurn = state.assignProcessTurn();
  state.settle();
  state.startUserTurn();
  const secondTurn = state.assignProcessTurn();

  assert.equal(state.shouldHide(firstTurn), true);
  assert.equal(state.shouldHide(secondTurn), false);
});
