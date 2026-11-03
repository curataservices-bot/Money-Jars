/*
 * Money Jars core logic. Pure functions, no DOM.
 * All money is stored as integer cents. Dates are 'YYYY-MM-DD' strings.
 * Works in the browser (window.Core) and in Node (require('./core.js')).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BUCKETS = ['spend', 'save', 'invest', 'gift'];
  const BUCKET_INFO = {
    spend: { label: 'Spend', emoji: '🛍️', blurb: 'Ready to use on things you want' },
    save: { label: 'Save', emoji: '🐷', blurb: 'For big goals later' },
    invest: { label: 'Invest', emoji: '🌱', blurb: 'Grows you and your ideas' },
    gift: { label: 'Gift', emoji: '🎁', blurb: 'For presents and good causes' },
  };
  const TYPE_INFO = {
    'gift-in': { label: 'Gift received', emoji: '🎉' },
    'earned-in': { label: 'Money earned', emoji: '💪' },
    spend: { label: 'Spent', emoji: '🛍️' },
    give: { label: 'Gave', emoji: '🎁' },
    'invest-use': { label: 'Invested in me', emoji: '🌱' },
    transfer: { label: 'Moved money', emoji: '🔁' },
    interest: { label: 'Save interest', emoji: '🏦' },
    bonus: { label: 'Birthday saver bonus', emoji: '🎂' },
    growth: { label: 'Invest value change', emoji: '📈' },
    adjust: { label: 'Correction', emoji: '✏️' },
  };
  const OUT_TYPE = { spend: 'spend', gift: 'give', invest: 'invest-use' };
  const AUTO_TYPES = ['interest', 'bonus'];

  function defaultSettings() {
    return {
      parentName: 'Mom & Dad',
      giftSplit: { spend: 25, save: 25, invest: 25, gift: 25 },
      match: { spend: 0, save: 25, invest: 100, gift: 50 },
      matchEarned: true,
      saveAPR: 4,
      saveMaxWithdrawPct: 30,
      saveWindow: 'quarter',
      saveWithdrawalsPerWindow: 1,
      saveMilestones: [100, 250, 500, 1000, 2500, 5000, 10000],
      birthdayBonusPct: 10,
      birthdayNoWithdrawBonusPct: 5,
      investPurposes: [
        'Education or tutoring',
        'Books',
        'Course or class',
        'Business idea',
        'Lemonade stand or small business',
        'Prototype, tools or supplies',
        'Other investment in myself',
      ],
      autoInterest: true,
      autoBirthday: true,
      pin: '',
    };
  }

  function defaultState() {
    return { app: 'money-jars', version: 1, kids: [], txns: [], settings: defaultSettings() };
  }

  // ---------- small helpers ----------
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return dateStr(new Date()); }
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function endOfMonth(y, m) { return y + '-' + pad(m) + '-' + pad(daysInMonth(y, m)); }
  function safeDate(y, m, d) { return y + '-' + pad(m) + '-' + pad(Math.min(d, daysInMonth(y, m))); }
  function daysBetween(a, b) {
    const pa = parseDate(a), pb = parseDate(b);
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
  }

  function toCents(input) {
    if (typeof input === 'number') return Math.round(input * 100);
    const s = String(input || '').replace(/[$,\s]/g, '');
    if (!/^-?\d*(\.\d*)?$/.test(s) || s === '' || s === '.' || s === '-') return NaN;
    return Math.round(parseFloat(s) * 100);
  }
  function fmt(cents, opts) {
    const neg = cents < 0;
    const abs = Math.abs(Math.round(cents));
    const dollars = Math.floor(abs / 100).toLocaleString('en-US');
    const c = pad(abs % 100);
    const short = opts && opts.short && abs % 100 === 0;
    return (neg ? '-' : '') + '$' + dollars + (short ? '' : '.' + c);
  }

  // Split `total` cents by percentage weights so the parts add up exactly.
  function allocate(total, weights) {
    const out = {};
    let used = 0;
    const rema = [];
    BUCKETS.forEach((b) => {
      const exact = (total * (Number(weights[b]) || 0)) / 100;
      out[b] = Math.floor(exact);
      used += out[b];
      rema.push([b, exact - out[b]]);
    });
    rema.sort((a, b) => b[1] - a[1]);
    let left = total - used;
    for (let i = 0; left > 0 && i < rema.length; i++, left--) out[rema[i][0]] += 1;
    return out;
  }

  function splitTotal(split) {
    return BUCKETS.reduce((s, b) => s + (Number(split[b]) || 0), 0);
  }

  // Split an amount between kid and parent money in proportion to what is in the bucket.
  function proRata(amount, bal) {
    const total = bal.kid + bal.parent;
    if (total <= 0) return { kid: amount, parent: 0 };
    let parent = Math.round((amount * bal.parent) / total);
    if (amount > 0 && parent > bal.parent) parent = bal.parent;
    return { kid: amount - parent, parent };
  }

  function sortedTxns(state) {
    return state.txns.slice().sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0));
  }

  // ---------- balances ----------
  function emptyBalances() {
    const out = {};
    BUCKETS.forEach((b) => (out[b] = { kid: 0, parent: 0, total: 0 }));
    out.all = { kid: 0, parent: 0, total: 0 };
    return out;
  }

  function balances(state, kidId, asOf) {
    const out = emptyBalances();
    state.txns.forEach((t) => {
      if (t.kidId !== kidId) return;
      if (asOf && t.date > asOf) return;
      t.lines.forEach((l) => {
        out[l.bucket][l.owner] += l.amount;
        out[l.bucket].total += l.amount;
        out.all[l.owner] += l.amount;
        out.all.total += l.amount;
      });
    });
    return out;
  }

  // ---------- Save rules ----------
  function windowKey(date, win) {
    const { y, m } = parseDate(date);
    if (win === 'month') return y + '-' + pad(m);
    if (win === 'half') return y + '-H' + (m <= 6 ? 1 : 2);
    if (win === 'year') return String(y);
    return y + '-Q' + Math.ceil(m / 3);
  }
  function windowLabel(win) {
    return { month: 'this month', quarter: 'this quarter', half: 'this half-year', year: 'this year' }[win] || 'this quarter';
  }
  function nextWindowStart(date, win) {
    const { y, m } = parseDate(date);
    const size = { month: 1, quarter: 3, half: 6, year: 12 }[win] || 3;
    const startM = Math.floor((m - 1) / size) * size + 1;
    let nm = startM + size, ny = y;
    if (nm > 12) { nm -= 12; ny += 1; }
    return ny + '-' + pad(nm) + '-01';
  }

  function isSaveWithdrawal(t) {
    return t.type === 'transfer' && t.from === 'save';
  }

  function saveStatus(state, kidId, date, excludeTxnId) {
    const s = state.settings;
    date = date || todayStr();
    let running = 0, maxEver = 0;
    sortedTxns(state).forEach((t) => {
      if (t.kidId !== kidId || t.id === excludeTxnId) return;
      t.lines.forEach((l) => { if (l.bucket === 'save') running += l.amount; });
      if (running > maxEver) maxEver = running;
    });
    const bal = balances(state, kidId).save.total;
    const milestones = (s.saveMilestones || []).map((m) => Math.round(m * 100)).sort((a, b) => a - b);
    const reached = milestones.filter((m) => m <= maxEver);
    const lockedFloor = reached.length ? reached[reached.length - 1] : 0;
    const nextMilestone = milestones.find((m) => m > bal) || null;
    const key = windowKey(date, s.saveWindow);
    const used = state.txns.filter((t) => t.kidId === kidId && t.id !== excludeTxnId &&
      isSaveWithdrawal(t) && windowKey(t.date, s.saveWindow) === key).length;
    const limit = Number(s.saveWithdrawalsPerWindow) || 1;
    const byPct = Math.floor((bal * (Number(s.saveMaxWithdrawPct) || 0)) / 100);
    const byFloor = Math.max(0, bal - lockedFloor);
    const maxAllowed = used >= limit ? 0 : Math.max(0, Math.min(byPct, byFloor));
    return {
      balance: bal, maxEver, lockedFloor, reached, nextMilestone,
      windowUsed: used, windowLimit: limit, windowLabel: windowLabel(s.saveWindow),
      nextWindowStart: nextWindowStart(date, s.saveWindow), byPct, byFloor, maxAllowed,
    };
  }

  function checkSaveWithdrawal(state, kidId, amount, date, excludeTxnId) {
    const st = saveStatus(state, kidId, date, excludeTxnId);
    const s = state.settings;
    const warnings = [];
    if (st.windowUsed >= st.windowLimit) {
      warnings.push('Save already had ' + st.windowUsed + ' take-out ' + st.windowLabel +
        '. The next window opens ' + st.nextWindowStart + '.');
    }
    if (amount > st.byPct) {
      warnings.push('Only ' + s.saveMaxWithdrawPct + '% of Save (' + fmt(st.byPct) + ') can come out at once.');
    }
    if (st.balance - amount < st.lockedFloor) {
      warnings.push(fmt(st.lockedFloor) + ' is locked because that milestone was reached. Only ' +
        fmt(st.byFloor) + ' is above the lock.');
    }
    return { status: st, warnings };
  }

  // ---------- transaction builders ----------
  // Each returns { txn, errors: [], warnings: [] }. Errors block. Warnings need a parent override.
  function baseTxn(p, type) {
    return {
      id: newId(), kidId: p.kidId, date: p.date || todayStr(), type,
      note: (p.note || '').trim(), category: p.category || '', lines: [], createdAt: Date.now(),
    };
  }

  function buildMoneyIn(state, p) {
    const s = state.settings;
    const errors = [], warnings = [];
    const kind = p.kind === 'earned' ? 'earned' : 'gift';
    const amount = p.amount;
    if (!(amount > 0)) errors.push('Enter an amount greater than zero.');
    const split = kind === 'gift' ? s.giftSplit : p.split;
    if (!split || splitTotal(split) !== 100) errors.push('The split must add up to 100%.');
    const txn = baseTxn(p, kind + '-in');
    txn.split = Object.assign({}, split);
    if (errors.length) return { txn, errors, warnings };
    const parts = allocate(amount, split);
    const doMatch = kind === 'gift' || s.matchEarned;
    let matchTotal = 0;
    BUCKETS.forEach((b) => {
      if (parts[b] > 0) {
        txn.lines.push({ bucket: b, owner: 'kid', amount: parts[b] });
        const m = doMatch ? Math.round((parts[b] * (Number(s.match[b]) || 0)) / 100) : 0;
        if (m > 0) { txn.lines.push({ bucket: b, owner: 'parent', amount: m }); matchTotal += m; }
      }
    });
    txn.matchTotal = matchTotal;
    if (kind === 'earned' && parts.spend === amount) {
      warnings.push('All of it is going to Spend, so there is no bonus. Putting some in Save, Invest or Gift earns a match.');
    }
    return { txn, errors, warnings, parts };
  }

  function buildOut(state, p) {
    const s = state.settings;
    const errors = [], warnings = [];
    const bucket = p.bucket;
    const txn = baseTxn(p, OUT_TYPE[bucket] || 'spend');
    if (!OUT_TYPE[bucket]) errors.push('Money can only be spent from Spend, Gift or Invest. Move Save money to Spend first.');
    if (!(p.amount > 0)) errors.push('Enter an amount greater than zero.');
    if (!txn.note) errors.push('Add a note about what it was for.');
    if (errors.length) return { txn, errors, warnings };
    const bal = balances(state, p.kidId)[bucket];
    if (p.amount > bal.total) errors.push('Only ' + fmt(bal.total) + ' is in ' + BUCKET_INFO[bucket].label + '.');
    if (bucket === 'invest') {
      if (!txn.category) errors.push('Pick what kind of investment this is.');
      else if ((s.investPurposes || []).indexOf(txn.category) === -1) {
        warnings.push('"' + txn.category + '" is not on the approved Invest list.');
      }
    }
    if (errors.length) return { txn, errors, warnings };
    const pr = proRata(p.amount, bal);
    if (pr.kid) txn.lines.push({ bucket, owner: 'kid', amount: -pr.kid });
    if (pr.parent) txn.lines.push({ bucket, owner: 'parent', amount: -pr.parent });
    return { txn, errors, warnings };
  }

  function buildTransfer(state, p) {
    const errors = [], warnings = [];
    const txn = baseTxn(p, 'transfer');
    txn.from = p.from; txn.to = p.to;
    if (BUCKETS.indexOf(p.from) === -1 || BUCKETS.indexOf(p.to) === -1) errors.push('Pick both jars.');
    if (p.from === p.to) errors.push('Pick two different jars.');
    if (!(p.amount > 0)) errors.push('Enter an amount greater than zero.');
    if (errors.length) return { txn, errors, warnings };
    const bal = balances(state, p.kidId)[p.from];
    if (p.amount > bal.total) errors.push('Only ' + fmt(bal.total) + ' is in ' + BUCKET_INFO[p.from].label + '.');
    if (errors.length) return { txn, errors, warnings };
    if (p.from === 'save') warnings.push.apply(warnings, checkSaveWithdrawal(state, p.kidId, p.amount, txn.date).warnings);
    if (p.from === 'invest') warnings.push('Invest money is only for investing in yourself. Use "Spend" with an Invest reason instead.');
    if (p.from === 'gift') warnings.push('Gift money is meant for other people.');
    const pr = proRata(p.amount, bal);
    if (pr.kid) {
      txn.lines.push({ bucket: p.from, owner: 'kid', amount: -pr.kid });
      txn.lines.push({ bucket: p.to, owner: 'kid', amount: pr.kid });
    }
    if (pr.parent) {
      txn.lines.push({ bucket: p.from, owner: 'parent', amount: -pr.parent });
      txn.lines.push({ bucket: p.to, owner: 'parent', amount: pr.parent });
    }
    return { txn, errors, warnings };
  }

  function buildGrowth(state, p) {
    const errors = [], warnings = [];
    const txn = baseTxn(p, 'growth');
    if (!(p.newValue >= 0)) errors.push('Enter the current value of the investments.');
    if (errors.length) return { txn, errors, warnings };
    const bal = balances(state, p.kidId).invest;
    const delta = p.newValue - bal.total;
    if (delta === 0) errors.push('The value did not change.');
    if (errors.length) return { txn, errors, warnings };
    const pr = proRata(delta, bal);
    if (pr.kid) txn.lines.push({ bucket: 'invest', owner: 'kid', amount: pr.kid });
    if (pr.parent) txn.lines.push({ bucket: 'invest', owner: 'parent', amount: pr.parent });
    txn.note = txn.note || ('Invest value updated to ' + fmt(p.newValue));
    return { txn, errors, warnings };
  }

  function buildAdjust(state, p) {
    const errors = [], warnings = [];
    const txn = baseTxn(p, 'adjust');
    if (BUCKETS.indexOf(p.bucket) === -1) errors.push('Pick a jar.');
    if (p.owner !== 'kid' && p.owner !== 'parent') errors.push('Pick whose money it is.');
    if (!p.amount || isNaN(p.amount)) errors.push('Enter an amount greater than zero.');
    if (!txn.note) errors.push('Add a note explaining the correction.');
    if (errors.length) return { txn, errors, warnings };
    const bal = balances(state, p.kidId)[p.bucket][p.owner];
    if (bal + p.amount < 0) warnings.push('This would make the balance negative.');
    txn.lines.push({ bucket: p.bucket, owner: p.owner, amount: p.amount });
    return { txn, errors, warnings };
  }

  // ---------- automatic entries: Save interest and birthday bonus ----------
  function kidStart(state, kid) {
    let start = kid.startDate || todayStr();
    state.txns.forEach((t) => { if (t.kidId === kid.id && !t.auto && t.date < start) start = t.date; });
    return start;
  }

  function birthdayOn(kid, year) {
    if (!kid.birthday) return null;
    const b = parseDate(kid.birthday);
    return safeDate(year, b.m, b.d);
  }

  function bonusFor(state, kidId, periodStart, periodEnd) {
    // periodStart exclusive, periodEnd inclusive
    const s = state.settings;
    let savedIn = 0, withdrawn = 0;
    state.txns.forEach((t) => {
      if (t.kidId !== kidId || t.date <= periodStart || t.date > periodEnd || t.auto) return;
      t.lines.forEach((l) => {
        if (l.bucket !== 'save') return;
        if (l.amount > 0 && l.owner === 'kid' && t.type !== 'growth') savedIn += l.amount;
        if (l.amount < 0 && t.type === 'transfer') withdrawn += -l.amount;
      });
    });
    const net = savedIn - withdrawn;
    let bonus = 0;
    if (net > 0) {
      bonus = Math.round((net * (Number(s.birthdayBonusPct) || 0)) / 100);
      if (withdrawn === 0) bonus += Math.round((net * (Number(s.birthdayNoWithdrawBonusPct) || 0)) / 100);
    }
    return { savedIn, withdrawn, net, bonus };
  }

  function birthdayPreview(state, kidId, today) {
    const kid = state.kids.find((k) => k.id === kidId);
    if (!kid || !kid.birthday) return null;
    today = today || todayStr();
    const y = parseDate(today).y;
    let next = birthdayOn(kid, y);
    if (next <= today) next = birthdayOn(kid, y + 1);
    const prevYear = parseDate(next).y - 1;
    const last = birthdayOn(kid, prevYear);
    const r = bonusFor(state, kidId, last, today);
    r.nextBirthday = next;
    r.daysUntil = daysBetween(today, next);
    r.turning = parseDate(next).y - parseDate(kid.birthday).y;
    return r;
  }

  // Adds any missing monthly interest and birthday bonus entries. Returns the new entries.
  function runAutoEntries(state, today) {
    today = today || todayStr();
    const s = state.settings;
    const added = [];
    state.kids.forEach((kid) => {
      const start = kidStart(state, kid);
      const has = (type, period) => state.txns.some((t) => t.kidId === kid.id && t.type === type && t.period === period);
      // Monthly interest on Save, paid by the parent, for each finished month.
      if (s.autoInterest && Number(s.saveAPR) > 0) {
        let { y, m } = parseDate(start);
        const now = parseDate(today);
        while (y < now.y || (y === now.y && m < now.m)) {
          const period = y + '-' + pad(m);
          if (!has('interest', period)) {
            const end = endOfMonth(y, m);
            const bal = balances(state, kid.id, end).save.total;
            const amt = Math.round((bal * Number(s.saveAPR)) / 100 / 12);
            if (amt > 0) {
              const t = {
                id: newId(), kidId: kid.id, date: end, type: 'interest', period, auto: true,
                note: s.saveAPR + '% yearly interest on ' + fmt(bal) + ' in Save',
                lines: [{ bucket: 'save', owner: 'parent', amount: amt }], createdAt: Date.now(),
              };
              state.txns.push(t); added.push(t);
            }
          }
          m += 1; if (m > 12) { m = 1; y += 1; }
        }
      }
      // Birthday saver bonus for each birthday since the kid started.
      if (s.autoBirthday && kid.birthday) {
        for (let y = parseDate(start).y; y <= parseDate(today).y; y++) {
          const bday = birthdayOn(kid, y);
          if (bday <= start || bday > today) continue;
          const period = String(y);
          if (has('bonus', period)) continue;
          const r = bonusFor(state, kid.id, birthdayOn(kid, y - 1), bday);
          if (r.bonus > 0) {
            const t = {
              id: newId(), kidId: kid.id, date: bday, type: 'bonus', period, auto: true,
              note: 'Saved ' + fmt(r.savedIn) + ', took out ' + fmt(r.withdrawn) + ' this year' +
                (r.withdrawn === 0 ? ' (no take-outs, extra bonus!)' : ''),
              lines: [{ bucket: 'save', owner: 'parent', amount: r.bonus }], createdAt: Date.now(),
            };
            state.txns.push(t); added.push(t);
          }
        }
      }
    });
    return added;
  }

  function clearAutoEntries(state) {
    const before = state.txns.length;
    state.txns = state.txns.filter((t) => !t.auto);
    return before - state.txns.length;
  }

  // ---------- import / export ----------
  function normalizeState(obj) {
    if (!obj || typeof obj !== 'object' || obj.app !== 'money-jars' || !Array.isArray(obj.kids) || !Array.isArray(obj.txns)) {
      throw new Error('This file is not a Money Jars backup.');
    }
    const st = defaultState();
    st.kids = obj.kids;
    st.txns = obj.txns;
    st.settings = Object.assign(defaultSettings(), obj.settings || {});
    st.savedAt = obj.savedAt;
    return st;
  }

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(state) {
    const kidName = {};
    state.kids.forEach((k) => (kidName[k.id] = k.name));
    const rows = [['Date', 'Kid', 'Type', 'Jar', 'Whose money', 'Amount', 'Note', 'Category', 'Entry ID']];
    sortedTxns(state).forEach((t) => {
      t.lines.forEach((l) => {
        rows.push([t.date, kidName[t.kidId] || '', (TYPE_INFO[t.type] || {}).label || t.type,
          BUCKET_INFO[l.bucket].label, l.owner === 'kid' ? 'Kid' : 'Parent', (l.amount / 100).toFixed(2),
          t.note, t.category, t.id]);
      });
    });
    return rows.map((r) => r.map(csvCell).join(',')).join('\n');
  }

  return {
    BUCKETS, BUCKET_INFO, TYPE_INFO, AUTO_TYPES,
    defaultState, defaultSettings, newId, todayStr, dateStr, daysBetween,
    toCents, fmt, allocate, splitTotal, proRata, balances, sortedTxns,
    windowKey, saveStatus, checkSaveWithdrawal,
    buildMoneyIn, buildOut, buildTransfer, buildGrowth, buildAdjust,
    runAutoEntries, clearAutoEntries, birthdayPreview, bonusFor,
    normalizeState, toCSV,
  };
});
