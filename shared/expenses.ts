import type { Expense } from "./types.ts";

// Who owes whom, from what each person paid and the share of each expense they had.

/** Each person's balance: positive when others owe them, negative when they owe. */
export function balances(expenses: Expense[], value: (e: Expense) => number | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, v: number) => out.set(id, (out.get(id) ?? 0) + v);
  for (const e of expenses) {
    const v = value(e);
    if (!v || !e.split.length) continue;
    add(e.paidBy, v);
    for (const id of e.split) add(id, -v / e.split.length);
  }
  return out;
}

/** The fewest payments that settle everyone up (largest debts paid to largest credits first). Amounts under 0.5 are left. */
export function settleUp(balance: Map<string, number>): { from: string; to: string; amount: number }[] {
  const owe = [...balance].filter(([, v]) => v < -0.005).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const owed = [...balance].filter(([, v]) => v > 0.005).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < owe.length && j < owed.length) {
    const pay = Math.min(owe[i].v, owed[j].v);
    if (pay >= 0.5) out.push({ from: owe[i].id, to: owed[j].id, amount: Math.round(pay * 100) / 100 });
    owe[i].v -= pay;
    owed[j].v -= pay;
    if (owe[i].v < 0.005) i++;
    if (owed[j].v < 0.005) j++;
  }
  return out;
}
