/* Money Jars UI. Depends on core.js (window.Core). */
(function () {
  'use strict';
  const C = window.Core;
  const B = C.BUCKETS, BI = C.BUCKET_INFO, TI = C.TYPE_INFO;
  const KEY = 'moneyJars.v1', META_KEY = 'moneyJars.meta', UNDO_KEY = 'moneyJars.beforeReset';
  // Google OAuth client ID for "Sign in with Google" Drive backup. Not a secret.
  const BUILT_IN_CLIENT_ID = '1008041625978-t9bi8k8pl7vqqs3g93kiujloo7l90s1d.apps.googleusercontent.com';
  const S = { state: null, kidId: null, view: 'home', unlockedUntil: 0, histKid: 'all' };
  let meta = { lastBackupAt: null, driveFileId: null };

  const KID_EMOJI = ['🦊', '🐼', '🦁', '🐯', '🐨', '🐸', '🦄', '🐙', '🦖', '🐬', '🚀', '⚽', '🌟', '🎨', '🎸', '🏀'];
  const KID_COLORS = ['#f47a2a', '#e64a8f', '#1f9e66', '#7c4ce0', '#2a7de1', '#d4a017', '#0fa3a3', '#c2410c'];

  // ---------- storage ----------
  function loadAll() {
    try {
      const raw = localStorage.getItem(KEY);
      S.state = raw ? C.normalizeState(JSON.parse(raw)) : C.defaultState();
    } catch (e) {
      console.error(e);
      S.state = C.defaultState();
    }
    try { meta = Object.assign(meta, JSON.parse(localStorage.getItem(META_KEY) || '{}')); } catch (e) { /* ignore */ }
    S.kidId = S.state.kids[0] ? S.state.kids[0].id : null;
  }
  function persist() {
    S.state.savedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(S.state)); } catch (e) { toast('Could not save on this device: ' + e.message); }
    Drive.maybeAuto();
  }
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ } }

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = C.fmt;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const kid = () => S.state.kids.find((k) => k.id === S.kidId);
  const st = () => S.state;
  const pName = () => st().settings.parentName || 'Parent';
  function niceDate(d) {
    const [y, m, dd] = d.split('-').map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function perDollar(pct) {
    pct = Number(pct) || 0;
    if (pct <= 0) return 'no bonus';
    if (pct >= 100) return '+' + fmt(pct, { short: true }) + ' for every $1';
    return '+' + pct + '¢ for every $1';
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  // On phones, open the share sheet (Save to Files, Drive, email). Elsewhere, download.
  async function deliver(name, data, type) {
    const file = new File([data], name, { type });
    const phone = matchMedia('(pointer: coarse)').matches;
    if (phone && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    download(name, data, type);
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- parent lock ----------
  function parentOK() {
    return !st().settings.pin || Date.now() < S.unlockedUntil;
  }
  function requireParent(fn) {
    if (parentOK()) return fn();
    openSheet('Grown-up check 🔐', `
      <form class="stack" id="pinForm">
        <p class="muted">Enter the parent PIN to make changes.</p>
        <input name="pin" type="password" inputmode="numeric" autocomplete="off" class="money" aria-label="PIN" autofocus>
        <div class="msgs"></div>
        <button class="btn primary block">Unlock</button>
      </form>`, (form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (form.pin.value === st().settings.pin) {
          S.unlockedUntil = Date.now() + 15 * 60 * 1000;
          closeSheet();
          render();
          fn();
        } else {
          $('.msgs', form).innerHTML = '<div class="msg err">That PIN is not right.</div>';
          form.pin.value = '';
        }
      });
    });
  }

  // ---------- sheet ----------
  function openSheet(title, body, init) {
    const d = $('#sheet');
    d.innerHTML = `<div class="sheet-head"><h2>${title}</h2><button class="sheet-close" data-action="close-sheet" aria-label="Close">✕</button></div><div class="sheet-body">${body}</div>`;
    if (!d.open) d.showModal();
    const form = $('form', d);
    if (init) init(form || d);
  }
  function closeSheet() { const d = $('#sheet'); if (d.open) d.close(); }

  // ---------- render ----------
  function render() {
    const app = $('#app');
    let html = header();
    if (S.view === 'settings') html += settingsView();
    else if (S.view === 'history') html += historyView();
    else if (!st().kids.length) html += welcomeView();
    else html += backupBanner() + kidTabs() + dashboard();
    app.innerHTML = html;
  }

  const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="8" width="36" height="8" rx="3" fill="#7c4ce0"/><path d="M16 18h32c3 0 5 2 5 5v27c0 4-3 7-7 7H18c-4 0-7-3-7-7V23c0-3 2-5 5-5z" fill="#d6f3e5" stroke="#1f9e66" stroke-width="3"/><circle cx="32" cy="40" r="10" fill="#f6c443" stroke="#d49a00" stroke-width="2.5"/><text x="32" y="45" text-anchor="middle" font-size="13" font-weight="900" fill="#8a5d00" font-family="Arial">$</text></svg>`;

  function header() {
    const tab = (v, label) => `<button data-action="view" data-view="${v}" class="${S.view === v ? 'on' : ''}">${label}</button>`;
    const lock = st().settings.pin ? `<button data-action="lock" title="${parentOK() ? 'Lock parent mode' : 'Locked'}">${parentOK() ? '🔓' : '🔒'}</button>` : '';
    return `<header class="top"><div class="brand">${LOGO}<span>Money Jars</span></div><nav>${tab('home', 'Jars')}${tab('history', 'History')}${tab('settings', 'Settings')}${lock}</nav></header>`;
  }

  function backupBanner() {
    if (!st().txns.length) return '';
    const unsaved = !meta.lastBackupAt || (st().savedAt && st().savedAt > meta.lastBackupAt);
    if (meta.driveLinked && Drive.clientId() && !Drive.connected() && unsaved) {
      return `<div class="banner"><span>☁️ New changes are not in Google Drive yet.</span><button class="btn" data-action="drive-signin">Back up to Drive</button></div>`;
    }
    const last = meta.lastBackupAt ? new Date(meta.lastBackupAt) : null;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    if (last && days < 7) return '';
    return `<div class="banner"><span>☁️ ${last ? 'Last backup was ' + days + ' days ago.' : 'Not backed up yet.'}</span><button class="btn" data-action="backup-now">Back up now</button></div>`;
  }

  function welcomeView() {
    return `<section class="card" style="text-align:center;padding:32px 20px">
      <div style="font-size:3rem">🛍️ 🐷 🌱 🎁</div>
      <h1 style="margin:12px 0 8px">Welcome to Money Jars</h1>
      <p class="muted">Every gift gets split into four jars. Grown-ups add a bonus to Save, Invest and Gift.</p>
      <div class="btn-row" style="justify-content:center;margin-top:16px">
        <button class="btn primary" data-action="kid-edit">➕ Add a kid</button>
        <button class="btn" data-action="restore-file">Restore a backup</button>
      </div></section>`;
  }

  function kidTabs() {
    if (st().kids.length < 2) return '';
    return `<div class="kids" role="tablist">${st().kids.map((k) =>
      `<button class="kid-tab ${k.id === S.kidId ? 'on' : ''}" style="--kid:${esc(k.color)}" data-action="pick-kid" data-id="${k.id}" role="tab" aria-selected="${k.id === S.kidId}"><span class="av">${esc(k.emoji)}</span>${esc(k.name)}</button>`).join('')}</div>`;
  }

  function dashboard() {
    const k = kid();
    const s = st().settings;
    const b = C.balances(st(), k.id);
    const ss = C.saveStatus(st(), k.id);
    const bp = C.birthdayPreview(st(), k.id);
    const jar = (bk) => {
      const x = b[bk];
      const pk = x.total > 0 ? Math.max(0, (x.kid / x.total) * 100) : 0;
      const pp = x.total > 0 ? Math.max(0, (x.parent / x.total) * 100) : 0;
      let note = `<div class="jar-note">${BI[bk].blurb}</div>`;
      if (bk === 'save') {
        const goal = ss.nextMilestone;
        const prev = ss.reached.length ? ss.reached[ss.reached.length - 1] : 0;
        const pct = goal ? Math.min(100, Math.max(0, ((ss.balance - prev) / (goal - prev)) * 100)) : 100;
        note = `${ss.lockedFloor ? `<span class="pill">🔒 ${fmt(ss.lockedFloor, { short: true })} locked</span>` : ''}
          ${goal ? `<div class="goal">Next goal ${fmt(goal, { short: true })}: ${fmt(goal - ss.balance)} to go<div class="bar"><span class="k" style="width:${pct}%"></span></div></div>` : '<div class="goal">🏆 Every goal reached!</div>'}
          <div class="jar-note">${ss.maxAllowed > 0 ? `Can take out up to ${fmt(ss.maxAllowed)} ${ss.windowLabel}.` : ss.windowUsed >= ss.windowLimit ? `Next take-out window opens ${niceDate(ss.nextWindowStart)}.` : 'Nothing can come out right now.'} Earns ${s.saveAPR}% a year.</div>`;
      }
      if (bk === 'invest') note = `<div class="jar-note">Only for growing you: classes, books, business ideas.</div>`;
      return `<article class="jar jar-${bk}">
        <div class="jar-top"><span class="e" aria-hidden="true">${BI[bk].emoji}</span><span class="n">${BI[bk].label}</span></div>
        <div class="jar-body">
          <div class="jar-amt num">${fmt(x.total)}</div>
          <div class="bar" role="img" aria-label="${fmt(x.kid)} yours, ${fmt(x.parent)} bonus"><span class="k" style="width:${pk}%"></span><span class="p" style="width:${pp}%"></span></div>
          <div class="jar-legend num">Yours ${fmt(x.kid)} · Bonus ${fmt(x.parent)}</div>
          ${note}
        </div></article>`;
    };
    const rules = B.map((bk) => `<li class="jar-${bk}"><span class="e">${BI[bk].emoji}</span><span>${BI[bk].label}: <b>${perDollar(s.match[bk])}</b></span></li>`).join('');
    const bday = bp ? `<div class="card"><h2>🎂 Birthday saver bonus</h2>
        <p style="margin:0 0 8px"><b>${bp.daysUntil} days</b> until ${esc(k.name)} turns ${bp.turning}.</p>
        <p class="muted small" style="margin:0 0 8px">This year: saved <b>${fmt(bp.savedIn)}</b>, took out <b>${fmt(bp.withdrawn)}</b>.</p>
        <p style="margin:0;font-weight:800">Bonus if your birthday were today: <span class="pos">${fmt(bp.bonus)}</span></p>
        <p class="muted small" style="margin:6px 0 0">${s.birthdayBonusPct}% of what you add to Save${Number(s.birthdayNoWithdrawBonusPct) ? `, plus ${s.birthdayNoWithdrawBonusPct}% more if you take nothing out` : ''}.</p></div>` : '';
    const recent = C.sortedTxns(st()).filter((t) => t.kidId === k.id).reverse().slice(0, 10);
    return `
      <section class="hero" style="--kid:${esc(k.color)}">
        <div class="avatar" aria-hidden="true">${esc(k.emoji)}</div>
        <div><h1>${esc(k.name)}'s money</h1>
          <div class="big num">${fmt(b.all.total)}</div>
          <div class="legend small num"><span><i class="dot"></i>Your money ${fmt(b.all.kid)}</span><span><i class="dot parent"></i>Bonus from ${esc(pName())} ${fmt(b.all.parent)}</span></div>
        </div>
      </section>
      <div class="actions">
        <button class="act primary" data-action="money-in"><span class="e">💵</span>Money in</button>
        <button class="act" data-action="money-out"><span class="e">🛒</span>Spend</button>
        <button class="act" data-action="move"><span class="e">🔁</span>Move</button>
        <button class="act" data-action="more"><span class="e">⋯</span>More</button>
      </div>
      <div class="jars">${B.map(jar).join('')}</div>
      <div class="two" style="margin-bottom:14px">
        <div class="card"><h2>✨ How the bonus works</h2><ul class="rules">${rules}</ul>
          <p class="muted small" style="margin:10px 0 0">The bonus is added once, when money goes in.</p></div>
        ${bday || `<div class="card"><h2>🎂 Birthday saver bonus</h2><p class="muted">Add ${esc(k.name)}'s birthday in Settings to see it.</p></div>`}
      </div>
      <section class="card"><h2>Recent activity</h2>${txnList(recent)}</section>`;
  }

  function txnSummary(t) {
    let kidSum = 0, parSum = 0;
    t.lines.forEach((l) => { if (l.owner === 'kid') kidSum += l.amount; else parSum += l.amount; });
    const info = TI[t.type] || { label: t.type, emoji: '•' };
    let main = '', sub = '', cls = '';
    if (t.type === 'transfer') {
      const amt = t.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
      main = fmt(amt);
      sub = BI[t.from].label + ' → ' + BI[t.to].label;
    } else {
      const tot = kidSum + parSum;
      cls = tot >= 0 ? 'pos' : 'neg';
      main = (tot >= 0 ? '+' : '') + fmt(tot);
      if (t.type === 'gift-in' || t.type === 'earned-in') { main = '+' + fmt(kidSum); sub = parSum ? '+' + fmt(parSum) + ' bonus' : 'no bonus'; }
      else {
        const jars = Array.from(new Set(t.lines.map((l) => BI[l.bucket].label)));
        sub = jars.join(', ');
      }
    }
    return { info, main, sub, cls };
  }

  function txnList(txns, showKid) {
    if (!txns.length) return '<div class="empty">Nothing here yet. Tap <b>Money in</b> to start.</div>';
    const names = {};
    st().kids.forEach((k) => (names[k.id] = k));
    return `<ul class="list">${txns.map((t) => {
      const x = txnSummary(t);
      const kk = names[t.kidId];
      return `<li class="item" data-action="txn" data-id="${t.id}" tabindex="0">
        <span class="ic" aria-hidden="true">${x.info.emoji}</span>
        <span class="mid"><div class="t">${esc(t.note || x.info.label)}</div>
          <div class="s">${niceDate(t.date)} · ${x.info.label}${t.category ? ' · ' + esc(t.category) : ''}${showKid && kk ? ' · ' + esc(kk.emoji + ' ' + kk.name) : ''}</div></span>
        <span class="amt num"><div class="${x.cls}">${x.main}</div><div class="s">${x.sub}</div></span>
      </li>`;
    }).join('')}</ul>`;
  }

  // ---------- history ----------
  function historyView() {
    const kids = st().kids;
    const sel = S.histKid;
    const txns = C.sortedTxns(st()).filter((t) => sel === 'all' || t.kidId === sel).reverse();
    const rows = [
      ['gift-in', 'Gifts received'], ['earned-in', 'Money earned'], ['interest', 'Save interest'], ['bonus', 'Birthday bonuses'],
      ['growth', 'Invest value changes'], ['spend', 'Spent'], ['give', 'Given to others'], ['invest-use', 'Invested in themselves'], ['adjust', 'Corrections'],
    ];
    const sums = {};
    txns.forEach((t) => {
      const r = sums[t.type] || (sums[t.type] = { kid: 0, parent: 0 });
      t.lines.forEach((l) => (r[l.owner] += l.amount));
    });
    let tk = 0, tp = 0;
    const body = rows.filter(([type]) => sums[type]).map(([type, label]) => {
      tk += sums[type].kid; tp += sums[type].parent;
      return `<tr><td>${TI[type].emoji} ${label}</td><td class="r num">${fmt(sums[type].kid)}</td><td class="r num">${fmt(sums[type].parent)}</td><td class="r num">${fmt(sums[type].kid + sums[type].parent)}</td></tr>`;
    }).join('');
    return `<h1 class="section-title">History</h1>
      <div class="card"><div class="btn-row" style="justify-content:space-between;align-items:center">
        <select data-action="hist-kid" aria-label="Show history for" style="width:auto">
          <option value="all"${sel === 'all' ? ' selected' : ''}>Everyone</option>
          ${kids.map((k) => `<option value="${k.id}"${sel === k.id ? ' selected' : ''}>${esc(k.emoji + ' ' + k.name)}</option>`).join('')}
        </select>
        <button class="btn primary" data-action="statements">📄 Statements</button></div></div>
      <div class="card"><h2>Totals</h2><div class="scroll-x"><table class="t">
        <thead><tr><th>What</th><th class="r">Kid money</th><th class="r">${esc(pName())}</th><th class="r">Total</th></tr></thead>
        <tbody>${body || '<tr><td colspan="4" class="muted">No entries yet.</td></tr>'}</tbody>
        <tfoot><tr><td>Balance now</td><td class="r num">${fmt(tk)}</td><td class="r num">${fmt(tp)}</td><td class="r num">${fmt(tk + tp)}</td></tr></tfoot>
      </table></div><p class="muted small" style="margin:8px 0 0">Moves between jars are left out because they do not change the total.</p></div>
      <div class="card"><h2>All entries</h2>${txnList(txns, true)}</div>`;
  }

  // ---------- settings ----------
  function settingsView() {
    if (!parentOK()) {
      return `<div class="card" style="text-align:center"><p>Settings are for grown-ups.</p><button class="btn primary" data-action="unlock">🔐 Unlock</button></div>`;
    }
    const s = st().settings;
    const num = (name, val, extra) => `<input name="${name}" type="number" inputmode="decimal" step="any" value="${esc(val)}" ${extra || ''}>`;
    const kidsHtml = st().kids.map((k) => `<li class="item" data-action="kid-edit" data-id="${k.id}"><span class="ic" style="background:${esc(k.color)}33">${esc(k.emoji)}</span><span class="mid"><div class="t">${esc(k.name)}</div><div class="s">${k.birthday ? 'Birthday ' + niceDate(k.birthday) : 'No birthday set'}</div></span><span class="muted">Edit ›</span></li>`).join('');
    const lastB = meta.lastBackupAt ? new Date(meta.lastBackupAt).toLocaleString() : 'never';
    return `<h1 class="section-title">Settings</h1>
      <div class="card"><h2>Kids</h2><ul class="list">${kidsHtml || '<li class="empty">No kids yet.</li>'}</ul>
        <button class="btn" data-action="kid-edit" style="margin-top:8px">➕ Add a kid</button></div>
      <form id="settingsForm" class="stack">
        <div class="card stack"><h2>Gift split</h2>
          <p class="muted small" style="margin:0">Every gift is split this way automatically. Must add up to 100%.</p>
          <div class="grid4">${B.map((b) => `<label class="f">${BI[b].emoji} ${BI[b].label} %${num('split_' + b, s.giftSplit[b], 'min="0" max="100"')}</label>`).join('')}</div></div>
        <div class="card stack"><h2>Parent match</h2>
          <p class="muted small" style="margin:0">Percent added once when money goes in. 100 means $1 for every $1.</p>
          <div class="grid4">${B.map((b) => `<label class="f">${BI[b].emoji} ${BI[b].label} %${num('match_' + b, s.match[b], 'min="0"')}</label>`).join('')}</div>
          <label class="check"><input type="checkbox" name="matchEarned" ${s.matchEarned ? 'checked' : ''}> Match earned money too, not just gifts</label>
          <div class="grid2">
            <label class="f">What kids call you<input name="parentName" value="${esc(s.parentName)}"></label>
            <label class="f">Bank name on statements<input name="bankName" value="${esc(s.bankName || '')}" placeholder="Bank of ${esc(s.parentName || 'Mom & Dad')}"></label>
          </div></div>
        <div class="card stack"><h2>🐷 Save rules</h2>
          <div class="grid2">
            <label class="f">Yearly interest %${num('saveAPR', s.saveAPR, 'min="0"')}</label>
            <label class="f">Max take-out % of Save${num('saveMaxWithdrawPct', s.saveMaxWithdrawPct, 'min="0" max="100"')}</label>
            <label class="f">Take-out window<select name="saveWindow">${['month', 'quarter', 'half', 'year'].map((w) => `<option value="${w}"${s.saveWindow === w ? ' selected' : ''}>${{ month: 'Monthly', quarter: 'Quarterly', half: 'Twice a year', year: 'Yearly' }[w]}</option>`).join('')}</select></label>
            <label class="f">Take-outs per window${num('saveWithdrawalsPerWindow', s.saveWithdrawalsPerWindow, 'min="1" step="1"')}</label>
          </div>
          <label class="f">Locking milestones in dollars<input name="saveMilestones" value="${esc((s.saveMilestones || []).join(', '))}"></label>
          <p class="muted small" style="margin:0">When Save reaches a milestone, that amount is locked for good.</p>
          <label class="check"><input type="checkbox" name="autoInterest" ${s.autoInterest ? 'checked' : ''}> Add interest automatically at the end of each month</label></div>
        <div class="card stack"><h2>🎂 Birthday saver bonus</h2>
          <div class="grid2">
            <label class="f">Bonus % of what was added to Save${num('birthdayBonusPct', s.birthdayBonusPct, 'min="0"')}</label>
            <label class="f">Extra % if nothing was taken out${num('birthdayNoWithdrawBonusPct', s.birthdayNoWithdrawBonusPct, 'min="0"')}</label>
          </div>
          <label class="check"><input type="checkbox" name="autoBirthday" ${s.autoBirthday ? 'checked' : ''}> Add the bonus automatically on each birthday</label></div>
        <div class="card stack"><h2>🌱 Approved Invest uses</h2>
          <label class="f">One per line<textarea name="investPurposes" rows="6">${esc((s.investPurposes || []).join('\n'))}</textarea></label></div>
        <div class="card stack"><h2>🔐 Parent PIN</h2>
          <p class="muted small" style="margin:0">Optional. Kids can look but need the PIN to change anything. Leave blank for no PIN.</p>
          <input name="pin" type="password" inputmode="numeric" autocomplete="new-password" value="${esc(s.pin)}" placeholder="No PIN"></div>
        <div class="msgs"></div>
        <button class="btn primary block">Save settings</button>
      </form>
      <div class="card stack" style="margin-top:14px"><h2>☁️ Backup</h2>
        <p class="muted small" style="margin:0">Your data lives on this device. Last backup: <b>${esc(lastB)}</b>.</p>
        <div class="btn-row">
          <button class="btn" data-action="backup-download">⬇️ Download backup</button>
          ${navigator.canShare ? '<button class="btn" data-action="backup-share">📤 Share to Drive or Files</button>' : ''}
          <button class="btn" data-action="restore-file">⬆️ Restore from file</button>
        </div>
        ${driveSection(s)}</div>
      <div class="card stack"><h2>Tools</h2>
        <div class="btn-row">
          <button class="btn" data-action="recalc">🔄 Recalculate interest and birthday bonuses</button>
          <button class="btn" data-action="theme">🌓 Switch light or dark</button>
          ${undoInfo() ? '<button class="btn" data-action="undo-reset">↩️ Undo the last fresh start</button>' : ''}
          <button class="btn danger" data-action="start-fresh">🧹 Start fresh</button>
        </div></div>`;
  }

  function driveSection(s) {
    const cid = Drive.clientId();
    const on = Drive.connected();
    const status = !cid ? '⚙️ Google sign-in is not set up yet. See the README.'
      : on ? '✅ Connected to Google Drive.'
      : meta.driveLinked ? '🔌 Linked before. Tap Sign in with Google to reconnect.' : 'Not connected yet.';
    return `<fieldset class="stack"><legend>Google Drive</legend>
      <p class="small" style="margin:0;font-weight:700">${status}</p>
      ${cid ? `<div class="btn-row">
        ${on ? '<button class="btn primary" data-action="drive-save">☁️ Back up now</button>'
          : '<button class="btn primary" data-action="drive-signin">Sign in with Google</button>'}
        <button class="btn" data-action="drive-restore">Restore from Drive</button></div>
      <label class="check"><input type="checkbox" id="driveAuto" ${s.driveAuto ? 'checked' : ''}> Back up after every change</label>
      <p class="muted small" style="margin:0">Saves to a file called money-jars-backup.json in your Drive. Google keeps older versions of it.</p>` : ''}
      <details class="help"><summary class="small">Advanced</summary>
        <label class="f small" style="margin-top:8px">Google OAuth client ID<input id="driveClientId" value="${esc(s.driveClientId || '')}" placeholder="${esc(BUILT_IN_CLIENT_ID || '1234-abc.apps.googleusercontent.com')}"></label>
      </details></fieldset>`;
  }

  // ---------- statements ----------
  function periodRange(key) {
    const t = C.todayStr();
    const [y, m] = t.split('-').map(Number);
    const p2 = (n) => String(n).padStart(2, '0');
    const last = (yy, mm) => yy + '-' + p2(mm) + '-' + p2(new Date(yy, mm, 0).getDate());
    if (key === 'this-month') return { from: y + '-' + p2(m) + '-01', to: t };
    if (key === 'last-month') { const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1; return { from: ly + '-' + p2(lm) + '-01', to: last(ly, lm) }; }
    if (key === 'this-year') return { from: y + '-01-01', to: t };
    if (key === 'last-year') return { from: (y - 1) + '-01-01', to: (y - 1) + '-12-31' };
    return { from: '', to: t };
  }
  function statementSheet() {
    const kids = st().kids;
    if (!kids.length) { toast('Add a kid first'); return; }
    openSheet('📄 Statements', `
      <form class="stack">
        <p class="muted" style="margin:0">Bank-style statements with each jar as its own account: withdrawals, deposits, parent bonus and running balance.</p>
        <label class="f">Who<select name="kid"><option value="all">Everyone</option>${kids.map((k) => `<option value="${k.id}"${k.id === S.histKid ? ' selected' : ''}>${esc(k.emoji + ' ' + k.name)}</option>`).join('')}</select></label>
        <label class="f">Statement period<select name="period">
          <option value="this-month">This month</option><option value="last-month">Last month</option>
          <option value="this-year">This year</option><option value="last-year">Last year</option>
          <option value="all" selected>All time</option><option value="custom">Custom dates</option></select></label>
        <div class="grid2" id="customDates" hidden>
          <label class="f">From<input type="date" name="from"></label>
          <label class="f">To<input type="date" name="to" value="${C.todayStr()}"></label>
        </div>
        <div class="msgs"></div>
        <button type="submit" class="btn primary block" value="xlsx">📗 Excel statement (.xlsx)</button>
        <button type="submit" class="btn block" value="csv">CSV file</button>
        <p class="muted small" style="margin:0">Excel files open in Excel, Google Sheets and Numbers. Use CSV to import into other tools.</p>
      </form>`, (form) => {
      form.addEventListener('change', () => { $('#customDates', form).hidden = form.period.value !== 'custom'; });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fmtType = (e.submitter && e.submitter.value) || 'xlsx';
        const range = form.period.value === 'custom' ? { from: form.from.value, to: form.to.value || C.todayStr() } : periodRange(form.period.value);
        if (range.from && range.to && range.from > range.to) { $('.msgs', form).innerHTML = '<div class="msg err">The From date is after the To date.</div>'; return; }
        const opts = { kidId: form.kid.value, from: range.from, to: range.to };
        const who = opts.kidId === 'all' ? 'All kids' : (kids.find((k) => k.id === opts.kidId) || {}).name;
        const base = 'Money Jars statement - ' + who + ' - ' + (range.from ? range.from + ' to ' : 'through ') + range.to;
        if (fmtType === 'csv') deliver(base + '.csv', C.statementCSV(st(), opts), 'text/csv');
        else deliver(base + '.xlsx', window.Statement.workbook(st(), opts), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      });
    });
  }

  // ---------- start fresh ----------
  function undoInfo() {
    try { const raw = localStorage.getItem(UNDO_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function startFreshSheet() {
    const kids = st().kids;
    openSheet('🧹 Start fresh', `
      <form class="stack">
        <div class="stack" role="radiogroup" aria-label="What to clear">
          <label class="check"><input type="radio" name="mode" value="entries" checked><span>Clear all money<br><span class="muted small">Every jar goes back to $0. Kids and settings stay.</span></span></label>
          ${kids.length ? `<label class="check"><input type="radio" name="mode" value="kid"><span>Clear one kid's money<br><span class="muted small">Only that kid's jars go back to $0.</span></span></label>
          <select name="kid" aria-label="Which kid" hidden>${kids.map((k) => `<option value="${k.id}">${esc(k.emoji + ' ' + k.name)}</option>`).join('')}</select>` : ''}
          <label class="check"><input type="radio" name="mode" value="all"><span>Erase everything<br><span class="muted small">Kids, money and settings. Like a brand-new app.</span></span></label>
        </div>
        <p class="msg warn" style="margin:0">This only changes this device. Your Google Drive backup stays until the next backup runs.</p>
        <button type="button" class="btn" data-action="backup-download">⬇️ Download a backup first</button>
        <label class="check"><input type="checkbox" name="sure"> I understand. I can undo this from Settings, Tools until the next fresh start.</label>
        <div class="msgs"></div>
        <button class="btn danger block">Start fresh</button>
      </form>`, (form) => {
      form.addEventListener('change', () => { if (form.kid) form.kid.hidden = form.mode.value !== 'kid'; if (form.sure.checked) $('.msgs', form).innerHTML = ''; });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!form.sure.checked) { $('.msgs', form).innerHTML = '<div class="msg err">Tick the box to confirm.</div>'; return; }
        const mode = form.mode.value;
        try { localStorage.setItem(UNDO_KEY, JSON.stringify({ at: new Date().toISOString(), mode, state: st() })); } catch (err) { /* ignore */ }
        if (mode === 'all') { S.state = C.defaultState(); S.kidId = null; S.view = 'home'; }
        else if (mode === 'kid') { const id = form.kid.value; st().txns = st().txns.filter((t) => t.kidId !== id); S.kidId = id; S.view = 'home'; }
        else { st().txns = []; S.view = 'home'; }
        if (mode !== 'all') st().kids.forEach((k) => { if (mode === 'entries' || k.id === form.kid.value) k.startDate = C.todayStr(); });
        persist(); closeSheet(); render();
        toast('Fresh start ✓ Undo is in Settings, Tools.');
      });
    });
  }

  function saveSettings(form) {
    const s = st().settings;
    const f = form.elements;
    const n = (name) => Number(f[name].value);
    const split = {}, match = {};
    B.forEach((b) => { split[b] = n('split_' + b); match[b] = n('match_' + b); });
    const errs = [];
    if (C.splitTotal(split) !== 100) errs.push('The gift split adds up to ' + C.splitTotal(split) + '%. It must be 100%.');
    if (B.some((b) => !(split[b] >= 0) || !(match[b] >= 0))) errs.push('Percentages cannot be negative.');
    const ms = f.saveMilestones.value.split(/[,\s]+/).filter(Boolean).map(Number);
    if (ms.some((x) => !(x > 0))) errs.push('Milestones must be positive numbers.');
    if (errs.length) { $('.msgs', form).innerHTML = errs.map((e) => `<div class="msg err">${esc(e)}</div>`).join(''); return; }
    Object.assign(s, {
      giftSplit: split, match, matchEarned: f.matchEarned.checked, parentName: f.parentName.value.trim() || 'Mom & Dad', bankName: f.bankName.value.trim(),
      saveAPR: n('saveAPR'), saveMaxWithdrawPct: n('saveMaxWithdrawPct'), saveWindow: f.saveWindow.value,
      saveWithdrawalsPerWindow: Math.max(1, Math.round(n('saveWithdrawalsPerWindow'))),
      saveMilestones: ms.sort((a, b) => a - b), autoInterest: f.autoInterest.checked,
      birthdayBonusPct: n('birthdayBonusPct'), birthdayNoWithdrawBonusPct: n('birthdayNoWithdrawBonusPct'),
      autoBirthday: f.autoBirthday.checked,
      investPurposes: f.investPurposes.value.split('\n').map((x) => x.trim()).filter(Boolean),
      pin: f.pin.value.trim(),
    });
    if (s.pin) S.unlockedUntil = Date.now() + 15 * 60 * 1000;
    persist();
    runAuto();
    render();
    toast('Settings saved ✓');
  }

  // ---------- kid editor ----------
  function kidSheet(id) {
    const k = st().kids.find((x) => x.id === id) || { name: '', emoji: KID_EMOJI[st().kids.length % KID_EMOJI.length], color: KID_COLORS[st().kids.length % KID_COLORS.length], birthday: '', startDate: C.todayStr() };
    openSheet(id ? 'Edit ' + esc(k.name) : 'Add a kid', `
      <form class="stack">
        <label class="f">Name<input name="name" value="${esc(k.name)}" required autocomplete="off"></label>
        <div class="f"><b class="small">Picture</b><div class="emoji-pick">${KID_EMOJI.map((e) => `<label><input type="radio" name="emoji" value="${e}" ${e === k.emoji ? 'checked' : ''}>${e}</label>`).join('')}</div></div>
        <div class="f"><b class="small">Color</b><div class="emoji-pick">${KID_COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${c === k.color ? 'checked' : ''}><span class="swatch" style="background:${c}"></span></label>`).join('')}</div></div>
        <div class="grid2">
          <label class="f">Birthday<input type="date" name="birthday" value="${esc(k.birthday)}"></label>
          <label class="f">Tracking since<input type="date" name="startDate" value="${esc(k.startDate)}"></label>
        </div>
        <p class="muted small" style="margin:0">Interest and birthday bonuses count from the "tracking since" date.</p>
        <button class="btn primary block">${id ? 'Save' : 'Add kid'}</button>
        ${id ? '<button type="button" class="btn danger" data-action="kid-delete" data-id="' + id + '">Remove this kid and all their entries</button>' : ''}
      </form>`, (form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = { name: form.name.value.trim(), emoji: form.emoji.value, color: form.color.value, birthday: form.birthday.value, startDate: form.startDate.value || C.todayStr() };
        if (!v.name) return;
        if (id) Object.assign(k, v);
        else { v.id = C.newId(); st().kids.push(v); S.kidId = v.id; }
        persist(); runAuto(); closeSheet(); render();
        toast(id ? 'Saved ✓' : v.name + ' added 🎉');
      });
    });
  }

  // ---------- forms for entries ----------
  function msgsHtml(r, opts) {
    let h = r.errors.map((e) => `<div class="msg err">${esc(e)}</div>`).join('');
    if (!r.errors.length) h += r.warnings.map((w) => `<div class="msg warn">⚠️ ${esc(w)}</div>`).join('');
    return h;
  }
  function overrideBox(r) {
    return !r.errors.length && r.warnings.length && !(r.nudge)
      ? `<label class="check"><input type="checkbox" name="override"> Parent override: allow this anyway</label>` : '';
  }
  // Entries dated before this month change past month-end balances, so redo automatic entries quietly.
  function refreshAuto(date) {
    if (date < C.todayStr().slice(0, 8) + '01') { C.clearAutoEntries(st()); C.runAutoEntries(st()); }
    else C.runAutoEntries(st());
  }
  function commit(txn, label) {
    const before = C.saveStatus(st(), txn.kidId).lockedFloor;
    st().txns.push(txn);
    refreshAuto(txn.date);
    persist();
    closeSheet();
    render();
    const after = C.saveStatus(st(), txn.kidId).lockedFloor;
    if (after > before) toast('🎉 Save milestone! ' + fmt(after, { short: true }) + ' is now locked in.');
    else toast(label + ' ✓');
  }

  function moneyInSheet() {
    const k = kid();
    const s = st().settings;
    openSheet('💵 Money in for ' + esc(k.name), `
      <form class="stack">
        <div class="seg" role="radiogroup" aria-label="Kind of money">
          <label><input type="radio" name="kind" value="gift" checked>🎉 Gift</label>
          <label><input type="radio" name="kind" value="earned">💪 Earned</label>
        </div>
        <label class="f">How much?<input name="amount" class="money" inputmode="decimal" placeholder="$0.00" autocomplete="off" required></label>
        <label class="f">Who was it from, or what was it for?<input name="note" placeholder="Birthday card from Grandma"></label>
        <label class="f">Date<input type="date" name="date" value="${C.todayStr()}"></label>
        <fieldset class="stack" id="splitBox" hidden><legend>Your choice: split it into jars</legend>
          <div class="grid4">${B.map((b) => `<label class="f">${BI[b].emoji} ${BI[b].label} %<input name="sp_${b}" type="number" min="0" max="100" inputmode="numeric" value="${s.giftSplit[b]}"></label>`).join('')}</div>
          <div class="btn-row"><button type="button" class="btn" data-preset="gift">Same as gifts</button><button type="button" class="btn" data-preset="spend">All to Spend</button></div>
        </fieldset>
        <div class="preview"></div>
        <div class="msgs"></div>
        <button class="btn primary block">Add money</button>
      </form>`, (form) => {
      const params = () => {
        const split = {};
        B.forEach((b) => (split[b] = Number(form['sp_' + b].value) || 0));
        return { kidId: k.id, kind: form.kind.value, amount: C.toCents(form.amount.value), note: form.note.value, date: form.date.value, split };
      };
      const update = () => {
        const p = params();
        $('#splitBox', form).hidden = p.kind !== 'earned';
        const r = C.buildMoneyIn(st(), Object.assign({}, p, { amount: p.amount > 0 ? p.amount : 0 }));
        const total = C.splitTotal(p.kind === 'gift' ? s.giftSplit : p.split);
        if (p.amount > 0 && total === 100) {
          const rows = B.map((b) => {
            const kidAmt = r.txn.lines.filter((l) => l.bucket === b && l.owner === 'kid').reduce((a, l) => a + l.amount, 0);
            const par = r.txn.lines.filter((l) => l.bucket === b && l.owner === 'parent').reduce((a, l) => a + l.amount, 0);
            if (!kidAmt && !par) return '';
            return `<tr class="jar-${b}"><td>${BI[b].emoji} ${BI[b].label}</td><td class="r num">${fmt(kidAmt)}</td><td class="r num pos">${par ? '+' + fmt(par) : '—'}</td><td class="r num"><b>${fmt(kidAmt + par)}</b></td></tr>`;
          }).join('');
          $('.preview', form).innerHTML = `<table class="t"><thead><tr><th>Jar</th><th class="r">Yours</th><th class="r">Bonus</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody>
            <tfoot><tr><td>All jars</td><td class="r num">${fmt(p.amount)}</td><td class="r num pos">+${fmt(r.txn.matchTotal || 0)}</td><td class="r num">${fmt(p.amount + (r.txn.matchTotal || 0))}</td></tr></tfoot></table>`;
          $('.msgs', form).innerHTML = r.warnings.map((w) => `<div class="msg warn">💡 ${esc(w)}</div>`).join('');
        } else {
          $('.preview', form).innerHTML = '';
          $('.msgs', form).innerHTML = p.kind === 'earned' && total !== 100 ? `<div class="msg err">The split adds up to ${total}%. It must be 100%.</div>` : '';
        }
      };
      form.addEventListener('input', update);
      form.addEventListener('click', (e) => {
        const pre = e.target.closest('[data-preset]');
        if (!pre) return;
        B.forEach((b) => (form['sp_' + b].value = pre.dataset.preset === 'spend' ? (b === 'spend' ? 100 : 0) : s.giftSplit[b]));
        update();
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = C.buildMoneyIn(st(), params());
        if (r.errors.length) { $('.msgs', form).innerHTML = msgsHtml(r); return; }
        commit(r.txn, 'Added ' + fmt(params().amount) + (r.txn.matchTotal ? ' + ' + fmt(r.txn.matchTotal) + ' bonus' : ''));
      });
      update();
    });
  }

  function jarPicker(name, b, allowed, checked) {
    return `<div class="seg jarpick" role="radiogroup">${B.map((bk) => `<label class="jar-${bk}"><input type="radio" name="${name}" value="${bk}" ${bk === checked ? 'checked' : ''} ${allowed.indexOf(bk) === -1 ? 'disabled' : ''}><span class="e">${BI[bk].emoji}</span>${BI[bk].label}<span class="b num">${fmt(b[bk].total)}</span></label>`).join('')}</div>`;
  }

  function moneyOutSheet() {
    const k = kid();
    const b = C.balances(st(), k.id);
    const purposes = st().settings.investPurposes || [];
    openSheet('🛒 Spend or give', `
      <form class="stack">
        <div class="f"><b class="small">From which jar?</b>${jarPicker('bucket', b, ['spend', 'gift', 'invest'], 'spend')}</div>
        <p class="muted small" style="margin:0">Save money has to be moved to Spend first.</p>
        <label class="f">How much?<input name="amount" class="money" inputmode="decimal" placeholder="$0.00" autocomplete="off" required></label>
        <label class="f" id="noteLabel">What did you buy?<input name="note" placeholder="Lego set" required></label>
        <label class="f" id="catBox" hidden>What kind of investment?<select name="category"><option value="">Pick one</option>${purposes.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
        <label class="f">Date<input type="date" name="date" value="${C.todayStr()}"></label>
        <div class="msgs"></div><div class="ovr"></div>
        <button class="btn primary block">Record it</button>
      </form>`, (form) => {
      const params = () => ({ kidId: k.id, bucket: form.bucket.value, amount: C.toCents(form.amount.value), note: form.note.value, category: form.category.value, date: form.date.value });
      const update = (final) => {
        const p = params();
        $('#catBox', form).hidden = p.bucket !== 'invest';
        $('#noteLabel', form).firstChild.textContent = { spend: 'What did you buy?', gift: 'Who or what was it for?', invest: 'What did you invest in?' }[p.bucket];
        form.note.placeholder = { spend: 'Lego set', gift: 'Birthday present for Mia', invest: 'Art class' }[p.bucket];
        if (!final && !(p.amount > 0)) { $('.msgs', form).innerHTML = ''; $('.ovr', form).innerHTML = ''; return null; }
        const r = C.buildOut(st(), p);
        const shown = final ? r : Object.assign({}, r, { errors: r.errors.filter((e) => !/note|Pick what kind/.test(e)) });
        $('.msgs', form).innerHTML = msgsHtml(shown);
        const had = $('[name=override]', form) && $('[name=override]', form).checked;
        $('.ovr', form).innerHTML = overrideBox(shown);
        if (had && $('[name=override]', form)) $('[name=override]', form).checked = true;
        return r;
      };
      form.addEventListener('input', (e) => { if (e.target.name !== 'override') update(false); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = update(true);
        if (r.errors.length) return;
        if (r.warnings.length && !(form.override && form.override.checked)) { toast('Tick "Parent override" to allow this'); return; }
        requireParent(() => commit(r.txn, TI[r.txn.type].label + ' ' + fmt(params().amount)));
      });
      update(false);
    });
  }

  function moveSheet() {
    const k = kid();
    const b = C.balances(st(), k.id);
    const ss = C.saveStatus(st(), k.id);
    openSheet('🔁 Move between jars', `
      <form class="stack">
        <div class="f"><b class="small">From</b>${jarPicker('from', b, B, 'spend')}</div>
        <div class="f"><b class="small">To</b>${jarPicker('to', b, B, 'save')}</div>
        <div class="hint"></div>
        <label class="f">How much?<input name="amount" class="money" inputmode="decimal" placeholder="$0.00" autocomplete="off" required></label>
        <label class="f">Why? (optional)<input name="note" placeholder="Saving up for a bike"></label>
        <label class="f">Date<input type="date" name="date" value="${C.todayStr()}"></label>
        <p class="muted small" style="margin:0">Moving money does not earn a new bonus.</p>
        <div class="msgs"></div><div class="ovr"></div>
        <button class="btn primary block">Move it</button>
      </form>`, (form) => {
      const params = () => ({ kidId: k.id, from: form.from.value, to: form.to.value, amount: C.toCents(form.amount.value), note: form.note.value, date: form.date.value });
      const update = (final) => {
        const p = params();
        $('.hint', form).innerHTML = p.from === 'save'
          ? `<div class="msg ok">🐷 Save can let out up to <b>${fmt(ss.maxAllowed)}</b> ${ss.windowLabel}.${ss.lockedFloor ? ' ' + fmt(ss.lockedFloor, { short: true }) + ' is locked.' : ''}</div>` : '';
        if (!final && !(p.amount > 0)) { $('.msgs', form).innerHTML = ''; $('.ovr', form).innerHTML = ''; return null; }
        const r = C.buildTransfer(st(), p);
        $('.msgs', form).innerHTML = msgsHtml(r);
        const had = $('[name=override]', form) && $('[name=override]', form).checked;
        $('.ovr', form).innerHTML = overrideBox(r);
        if (had && $('[name=override]', form)) $('[name=override]', form).checked = true;
        return r;
      };
      form.addEventListener('input', (e) => { if (e.target.name !== 'override') update(false); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = update(true);
        if (r.errors.length) return;
        if (r.warnings.length && !(form.override && form.override.checked)) { toast('Tick "Parent override" to allow this'); return; }
        const p = params();
        if (!r.txn.note) r.txn.note = 'Moved ' + BI[p.from].label + ' to ' + BI[p.to].label;
        requireParent(() => commit(r.txn, 'Moved ' + fmt(p.amount)));
      });
      update(false);
    });
  }

  function moreSheet() {
    openSheet('More', `<div class="stack">
      <button class="btn block" data-action="growth">📈 Update Invest value</button>
      <button class="btn block" data-action="adjust">✏️ Make a correction</button>
      <button class="btn block" data-action="kid-edit" data-id="${S.kidId}">⚙️ Edit ${esc(kid().name)}</button>
    </div>`);
  }

  function growthSheet() {
    const k = kid();
    const b = C.balances(st(), k.id).invest;
    openSheet('📈 Update Invest value', `
      <form class="stack">
        <p class="muted" style="margin:0">If Invest money is in a real account, enter what it is worth today. Gains and losses are shared between ${esc(k.name)} and ${esc(pName())} by how much each put in.</p>
        <p style="margin:0">Invest jar now: <b>${fmt(b.total)}</b></p>
        <label class="f">Value today<input name="value" class="money" inputmode="decimal" placeholder="$0.00" required></label>
        <label class="f">Note (optional)<input name="note" placeholder="Brokerage statement"></label>
        <label class="f">Date<input type="date" name="date" value="${C.todayStr()}"></label>
        <div class="msgs"></div>
        <button class="btn primary block">Update</button>
      </form>`, (form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = C.buildGrowth(st(), { kidId: k.id, newValue: C.toCents(form.value.value), note: form.note.value, date: form.date.value });
        if (r.errors.length) { $('.msgs', form).innerHTML = msgsHtml(r); return; }
        requireParent(() => commit(r.txn, 'Invest value updated'));
      });
    });
  }

  function adjustSheet() {
    const k = kid();
    const bal = C.balances(st(), k.id);
    openSheet('✏️ Correction', `
      <form class="stack">
        <p class="muted" style="margin:0">Fix a mistake or enter a starting balance.</p>
        <div class="seg" role="radiogroup" aria-label="Add or take away">
          <label><input type="radio" name="dir" value="1" checked>➕ Deposit</label>
          <label><input type="radio" name="dir" value="-1">➖ Withdraw</label>
        </div>
        <div class="grid2">
          <label class="f">Jar<select name="bucket">${B.map((b) => `<option value="${b}">${BI[b].emoji} ${BI[b].label}</option>`).join('')}</select></label>
          <label class="f">Whose money<select name="owner"><option value="kid">${esc(k.name)}'s</option><option value="parent">${esc(pName())} bonus</option></select></label>
        </div>
        <label class="f">Amount<input name="amount" class="money" inputmode="decimal" placeholder="$0.00" autocomplete="off" required></label>
        <div class="preview"></div>
        <label class="f">Reason<input name="note" placeholder="Starting balance" required></label>
        <label class="f">Date<input type="date" name="date" value="${C.todayStr()}"></label>
        <div class="msgs"></div><div class="ovr"></div>
        <button class="btn primary block">Save correction</button>
      </form>`, (form) => {
      const params = () => {
        const amt = Math.abs(C.toCents(form.amount.value));
        return { kidId: k.id, bucket: form.bucket.value, owner: form.owner.value, amount: amt * Number(form.dir.value), note: form.note.value, date: form.date.value };
      };
      const update = () => {
        const p = params();
        const now = bal[p.bucket][p.owner];
        $('.preview', form).innerHTML = p.amount
          ? `<div class="msg ${now + p.amount < 0 ? 'warn' : 'ok'}">${BI[p.bucket].emoji} ${BI[p.bucket].label}, ${p.owner === 'kid' ? esc(k.name) + "'s money" : esc(pName()) + ' bonus'}: ${fmt(now)} → <b>${fmt(now + p.amount)}</b></div>`
          : '';
      };
      form.addEventListener('input', (e) => { if (e.target.name !== 'override') update(); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const r = C.buildAdjust(st(), params());
        $('.msgs', form).innerHTML = msgsHtml(r);
        if (r.errors.length) return;
        if (r.warnings.length && !(form.override && form.override.checked)) { $('.ovr', form).innerHTML = overrideBox(r); return; }
        requireParent(() => commit(r.txn, 'Correction saved'));
      });
    });
  }

  function txnSheet(id) {
    const t = st().txns.find((x) => x.id === id);
    if (!t) return;
    const x = txnSummary(t);
    const k = st().kids.find((kk) => kk.id === t.kidId);
    openSheet(x.info.emoji + ' ' + x.info.label, `
      <div class="stack">
        <div><div style="font-size:1.6rem;font-weight:900" class="${x.cls}">${x.main}</div><div class="muted">${x.sub}</div></div>
        ${t.note ? `<p style="margin:0"><b>Note:</b> ${esc(t.note)}</p>` : ''}
        ${t.category ? `<p style="margin:0"><b>Invest use:</b> ${esc(t.category)}</p>` : ''}
        <p class="muted" style="margin:0">${niceDate(t.date)} · ${esc(k ? k.name : '')}</p>
        <table class="t"><thead><tr><th>Jar</th><th>Whose</th><th class="r">Amount</th></tr></thead><tbody>
          ${t.lines.map((l) => `<tr><td>${BI[l.bucket].emoji} ${BI[l.bucket].label}</td><td>${l.owner === 'kid' ? esc(k ? k.name : 'Kid') : esc(pName())}</td><td class="r num ${l.amount < 0 ? 'neg' : 'pos'}">${fmt(l.amount)}</td></tr>`).join('')}
        </tbody></table>
        ${t.auto ? '<p class="muted small" style="margin:0">Added automatically. Change the rules in Settings, then use Recalculate.</p>'
          : `<button class="btn danger" data-action="txn-delete" data-id="${t.id}">🗑️ Delete this entry</button>`}
      </div>`);
  }

  // ---------- auto entries ----------
  function runAuto() {
    const added = C.runAutoEntries(st());
    if (added.length) {
      persist();
      const ni = added.filter((t) => t.type === 'interest').length, nb = added.length - ni;
      toast('Added ' + [ni ? ni + ' interest payment' + (ni > 1 ? 's' : '') : '', nb ? nb + ' birthday bonus' + (nb > 1 ? 'es' : '') : ''].filter(Boolean).join(' and ') + ' 🎉');
    }
  }

  // ---------- backup ----------
  function backupJSON() { return JSON.stringify(Object.assign({}, st(), { savedAt: new Date().toISOString() }), null, 2); }
  function backupName() { return 'money-jars-backup-' + C.todayStr() + '.json'; }
  function markBackedUp() { meta.lastBackupAt = new Date().toISOString(); saveMeta(); }
  async function shareBackup() {
    const file = new File([backupJSON()], backupName(), { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Money Jars backup' }); markBackedUp(); render(); toast('Backup shared ✓'); }
      catch (e) { if (e.name !== 'AbortError') toast('Sharing failed: ' + e.message); }
    } else { download(backupName(), backupJSON(), 'application/json'); markBackedUp(); render(); toast('Backup downloaded ✓'); }
  }
  function restoreFromText(text) {
    let next;
    try { next = C.normalizeState(JSON.parse(text)); } catch (e) { toast(e.message || 'That file could not be read.'); return; }
    const when = next.savedAt ? new Date(next.savedAt).toLocaleString() : 'unknown date';
    openSheet('Restore backup?', `<div class="stack">
      <p style="margin:0">This backup from <b>${esc(when)}</b> has <b>${next.kids.length}</b> kids and <b>${next.txns.length}</b> entries.</p>
      <p class="msg warn" style="margin:0">It will replace everything on this device.</p>
      <button class="btn primary block" id="doRestore">Replace with this backup</button></div>`, (root) => {
      $('#doRestore', root.closest('dialog') || document).addEventListener('click', () => {
        S.state = next; S.kidId = next.kids[0] ? next.kids[0].id : null; S.view = 'home';
        persist(); runAuto(); closeSheet(); render(); toast('Backup restored ✓');
      });
    });
  }
  function pickFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = () => { const f = inp.files[0]; if (f) f.text().then(restoreFromText); };
    inp.click();
  }

  // Google Drive backup using Google Identity Services and the drive.file scope.
  const Drive = {
    token: null, exp: 0, timer: null,
    clientId() { return (st().settings.driveClientId || '').trim() || BUILT_IN_CLIENT_ID; },
    connected() { return !!this.token && Date.now() < this.exp - 60000; },
    async signIn() {
      await this.getToken();
      meta.driveLinked = true; saveMeta();
      if (!st().settings.driveAuto) { st().settings.driveAuto = true; persist(); }
      await this.save(true);
      render(); toast('Connected to Google Drive and backed up ✓');
    },
    loadGis() {
      return new Promise((res, rej) => {
        if (window.google && google.accounts && google.accounts.oauth2) return res();
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.onload = res; s.onerror = () => rej(new Error('Could not reach Google. Are you online?'));
        document.head.appendChild(s);
      });
    },
    async getToken() {
      if (this.token && Date.now() < this.exp - 60000) return this.token;
      const cid = this.clientId();
      if (!cid) throw new Error('Add a Google client ID in Settings first.');
      await this.loadGis();
      return new Promise((res, rej) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: cid, scope: 'https://www.googleapis.com/auth/drive.file',
          callback: (r) => { if (r.error) return rej(new Error(r.error)); this.token = r.access_token; this.exp = Date.now() + r.expires_in * 1000; res(this.token); },
          error_callback: (e) => rej(new Error(e.message || e.type || 'Sign-in was cancelled')),
        });
        client.requestAccessToken();
      });
    },
    async api(url, opts) {
      const tok = await this.getToken();
      opts = opts || {};
      opts.headers = Object.assign({ Authorization: 'Bearer ' + tok }, opts.headers || {});
      const r = await fetch(url, opts);
      if (!r.ok && r.status !== 404) throw new Error('Google Drive said ' + r.status);
      return r;
    },
    async findFile() {
      if (meta.driveFileId) return meta.driveFileId;
      const q = encodeURIComponent("name='money-jars-backup.json' and trashed=false");
      const r = await this.api('https://www.googleapis.com/drive/v3/files?q=' + q + '&orderBy=modifiedTime desc&fields=files(id,modifiedTime)');
      const j = await r.json();
      return j.files && j.files[0] ? j.files[0].id : null;
    },
    async save(quiet) {
      const body = backupJSON();
      let id = await this.findFile();
      if (id) {
        const r = await this.api('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
        if (r.status === 404) { meta.driveFileId = null; id = null; }
      }
      if (!id) {
        const boundary = 'mj' + Date.now();
        const multipart = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify({ name: 'money-jars-backup.json', mimeType: 'application/json' }) + '\r\n--' + boundary +
          '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + boundary + '--';
        const r = await this.api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart });
        id = (await r.json()).id;
      }
      meta.driveFileId = id; meta.driveLinked = true; markBackedUp();
      if (!quiet) { render(); toast('Backed up to Google Drive ✓'); }
    },
    async restore() {
      const id = await this.findFile();
      if (!id) throw new Error('No Money Jars backup found in your Drive yet.');
      const r = await this.api('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media');
      if (r.status === 404) { meta.driveFileId = null; saveMeta(); throw new Error('The Drive backup file is gone.'); }
      meta.driveFileId = id; saveMeta();
      restoreFromText(await r.text());
    },
    maybeAuto() {
      if (!st().settings.driveAuto || !this.token || Date.now() > this.exp - 60000) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.save(true).catch((e) => toast('Drive backup failed: ' + e.message)), 2500);
    },
  };

  async function backupNow() {
    if (Drive.clientId()) {
      try { await Drive.save(); } catch (e) { toast(e.message); }
    } else shareBackup();
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    const parentOnly = (fn) => requireParent(fn);
    switch (a) {
      case 'view': S.view = el.dataset.view; render(); window.scrollTo(0, 0); break;
      case 'pick-kid': S.kidId = id; render(); break;
      case 'close-sheet': closeSheet(); break;
      case 'lock': if (parentOK()) { S.unlockedUntil = 0; render(); toast('Locked 🔒'); } else requireParent(() => {}); break;
      case 'unlock': requireParent(() => render()); break;
      case 'money-in': parentOnly(moneyInSheet); break;
      case 'money-out': moneyOutSheet(); break;
      case 'move': moveSheet(); break;
      case 'more': moreSheet(); break;
      case 'growth': parentOnly(growthSheet); break;
      case 'adjust': parentOnly(adjustSheet); break;
      case 'kid-edit': closeSheet(); parentOnly(() => kidSheet(id)); break;
      case 'kid-delete':
        if (confirm('Remove this kid and every entry for them? This cannot be undone.')) {
          st().kids = st().kids.filter((k) => k.id !== id);
          st().txns = st().txns.filter((t) => t.kidId !== id);
          S.kidId = st().kids[0] ? st().kids[0].id : null;
          persist(); closeSheet(); render(); toast('Removed');
        }
        break;
      case 'txn': txnSheet(id); break;
      case 'txn-delete':
        parentOnly(() => {
          if (!confirm('Delete this entry? Balances will be recalculated.')) return;
          const gone = st().txns.find((t) => t.id === id);
          st().txns = st().txns.filter((t) => t.id !== id);
          if (gone) refreshAuto(gone.date);
          persist(); closeSheet(); render(); toast('Entry deleted');
        });
        break;
      case 'statements': statementSheet(); break;
      case 'backup-now': backupNow(); break;
      case 'backup-download': download(backupName(), backupJSON(), 'application/json'); markBackedUp(); render(); toast('Backup downloaded ✓'); break;
      case 'backup-share': shareBackup(); break;
      case 'restore-file': parentOnly(pickFile); break;
      case 'drive-save': Drive.save().catch((err) => toast(err.message)); break;
      case 'drive-signin': Drive.signIn().catch((err) => toast(err.message)); break;
      case 'drive-restore': Drive.restore().catch((err) => toast(err.message)); break;
      case 'recalc':
        if (confirm('Remove all automatic interest and birthday bonus entries and work them out again with the current rules?')) {
          C.clearAutoEntries(st()); persist(); runAuto(); render(); toast('Recalculated ✓');
        }
        break;
      case 'theme': {
        const root = document.documentElement;
        const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
        root.dataset.theme = dark ? 'light' : 'dark';
        try { localStorage.setItem('moneyJars.theme', root.dataset.theme); } catch (err) { /* ignore */ }
        break;
      }
      case 'start-fresh': parentOnly(startFreshSheet); break;
      case 'undo-reset':
        parentOnly(() => {
          const u = undoInfo();
          if (!u) return;
          if (!confirm('Put back everything from before the fresh start on ' + new Date(u.at).toLocaleString() + '? Changes made since then will be replaced.')) return;
          S.state = C.normalizeState(u.state); S.kidId = S.state.kids[0] ? S.state.kids[0].id : null;
          try { localStorage.removeItem(UNDO_KEY); } catch (err) { /* ignore */ }
          persist(); render(); toast('Restored ✓');
        });
        break;
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.item[data-action]')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-action="hist-kid"]')) { S.histKid = e.target.value; render(); }
    if (e.target.id === 'driveAuto') { st().settings.driveAuto = e.target.checked; persist(); }
    if (e.target.id === 'driveClientId') { st().settings.driveClientId = e.target.value.trim(); Drive.token = null; persist(); render(); }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'settingsForm') { e.preventDefault(); saveSettings(e.target); }
  });

  // ---------- start ----------
  try { const th = localStorage.getItem('moneyJars.theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* ignore */ }
  loadAll();
  render();
  runAuto();
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
