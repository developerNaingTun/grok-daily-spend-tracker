import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, validAmount, validDate, Entry } from './ledger';
const entry = (changes: Partial<Entry>): Entry => ({id:'x',owner_id:'wife',amount:0.1,kind:'expense',category:'Utilities',date:'2026-11-01',note:'',...changes});
test('shared totals include both people, retain negative balance, and avoid decimal drift', () => {
 const totals=summarize([entry({}),entry({amount:0.2}),entry({owner_id:'husband',amount:0.1,kind:'income'}),entry({owner_id:'husband',amount:5,category:'Tax'})]);
 assert.equal(totals.income,0.1);assert.equal(totals.expense,5.3);assert.equal(totals.balance,-5.2);
 assert.deepEqual(totals.byPerson.wife,{income:0,expense:0.3});
 assert.deepEqual(totals.byCategory,[{category:'Tax',amount:5},{category:'Utilities',amount:0.3}]);
});
test('empty month is valid with zero totals', () => {assert.deepEqual(summarize([]),{income:0,expense:0,balance:0,byPerson:{},byCategory:[]});});
test('validate real dates including leap years', () => {
 assert.ok(validDate('2024-02-29'));assert.ok(!validDate('2026-02-29'));assert.ok(!validDate('2026-13-01'));assert.ok(!validDate('2026-2-01'));assert.ok(!validDate('0001-01-01'));
});
test('reject negative, zero, fractional overprecision and non-finite amounts', () => {
 for(const value of ['0','-1','1.001','NaN','Infinity','1e6','1000000000000','']) assert.ok(!validAmount(value),value);
 for(const value of ['1000','0.01','12.50']) assert.ok(validAmount(value),value);
});
