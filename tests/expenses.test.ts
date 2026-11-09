import assert from "node:assert/strict";
import { test } from "node:test";
import type { Expense } from "../shared/types.ts";
import { balances, settleUp } from "../shared/expenses.ts";

const e = (paidBy: string, amount: number, split: string[]): Expense => ({
  id: `${paidBy}${amount}`, title: "Made-up dinner", amount: { amount, currency: "USD" }, day: "2027-05-10", category: "food", paidBy, split, addedBy: paidBy, createdAt: "",
});
const usd = (x: Expense) => x.amount.amount;

test("an equal split: the others each owe the payer their share", () => {
  const b = balances([e("a", 90, ["a", "b", "c"])], usd);
  assert.deepEqual(Object.fromEntries(b), { a: 60, b: -30, c: -30 });
  assert.deepEqual(settleUp(b), [{ from: "b", to: "a", amount: 30 }, { from: "c", to: "a", amount: 30 }]);
});

test("payments in both directions net out to the fewest transfers", () => {
  const b = balances([e("a", 100, ["a", "b"]), e("b", 60, ["a", "b"]), e("b", 20, ["b"])], usd);
  assert.deepEqual(settleUp(b), [{ from: "b", to: "a", amount: 20 }]);
});

test("paying for someone else alone, and tiny remainders left out", () => {
  assert.deepEqual(settleUp(balances([e("a", 40, ["b"])], usd)), [{ from: "b", to: "a", amount: 40 }]);
  assert.deepEqual(settleUp(balances([e("a", 1, ["a", "b", "c"])], usd)), []);
});

test("an expense without a rate counts for nothing", () => {
  assert.deepEqual(settleUp(balances([e("a", 90, ["a", "b"])], () => undefined)), []);
});

test("split bookings and trip spending settle together", () => {
  // Made-up: a 300 ride you paid, shared with Ana; a 600 stay Ana paid, shared by you, Ana and Leo.
  const b = balances([e("you", 300, ["you", "ana"]), e("ana", 600, ["you", "ana", "leo"])], usd);
  assert.deepEqual(settleUp(b), [{ from: "leo", to: "ana", amount: 200 }, { from: "you", to: "ana", amount: 50 }]);
});
