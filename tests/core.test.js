const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

function setup() {
  const st = C.defaultState();
  st.kids.push({ id: 'a', name: 'Ava', birthday: '2016-06-15', startDate: '2026-01-01' });
  return st;
}
function add(st, r) {
  assert.deepEqual(r.errors, [], 'unexpected errors: ' + r.errors.join(' '));
  st.txns.push(r.txn);
  return r.txn;
}

test('allocate splits cents exactly', () => {
  const p = C.allocate(1001, { spend: 25, save: 25, invest: 25, gift: 25 });
  assert.equal(p.spend + p.save + p.invest + p.gift, 1001);
});

test('gift is split by fixed percentages and matched once', () => {
  const st = setup();
  add(st, C.buildMoneyIn(st, { kidId: 'a', date: '2026-01-05', kind: 'gift', amount: 10000 }));
  const b = C.balances(st, 'a');
  assert.deepEqual([b.spend.kid, b.save.kid, b.invest.kid, b.gift.kid], [2500, 2500, 2500, 2500]);
  assert.deepEqual([b.spend.parent, b.save.parent, b.invest.parent, b.gift.parent], [0, 625, 2500, 1250]);
  assert.equal(b.all.kid, 10000);
  assert.equal(b.all.parent, 4375);
});

test('earned money uses the chosen split and warns on 100% spend', () => {
  const st = setup();
  const r = C.buildMoneyIn(st, { kidId: 'a', kind: 'earned', amount: 2000, split: { spend: 100, save: 0, invest: 0, gift: 0 } });
  assert.equal(r.txn.matchTotal, 0);
  assert.equal(r.warnings.length, 1);
  const r2 = C.buildMoneyIn(st, { kidId: 'a', kind: 'earned', amount: 2000, split: { spend: 50, save: 0, invest: 50, gift: 0 } });
  assert.equal(r2.txn.matchTotal, 1000);
  const bad = C.buildMoneyIn(st, { kidId: 'a', kind: 'earned', amount: 2000, split: { spend: 50, save: 0, invest: 0, gift: 0 } });
  assert.ok(bad.errors.length);
});

test('spending takes kid and parent money in proportion', () => {
  const st = setup();
  add(st, C.buildMoneyIn(st, { kidId: 'a', date: '2026-01-05', kind: 'gift', amount: 10000 }));
  add(st, C.buildOut(st, { kidId: 'a', date: '2026-01-06', bucket: 'gift', amount: 1875, note: 'Food bank' }));
  const b = C.balances(st, 'a');
  assert.equal(b.gift.kid, 1250);
  assert.equal(b.gift.parent, 625);
});

test('spend needs a note and cannot overdraw; invest needs a purpose', () => {
  const st = setup();
  add(st, C.buildMoneyIn(st, { kidId: 'a', date: '2026-01-05', kind: 'gift', amount: 10000 }));
  assert.ok(C.buildOut(st, { kidId: 'a', bucket: 'spend', amount: 100, note: '' }).errors.length);
  assert.ok(C.buildOut(st, { kidId: 'a', bucket: 'spend', amount: 999999, note: 'x' }).errors.length);
  assert.ok(C.buildOut(st, { kidId: 'a', bucket: 'save', amount: 100, note: 'x' }).errors.length);
  assert.ok(C.buildOut(st, { kidId: 'a', bucket: 'invest', amount: 100, note: 'x' }).errors.length);
  const ok = C.buildOut(st, { kidId: 'a', bucket: 'invest', amount: 100, note: 'Coding class', category: 'Course or class' });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.warnings, []);
});

test('save withdrawals: 30% cap, one per window, locked milestones', () => {
  const st = setup();
  st.settings.match.save = 0;
  st.settings.giftSplit = { spend: 0, save: 100, invest: 0, gift: 0 };
  add(st, C.buildMoneyIn(st, { kidId: 'a', date: '2026-01-05', kind: 'gift', amount: 20000 })); // $200 save, $100 locked
  let r = C.buildTransfer(st, { kidId: 'a', date: '2026-02-01', from: 'save', to: 'spend', amount: 6000 });
  assert.deepEqual(r.warnings, []); // 30% of 200 = 60, 200-60 >= 100
  r = C.buildTransfer(st, { kidId: 'a', date: '2026-02-01', from: 'save', to: 'spend', amount: 6001 });
  assert.equal(r.warnings.length, 1);
  add(st, C.buildTransfer(st, { kidId: 'a', date: '2026-02-01', from: 'save', to: 'spend', amount: 1000 }));
  r = C.buildTransfer(st, { kidId: 'a', date: '2026-03-01', from: 'save', to: 'spend', amount: 100 });
  assert.ok(r.warnings.some((w) => /already had/.test(w)));
  r = C.buildTransfer(st, { kidId: 'a', date: '2026-04-01', from: 'save', to: 'spend', amount: 100 });
  assert.deepEqual(r.warnings, []);
  // Floor: balance 190, locked 100 -> max by floor 90, by pct 57
  const s = C.saveStatus(st, 'a', '2026-04-01');
  assert.equal(s.lockedFloor, 10000);
  assert.equal(s.maxAllowed, 5700);
});

