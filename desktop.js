/* Nix app: desktop layout extras (screens 1100px and wider only).
   Phones never run this: it waits until the screen is wide enough, and does nothing below that.
   Reads inventory through window.NixInv (inventory.js) and saves only through the app's own forms. */
(function () {
  'use strict';
  const MQ = window.matchMedia('(min-width: 1100px)');
  let started = false;
  const boot = () => { if (!started && MQ.matches) { started = true; start(); } };
  if (MQ.addEventListener) MQ.addEventListener('change', boot); else if (MQ.addListener) MQ.addListener(boot);
  boot();

  function start() {
    const $ = id => document.getElementById(id);
    const root = document.documentElement;
    root.classList.add('dk-on');
    const keep = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
                   set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const get = (o, name) => { const k = Object.keys(o || {}).find(x => x.toLowerCase() === name.toLowerCase()); return k ? o[k] : ''; };
    const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? null : n; };
    const money = n => '$' + (n || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 });
    const ymd = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const pdate = v => {
      if (!v) return null;
      const s = String(v).trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
      const d = new Date(s); return isNaN(d) ? null : d;
    };
    const group = p => { const s = String(get(p, 'Status')).trim(); return /^sold$/i.test(s) ? 'sold' : /in stock|reserved/i.test(s) ? 'stock' : 'progress'; };
    const photoId = p => { const k = Object.keys(p).find(x => /photo/i.test(x) && /^https?:/.test(p[x])); return k ? (String(p[k]).match(/[-\w]{25,}/) || [])[0] || '' : ''; };
    const COSTY = /cost|labour|charges|landed|margin|profit|rate|buyer|paid/i;   // columns hidden in Client view
    const inv = () => window.NixInv || null;
    const data = () => { const i = inv(); return i ? i.data() : null; };
    const full = () => { const d = data(); return !!(d && d.role === 'full' && d.pieces); };
    const TABS = [['stock', 'In stock'], ['progress', 'In progress'], ['sold', 'Sold'], ['all', 'All']];

    let tab = keep.get('nixDkTab') || 'stock', view = 'table', q = '', sort = { k: '', dir: -1 }, limit = 200;
    let safe = keep.get('nixDkSafe') === '1', needF = '';
    let ROWS = [], NEED = [];

    /* ---------- Side menu: keyboard shortcut hint ---------- */
    const nav = document.querySelector('.nv');
    if (nav) {
      const k = document.createElement('div'); k.className = 'dk dk-keys';
      k.innerHTML = '<b>Shortcuts</b><br><kbd>/</kbd> search stock<br><kbd>I</kbd> inventory · <kbd>C</kbd> calculator<br><kbd>N</kbd> new piece · <kbd>Esc</kbd> close panel';
      nav.appendChild(k);
    }

    /* ---------- Piece panel opens as a side drawer, with a dimmed background ---------- */
    const det = $('ivDet');
    const shade = document.createElement('div'); shade.className = 'dk dk-shade'; shade.hidden = true;
    document.body.appendChild(shade);
    shade.onclick = () => history.back();
    if (det) new MutationObserver(() => { shade.hidden = det.hidden; }).observe(det, { attributes: true, attributeFilter: ['hidden'] });

    /* ---------- Desktop inventory section (built once, under the dashboard) ---------- */
    const sec = document.createElement('section');
    sec.className = 'dk dk-inv'; sec.id = 'dkInv'; sec.hidden = true;
    sec.innerHTML =
      '<div class="dk-top"><div class="seg dk-views" id="dkViews">' +
        '<button type="button" data-w="table">Stock table</button><button type="button" data-w="ins">Insights</button><button type="button" data-w="need">Needs info <span id="dkNeedN"></span></button></div>' +
        '<div class="dk-acts"><button type="button" class="btn sm" id="dkNew">+ New piece</button><button type="button" class="ghost sm" id="dkDia">+ Diamonds</button></div></div>' +
      '<div id="dkTable">' +
        '<div class="dk-bar"><div class="seg dk-tabs" id="dkTabs"></div>' +
        '<input id="dkQ" type="search" placeholder="Search SKU, design, metal…  ( / )" autocomplete="off">' +
        '<label class="fm-check dk-safe" title="Hides costs and margins on screen, in print and in exports"><input type="checkbox" id="dkSafe"> Client view</label>' +
        '<button type="button" class="ghost sm" id="dkCsv">Export to Excel</button><button type="button" class="ghost sm" id="dkPrn">Print</button></div>' +
        '<div class="dk-count" id="dkCount"></div>' +
        '<div class="dk-tw"><table class="dk-t" id="dkT"></table></div>' +
        '<button type="button" class="ghost dk-more" id="dkMore" hidden>Show more</button></div>' +
      '<div id="dkIns" hidden></div>' +
      '<div id="dkNeed" hidden></div>';
    const dash = $('ivDash');
    if (dash) dash.insertAdjacentElement('afterend', sec);
    // The status line above describes the phone list; on desktop keep only "Updated …" (and any offline or error message)
    const info = $('ivInfo');
    if (info) new MutationObserver(() => {
      if (!root.classList.contains('dk-inv-on') || !MQ.matches) return;
      const m = info.textContent.match(/^(?:Latest \d+ of \d+|\d+ found[^.]*)[^.]*\. (Updated .+)$/);
      if (m) info.textContent = m[1];
    }).observe(info, { childList: true, characterData: true, subtree: true });

    /* ---------- Data preparation ---------- */
    function prep(d) {
      ROWS = d.pieces.map((p, i) => {
        const dia = (d.diamonds && d.diamonds[p._sku]) || [];
        const ct = dia.reduce((s, x) => s + (num(get(x, 'Total Carat Weight')) || 0), 0);
        const g = group(p), cost = num(get(p, 'Total Landed Cost (CAD)')), ask = num(get(p, 'Asking Price (CAD)')), sold = num(get(p, 'Sold Price (CAD)'));
        const base = g === 'sold' && sold ? sold : ask;
        return {
          p, i, dia, g, sku: p._sku, name: get(p, 'Design / Name'), type: get(p, 'Item Type'), metal: get(p, 'Metal'),
          gw: num(get(p, 'Gold Weight (g)')), ct: dia.length ? Math.round(ct * 1000) / 1000 : null,
          cost, ask, sold, mg: cost != null && base ? (base - cost) / base * 100 : null,
          sdate: pdate(get(p, 'Sold Date')), status: String(get(p, 'Status') || ''), ship: get(p, 'Shipment ID'), photo: photoId(p),
          channel: String(get(p, 'Sales Channel') || '').trim()
        };
      });
      NEED = ROWS.filter(r => r.g !== 'sold').map(r => ({ r, miss: CHECKS.filter(c => c[1](r)).map(c => c[0]) })).filter(x => x.miss.length);
    }
    const blank = v => v === '' || v == null;
    const CHECKS = [
      ['Gold weight', r => r.gw == null],
      ['Gold cost', r => blank(get(r.p, 'Gold Cost (INR)'))],
      ['Labour', r => blank(get(r.p, 'Labour (INR)'))],
      ['Diamonds', r => !r.dia.length],
      ['Diamond cost', r => r.dia.some(x => blank(get(x, 'Cost (INR)')))],
      ['Asking price', r => r.ask == null],
      ['Photo', r => !r.photo],
      ['Landed cost', r => r.g === 'stock' && r.cost == null]
    ];

    /* ---------- Stock table ---------- */
    const thumb = (id, w) => '<span class="dk-th">' + (id ? '<img loading="lazy" alt="" src="https://drive.google.com/thumbnail?id=' + esc(id) + '&sz=w' + (w || 96) + '" onerror="this.remove()">' : '') + '</span>';
    const COLS = [
      { k: 'photo', t: '', nosort: 1, cell: r => thumb(r.photo) },
      { k: 'sku', t: 'SKU', cell: r => '<b>' + esc(r.sku) + '</b>' },
      { k: 'name', t: 'Design', cls: 'dk-nm' },
      { k: 'type', t: 'Item' },
      { k: 'metal', t: 'Metal' },
      { k: 'gw', t: 'Gold (g)', n: 2, sum: 1 },
      { k: 'ct', t: 'Carats', n: 2, sum: 1 },
      { k: 'cost', t: 'Landed (CAD)', n: 0, sum: 1, cost: 1 },
      { k: 'ask', t: 'Asking (CAD)', n: 0, sum: 1, hide: () => tab === 'sold' },
      { k: 'sold', t: 'Sold (CAD)', n: 0, sum: 1, hide: () => tab !== 'sold' && tab !== 'all' },
      { k: 'sdate', t: 'Sold on', date: 1, hide: () => tab !== 'sold' },
      { k: 'mg', t: 'Margin', n: 'pct', cost: 1 },
      { k: 'status', t: 'Status', cell: r => r.status ? '<span class="pill">' + esc(r.status) + '</span>' : '' },
      { k: 'ship', t: 'Shipment', hide: () => tab === 'sold' }
    ];
    const cols = () => COLS.filter(c => !(c.hide && c.hide()) && !(safe && c.cost));
    const isNum = c => c.n != null || c.date;
    function fmt(c, v) {
      if (v == null || v === '') return '';
      if (c.date) return ymd(v);
      if (c.n === 'pct') return Math.round(v) + '%';
      if (c.n != null) return v.toLocaleString('en-CA', { minimumFractionDigits: c.n, maximumFractionDigits: c.n });
      return esc(v);
    }
    function filtered() {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      // like the phone app: a search looks through every piece; without one, the chosen tab is shown
      const rows = ROWS.filter(r => (terms.length || tab === 'all' || r.g === tab) && terms.every(t => (r.p._h || '').indexOf(t) > -1));
      const k = sort.k, d = sort.dir;
      rows.sort(!k ? (a, b) => b.i - a.i : (a, b) => {
        const x = a[k], y = b[k], xe = x == null || x === '', ye = y == null || y === '';
        if (xe || ye) return xe && ye ? b.i - a.i : xe ? 1 : -1;      // empty values always last
        const c = typeof x === 'number' || x instanceof Date ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
        return c * d || b.i - a.i;
      });
      return rows;
    }
    function renderTable() {
      const rows = filtered(), cs = cols();
      const n = { stock: 0, progress: 0, sold: 0, all: ROWS.length }; ROWS.forEach(r => n[r.g]++);
      $('dkTabs').innerHTML = TABS.map(([k, l]) => '<button type="button" data-t="' + k + '"' + (k === tab && !q ? ' class="on"' : '') + '>' + l + ' (' + n[k] + ')</button>').join('');
      const th = cs.map(c => {
        const on = sort.k === c.k;
        return '<th class="' + (isNum(c) ? 'n' : '') + '"' + (on ? ' aria-sort="' + (sort.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' +
          (c.nosort ? '' : '<button type="button" data-k="' + c.k + '">' + esc(c.t) + '<i>' + (on ? (sort.dir > 0 ? ' ▲' : ' ▼') : '') + '</i></button>') + '</th>';
      }).join('');
      const body = rows.slice(0, limit).map(r => '<tr data-sku="' + esc(r.sku) + '" tabindex="0">' + cs.map(c =>
        '<td class="' + [isNum(c) ? 'n' : '', c.cls || '', c.k === 'mg' && r.mg != null && r.mg < 20 ? 'dk-lo' : ''].join(' ').trim() + '">' + (c.cell ? c.cell(r) : fmt(c, r[c.k])) + '</td>').join('') + '</tr>').join('');
      // Totals cover every matching piece, not only the rows on screen
      const withBoth = rows.filter(r => r.cost != null && (r.g === 'sold' && r.sold ? r.sold : r.ask));
      const bSum = withBoth.reduce((s, r) => s + (r.g === 'sold' && r.sold ? r.sold : r.ask), 0), cSum = withBoth.reduce((s, r) => s + r.cost, 0);
      const foot = cs.map((c, i) => {
        if (i === 1) return '<td>Total · ' + rows.length + '</td>';
        if (c.sum) { const s = rows.reduce((a, r) => a + (r[c.k] || 0), 0); return '<td class="n">' + fmt(c, s) + '</td>'; }
        if (c.k === 'mg' && bSum) return '<td class="n">' + Math.round((bSum - cSum) / bSum * 100) + '%</td>';
        return '<td></td>';
      }).join('');
      $('dkT').innerHTML = '<thead><tr>' + th + '</tr></thead><tbody>' +
        (body || '<tr><td colspan="' + cs.length + '" class="dk-empty">' + (q ? 'No piece matches. Try a shorter search.' : 'No pieces here yet.') + '</td></tr>') +
        '</tbody>' + (rows.length ? '<tfoot><tr>' + foot + '</tr></tfoot>' : '');
      $('dkCount').textContent = (q ? rows.length + ' found in all pieces' : rows.length + ' pieces') + (rows.length > limit ? ', showing the first ' + limit : '') +
        '. Click a column to sort, click a row to open the piece.' + (safe ? ' Client view is on: costs and margins are hidden.' : '');
      $('dkMore').hidden = rows.length <= limit;
    }

    /* ---------- Insights ---------- */
    const sum = (a, f) => a.reduce((s, r) => s + (f(r) || 0), 0);
    function bars(list, unit) {
      const max = Math.max.apply(null, [1].concat(list.map(x => x.v)));
      if (!list.length) return '<p class="iv-note">Nothing to show yet.</p>';
      return list.map(x => '<div class="dk-br"><span>' + esc(x.l) + '</span><i><em style="width:' + (x.v / max * 100) + '%"></em></i><b>' +
        (unit === '$' ? money(x.v) : x.v + (unit ? ' ' + unit : '')) + (x.s ? '<small>' + esc(x.s) + '</small>' : '') + '</b></div>').join('');
    }
    function tally(rows, key) {
      const m = {};
      rows.forEach(r => { const k = String(r[key] || '').trim() || 'Not set'; (m[k] = m[k] || { l: k, n: 0, c: 0 }); m[k].n++; m[k].c += r.cost || 0; });
      return Object.keys(m).map(k => m[k]).sort((a, b) => b.n - a.n).slice(0, 10);
    }
    function renderIns() {
      const box = $('dkIns');
      if (safe) { box.innerHTML = '<p class="iv-note">Insights show costs and profit. Turn off Client view on the Stock table to see them.</p>'; return; }
      const now = new Date(), y = now.getFullYear(), m = now.getMonth();
      const stock = ROWS.filter(r => r.g === 'stock'), prog = ROWS.filter(r => r.g === 'progress'), sold = ROWS.filter(r => r.g === 'sold' && r.sold != null);
      const both = stock.filter(r => r.cost != null && r.ask != null);
      const thisM = sold.filter(r => r.sdate && r.sdate.getFullYear() === y && r.sdate.getMonth() === m);
      const ytd = sold.filter(r => r.sdate && r.sdate.getFullYear() === y), ytdC = ytd.filter(r => r.cost != null);
      const yProfit = sum(ytdC, r => r.sold - r.cost), yRev = sum(ytdC, r => r.sold);
      const kp = [
        ['In stock', stock.length + ' pieces'],
        ['Stock at landed cost', money(sum(stock, r => r.cost))],
        ['Stock at asking price', money(sum(stock, r => r.ask))],
        ['Potential profit in stock' + (both.length < stock.length ? ' *' : ''), money(sum(both, r => r.ask - r.cost))],
        ['In progress', prog.length + ' pieces'],
        ['Sales this month', money(sum(thisM, r => r.sold)) + ' · ' + thisM.length + ' sold'],
        ['Sales in ' + y, money(sum(ytd, r => r.sold)) + ' · ' + ytd.length + ' sold'],
        ['Profit in ' + y + (ytdC.length < ytd.length ? ' *' : ''), money(yProfit) + (yRev ? ' · ' + Math.round(yProfit / yRev * 100) + '%' : '')]
      ];
      const months = [];
      for (let k = 11; k >= 0; k--) {
        const d = new Date(y, m - k, 1), rs = sold.filter(r => r.sdate && r.sdate.getFullYear() === d.getFullYear() && r.sdate.getMonth() === d.getMonth());
        const rc = rs.filter(r => r.cost != null);
        months.push({ l: d.toLocaleDateString('en-CA', { month: 'short', year: 'numeric' }), v: sum(rs, r => r.sold),
                      s: rs.length ? rs.length + ' sold' + (rc.length ? ' · profit ' + money(sum(rc, r => r.sold - r.cost)) : '') : '' });
      }
      const ch = {};
      ytd.forEach(r => { const k = r.channel || 'Not set'; (ch[k] = ch[k] || { l: k, v: 0, n: 0 }); ch[k].v += r.sold; ch[k].n++; });
      const chans = Object.keys(ch).map(k => ch[k]).sort((a, b) => b.v - a.v).map(x => ({ l: x.l, v: x.v, s: x.n + ' sold' }));
      const byType = tally(stock, 'type').map(x => ({ l: x.l, v: x.n, s: x.c ? money(x.c) + ' at cost' : '' }));
      const byMetal = tally(stock, 'metal').map(x => ({ l: x.l, v: x.n, s: x.c ? money(x.c) + ' at cost' : '' }));
      const noDate = sold.length - sold.filter(r => r.sdate).length;
      box.innerHTML =
        '<div class="iv-kpis dk-kpis">' + kp.map(k => '<div class="iv-kpi"><small>' + esc(k[0]) + '</small><b>' + esc(k[1]) + '</b></div>').join('') + '</div>' +
        '<div class="dk-grid">' +
          '<div class="card"><h3 class="dk-h3">Sales by month (CAD)</h3>' + bars(months, '$') + '</div>' +
          '<div class="card"><h3 class="dk-h3">Sales by channel, ' + y + ' (CAD)</h3>' + bars(chans, '$') + '</div>' +
          '<div class="card"><h3 class="dk-h3">In stock by item type</h3>' + bars(byType, 'pcs') + '</div>' +
          '<div class="card"><h3 class="dk-h3">In stock by metal</h3>' + bars(byMetal, 'pcs') + '</div>' +
        '</div>' +
        '<p class="iv-note">All amounts in CAD. * Counts only pieces that have both a landed cost and a price.' +
        (noDate ? ' ' + noDate + ' sold piece' + (noDate > 1 ? 's have' : ' has') + ' no Sold Date, so ' + (noDate > 1 ? 'they are' : 'it is') + ' not in the monthly figures.' : '') + '</p>';
    }

    /* ---------- Needs info ---------- */
    function renderNeed() {
      const box = $('dkNeed');
      if (!NEED.length) { box.innerHTML = '<p class="iv-note">Every piece in stock and in progress has its details filled in.</p>'; return; }
      const counts = CHECKS.map(c => [c[0], NEED.filter(x => x.miss.indexOf(c[0]) > -1).length]).filter(c => c[1]);
      if (needF && !counts.some(c => c[0] === needF)) needF = '';
      const list = NEED.filter(x => !needF || x.miss.indexOf(needF) > -1).sort((a, b) => b.r.i - a.r.i);
      box.innerHTML =
        '<p class="fm-hint">Pieces in stock or in progress with missing details. Fill these in so costs, margins and quotes are correct.</p>' +
        '<div class="chips fm-chips" id="dkNeedChips"><button type="button" class="chip sm' + (!needF ? ' on' : '') + '" data-f="">All (' + NEED.length + ')</button>' +
          counts.map(c => '<button type="button" class="chip sm' + (needF === c[0] ? ' on' : '') + '" data-f="' + esc(c[0]) + '">' + esc(c[0]) + ' (' + c[1] + ')</button>').join('') + '</div>' +
        '<div class="dk-tw"><table class="dk-t dk-need"><thead><tr><th></th><th>SKU</th><th>Design</th><th>Status</th><th>Missing</th><th></th></tr></thead><tbody>' +
        list.slice(0, 400).map(x => '<tr data-sku="' + esc(x.r.sku) + '"><td>' + thumb(x.r.photo) + '</td><td><b>' + esc(x.r.sku) + '</b></td><td class="dk-nm">' + esc(x.r.name) +
          '</td><td>' + (x.r.status ? '<span class="pill">' + esc(x.r.status) + '</span>' : '') + '</td><td class="dk-miss">' + x.miss.map(m => '<span class="dk-tag">' + esc(m) + '</span>').join('') +
          '</td><td class="n dk-fix"><button type="button" class="ghost sm" data-a="edit">Edit piece</button>' +
          (x.miss.some(m => /^Diamond/.test(m)) ? ' <button type="button" class="ghost sm" data-a="dia">Diamonds</button>' : '') + '</td></tr>').join('') +
        '</tbody></table></div>' + (list.length > 400 ? '<p class="iv-note">Showing the first 400.</p>' : '');
    }

    /* ---------- Export and print (follow the current tab, search and Client view) ---------- */
    function doCsv() {
      const d = data(); if (!d) return;
      const rows = filtered();
      const heads = (d.ph || []).filter(h => h && !(safe && COSTY.test(h)));
      const extra = ['Diamond groups', 'Total carats'].concat(safe ? [] : ['Diamond cost (INR)']);
      const cell = v => {
        v = v == null ? '' : String(v);
        if (/^[=+@\t\r]/.test(v)) v = "'" + v;                         // stops Excel treating text as a formula
        return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      };
      const lines = [heads.concat(extra).map(cell).join(',')].concat(rows.map(r => heads.map(h => get(r.p, h))
        .concat([r.dia.length, r.ct == null ? '' : r.ct])
        .concat(safe ? [] : [r.dia.length ? sum(r.dia, x => num(get(x, 'Cost (INR)'))) : ''])
        .map(cell).join(',')));
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'nix-' + (q ? 'search' : tab) + (safe ? '-client' : '') + '-' + ymd() + '.csv';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
    function doPrint() {
      const rows = filtered(), cs = cols();
      let pr = $('dkPrint');
      if (!pr) { pr = document.createElement('div'); pr.id = 'dkPrint'; document.body.appendChild(pr); }
      const label = q ? 'Search: ' + q : TABS.find(t => t[0] === tab)[1];
      pr.innerHTML = '<div class="dkp-h"><b>Nix Jewels</b><span>' + esc(label) + ' · ' + rows.length + ' pieces · ' +
        esc(new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })) + '</span></div>' +
        '<table><thead><tr>' + cs.map(c => '<th' + (isNum(c) ? ' class="n"' : '') + '>' + esc(c.t) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + cs.map(c => '<td' + (isNum(c) ? ' class="n"' : '') + '>' +
          (c.k === 'photo' ? (r.photo ? '<img alt="" src="https://drive.google.com/thumbnail?id=' + esc(r.photo) + '&sz=w120">' : '') :
           c.k === 'status' ? esc(r.status) : c.k === 'sku' ? esc(r.sku) : fmt(c, r[c.k])) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table>';
      const imgs = Array.prototype.slice.call(pr.querySelectorAll('img'));
      const ready = Promise.all(imgs.map(im => im.complete ? 0 : new Promise(ok => { im.onload = im.onerror = ok; })));
      Promise.race([ready, new Promise(ok => setTimeout(ok, 5000))]).then(() => {
        root.classList.add('dk-printing');
        window.print();
        setTimeout(() => root.classList.remove('dk-printing'), 500);
      });
    }
    window.addEventListener('afterprint', () => root.classList.remove('dk-printing'));

    /* ---------- Rendering and wiring ---------- */
    function renderViews() {
      Array.prototype.forEach.call($('dkViews').children, b => b.classList.toggle('on', b.dataset.w === view));
      $('dkTable').hidden = view !== 'table'; $('dkIns').hidden = view !== 'ins'; $('dkNeed').hidden = view !== 'need';
      $('dkNeedN').textContent = NEED.length ? '(' + NEED.length + ')' : '';
      $('dkSafe').checked = safe;
      if (view === 'table') renderTable(); else if (view === 'ins') renderIns(); else renderNeed();
    }
    function refresh() {
      if (!full()) { sec.hidden = true; root.classList.remove('dk-inv-on'); return; }
      prep(data());
      sec.hidden = false; root.classList.add('dk-inv-on');
      renderViews();
    }
    window.addEventListener('nix:data', refresh);
    window.addEventListener('nix:lock', () => { sec.hidden = true; root.classList.remove('dk-inv-on'); });

    $('dkViews').onclick = e => { const b = e.target.closest('button[data-w]'); if (b) { view = b.dataset.w; renderViews(); } };
    $('dkTabs').onclick = e => {
      const b = e.target.closest('button[data-t]'); if (!b) return;
      tab = b.dataset.t; keep.set('nixDkTab', tab); q = ''; $('dkQ').value = ''; limit = 200;
      if (sort.k === 'sdate' || sort.k === 'sold' || sort.k === 'ask' || sort.k === 'ship') sort = { k: '', dir: -1 };
      renderTable();
    };
    let qt = null;
    $('dkQ').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { q = $('dkQ').value.trim(); limit = 200; renderTable(); }, 120); });
    $('dkSafe').onchange = () => { safe = $('dkSafe').checked; keep.set('nixDkSafe', safe ? '1' : '0'); if (safe && /^(cost|mg)$/.test(sort.k)) sort = { k: '', dir: -1 }; renderTable(); };
    $('dkMore').onclick = () => { limit += 300; renderTable(); };
    $('dkCsv').onclick = doCsv;
    $('dkPrn').onclick = doPrint;
    $('dkNew').onclick = () => inv() && inv().newPiece();
    $('dkDia').onclick = () => inv() && inv().diamond();
    const openRow = tr => { if (tr && tr.dataset.sku && inv()) inv().open(tr.dataset.sku); };
    $('dkT').addEventListener('click', e => {
      const th = e.target.closest('th button[data-k]');
      if (th) {
        const k = th.dataset.k, c = COLS.find(x => x.k === k);
        sort = sort.k === k ? { k, dir: -sort.dir } : { k, dir: isNum(c) ? -1 : 1 };
        return renderTable();
      }
      openRow(e.target.closest('tbody tr'));
    });
    $('dkT').addEventListener('keydown', e => { if (e.key === 'Enter') openRow(e.target.closest('tbody tr')); });
    $('dkNeed').addEventListener('click', e => {
      const chip = e.target.closest('button[data-f]');
      if (chip) { needF = chip.dataset.f; return renderNeed(); }
      const tr = e.target.closest('tbody tr'); if (!tr || !inv()) return;
      const a = e.target.closest('button[data-a]');
      if (a && a.dataset.a === 'dia') inv().diamond(tr.dataset.sku);
      else if (a) inv().edit(tr.dataset.sku);
      else inv().open(tr.dataset.sku);
    });

    /* ---------- Keyboard shortcuts (ignored while typing or when the PIN screen is up) ---------- */
    const go = v => { const b = document.querySelector('.nv button[data-v="' + v + '"]'); if (b && !b.classList.contains('on')) b.click(); };
    document.addEventListener('keydown', e => {
      if (!MQ.matches || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target, typing = /^(TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || (t.tagName === 'INPUT' && !/^(checkbox|radio|button|submit)$/.test(t.type));
      if (typing) { if (e.key === 'Escape' && t.id === 'dkQ') { t.value = ''; q = ''; renderTable(); t.blur(); } return; }
      const lock = $('lock'); if (lock && !lock.hidden && lock.getClientRects().length) return;
      if (e.key === 'Escape' && det && !det.hidden) { e.preventDefault(); history.back(); return; }
      if (det && !det.hidden) return;
      const k = e.key.toLowerCase();
      if (k === '/') { e.preventDefault(); go('inv'); if (!sec.hidden) { view = 'table'; renderViews(); $('dkQ').focus(); setTimeout(() => $('dkQ').focus(), 60); } }
      else if (k === 'c') go('calc');
      else if (k === 'i') go('inv');
      else if (k === 'n' && full() && inv()) { go('inv'); inv().newPiece(); }
    });

    refresh();   // in case the inventory was already open when the window became wide
  }
})();
