/* Nix app: production cost estimator (desktop only: screens 1100px and wider; phones never run it).
   Uses the live prices the calculator saves (calc.js), your costs and past pieces (inventory.js through window.NixInv),
   and the Estimate Settings, Diamond Rates and Quotes tabs in the tracker (Backend.gs).
   The estimate being worked on is kept in this browser as a draft, so a reload never loses it. */
(function () {
  'use strict';
  const MQ = window.matchMedia('(min-width: 1100px)');
  let started = false;
  const boot = () => { if (!started && MQ.matches) { started = true; start(); } };
  if (MQ.addEventListener) MQ.addEventListener('change', boot); else if (MQ.addListener) MQ.addListener(boot);
  boot();

  function start() {
    const $ = id => document.getElementById(id);
    const OZ = 31.1034768;
    const keep = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
                   set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
                   del: k => { try { localStorage.removeItem(k); } catch (e) {} } };
    const sess = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
                   set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} } };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const get = (o, name) => { const k = Object.keys(o || {}).find(x => x.toLowerCase() === name.toLowerCase()); return k ? o[k] : ''; };
    const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : null; };
    const r2 = v => v == null ? '' : Math.round(v * 100) / 100;
    const fI = v => v == null || !isFinite(v) ? '–' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);
    const fC = (v, d) => v == null || !isFinite(v) ? '–' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }).format(v);
    const fU = v => v == null || !isFinite(v) ? '–' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
    const ymd = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const inv = () => window.NixInv || null;
    const data = () => { const i = inv(); return i ? i.data() : null; };
    const full = () => { const d = data(); return !!(d && d.role === 'full' && d.pieces); };
    const lists = () => (data() && data().lists) || {};
    const estData = () => (data() && data().est) || { ready: false };

    /* ---------- Metals: purity and standard densities (g/cm³), used for CAD volume and metal conversion ---------- */
    const DENS = { 9: { Y: 11.3, W: 11.2, R: 11.3 }, 10: { Y: 11.6, W: 11.1, R: 11.5 }, 14: { Y: 13.1, W: 12.6, R: 13.0 },
                   18: { Y: 15.6, W: 14.7, R: 15.1 }, 22: { Y: 17.8, W: 17.8, R: 17.8 }, 24: { Y: 19.32, W: 19.32, R: 19.32 } };
    function metalInfo(m) {
      const s = String(m || '');
      if (/plat|pt\s*950|\b950\b/i.test(s)) return { kind: 'pt', purity: 0.95, dens: 20.1, label: 'platinum 950' };
      if (/silver|925|92\.5/i.test(s)) return { kind: 'ag', purity: 0.925, dens: 10.36, label: 'silver 925' };
      const k = s.match(/(\d{1,2})\s*K/i);
      if (!k) return null;
      const K = +k[1], col = /white/i.test(s) ? 'W' : /rose|pink|red/i.test(s) ? 'R' : 'Y';
      const near = Object.keys(DENS).map(Number).reduce((a, b) => Math.abs(b - K) < Math.abs(a - K) ? b : a);
      return { kind: 'au', K: K, purity: K / 24, dens: DENS[near][col], label: K + 'K' };
    }

    /* ---------- Settings (from the Estimate Settings tab, with the calculator's in-house defaults) ---------- */
    const SET = { goldSrc: 'Gold price', prem: 'Dealer premium on spot (%)', house14: 'In-house 14K gold rate (INR per g)',
      housePt: 'In-house platinum 950 rate (INR per g)', houseAg: 'In-house silver 925 rate (INR per g)', lab: 'Labour (INR)', labUnit: 'Labour unit',
      other: 'Other costs per piece (INR)', cert: 'Certificate per piece (INR)', hall: 'Hallmark per piece (INR)', ship: 'Shipping per piece (INR)',
      duty: 'Duty / taxes (% of cost)', brok: 'Brokerage per piece (CAD)', p1: 'Profit from (%)', p2: 'Profit to (%)', valid: 'Quote valid for (days)' };
    const DEF = { goldSrc: 'Market', prem: '7', house14: '10000', housePt: '', houseAg: '', lab: '1000', labUnit: 'per gram', other: '3500',
      cert: '0', hall: '0', ship: '', duty: '', brok: '0', p1: '23', p2: '30', valid: '7' };
    function hist() {
      const d = data(); const h = { ship: null, shipN: 0, duty: null, dutyN: 0 };
      if (!d || !d.pieces) return h;
      let s = 0, sn = 0, du = 0, base = 0, dn = 0;
      d.pieces.forEach(p => {
        const sh = num(get(p, 'Shipping Allocated (INR)')), dt = num(get(p, 'Duty / Taxes Allocated (INR)')), tc = num(get(p, 'Total Cost (INR)'));
        if (sh > 0) { s += sh; sn++; }
        if (dt > 0 && tc > 0) { du += dt; base += tc; dn++; }
      });
      if (sn) { h.ship = s / sn; h.shipN = sn; }
      if (dn) { h.duty = du / base * 100; h.dutyN = dn; }
      return h;
    }
    function defaults() {
      const s = estData().settings || {}, c = {}, h = hist();
      Object.keys(SET).forEach(k => { const v = s[SET[k]]; c[k] = v != null && String(v).trim() !== '' ? String(v).replace(/%$/, '').trim() : DEF[k]; });
      c.goldSrc = /house/i.test(c.goldSrc) ? 'In-house' : 'Market';
      c.labUnit = /piece/i.test(c.labUnit) ? 'per piece' : 'per gram';
      if (c.ship === '') c.ship = h.ship != null ? String(Math.round(h.ship)) : '0';
      if (c.duty === '') c.duty = h.duty != null ? String(Math.round(h.duty * 10) / 10) : '0';
      c.rate = ''; c.mrate = '';      // blank = today's live rate
      return c;
    }

    /* ---------- Live prices ---------- */
    let metals = {};
    try { metals = JSON.parse(keep.get('nix_est_metals') || '{}') || {}; } catch (e) {}
    function calcSaved() { try { return JSON.parse(keep.get('nix_calc_v2') || 'null') || {}; } catch (e) { return {}; } }
    function fx() {
      const s = calcSaved();
      if (s.fx && s.fx.CAD > 0 && s.fx.INR > 0) return { inrCad: s.fx.CAD / s.fx.INR, usdInr: s.fx.INR, usdCad: s.fx.CAD, src: 'calculator rates dated ' + s.fx.date };
      const l = lists().liveRate;
      if (l && l.rate > 0) return { inrCad: l.rate, usdInr: null, usdCad: null, src: 'Google rate on ' + l.date };
      return null;
    }
    function spot(kind) {
      if (kind === 'au') { const g = calcSaved().gold; return g && g.usdoz > 0 ? { usd: g.usdoz, ts: g.ts, src: g.src } : null; }
      const m = metals[kind === 'pt' ? 'XPT' : 'XAG'];
      return m && m.usd > 0 ? { usd: m.usd, ts: m.ts, src: 'Gold-API.com' } : null;
    }
    let lastFetch = 0;
    function fetchMetals(force) {
      if (!force && Date.now() - lastFetch < 5 * 60000) return;
      lastFetch = Date.now();
      [['XPT', 200, 10000], ['XAG', 3, 500]].forEach(([sym, lo, hi]) => {
        fetch('https://api.gold-api.com/price/' + sym, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => {
          if (d && d.price > lo && d.price < hi) { metals[sym] = { usd: d.price, ts: Date.now() }; keep.set('nix_est_metals', JSON.stringify(metals)); if (!view.hidden) paint(); }
        }).catch(() => {});
      });
    }
    // Rate per gram of the chosen metal in INR, and where it came from
    function metalRate(mi, c) {
      if (!mi) return { rate: null, src: 'Choose the metal.' };
      const own = num(c.mrate);
      if (own > 0) return { rate: own, src: 'your rate for this estimate' };
      if (c.goldSrc === 'In-house') {
        if (mi.kind === 'au' && num(c.house14) > 0) return { rate: num(c.house14) * mi.K / 14, src: 'in-house 14K rate ' + fI(num(c.house14)) + '/g' + (mi.K !== 14 ? ' × ' + mi.K + '/14' : '') };
        if (mi.kind === 'pt' && num(c.housePt) > 0) return { rate: num(c.housePt), src: 'in-house platinum rate' };
        if (mi.kind === 'ag' && num(c.houseAg) > 0) return { rate: num(c.houseAg), src: 'in-house silver rate' };
      }
      const sp = spot(mi.kind), f = fx();
      if (!sp) return { rate: null, src: mi.kind === 'au' ? 'Waiting for the live gold price (open the Calculator once).' : 'Waiting for the live ' + mi.label + ' price.' };
      if (!f || !f.usdInr) return { rate: null, src: 'Waiting for the exchange rates (open the Calculator once).' };
      const prem = num(c.prem) || 0;
      const age = sp.ts ? Math.round((Date.now() - sp.ts) / 60000) : null;
      return { rate: sp.usd / OZ * (1 + prem / 100) * mi.purity * f.usdInr,
               src: 'market: ' + fU(sp.usd) + '/oz' + (prem ? ' + ' + prem + '%' : '') + ' × ' + (mi.kind === 'au' ? mi.K + '/24' : mi.purity) + (age != null && age > 120 ? ' (price is ' + Math.round(age / 60) + ' h old)' : '') };
    }

    /* ---------- Diamond rates ---------- */
    const ntype = t => /lab/i.test(t) ? 'lab' : /nat/i.test(t) ? 'nat' : '';
    const nq = q => String(q || '').toLowerCase().replace(/\s+/g, '').replace(/[–—]/g, '-');
    function diaRate(g) {
      const count = num(g.count) || 0, ct = num(g.ct) || 0;
      if (!(ct > 0)) return null;
      const per = count > 0 ? ct / count : ct;
      let best = null;
      (estData().rates || []).forEach(r => {
        if (r.type && ntype(r.type) !== ntype(g.type)) return;
        let s = 0;
        if (!r.shape || /^(all|any)$/i.test(r.shape)) s = 0;
        else if (/^fancy$/i.test(r.shape)) { if (/^round$/i.test(g.shape || '')) return; s = 2; }
        else if (r.shape.toLowerCase() === String(g.shape || '').toLowerCase()) s = 4;
        else return;
        if (per < r.from - 1e-9 || per > r.to + 1e-9) return;
        if (!r.quality || /^any$/i.test(r.quality)) s += 0;
        else if (nq(r.quality) === nq(g.quality)) s += 1;
        else return;
        const width = r.to - r.from;
        if (!best || s > best.s || (s === best.s && width < best.w)) best = { s: s, w: width, r: r };
      });
      return best ? { rate: best.r.rate, per: per, row: best.r } : { rate: null, per: per };
    }

    /* ---------- The estimate ---------- */
    const WM = { cad: 'CAD file', sim: 'Similar pieces', man: 'Typed' };
    function blank() {
      return { no: '', status: 'Draft', client: '', name: '', type: '', metal: '', size: '', notes: '', sku: '',
               wm: 'cad', cadMode: 'vol', cadVal: '', cadMetal: '', dens: '', simPick: '', weight: '',
               dia: [], c: defaults(), price: '', saved: null };
    }
    let est = null, dirty = false;
    try { const d = JSON.parse(keep.get('nix_est_draft') || 'null'); if (d && d.c) { est = d.est; dirty = !!d.dirty; } } catch (e) {}
    let draftT = null;
    const saveDraft = () => { clearTimeout(draftT); draftT = setTimeout(() => keep.set('nix_est_draft', JSON.stringify({ c: 1, est: est, dirty: dirty })), 250); };

    function similar() {
      const d = data(); if (!d || !d.pieces || !est.type) return { rows: [], med: null };
      const tgt = metalInfo(est.metal);
      const cg = est.dia.find(g => /^center/i.test(g.role));
      const cct = cg ? num(cg.ct) : null, sz = num(est.size);
      const rows = [];
      d.pieces.forEach(p => {
        const w = num(get(p, 'Gold Weight (g)'));
        if (!(w > 0) || String(get(p, 'Item Type')).toLowerCase() !== est.type.toLowerCase()) return;
        const mi = metalInfo(get(p, 'Metal'));
        const conv = mi && tgt ? w * tgt.dens / mi.dens : w;
        const dl = (d.diamonds && d.diamonds[p._sku]) || [];
        const c0 = dl.find(x => /^center$/i.test(get(x, 'Diamond Role')));
        const pc = c0 ? num(get(c0, 'Total Carat Weight')) : null, ps = num(get(p, 'Size'));
        let score = 0;
        if (cct > 0) { if (pc > 0) { const diff = Math.abs(pc - cct) / cct; if (diff > 0.5) return; score += diff * 3; } else score += 1.5; }
        if (sz != null && ps != null) score += Math.min(Math.abs(ps - sz), 4) * 0.15;
        rows.push({ sku: p._sku, name: get(p, 'Design / Name'), metal: get(p, 'Metal'), w: w, conv: conv, cct: pc, size: get(p, 'Size'), score: score });
      });
      rows.sort((a, b) => a.score - b.score);
      const top = rows.slice(0, 10), use = top.slice(0, 5).map(r => r.conv).sort((a, b) => a - b);
      const med = use.length ? (use.length % 2 ? use[(use.length - 1) / 2] : (use[use.length / 2 - 1] + use[use.length / 2]) / 2) : null;
      return { rows: top, med: med, n: use.length };
    }
    function weight() {
      const tgt = metalInfo(est.metal);
      if (est.wm === 'man') return { w: num(est.weight), src: 'typed' };
      if (est.wm === 'cad') {
        const v = num(est.cadVal); if (!(v > 0)) return { w: null, src: 'Enter the CAD ' + (est.cadMode === 'vol' ? 'volume' : 'weight') + '.' };
        if (!tgt) return { w: null, src: 'Choose the metal.' };
        const dT = num(est.dens) || tgt.dens;
        if (est.cadMode === 'vol') return { w: v / 1000 * dT, src: v + ' mm³ × ' + dT + ' g/cm³' };
        const src = metalInfo(est.cadMetal || est.metal);
        if (!src) return { w: null, src: 'Choose the metal the CAD weight is in.' };
        return { w: v * dT / src.dens, src: v + ' g in ' + src.label + (src.dens !== dT ? ' × ' + dT + ' / ' + src.dens : '') };
      }
      const s = similar();
      if (est.simPick) { const r = s.rows.find(x => x.sku === est.simPick); if (r) return { w: r.conv, src: 'like ' + r.sku }; }
      return s.med != null ? { w: s.med, src: 'typical of ' + s.n + ' similar piece' + (s.n > 1 ? 's' : '') } : { w: null, src: est.type ? 'No past ' + est.type.toLowerCase() + ' with a gold weight yet.' : 'Choose the item type.' };
    }
    function compute() {
      const c = est.c, mi = metalInfo(est.metal), W = weight(), w = W.w;
      const mr = metalRate(mi, c), f = fx();
      const rate = num(c.rate) > 0 ? num(c.rate) : f ? f.inrCad : null;
      const gold = w > 0 && mr.rate ? w * mr.rate : null;
      const lab = c.labUnit === 'per piece' ? (num(c.lab) || 0) : (w > 0 ? w * (num(c.lab) || 0) : 0);
      const other = num(c.other) || 0, ch = (num(c.cert) || 0) + (num(c.hall) || 0);
      const groups = est.dia.map(g => {
        const R = diaRate(g), own = num(g.override);
        const cost = own != null && own >= 0 && String(g.override).trim() !== '' ? own : R && R.rate != null ? R.rate * (num(g.ct) || 0) : null;
        return { R: R, cost: cost, own: own != null && String(g.override).trim() !== '' };
      });
      const dia = groups.reduce((s, x) => s + (x.cost || 0), 0);
      const missing = est.dia.filter((g, i) => (num(g.ct) || 0) > 0 && groups[i].cost == null).length;
      const prod = gold != null ? gold + lab + other + dia + ch : null;
      const ship = num(c.ship) || 0, dutyP = num(c.duty) || 0;
      const duty = prod != null ? prod * dutyP / 100 : null;
      const total = prod != null ? prod + ship + duty : null;
      const brok = num(c.brok) || 0;
      const landed = total != null && rate ? total * rate + brok : null;
      const p1 = num(c.p1), p2 = num(c.p2);
      const s1 = landed != null && p1 != null ? landed * (1 + p1 / 100) : null, s2 = landed != null && p2 != null ? landed * (1 + p2 / 100) : s1;
      const suggest = s2 != null ? Math.ceil(s2 / 10) * 10 : null;
      const price = num(est.price) > 0 ? num(est.price) : suggest;
      const warn = [];
      if (!est.type) warn.push('Choose the item type.');
      if (!mi) warn.push('Choose the metal.');
      if (!(w > 0)) warn.push('Gold weight: ' + W.src);
      if (!mr.rate && mi) warn.push(mr.src);
      if (!rate) warn.push('No INR to CAD rate yet: open the Calculator once, or type the rate under Costs.');
      if (missing) warn.push(missing + ' diamond group' + (missing > 1 ? 's have' : ' has') + ' no matching rate on the Diamond Rates tab. Type the cost, or add a rate.');
      return { mi, W, w, mr, rate, f, gold, lab, other, ch, groups, dia, prod, ship, dutyP, duty, total, brok, landed, p1, p2, s1, s2, suggest, price,
               markup: landed && price ? (price / landed - 1) * 100 : null, margin: landed && price ? (1 - landed / price) * 100 : null, warn };
    }

    /* ---------- Screen ---------- */
    const view = document.createElement('main');
    view.id = 'viewEst'; view.className = 'dk es'; view.hidden = true;
    $('viewInv').insertAdjacentElement('afterend', view);
    const nav = document.querySelector('.nv');
    const navBtn = document.createElement('button');
    navBtn.type = 'button'; navBtn.dataset.v = 'est'; navBtn.className = 'dk';
    navBtn.innerHTML = '<span>⚖️</span>Estimator';
    if (nav) nav.insertBefore(navBtn, nav.querySelector('.dk-keys'));
    let wasOpen = sess.get('nix_est_open') === '1', booted = false, tab = 'edit';

    function show() {
      if (!MQ.matches) return;
      $('viewCalc').hidden = true; $('viewInv').hidden = true; view.hidden = false;
      document.querySelectorAll('.nv button').forEach(b => { const on = b === navBtn; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
      if (window.NixApp) { NixApp.view = 'est'; NixApp.emit('view', 'est'); }
      sess.set('nix_est_open', '1');
      window.scrollTo(0, 0);
      fetchMetals();
      render();
    }
    navBtn.onclick = show;
    if (window.NixApp) {
      NixApp.on('view', v => { if (v !== 'est') { view.hidden = true; navBtn.classList.remove('on'); navBtn.removeAttribute('aria-current'); if (booted) sess.set('nix_est_open', '0'); } });
      NixApp.on('unlock', () => { booted = true; if (wasOpen) setTimeout(show, 0); });
    }
    if (MQ.addEventListener) MQ.addEventListener('change', () => { if (!MQ.matches && !view.hidden) { const b = document.querySelector('.nv button[data-v="calc"]'); if (b) b.click(); } });
    window.addEventListener('nix:data', () => { if (!view.hidden) render(); });
    window.addEventListener('nix:lock', () => { if (!view.hidden) render(); });
    document.addEventListener('keydown', e => {
      if (!MQ.matches || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'e') return;
      const t = e.target;
      if (/^(TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || (t.tagName === 'INPUT' && !/^(checkbox|radio|button|submit)$/.test(t.type))) return;
      const det = $('ivDet'); if (det && !det.hidden) return;
      show();
    });
    setInterval(() => { if (!view.hidden && !document.hidden) { fetchMetals(); paint(); } }, 60000);

    let built = false;
    function render() {
      if (!full()) {
        built = false;
        view.innerHTML = '<div class="es-wrap"><div class="card es-locked"><h2>Cost estimator</h2><p class="sub">The estimator uses your costs, diamond rates and past pieces, so it opens with your inventory access code.</p>' +
          '<button type="button" class="btn" id="esGoInv">Unlock Inventory</button></div></div>';
        $('esGoInv').onclick = () => { const b = document.querySelector('.nv button[data-v="inv"]'); if (b) b.click(); };
        return;
      }
      if (!est) { est = blank(); dirty = false; }
      if (!built) build(); else { renderList(); paint(); }
    }

    const opt = (arr, cur, ph) => (ph != null ? '<option value="">' + esc(ph) + '</option>' : '') +
      arr.concat(cur && arr.indexOf(cur) < 0 ? [cur] : []).map(v => '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
    const fld = (label, inner, help, id) => '<div class="fm-f"' + (id ? ' id="' + id + '"' : '') + '><label>' + esc(label) + '</label>' + inner + (help != null ? '<div class="fm-help">' + help + '</div>' : '') + '</div>';
    const inp = (k, v, unit, ph, attr) => '<div class="in"><input ' + k + ' value="' + esc(v) + '" inputmode="decimal" autocomplete="off"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + (attr || '') + '>' + (unit ? '<span>' + unit + '</span>' : '') + '</div>';
    const txt = (k, v, ph) => '<input ' + k + ' value="' + esc(v) + '" autocomplete="off"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>';

    function build() {
      built = true;
      const L = lists(), c = est.c, ed = estData();
      const metalsList = (L.metal || []).filter(m => metalInfo(m));
      view.innerHTML =
        '<div class="es-wrap">' +
        '<div class="es-top"><div><h2 class="es-h1">Cost estimator</h2><div class="sub" id="esWho"></div></div>' +
          '<div class="seg es-tabs" id="esTabs"><button type="button" data-t="edit">Estimate</button><button type="button" data-t="list">Saved quotes <span id="esQn"></span></button></div>' +
          '<button type="button" class="ghost sm" id="esNew">New estimate</button></div>' +
        (ed.ready ? '' : '<div class="note">The Estimate Settings, Diamond Rates and Quotes tabs are not in your tracker yet. In the tracker, run <b>Nix Admin › Set up the cost estimator</b>, then press Refresh on Inventory. Until then the calculator\'s in-house defaults are used and quotes cannot be saved.</div>') +
        '<div id="esEdit" class="es-grid"><div class="es-left">' +
          '<section class="card"><h3 class="dk-h3">1 · Design</h3><div class="fm two">' +
            fld('Client', txt('data-k="client"', est.client, 'Name, phone or order')) +
            fld('Design / Name', txt('data-k="name"', est.name, 'e.g. Oval halo engagement ring')) +
            fld('Item type *', '<select data-k="type">' + opt(L.itemType || [], est.type, 'Choose…') + '</select>') +
            fld('Metal *', '<select data-k="metal">' + opt(metalsList, est.metal, 'Choose…') + '</select>') +
            fld('Size', txt('data-k="size"', est.size, 'Ring size, length…')) +
            fld('Quote status', '<select data-k="status" id="esStatus">' + opt(['Draft', 'Sent', 'Won', 'Lost'], est.status === 'Converted' ? 'Draft' : est.status) + '</select>') +
          '</div></section>' +
          '<section class="card"><h3 class="dk-h3">2 · Gold weight</h3>' +
            '<div class="seg" id="esWm"><button type="button" data-w="cad">From the CAD file</button><button type="button" data-w="sim">Like past pieces</button><button type="button" data-w="man">I know the weight</button></div>' +
            '<div id="esWcad"><div class="fm two">' +
              fld('The CAD file gives', '<select data-k="cadMode"><option value="vol"' + (est.cadMode === 'vol' ? ' selected' : '') + '>Volume (mm³)</option><option value="wt"' + (est.cadMode === 'wt' ? ' selected' : '') + '>Weight (g)</option></select>') +
              fld('Value', inp('data-k="cadVal"', est.cadVal, '<i id="esCadU"></i>', 'from Matrix, Rhino…')) +
              fld('CAD weight is in', '<select data-k="cadMetal">' + opt(metalsList, est.cadMetal, 'Same metal') + '</select>', null, 'esCadMetal') +
              fld('Density (g/cm³)', inp('data-k="dens"', est.dens, '', ''), '<span id="esDensH"></span>') +
            '</div></div>' +
            '<div id="esWsim"><p class="fm-help">Past pieces of the same item type, closest centre stone and size first. Weights are converted to the metal you chose. The typical weight uses the 5 closest; click a piece to use its weight instead.' +
              ' Working from a photo? Pick the closest piece, or upload the photo to the Nix Jewels project in Claude for a second opinion.</p><div id="esSim"></div></div>' +
            '<div id="esWman"><div class="fm two">' + fld('Gold weight (g)', inp('data-k="weight"', est.weight, 'g', 'Factory or your own estimate')) + '</div></div>' +
            '<div class="es-wout" id="esWout"></div>' +
          '</section>' +
          '<section class="card"><h3 class="dk-h3">3 · Diamonds</h3><div class="dk-tw es-dtw"><table class="dk-t es-dt" id="esDt"></table></div>' +
            '<div class="es-drow"><button type="button" class="ghost sm" id="esAddD">+ Add diamond group</button><span class="fm-help" id="esDhelp"></span></div></section>' +
          '<section class="card"><h3 class="dk-h3">4 · Costs <button type="button" class="iv-link" id="esReset">Reset to my defaults</button></h3><div class="fm es-c3">' +
            fld('Gold price', '<select data-c="goldSrc">' + opt(['Market', 'In-house'], c.goldSrc) + '</select>') +
            fld('Dealer premium on spot', inp('data-c="prem"', c.prem, '%')) +
            fld('In-house 14K gold rate', inp('data-c="house14"', c.house14, '₹/g')) +
            fld('Metal rate for this estimate', inp('data-c="mrate"', c.mrate, '₹/g', 'today'), '<span id="esMrH"></span>') +
            fld('Labour', '<div class="es-pair">' + inp('data-c="lab"', c.lab, '₹') + '<select data-c="labUnit">' + opt(['per gram', 'per piece'], c.labUnit) + '</select></div>') +
            fld('Other costs per piece', inp('data-c="other"', c.other, '₹')) +
            fld('Certificate', inp('data-c="cert"', c.cert, '₹')) +
            fld('Hallmark', inp('data-c="hall"', c.hall, '₹')) +
            fld('Shipping per piece', inp('data-c="ship"', c.ship, '₹'), '<span id="esShipH"></span>') +
            fld('Duty / taxes', inp('data-c="duty"', c.duty, '% of cost'), '<span id="esDutyH"></span>') +
            fld('Brokerage per piece', inp('data-c="brok"', c.brok, 'CAD')) +
            fld('Exchange rate (1 INR in CAD)', inp('data-c="rate"', c.rate, '', 'today'), '<span id="esRateH"></span>') +
            fld('Profit from', inp('data-c="p1"', c.p1, '%')) +
            fld('Profit to', inp('data-c="p2"', c.p2, '%')) +
          '</div><p class="fm-help">Profit is a markup on the landed cost, the same as the calculator\'s in-house mode. Your defaults come from the Estimate Settings tab.</p></section>' +
          '<section class="card"><h3 class="dk-h3">Notes</h3><textarea class="fm-ta" data-k="notes" rows="3" placeholder="Internal notes (not printed on the client quote)">' + esc(est.notes) + '</textarea></section>' +
        '</div>' +
        '<aside class="es-right">' +
          '<div class="result es-res"><div class="l">Landed cost in Canada (CAD)</div><div class="big" id="esLanded">–</div><div class="gl"></div><div class="a" id="esAlt"></div><div id="esBrk"></div><div class="sell" id="esSell"></div></div>' +
          '<div class="card es-q">' +
            fld('Price to quote (CAD)', inp('data-k="price" id="esPrice"', est.price, 'CAD'), '<span id="esMg"></span>') +
            '<div id="esWarn"></div>' +
            '<div class="es-btns"><button type="button" class="btn" id="esSave">Save quote</button><button type="button" class="ghost" id="esCopy">Save as a new quote</button>' +
            '<button type="button" class="ghost" id="esPrC">Print for client</button><button type="button" class="ghost" id="esPrI">Print cost sheet</button></div>' +
            '<div id="esMsg"></div>' +
            '<div class="es-conv" id="esConv"></div>' +
          '</div>' +
        '</aside></div>' +
        '<div id="esList" hidden></div>' +
        '<datalist id="esQual"></datalist>' +
        '</div>';

      view.addEventListener('input', onInput);
      view.addEventListener('change', onInput);
      $('esTabs').onclick = e => { const b = e.target.closest('button[data-t]'); if (b) { tab = b.dataset.t; paintTabs(); } };
      $('esWm').onclick = e => { const b = e.target.closest('button[data-w]'); if (!b) return; if (est.wm === 'sim' && b.dataset.w === 'man' && !est.weight) { const w = weight().w; if (w) est.weight = String(r2(w)); view.querySelector('[data-k="weight"]').value = est.weight; } est.wm = b.dataset.w; changed(); };
      $('esAddD').onclick = () => {
        const used = est.dia.map(g => g.role), all = L.role || ['Center', 'Side'];
        const pref = ['Center', 'Side', 'Halo', 'Accent', 'Pave', 'Side 2', 'Center 2'];
        const roles = pref.filter(r => all.indexOf(r) > -1).concat(all.filter(r => pref.indexOf(r) < 0));
        const last = est.dia[est.dia.length - 1];
        est.dia.push({ role: roles.find(r => used.indexOf(r) < 0) || '', type: last ? last.type : (keep.get('nix_est_type') || 'Lab-grown'), shape: est.dia.length ? 'Round' : '', count: est.dia.length ? '' : '1', ct: '', quality: '', override: '' });
        buildDia(); changed();
        const rows = $('esDt').querySelectorAll('tbody tr'); const f = rows[rows.length - 1] && rows[rows.length - 1].querySelector('select'); if (f) f.focus();
      };
      $('esDt').addEventListener('click', e => { const b = e.target.closest('button[data-rm]'); if (b) { est.dia.splice(+b.dataset.rm, 1); buildDia(); changed(); } });
      $('esReset').onclick = () => { est.c = defaults(); fillCosts(); changed(); msg('Costs reset to your defaults from the Estimate Settings tab.', true); };
      $('esNew').onclick = () => {
        if (dirty && !armNew) { armNew = true; $('esNew').textContent = 'Click again: unsaved changes will be lost'; $('esNew').classList.add('es-armed'); setTimeout(() => { armNew = false; const b = $('esNew'); if (b) { b.textContent = 'New estimate'; b.classList.remove('es-armed'); } }, 5000); return; }
        armNew = false; est = blank(); dirty = false; saveDraft(); built = false; tab = 'edit'; render();
      };
      $('esSave').onclick = () => saveQuote(false);
      $('esCopy').onclick = () => saveQuote(true);
      $('esPrC').onclick = () => doPrint(true);
      $('esPrI').onclick = () => doPrint(false);
      $('esSim').addEventListener('click', e => { const tr = e.target.closest('tr[data-sku]'); if (tr) { est.simPick = est.simPick === tr.dataset.sku ? '' : tr.dataset.sku; changed(); } });
      $('esList').addEventListener('click', onListClick);
      $('esList').addEventListener('input', e => { if (e.target.id === 'esLq') renderList(); });
      buildDia(); renderList(); paintTabs(); paint();
    }
    let armNew = false;

    function fillCosts() { view.querySelectorAll('[data-c]').forEach(el => { el.value = est.c[el.dataset.c] == null ? '' : est.c[el.dataset.c]; }); }
    function onInput(e) {
      const t = e.target;
      if (t.id === 'esLq') return;
      if (t.dataset.k) { est[t.dataset.k] = t.value; if (t.dataset.k === 'type' || t.dataset.k === 'metal') est.simPick = ''; }
      else if (t.dataset.c) est.c[t.dataset.c] = t.value;
      else if (t.dataset.d) { const g = est.dia[+t.dataset.i]; if (!g) return; g[t.dataset.d] = t.value; if (t.dataset.d === 'type') keep.set('nix_est_type', t.value); }
      else return;
      changed();
    }
    function changed() { dirty = true; saveDraft(); paint(); }

    function buildDia() {
      const L = lists(), types = ['Lab-grown', 'Natural'];
      $('esDt').innerHTML = '<thead><tr><th>Role</th><th>Type</th><th>Shape</th><th class="n">Stones</th><th class="n">Total ct</th><th>Quality</th><th class="n">Cost (₹)</th><th></th></tr></thead><tbody>' +
        est.dia.map((g, i) => '<tr>' +
          '<td><select data-d="role" data-i="' + i + '">' + opt(L.role || [], g.role, 'Role') + '</select></td>' +
          '<td><select data-d="type" data-i="' + i + '">' + opt(types, g.type) + '</select></td>' +
          '<td><select data-d="shape" data-i="' + i + '">' + opt((L.shape || []).filter(s => !/none/i.test(s)), g.shape, 'Shape') + '</select></td>' +
          '<td class="n"><input data-d="count" data-i="' + i + '" value="' + esc(g.count) + '" inputmode="numeric" class="es-sm"></td>' +
          '<td class="n"><input data-d="ct" data-i="' + i + '" value="' + esc(g.ct) + '" inputmode="decimal" class="es-sm"><div class="fm-help" id="esPer' + i + '"></div></td>' +
          '<td><input data-d="quality" data-i="' + i + '" value="' + esc(g.quality) + '" list="esQual" placeholder="e.g. F-G VS" class="es-md"></td>' +
          '<td class="n"><input data-d="override" data-i="' + i + '" value="' + esc(g.override) + '" inputmode="decimal" class="es-md" id="esOv' + i + '"><div class="fm-help" id="esRt' + i + '"></div></td>' +
          '<td><button type="button" class="iv-link" data-rm="' + i + '" aria-label="Remove this group">✕</button></td></tr>').join('') +
        (est.dia.length ? '' : '<tr><td colspan="8" class="dk-empty">No diamonds. A plain metal piece needs none; otherwise add a group for the centre stone, sides, halo and so on.</td></tr>') +
        '</tbody>' + (est.dia.length ? '<tfoot><tr><td colspan="4">Total</td><td class="n" id="esDct"></td><td></td><td class="n" id="esDcost"></td><td></td></tr></tfoot>' : '');
      const qs = {}; (estData().rates || []).forEach(r => { if (r.quality && !/^any$/i.test(r.quality)) qs[r.quality] = 1; });
      $('esQual').innerHTML = Object.keys(qs).map(q => '<option value="' + esc(q) + '">').join('');
    }

    function paintTabs() {
      Array.prototype.forEach.call($('esTabs').children, b => b.classList.toggle('on', b.dataset.t === tab));
      $('esEdit').hidden = tab !== 'edit'; $('esList').hidden = tab !== 'list';
      if (tab === 'list') { renderList(); const q = $('esLq'); if (q) q.focus(); }
    }

    function paint() {
      if (!built || !est) return;
      const R = compute(), c = est.c, h = hist();
      $('esWho').textContent = (est.no ? 'Quote ' + est.no + (est.sku ? ' · made into ' + est.sku : '') : 'New estimate') + (dirty ? ' · unsaved changes (kept as a draft in this browser)' : est.no ? ' · saved' : '');
      // weight method
      Array.prototype.forEach.call($('esWm').children, b => b.classList.toggle('on', b.dataset.w === est.wm));
      $('esWcad').hidden = est.wm !== 'cad'; $('esWsim').hidden = est.wm !== 'sim'; $('esWman').hidden = est.wm !== 'man';
      $('esCadU').textContent = est.cadMode === 'vol' ? 'mm³' : 'g';
      $('esCadMetal').hidden = est.cadMode !== 'wt';
      const tgt = R.mi;
      $('esDensH').textContent = tgt ? 'Standard for ' + est.metal + ': ' + tgt.dens + '. Change only if your caster uses another figure.' : '';
      view.querySelector('[data-k="dens"]').placeholder = tgt ? String(tgt.dens) : '';
      if (est.wm === 'sim') {
        const S = similar();
        $('esSim').innerHTML = !S.rows.length ? '<p class="iv-note">' + esc(est.type ? 'No past ' + est.type.toLowerCase() + ' has a gold weight yet. Use the CAD file or type the weight.' : 'Choose the item type first.') + '</p>' :
          '<div class="dk-tw"><table class="dk-t es-st"><thead><tr><th>SKU</th><th>Design</th><th>Metal</th><th class="n">Its weight</th><th class="n">In ' + esc(est.metal || 'this metal') + '</th><th class="n">Centre ct</th><th>Size</th></tr></thead><tbody>' +
          S.rows.map((r, i) => '<tr data-sku="' + esc(r.sku) + '" class="' + (est.simPick === r.sku ? 'es-pick' : !est.simPick && i < 5 ? 'es-used' : '') + '"><td><b>' + esc(r.sku) + '</b></td><td class="dk-nm">' + esc(r.name) + '</td><td>' + esc(r.metal) +
            '</td><td class="n">' + r.w.toFixed(2) + ' g</td><td class="n">' + r.conv.toFixed(2) + ' g</td><td class="n">' + (r.cct ? r.cct.toFixed(2) : '') + '</td><td>' + esc(r.size) + '</td></tr>').join('') + '</tbody></table></div>';
      }
      $('esWout').innerHTML = R.w > 0 ? '<b>' + R.w.toFixed(2) + ' g</b> of ' + esc(est.metal || 'metal') + ' <span>· ' + esc(R.W.src) + '</span>' : '<span>' + esc(R.W.src) + '</span>';
      // diamonds
      let tct = 0;
      est.dia.forEach((g, i) => {
        const x = R.groups[i], per = x.R ? x.R.per : null;
        tct += num(g.ct) || 0;
        const pe = $('esPer' + i); if (pe) pe.textContent = per && (num(g.count) || 0) > 1 ? per.toFixed(3) + ' ct each' : '';
        const rt = $('esRt' + i); if (rt) rt.innerHTML = x.own ? 'your cost' : x.R && x.R.rate ? fI(x.R.rate) + '/ct' : (num(g.ct) > 0 ? '<span class="es-miss">no rate: type the cost</span>' : '');
        const ov = $('esOv' + i); if (ov) ov.placeholder = !x.own && x.cost != null ? String(Math.round(x.cost)) : 'type cost';
      });
      if ($('esDct')) { $('esDct').textContent = tct ? (Math.round(tct * 1000) / 1000) + ' ct' : ''; $('esDcost').textContent = R.dia ? fI(R.dia) : ''; }
      const nr = (estData().rates || []).length;
      $('esDhelp').textContent = nr ? 'Costs come from your ' + nr + ' rate' + (nr > 1 ? 's' : '') + ' on the Diamond Rates tab (by type, shape, size per stone and quality). Type a cost to use your own figure.' : 'No rates on the Diamond Rates tab yet, so type each group\'s cost. Rates you add there are used automatically.';
      // cost hints
      $('esMrH').textContent = R.mi ? (R.mr.rate ? fI(R.mr.rate) + '/g · ' + R.mr.src : R.mr.src) : '';
      view.querySelector('[data-c="mrate"]').placeholder = R.mr.rate && !(num(c.mrate) > 0) ? String(Math.round(R.mr.rate)) : 'today';
      $('esShipH').textContent = h.ship != null ? 'Your average: ' + fI(h.ship) + ' from ' + h.shipN + ' pieces' : 'No shipping history yet';
      $('esDutyH').textContent = h.duty != null ? 'Your average: ' + (Math.round(h.duty * 10) / 10) + '% from ' + h.dutyN + ' pieces' : 'No duty history yet';
      $('esRateH').textContent = R.f ? 'Today: ' + R.f.inrCad.toFixed(5) + ' (' + R.f.src + ')' : 'Open the Calculator once to load today\'s rate';
      view.querySelector('[data-c="rate"]').placeholder = R.f ? R.f.inrCad.toFixed(5) : '';
      // result
      $('esLanded').textContent = fC(R.landed);
      $('esAlt').textContent = R.landed != null ? (R.f && R.f.usdCad ? fU(R.landed / R.f.usdCad) + '  ·  ' : '') + fI(R.total) + ' before conversion' : '';
      const line = (a, b, cl) => '<div class="es-l' + (cl ? ' ' + cl : '') + '"><span>' + a + '</span><b>' + b + '</b></div>';
      $('esBrk').innerHTML = R.prod == null ? '' :
        line(esc(est.metal || 'Metal') + (R.w > 0 && R.mr.rate ? ' · ' + R.w.toFixed(2) + ' g × ' + fI(R.mr.rate) : ''), fI(R.gold)) +
        line('Labour' + (c.labUnit === 'per gram' && R.w > 0 ? ' · ' + fI(num(c.lab)) + '/g' : ''), fI(R.lab)) +
        line('Diamonds' + (tct ? ' · ' + (Math.round(tct * 100) / 100) + ' ct' : ''), fI(R.dia)) +
        line('Other costs', fI(R.other)) + (R.ch ? line('Certificate + hallmark', fI(R.ch)) : '') +
        line('Production cost in India', fI(R.prod), 'es-sum') +
        line('Shipping', fI(R.ship)) + line('Duty / taxes · ' + R.dutyP + '%', fI(R.duty)) +
        line('× ' + (R.rate ? R.rate.toFixed(5) : '–') + ' INR to CAD', fC(R.total != null && R.rate ? R.total * R.rate : null)) +
        (R.brok ? line('Brokerage', fC(R.brok)) : '');
      $('esSell').innerHTML = R.s1 != null ? 'Selling price at ' + R.p1 + (R.p2 !== R.p1 ? '–' + R.p2 : '') + '% profit: ' + fC(R.s1) + (R.p2 !== R.p1 ? ' – ' + fC(R.s2) : '') : '';
      $('esPrice').placeholder = R.suggest ? String(R.suggest) : 'CAD';
      $('esMg').innerHTML = R.price && R.landed ? (num(est.price) > 0 ? '' : 'Suggested, rounded up from the top of your range. ') + 'Profit ' + fC(R.price - R.landed) + ' · ' + Math.round(R.markup) + '% markup · ' + Math.round(R.margin) + '% margin' +
        (R.f && R.f.usdCad ? ' · about ' + fU(R.price / R.f.usdCad) : '') : '';
      $('esWarn').innerHTML = R.warn.map(w => '<div class="note">' + esc(w) + '</div>').join('') +
        (est.saved && est.saved.mrate ? '<p class="fm-help">Saved on ' + esc(est.saved.date) + ' with metal at ' + fI(est.saved.mrate) + '/g and 1 INR = ' + esc(est.saved.rate) + ' CAD. The figures above use ' + (num(c.mrate) > 0 ? 'your rate' : 'today\'s prices') + '.</p>' : '');
      const ready = estData().ready;
      $('esSave').disabled = !ready; $('esCopy').disabled = !ready || !est.no;
      $('esSave').textContent = est.no ? 'Save changes to ' + est.no : 'Save quote';
      paintConv(R);
      $('esQn').textContent = (estData().qr || []).length ? '(' + estData().qr.length + ')' : '';
    }

    /* ---------- Make it a piece ---------- */
    let armConv = false;
    function paintConv() {
      const box = $('esConv');
      if (est.sku) { box.innerHTML = '<p class="fm-help">This quote is piece <b>' + esc(est.sku) + '</b>.</p><button type="button" class="ghost sm" id="esOpenP">Open ' + esc(est.sku) + '</button>'; $('esOpenP').onclick = () => openPiece(est.sku); return; }
      if (!estData().ready) { box.innerHTML = ''; return; }
      if (box.dataset.built === '1') return;
      box.dataset.built = '1';
      const st = (lists().status || []).filter(s => !/^sold$/i.test(s));
      box.innerHTML = '<h4>Client said yes?</h4><p class="fm-help">Makes a new piece with an SKU, these costs as a starting point, the quoted price as the asking price, and the diamond groups. The quote is saved first.</p>' +
        '<div class="es-pair"><select id="esCst">' + opt(st, st[0] || 'Ordered') + '</select><button type="button" class="btn sm" id="esCv">Make it a piece</button></div>';
      $('esCv').onclick = convert;
    }
    function openPiece(sku) { const b = document.querySelector('.nv button[data-v="inv"]'); if (b) b.click(); setTimeout(() => { if (inv()) inv().open(sku); }, 80); }
    function convert() {
      const btn = $('esCv');
      const R = compute();
      if (!est.type || !est.metal) return msg('Choose the item type and metal first.', false);
      if (!est.dia.every(g => g.role)) return msg('Every diamond group needs a role (Center, Side…).', false);
      const roles = est.dia.map(g => g.role); if (roles.some((r, i) => roles.indexOf(r) !== i)) return msg('Two diamond groups have the same role. Use Side and Side 2, for example.', false);
      if (!(R.landed > 0)) return msg('Finish the estimate first: ' + (R.warn[0] || ''), false);
      if (!armConv) { armConv = true; btn.textContent = 'Click again to create the piece'; btn.classList.add('es-armed'); setTimeout(() => { armConv = false; if ($('esCv')) { $('esCv').textContent = 'Make it a piece'; $('esCv').classList.remove('es-armed'); } }, 6000); return; }
      armConv = false;
      const status = $('esCst').value;
      busy(btn, 'Saving the quote…');
      saveQuote(false, true).then(ok => {
        if (!ok) { busy(btn); return; }
        busy(btn, 'Creating the piece…');
        return inv().api('quoteToPiece', { 'Quote No': est.no, 'Status': status }).then(j => {
          busy(btn);
          if (!j.ok) return msg('Not done: ' + (j.error || j.result), false);
          est.sku = j.sku; est.status = 'Converted'; dirty = false; saveDraft();
          $('esConv').dataset.built = ''; paint();
          msg(j.result, true, j.sku);
        });
      }).catch(e => { busy(btn); msg(e.message || 'Could not reach the server.', false); });
    }

    /* ---------- Save ---------- */
    function busy(btn, text) {
      if (!btn) return;
      if (text) { if (!btn.dataset.l) btn.dataset.l = btn.textContent; btn.disabled = true; btn.textContent = text; }
      else { btn.disabled = false; if (btn.dataset.l) btn.textContent = btn.dataset.l; delete btn.dataset.l; }
    }
    function msg(text, ok, sku) {
      const b = $('esMsg'); if (!b) return;
      b.innerHTML = '<div class="res ' + (ok ? 'ok' : 'bad') + '">' + esc(text) + '</div>' + (sku ? '<button type="button" class="ghost sm" id="esOpenNew">Open ' + esc(sku) + '</button>' : '');
      if (sku) $('esOpenNew').onclick = () => openPiece(sku);
    }
    function diaText() {
      return est.dia.filter(g => num(g.ct) > 0).map(g => (g.role ? g.role + ': ' : '') + (num(g.count) > 1 ? g.count + ' × ' : '') + (g.shape || '') + ' ' + (Math.round(num(g.ct) * 1000) / 1000) + ' ct' + (g.quality ? ' ' + g.quality : '') + (g.type ? ' (' + g.type.toLowerCase() + ')' : '')).join('; ');
    }
    function saveQuote(asNew, quiet) {
      const R = compute();
      const btn = asNew ? $('esCopy') : $('esSave');
      if (!inv() || !inv().api) { msg('Update inventory.js: this version cannot save quotes.', false); return Promise.resolve(false); }
      if (!est.type || !est.metal) { msg('Choose the item type and metal before saving.', false); return Promise.resolve(false); }
      const price = R.price;
      const mrate = R.mr.rate ? Math.round(R.mr.rate) : '';
      const groups = est.dia.map((g, i) => Object.assign({}, g, { cost: R.groups[i].cost != null ? Math.round(R.groups[i].cost) : '' }));
      const snap = Object.assign({}, est, { no: asNew ? '' : est.no, sku: asNew ? '' : est.sku, dia: groups, saved: { date: ymd(), mrate: mrate, rate: R.rate ? R.rate.toFixed(5) : '' } });
      const f = {
        'Quote No': asNew ? '' : est.no, 'Status': est.status, 'Client': est.client, 'Design / Name': est.name, 'Item Type': est.type, 'Metal': est.metal, 'Size': est.size,
        'Gold Weight (g)': r2(R.w), 'Weight From': WM[est.wm] + (R.W.src ? ': ' + R.W.src : ''), 'Gold Cost (INR)': R.gold != null ? Math.round(R.gold) : '',
        'Labour (INR)': Math.round(R.lab), 'Other (INR)': Math.round(R.other), 'Diamond Cost (INR)': Math.round(R.dia), 'Certificate + Hallmark (INR)': Math.round(R.ch),
        'Shipping (INR)': Math.round(R.ship), 'Duty (INR)': R.duty != null ? Math.round(R.duty) : '', 'Total Cost (INR)': R.total != null ? Math.round(R.total) : '',
        'Rate (INR to CAD)': R.rate ? +R.rate.toFixed(6) : '', 'Brokerage (CAD)': R.brok, 'Landed Cost (CAD)': r2(R.landed), 'Markup (%)': R.markup != null ? Math.round(R.markup * 10) / 10 : '',
        'Price (CAD)': price || '', 'Diamonds': diaText(), 'Notes': est.notes, 'Details (app)': JSON.stringify(snap)
      };
      busy(btn, 'Saving…');
      return inv().api('saveQuote', f).then(j => {
        busy(btn);
        if (!j.ok) { msg('Not saved: ' + (j.error || j.result), false); return false; }
        est.no = j.quote; est.saved = snap.saved; if (asNew) est.sku = '';
        if (!num(est.price) && price) { est.price = String(price); $('esPrice').value = est.price; }
        dirty = false; saveDraft(); $('esConv').dataset.built = ''; paint();
        if (!quiet) msg(j.result + '.', true);
        return true;
      }, e => { busy(btn); msg(e.message || 'Could not reach the server, so the quote may not be saved. Check Saved quotes before trying again.', false); return false; });
    }

    /* ---------- Saved quotes ---------- */
    let pendingOpen = '';
    function quotes() {
      const ed = estData(); if (!ed.qh) return [];
      return ed.qr.map(r => { const o = {}; ed.qh.forEach((h, i) => { o[h] = r[i]; }); return o; }).reverse();
    }
    function renderList() {
      const box = $('esList'); if (!box) return;
      const ed = estData();
      if (!ed.ready) { box.innerHTML = '<p class="iv-note">Run Nix Admin › Set up the cost estimator in the tracker to save quotes.</p>'; return; }
      const prev = $('esLq'), q = prev ? prev.value : '', terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      const all = quotes(), rows = all.filter(o => terms.every(t => Object.keys(o).filter(k => k !== 'Details (app)').map(k => o[k]).join(' ').toLowerCase().indexOf(t) > -1));
      const has = !!prev;
      if (!has) box.innerHTML = '<div class="dk-bar"><input id="esLq" type="search" placeholder="Search quote number, client, design, metal…" autocomplete="off"></div><div id="esLt"></div>';
      const cols = ['Quote No', 'Date', 'Client', 'Design / Name', 'Item Type', 'Metal', 'Gold Weight (g)', 'Landed Cost (CAD)', 'Price (CAD)', 'Status', 'SKU'];
      const isN = h => /Weight|Cost|Price/.test(h);
      $('esLt').innerHTML = !all.length ? '<p class="iv-note">No saved quotes yet.</p>' :
        '<div class="dk-tw"><table class="dk-t"><thead><tr>' + cols.map(h => '<th class="' + (isN(h) ? 'n' : '') + '" style="padding:10px">' + esc(h.replace(' (CAD)', '').replace('Gold Weight (g)', 'Gold (g)')) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.slice(0, 300).map(o => '<tr data-q="' + esc(o['Quote No']) + '"' + (pendingOpen === o['Quote No'] ? ' class="es-pick"' : '') + '>' + cols.map(h => '<td class="' + (isN(h) ? 'n' : '') + (h === 'Design / Name' ? ' dk-nm' : '') + '">' + (h === 'Quote No' ? '<b>' + esc(o[h]) + '</b>' : h === 'Status' ? '<span class="pill">' + esc(o[h]) + '</span>' : esc(o[h])) + '</td>').join('') + '</tr>').join('') +
        (rows.length ? '' : '<tr><td colspan="' + cols.length + '" class="dk-empty">No quote matches.</td></tr>') + '</tbody></table></div>' +
        (pendingOpen ? '<p class="note">You have unsaved changes. Click ' + esc(pendingOpen) + ' again to open it anyway.</p>' : '');
    }
    function onListClick(e) {
      const tr = e.target.closest('tr[data-q]'); if (!tr) return;
      const no = tr.dataset.q;
      if (dirty && pendingOpen !== no && est.no !== no) { pendingOpen = no; renderList(); return; }
      pendingOpen = '';
      const o = quotes().find(x => x['Quote No'] === no); if (!o) return;
      let d = null;
      try { d = JSON.parse(o['Details (app)'] || 'null'); } catch (x) {}
      const b = blank();
      est = d && d.c ? Object.assign(b, d, { c: Object.assign(b.c, d.c) }) : Object.assign(b, { type: o['Item Type'], metal: o['Metal'], name: o['Design / Name'], client: o['Client'], size: o['Size'], wm: 'man', weight: String(num(o['Gold Weight (g)']) || ''), price: String(num(o['Price (CAD)']) || ''), notes: o['Notes'] });
      est.no = no; est.sku = o['SKU'] || ''; est.status = o['Status'] || 'Draft';
      est.dia = (est.dia || []).map(g => Object.assign({ override: '' }, g, { cost: undefined }));
      dirty = false; saveDraft(); built = false; tab = 'edit'; render();
      msg('Opened ' + no + '. Costs use today\'s prices; the quoted price stays as saved.', true);
    }

    /* ---------- Print ---------- */
    function doPrint(client) {
      const R = compute(), c = est.c;
      if (!(R.landed > 0)) return msg('Finish the estimate first: ' + (R.warn[0] || ''), false);
      let pr = $('esPrint');
      if (!pr) { pr = document.createElement('div'); pr.id = 'esPrint'; document.body.appendChild(pr); }
      const days = num(c.valid) || 7, dt = new Date();
      const until = new Date(dt.getTime() + days * 864e5);
      const dl = (a, b) => '<tr><th>' + esc(a) + '</th><td>' + b + '</td></tr>';
      const title = est.name || est.type;
      const diaRows = est.dia.filter(g => num(g.ct) > 0).map(g => (g.role ? esc(g.role) + ': ' : '') + (num(g.count) > 1 ? esc(g.count) + ' × ' : '') + esc(g.shape) + ', ' + (Math.round(num(g.ct) * 100) / 100) + ' ct total' + (g.quality ? ', ' + esc(g.quality) : '') + ', ' + esc(String(g.type || '').toLowerCase()));
      const head = '<div class="esp-h"><b>Nix Jewels</b><span>' + (client ? 'Quote' : 'Cost sheet') + (est.no ? ' ' + esc(est.no) : '') + ' · ' + esc(dt.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })) + '</span></div>';
      if (client) {
        pr.innerHTML = head + (est.client ? '<p>Prepared for <b>' + esc(est.client) + '</b></p>' : '') + '<h1>' + esc(title) + '</h1>' +
          '<table class="esp-t">' + dl('Item', esc(est.type)) + dl('Metal', esc(est.metal)) + (est.size ? dl('Size', esc(est.size)) : '') +
          dl('Approximate metal weight', R.w.toFixed(2) + ' g') + (diaRows.length ? dl('Diamonds', diaRows.join('<br>')) : '') + '</table>' +
          '<div class="esp-p"><span>Price</span><b>' + fC(R.price) + ' CAD</b>' + (R.f && R.f.usdCad ? '<small>about ' + fU(R.price / R.f.usdCad) + ' USD</small>' : '') + '</div>' +
          '<p class="esp-n">This quote is valid until ' + esc(until.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })) + '. Metal weight is approximate until the piece is made, and the price may change with the gold price after that date. Taxes are extra where they apply.</p>';
      } else {
        const L = (a, b) => '<tr><th>' + a + '</th><td class="n">' + b + '</td></tr>';
        pr.innerHTML = head + '<h1>' + esc(title) + (est.client ? ' · ' + esc(est.client) : '') + '</h1>' +
          '<p>' + esc(est.type) + ' · ' + esc(est.metal) + (est.size ? ' · size ' + esc(est.size) : '') + ' · ' + R.w.toFixed(2) + ' g (' + esc(WM[est.wm] + ': ' + R.W.src) + ')</p>' +
          (diaRows.length ? '<p>' + diaRows.join('<br>') + '</p>' : '') +
          '<table class="esp-t">' + L('Metal · ' + R.w.toFixed(2) + ' g × ' + fI(R.mr.rate) + '/g (' + esc(R.mr.src) + ')', fI(R.gold)) + L('Labour', fI(R.lab)) + L('Diamonds', fI(R.dia)) +
          L('Other costs', fI(R.other)) + L('Certificate + hallmark', fI(R.ch)) + L('<b>Production cost in India</b>', '<b>' + fI(R.prod) + '</b>') +
          L('Shipping', fI(R.ship)) + L('Duty / taxes · ' + R.dutyP + '%', fI(R.duty)) + L('<b>Total in INR</b>', '<b>' + fI(R.total) + '</b>') +
          L('Exchange rate', '1 INR = ' + R.rate.toFixed(5) + ' CAD') + L('Brokerage', fC(R.brok)) + L('<b>Landed cost</b>', '<b>' + fC(R.landed, 2) + '</b>') +
          L('Selling range at ' + R.p1 + '–' + R.p2 + '%', fC(R.s1) + ' – ' + fC(R.s2)) + L('<b>Quoted price</b>', '<b>' + fC(R.price) + '</b> (' + Math.round(R.margin) + '% margin)') + '</table>' +
          (est.notes ? '<p>Notes: ' + esc(est.notes) + '</p>' : '');
      }
      document.documentElement.classList.add('es-printing');
      window.print();
      setTimeout(() => document.documentElement.classList.remove('es-printing'), 500);
    }
    window.addEventListener('afterprint', () => document.documentElement.classList.remove('es-printing'));
  }
})();
