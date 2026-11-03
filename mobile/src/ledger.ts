export const categories = ['Salary', 'Other income', 'Food', 'Transport', 'Housing', 'Tax', 'Utilities', 'Health', 'Shopping', 'Other'] as const;
export type Category = typeof categories[number];
export type Entry = { id: string; owner_id: string; amount: number; kind: 'income' | 'expense'; category: Category; date: string; note: string };
export type Household = { id: string; name: string; currency: 'MMK'; invite_code: string; members: { user_id: string; display_name: string }[] };
export function summarize(entries: Entry[]) {
  let income = 0, expense = 0;
  const byCategory: Record<string, number> = {};
  const byPerson: Record<string, { income: number; expense: number }> = {};
  for (const e of entries) {
    const cents = Math.round(Number(e.amount) * 100);
    const person = byPerson[e.owner_id] ??= { income: 0, expense: 0 };
    person[e.kind] += cents;
    if (e.kind === 'income') income += cents;
    else { expense += cents; byCategory[e.category] = (byCategory[e.category] ?? 0) + cents; }
  }
  return { income: income / 100, expense: expense / 100, balance: (income - expense) / 100,
    byCategory: Object.entries(byCategory).map(([category, cents]) => ({ category, amount: cents / 100 })).sort((a,b) => b.amount-a.amount),
    byPerson: Object.fromEntries(Object.entries(byPerson).map(([id, v]) => [id, { income: v.income / 100, expense: v.expense / 100 }])) };
}
export function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value && value >= '1900-01-01' && value <= '9998-12-31'; }
export function validAmount(value: string) { return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0 && Number(value) <= 999999999999; }
export function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export const money = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} MMK`;
