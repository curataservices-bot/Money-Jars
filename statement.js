/* Builds bank-style statement workbooks from Money Jars data. Needs core.js and xlsx.js. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./core.js') : root.Core, isNode ? require('./xlsx.js') : root.XLSXLite);
  if (isNode) module.exports = api;
  else root.Statement = api;
})(typeof self !== 'undefined' ? self : this, function (C, X) {
  'use strict';
  const B = C.BUCKETS;
  const W = 7; // columns per account block, including a spacer

  function niceDate(d) {
    if (!d) return '';
    const [y, m, dd] = d.split('-').map(Number);
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + dd + ', ' + y;
  }
  function periodText(from, to) {
    if (!from && !to) return 'All activity';
    if (!from) return 'Everything through ' + niceDate(to);
    return niceDate(from) + ' to ' + niceDate(to || C.todayStr());
  }
  const $ = (c) => (c ? c / 100 : '');
  const money = (c) => c / 100;

  function kidSheet(state, kid, opts) {
    const s = state.settings;
    const bank = s.bankName || ('Bank of ' + (s.parentName || 'Mom & Dad'));
    const rows = [], merges = [], heights = {};
    const put = (r, c, cell) => { (rows[r] = rows[r] || [])[c] = cell; };
    const merge = (r, c1, c2) => merges.push(X.colName(c1) + (r + 1) + ':' + X.colName(c2) + (r + 1));
    let maxRow = 0;
    B.forEach((b, i) => {
      const o = i * W;
      const st = C.statementRows(state, kid.id, b, opts.from, opts.to);
      const label = C.BUCKET_INFO[b].label;
      put(0, o, { v: 'STATEMENT OF ACCOUNT', s: 'title' }); merge(0, o, o + 5);
      put(1, o, { v: kid.name, s: 'bold' }); merge(1, o, o + 5);
      put(2, o, { v: bank + '  ·  Statement date ' + niceDate(C.todayStr()), s: 'muted' }); merge(2, o, o + 5);
      put(3, o, { v: 'Statement period: ' + periodText(opts.from, opts.to), s: 'muted' }); merge(3, o, o + 5);
      for (let c = 0; c < 6; c++) put(5, o + c, { v: c ? '' : label.toUpperCase() + ' ACCOUNT', s: b });
      merge(5, o, o + 5); heights[5] = 22;
      const sum = [
        ['Opening balance', st.opening, 'money'],
        ['+ Deposits', st.totals.deposit, 'money'],
        ['+ Parent bonus', st.totals.bonus, 'money'],
        ['− Withdrawals', st.totals.withdrawal, 'money'],
      ];
      sum.forEach(([l, v], j) => { put(6 + j, o, { v: l, s: 'label' }); put(6 + j, o + 5, { v: money(v), s: 'money' }); });
      put(10, o, { v: 'Closing balance', s: 'totalLabel' });
      for (let c = 1; c < 5; c++) put(10, o + c, { v: '', s: 'totalLabel' });
      put(10, o + 5, { v: money(st.closing), s: 'totalMoney' });
      put(11, o, { v: '   ' + kid.name + "'s own money", s: 'muted' }); put(11, o + 5, { v: money(st.closingKid), s: 'money' });
      put(12, o, { v: '   Bonus money from ' + (s.parentName || 'parents'), s: 'muted' }); put(12, o + 5, { v: money(st.closingParent), s: 'money' });
      const head = ['DATE', 'DESCRIPTION', 'WITHDRAWALS', 'DEPOSITS', 'PARENT BONUS', 'BALANCE'];
      head.forEach((h, c) => put(14, o + c, { v: h, s: c >= 2 ? 'headerRight' : 'header' }));
      heights[14] = 20;
      let r = 15;
      put(r, o, opts.from ? { v: opts.from, t: 'd', s: 'date' } : { v: '', s: 'text' });
      put(r, o + 1, { v: 'Balance forward', s: 'text' });
      put(r, o + 2, { v: '', s: 'money' }); put(r, o + 3, { v: '', s: 'money' }); put(r, o + 4, { v: '', s: 'money' });
      put(r, o + 5, { v: money(st.opening), s: 'money' });
      st.rows.forEach((x) => {
        r++;
        put(r, o, { v: x.date, t: 'd', s: 'date' });
        put(r, o + 1, { v: x.description, s: 'text' });
        put(r, o + 2, { v: $(x.withdrawal), s: 'moneyOut' });
        put(r, o + 3, { v: $(x.deposit), s: 'money' });
        put(r, o + 4, { v: $(x.bonus), s: 'moneyBonus' });
        put(r, o + 5, { v: money(x.balance), s: 'money' });
      });
      r++;
      put(r, o, { v: 'Totals', s: 'totalLabel' }); put(r, o + 1, { v: '', s: 'totalLabel' });
      put(r, o + 2, { v: money(st.totals.withdrawal), s: 'totalMoney' });
      put(r, o + 3, { v: money(st.totals.deposit), s: 'totalMoney' });
      put(r, o + 4, { v: money(st.totals.bonus), s: 'totalMoney' });
      put(r, o + 5, { v: money(st.closing), s: 'totalMoney' });
      maxRow = Math.max(maxRow, r);
    });
    const cols = [];
    B.forEach(() => cols.push(13, 34, 13, 13, 14, 14, 3));
    for (let r = 0; r <= maxRow; r++) rows[r] = rows[r] || [];
    return { name: kid.name, rows, cols, merges, heights: Object.keys(heights).map(Number).reduce((a, k) => { a[k] = heights[k]; return a; }, []) };
  }

  function summarySheet(state, kids, opts) {
    const s = state.settings;
    const bank = s.bankName || ('Bank of ' + (s.parentName || 'Mom & Dad'));
    const rows = [
      [{ v: 'MONEY JARS SUMMARY', s: 'title' }],
      [{ v: bank + '  ·  Statement date ' + niceDate(C.todayStr()), s: 'muted' }],
      [{ v: 'Statement period: ' + periodText(opts.from, opts.to), s: 'muted' }],
      [],
      [{ v: 'Closing balances', s: 'bold' }],
    ];
    const head = ['KID', 'SPEND', 'SAVE', 'INVEST', 'GIFT', 'TOTAL', "KID'S OWN MONEY", 'PARENT BONUS'];
    rows.push(head.map((h, i) => ({ v: h, s: i ? 'headerRight' : 'header' })));
    const tot = new Array(7).fill(0);
    kids.forEach((k) => {
      const per = B.map((b) => C.statementRows(state, k.id, b, opts.from, opts.to));
      const vals = per.map((p) => p.closing);
      const total = vals.reduce((a, v) => a + v, 0);
      const kidOwn = per.reduce((a, p) => a + p.closingKid, 0);
      const par = per.reduce((a, p) => a + p.closingParent, 0);
      const all = vals.concat([total, kidOwn, par]);
      all.forEach((v, i) => (tot[i] += v));
      rows.push([{ v: k.name, s: 'text' }].concat(all.map((v) => ({ v: money(v), s: 'money' }))));
    });
    if (kids.length > 1) rows.push([{ v: 'All kids', s: 'totalLabel' }].concat(tot.map((v) => ({ v: money(v), s: 'totalMoney' }))));
    rows.push([], [{ v: 'Activity this period (moves between jars left out)', s: 'bold' }]);
    rows.push(['KID', 'DEPOSITS', 'PARENT BONUS', 'WITHDRAWALS'].map((h, i) => ({ v: h, s: i ? 'headerRight' : 'header' })));
    kids.forEach((k) => {
      let d = 0, bo = 0, w = 0;
      B.forEach((b) => C.statementRows(state, k.id, b, opts.from, opts.to).rows.forEach((x) => {
        if (x.type === 'transfer') return;
        d += x.deposit; bo += x.bonus; w += x.withdrawal;
      }));
      rows.push([{ v: k.name, s: 'text' }, { v: money(d), s: 'money' }, { v: money(bo), s: 'moneyBonus' }, { v: money(w), s: 'moneyOut' }]);
    });
    return { name: 'Summary', rows, cols: [24, 14, 14, 14, 14, 14, 18, 15], merges: [] };
  }

  // opts: { kidId: 'all' | id, from: 'YYYY-MM-DD' | '', to: 'YYYY-MM-DD' | '' }
  function workbook(state, opts) {
    opts = opts || {};
    const kids = state.kids.filter((k) => !opts.kidId || opts.kidId === 'all' || k.id === opts.kidId);
    const sheets = [summarySheet(state, kids, opts)].concat(kids.map((k) => kidSheet(state, k, opts)));
    return X.build(sheets, 'Money Jars statement');
  }

  return { workbook, periodText };
});