test('moving out of invest or gift is flagged', () => {
  const st = setup();
  add(st, C.buildMoneyIn(st, { kidId: 'a', date: '2026-01-05', kind: 'gift', amount: 10000 }));
  assert.equal(C.buildTransfer(st, { kidId: 'a', from: 'invest', to: 'spend', amount: 100 }).warnings.length, 1);
  assert.equal(C.buildTransfer(st, { kidId: 'a', from: 'gift', to: 'spend', amount: 100 }).warnings.length, 1);
  assert.equal(C.buildTransfer(st, { kidId: 'a', from: 'spend', to: 'save', amount: 100 }).warnings.length, 0);
});

test('transfers keep ownership and earn no match', () => {
  const st = setup();
  add(st, C.buildMoneyIn(st, { kidId: 'a', date: '2026-01-05', kind: 'gift', amount: 10000 }));
  const before = C.balances(st, 'a').all;
  add(st, C.buildTransfer(st, { kidId: 'a', date: '2026-01-06', from: 'spend', to: 'invest', amount: 2500 }));
  const after = C.balances(st, 'a').all;
  assert.deepEqual(before, after);
});

test('monthly interest posts once per finished month, paid by parent', () => {
  const st = setup();
  st.settings.giftSplit = { spend: 0, save: 100, invest: 0, gift: 0 };
  st.settings.match.save = 0;
  add(st, C.buildMoneyIn(st, { kidId: 'a', date: '2026-01-05', kind: 'gift', amount: 120000 }));
  const added = C.runAutoEntries(st, '2026-03-10');
  const interest = added.filter((t) => t.type === 'interest');
  assert.equal(interest.length, 2); // Jan and Feb
  assert.equal(interest[0].lines[0].amount, 400); // 1200 * 4% / 12
  assert.equal(interest[0].lines[0].owner, 'parent');
  assert.equal(C.runAutoEntries(st, '2026-03-10').length, 0); // idempotent
});

test('birthday bonus rewards saving and no take-outs', () => {
  const st = setup();
  st.settings.autoInterest = false;
  st.settings.giftSplit = { spend: 0, save: 100, invest: 0, gift: 0 };
  add(st, C.buildMoneyIn(st, { kidId: 'a', date: '2026-02-01', kind: 'gift', amount: 10000 }));
  let added = C.runAutoEntries(st, '2026-06-15');
  assert.equal(added.length, 1);
  assert.equal(added[0].lines[0].amount, 1500); // 10% + 5% of $100
  const st2 = setup();
  st2.settings.autoInterest = false;
  st2.settings.giftSplit = { spend: 0, save: 100, invest: 0, gift: 0 };
  add(st2, C.buildMoneyIn(st2, { kidId: 'a', date: '2026-02-01', kind: 'gift', amount: 10000 }));
  add(st2, C.buildTransfer(st2, { kidId: 'a', date: '2026-03-01', from: 'save', to: 'spend', amount: 2000 }));
  added = C.runAutoEntries(st2, '2026-06-15');
  assert.equal(added[0].lines[0].amount, 800); // 10% of (100 - 20)
});

test('invest value updates split gains by ownership', () => {
  const st = setup();
  add(st, C.buildMoneyIn(st, { kidId: 'a', date: '2026-01-05', kind: 'gift', amount: 10000 })); // invest 25 kid + 25 parent
  add(st, C.buildGrowth(st, { kidId: 'a', newValue: 6000 }));
  const b = C.balances(st, 'a').invest;
  assert.equal(b.total, 6000);
  assert.equal(b.kid, 3000);
});

test('backup round trip and CSV', () => {
  const st = setup();
  add(st, C.buildMoneyIn(st, { kidId: 'a', date: '2026-01-05', kind: 'gift', amount: 10000, note: 'From "Grandma", with love' }));
  const back = C.normalizeState(JSON.parse(JSON.stringify(st)));
  assert.equal(back.txns.length, 1);
  assert.throws(() => C.normalizeState({ hello: 1 }));
  const csv = C.toCSV(st);
  assert.match(csv, /"From ""Grandma"", with love"/);
});
