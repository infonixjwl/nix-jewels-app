/* Nix app: Inventory view – dashboard, piece search and details, and the Piece and Diamond forms.
   Talks to the Apps Script web app (doPost in the AppApi file). A code entry unlocks Inventory for 15 minutes. */
(function () {
  const LIVE_URL = 'https://script.google.com/macros/s/AKfycby4IDr0w-aAu54uZzLpOZu2XEE0y2k7pR-zzFK9obZwg9Os_Z6qi-aMZJm5aRIcCMhQBQ/exec';
  const SESSION_MS = 15 * 60 * 1000;
  const COST_HELP = 'Enter 0 if there is no cost. Leave blank if not known yet.';

  const $ = id => document.getElementById(id);
  const wrap = s => ({ get: k => { try { return s.getItem(k); } catch (e) { return null; } },
                       set: (k, v) => { try { s.setItem(k, v); } catch (e) {} },
                       del: k => { try { s.removeItem(k); } catch (e) {} } });
  const ls = wrap(localStorage), ss = wrap(sessionStorage);
  ls.del('nixKey'); ss.del('nix_inv_key');   // older versions kept the access code; remove it

  /* ----- test mode: open the app once with ?api=<test web app link>; ?api=live switches back ----- */
  let API_URL = LIVE_URL, TEST = false, BAD_TEST = false;
  try {
    const raw = new URLSearchParams(location.search).get('api');
    if (raw !== null) {
      const q = raw.trim();
      if (q === 'live') ls.del('nixApiTest');
      else if (/^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/.test(q) && q !== LIVE_URL) ls.set('nixApiTest', q);
      else BAD_TEST = true;
      history.replaceState(null, '', location.pathname);
    }
    const t = ls.get('nixApiTest');
    if (t) { API_URL = t; TEST = true; }
  } catch (e) {}
  const sfx = TEST ? '_test' : '';
  const TOKK = 'nix_inv_tok' + sfx, ENDK = 'nix_inv_end' + sfx, LS_DATA = 'nixData' + sfx, LS_CHK = 'nixChk' + sfx;

  const root = $('viewInv');
  let DATA = null, token = '', endT = 0, expiry = null;
  const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
  const get = (o, name) => { const k = Object.keys(o || {}).find(x => x.toLowerCase() === name.toLowerCase()); return k ? o[k] : ''; };
  const sha = s => crypto.subtle.digest('SHA-256', new TextEncoder().encode('nixInv1|' + s))
    .then(b => btoa(String.fromCharCode.apply(null, new Uint8Array(b))));
  const call = body => fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

  root.innerHTML = (TEST ? '<div class="iv-test"><span>Test mode: this is your test copy, not live data.</span><button type="button" class="iv-link" id="ivLive">Switch to live</button></div>' : '') +
    (BAD_TEST ? '<div class="iv-test"><span>That test link was not recognised, so you are on the LIVE tracker. Use the test copy\'s web app address ending in /exec (not your live one).</span></div>' : '') +
    '<div class="iv-wrap"><div id="ivLogin"></div><div id="ivMain" hidden>' +
    '<div class="iv-meta"><span id="ivInfo"></span><span><button class="iv-link" id="ivRef" type="button">Refresh</button><button class="iv-link" id="ivLock" type="button">Lock</button></span></div>' +
    '<div id="ivForms"></div><div id="ivDash"></div>' +
    '<div id="ivFind" hidden><h2 class="iv-h">Find a piece</h2><div class="iv-bar"><input id="ivQ" type="search" placeholder="SKU, name, metal, certificate" autocomplete="off" enterkeyhint="search"><select id="ivSt"></select></div><div id="ivRes"></div></div>' +
    '</div></div>';
  const det = el('div', 'iv-det'); det.id = 'ivDet'; det.hidden = true; document.body.appendChild(det);
  const stamp = () => new Date(DATA.fetched || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (TEST) $('ivLive').onclick = () => { ls.del('nixApiTest'); location.reload(); };

  /* ================= LOGIN AND SESSION ================= */
  function showLogin(msg, isErr) {
    $('ivMain').hidden = true;
    const box = $('ivLogin'); box.innerHTML = '';
    const c = el('div', 'card iv-login');
    c.appendChild(el('h2', '', 'Inventory'));
    c.appendChild(el('p', 'sub', 'Enter your inventory access code. It stays unlocked for 15 minutes.'));
    c.appendChild(el('p', 'iv-conn' + (TEST ? ' test' : ''), TEST ? 'Connected to: TEST COPY' : 'Connected to: live master tracker'));
    if (msg && !isErr) c.appendChild(el('p', 'sub', msg));
    const inp = el('input'); inp.type = 'password'; inp.id = 'ivCode'; inp.placeholder = 'Access code'; inp.autocomplete = 'off'; c.appendChild(inp);
    const er = el('div', 'err', isErr ? msg : ''); er.id = 'ivErr'; c.appendChild(er);
    const go = el('button', 'btn', 'Unlock'); go.type = 'button'; go.id = 'ivGo'; c.appendChild(go);
    const submit = () => { const v = inp.value.trim(); if (v) login(v); };
    go.onclick = submit; inp.onkeydown = e => { if (e.key === 'Enter') submit(); };
    box.appendChild(c);
  }
  function clearSession() { token = ''; endT = 0; ss.del(TOKK); ss.del(ENDK); if (expiry) { clearInterval(expiry); expiry = null; } }
  function lockInv(msg) { clearSession(); DATA = null; closePanel(); showLogin(msg, false); }
  function fail(msg) { clearSession(); showLogin(msg, true); }
  function startExpiry() {
    if (expiry) clearInterval(expiry);
    expiry = setInterval(() => { if (endT && Date.now() > endT) lockInv('Inventory session ended. Enter the code again.'); }, 5000);
  }
  function store(d) { d.fetched = Date.now(); ls.set(LS_DATA, JSON.stringify(d)); setData(d); }

  function login(code) {
    const go = $('ivGo'); if (go) { go.disabled = true; go.textContent = 'Checking…'; }
    return call({ action: 'login', code: code }).then(j => {
      if (!j.ok) { if (/^Wrong/.test(j.error)) { ls.del(LS_DATA); ls.del(LS_CHK); } return fail(j.error); }
      token = j.token; endT = Date.now() + Math.min(SESSION_MS, (j.expiresIn || 900) * 1000);
      ss.set(TOKK, token); ss.set(ENDK, String(endT)); startExpiry();
      return sha(code).then(h => { ls.set(LS_CHK, h); store(j.data); });
    }, () => offline(code));
  }
  // No internet: the saved copy opens only if the code matches the one used last time. Saving needs a connection.
  function offline(code) {
    const c = ls.get(LS_DATA), h = ls.get(LS_CHK);
    if (!c || !h) return fail('Could not reach the server. Check your internet.');
    return sha(code).then(x => {
      if (x !== h) return fail('Could not reach the server, and that code does not match the saved copy.');
      try { clearSession(); endT = Date.now() + SESSION_MS; startExpiry(); setData(JSON.parse(c)); $('ivInfo').textContent += ' (offline copy)'; }
      catch (e) { fail('Could not load. Check your internet.'); }
    });
  }
  function refresh() {
    if (!token) return lockInv('Enter the code again to reconnect.');
    $('ivInfo').textContent = 'Updating…';
    return call({ action: 'data', token: token }).then(j => {
      if (!j.ok) { if (/session/i.test(j.error)) return lockInv('Inventory session ended. Enter the code again.'); $('ivInfo').textContent = j.error; return; }
      store(j.data);
    }, () => { if (DATA) $('ivInfo').textContent = 'Could not reach the server. Showing the last copy (' + stamp() + ').'; });
  }

  /* ================= DASHBOARD ================= */
  function renderDash(d) {
    const box = $('ivDash'); box.innerHTML = ''; if (!d) return;
    box.appendChild(el('h2', 'iv-h', 'Dashboard'));
    const g = el('div', 'iv-kpis');
    d.cards.forEach(c => { const k = el('div', 'iv-kpi'); k.appendChild(el('small', '', c.label)); k.appendChild(el('b', '', c.value)); g.appendChild(k); });
    box.appendChild(g);
    const rows = d.status.filter(s => !(/^Other/.test(s.label) && s.value === 0));
    const max = Math.max.apply(null, [1].concat(rows.map(s => s.value)));
    box.appendChild(el('h2', 'iv-h', 'Pieces by status'));
    const card = el('div', 'iv-card');
    rows.forEach(s => {
      const r = el('div', 'iv-st'), tr = el('i'), fl = el('em');
      fl.style.width = (s.value / max * 100) + '%'; tr.appendChild(fl);
      r.appendChild(el('span', '', s.label)); r.appendChild(tr); r.appendChild(el('b', '', String(s.value))); card.appendChild(r);
    });
    box.appendChild(card);
    if (d.rate) box.appendChild(el('p', 'iv-note', 'INR conversion uses CAD to INR ' + d.rate + '.'));
  }

  /* ================= FORM TILES ================= */
  function renderForms() {
    const box = $('ivForms'); box.innerHTML = '';
    if (!DATA || DATA.role !== 'full') return;
    box.appendChild(el('h2', 'iv-h', 'Forms'));
    const grid = el('div', 'ftiles');
    const tile = (icon, title, desc, act) => {
      const t = el(typeof act === 'string' ? 'a' : 'button', 'ftile');
      if (typeof act === 'string') { t.href = act; t.target = '_blank'; t.rel = 'noopener'; } else { t.type = 'button'; t.onclick = act; }
      const tx = el('span'); tx.appendChild(el('b', '', title)); tx.appendChild(el('small', '', desc));
      t.appendChild(el('span', 'ic', icon)); t.appendChild(tx); grid.appendChild(t);
    };
    tile('💎', 'Piece', 'Add or update a piece', () => openPiece());
    tile('🔹', 'Diamond', 'Add or update diamonds', () => openDiamond());
    box.appendChild(grid);
  }

  /* ================= PIECE LIST AND DETAIL ================= */
  function render() {
    const terms = $('ivQ').value.trim().toLowerCase().split(/\s+/).filter(Boolean), st = $('ivSt').value, res = $('ivRes');
    let rows = DATA.pieces.slice().reverse().filter(p => (!st || get(p, 'Status') === st) && terms.every(t => p._h.indexOf(t) > -1));
    const total = rows.length, filtered = terms.length || st, limit = filtered ? 50 : 20;
    rows = rows.slice(0, limit); res.innerHTML = '';
    if (!rows.length) res.appendChild(el('p', 'iv-note', 'No piece matches. Try a shorter search.'));
    rows.forEach(p => {
      const b = el('button', 'iv-row'), left = el('span'); b.type = 'button';
      left.appendChild(el('b', '', p._sku));
      const sub = get(p, 'Design / Name') || get(p, 'Item Type'); if (sub) left.appendChild(el('small', '', sub));
      b.appendChild(left);
      const s = get(p, 'Status'); if (s) b.appendChild(el('span', 'pill', s));
      b.onclick = () => openDetail(p); res.appendChild(b);
    });
    $('ivInfo').textContent = (filtered ? total + ' found' + (total > limit ? ', showing ' + limit : '') : 'Latest ' + rows.length + ' of ' + DATA.pieces.length) + '. Updated ' + stamp();
  }
  function fields(obj, skip) {
    const card = el('div', 'iv-card');
    Object.keys(obj).forEach(k => {
      if (k[0] === '_' || skip.indexOf(k.toLowerCase()) > -1) return;
      const row = el('div', 'iv-f'), b = el('b'), v = obj[k]; row.appendChild(el('span', '', k));
      if (/^https?:\/\//.test(v)) { const a = el('a', '', 'Open link'); a.href = v; a.target = '_blank'; a.rel = 'noopener'; b.appendChild(a); } else b.textContent = v;
      row.appendChild(b); card.appendChild(row);
    });
    return card.children.length ? card : null;
  }
  function openPanel(title) {
    det.innerHTML = '';
    const body = el('div', 'iv-body'); det.appendChild(body);
    const back = el('button', 'iv-back', '‹ Back'); back.type = 'button'; back.onclick = () => history.back(); body.appendChild(back);
    body.appendChild(el('h3', '', title));
    if (det.hidden) { det.hidden = false; document.body.style.overflow = 'hidden'; history.pushState({ iv: 1 }, ''); }
    det.scrollTop = 0;
    return body;
  }
  function closePanel() { det.hidden = true; document.body.style.overflow = ''; }
  window.addEventListener('popstate', closePanel);

  function openDetail(p) {
    const body = openPanel(p._sku);
    const nm = get(p, 'Design / Name'); if (nm) body.appendChild(el('p', 'nm', nm));
    const st = get(p, 'Status'); if (st) body.appendChild(el('span', 'pill', st));
    const pk = Object.keys(p).find(k => /photo/i.test(k) && /^https?:/.test(p[k]));
    if (pk) {
      const id = (p[pk].match(/[-\w]{25,}/) || [])[0];
      if (id) { const im = el('img'); im.alt = 'Photo of ' + p._sku; im.src = 'https://drive.google.com/thumbnail?id=' + id + '&sz=w800'; im.onerror = () => im.remove(); body.appendChild(im); }
    }
    const main = fields(p, ['sku', 'status', 'design / name', 'notes']); if (main) body.appendChild(main);
    const dia = DATA.diamonds[p._sku] || [];
    body.appendChild(el('h2', 'iv-h', 'Diamonds (' + dia.length + ')'));
    if (!dia.length) body.appendChild(el('p', 'iv-note', 'No diamond details entered yet.'));
    dia.forEach(d => {
      const role = get(d, 'Diamond Role') || 'Diamond', shape = get(d, 'Shape');
      body.appendChild(el('div', 'iv-note', role + (shape ? ', ' + shape : '')));
      const c = fields(d, ['diamond role']); if (c) body.appendChild(c);
    });
    const note = get(p, 'Notes'); if (note) { body.appendChild(el('h2', 'iv-h', 'Notes')); body.appendChild(el('p', 'iv-note', note)); }
    if (DATA.role === 'full' && token) {
      const acts = el('div', 'fm-row2');
      const b1 = el('button', 'ghost', 'Update this piece'); b1.type = 'button'; b1.onclick = () => openPiece({ mode: 'upd', sku: p._sku });
      const b2 = el('button', 'ghost', 'Add or update diamonds'); b2.type = 'button'; b2.onclick = () => openDiamond({ sku: p._sku });
      acts.appendChild(b1); acts.appendChild(b2); body.appendChild(acts);
    }
  }

  /* ================= IN-APP FORMS ================= */
  // q = name the backend expects (the Google Form question), h = column header on the sheet
  const PIECE_F = [
    { q: 'Status', h: 'Status', t: 'sel', o: 'status' },
    { q: 'Item Type', h: 'Item Type', t: 'sel', o: 'itemType' },
    { q: 'Metal', h: 'Metal', t: 'sel', o: 'metal' },
    { q: 'Main Diamond Shape', h: 'Diamond Shape', t: 'sel', o: 'shape' },
    { q: 'Design / Name', h: 'Design / Name', t: 'text' },
    { q: 'Size', h: 'Size', t: 'text' },
    { q: 'Gold Weight (g)', h: 'Gold Weight (g)', t: 'num' },
    { q: 'Photo Link', h: 'Photo Link (Drive)', t: 'url', help: 'Paste the Google Drive link' },
    { q: 'Gold Cost (INR)', h: 'Gold Cost (INR)', t: 'num', help: COST_HELP },
    { q: 'Labour (INR)', h: 'Labour (INR)', t: 'num', help: COST_HELP },
    { q: 'Other Charges (INR)', h: 'Other Charges (INR)', t: 'num', help: COST_HELP },
    { q: 'Shipment ID', h: 'Shipment ID', t: 'sel', o: 'shipments', help: 'Leave blank until the piece ships. New shipments are added on the Shipments tab.' }
  ];
  const DIA_F = [
    { q: 'Shape', h: 'Shape', t: 'sel', o: 'shape' },
    { q: 'Pieces (count)', h: 'Pieces (count)', t: 'num', help: 'Number of stones in this group' },
    { q: 'Total Carat Weight', h: 'Total Carat Weight', t: 'num', help: 'Combined carats for this group' },
    { q: 'Color / Clarity', h: 'Color / Clarity', t: 'text', ph: 'e.g. F / VS1' },
    { q: 'Certificate No.', h: 'Certificate No.', t: 'text' },
    { q: 'Cost (INR)', h: 'Cost (INR)', t: 'num', help: 'Total cost for this group. Leave blank if not known yet.' },
    { q: 'Certificate Photo Link', h: 'Certificate Photo', t: 'url', help: 'Paste the Google Drive link to the certificate' }
  ];
  let uid = 0;
  function field(f) {
    const w = el('div', 'fm-f'), id = 'fm' + (++uid);
    const lab = el('label', '', f.q + (f.req ? ' *' : '')); lab.htmlFor = id; w.appendChild(lab);
    let inp;
    if (f.t === 'sel') {
      inp = el('select');
      const o0 = el('option', '', f.blank || '—'); o0.value = ''; inp.appendChild(o0);
      ((DATA.lists || {})[f.o] || []).forEach(v => { const o = el('option', '', v); o.value = v; inp.appendChild(o); });
    } else {
      inp = el('input'); inp.type = f.t === 'url' ? 'url' : 'text'; inp.autocomplete = 'off';
      if (f.t === 'num') inp.inputMode = 'decimal';
      if (f.ph) inp.placeholder = f.ph;
      if (f.list) inp.setAttribute('list', f.list);
    }
    inp.id = id; w.appendChild(inp);
    if (f.help) w.appendChild(el('div', 'fm-help', f.help));
    const er = el('div', 'fm-err'); w.appendChild(er);
    const F = { f: f, w: w, inp: inp, er: er, orig: '' };
    F.val = () => inp.value.trim();
    F.set = v => {
      v = v == null ? '' : String(v).trim();
      if (f.t === 'num') v = v.replace(/[^\d.]/g, '');
      if (f.t === 'sel' && v) {
        const m = Array.prototype.find.call(inp.options, o => o.value.toLowerCase() === v.toLowerCase());
        if (m) v = m.value; else { const o = el('option', '', v); o.value = v; inp.appendChild(o); }
      }
      inp.value = v; F.orig = v; er.textContent = '';
    };
    inp.addEventListener('input', () => { er.textContent = ''; });
    return F;
  }
  function check(F) {
    const v = F.val();
    if (F.f.t === 'num' && v && !/^\d+(\.\d+)?$/.test(v.replace(/,/g, ''))) F.er.textContent = 'Enter a number, e.g. 2500 or 1.25 (no letters or symbols).';
    else if (F.f.t === 'url' && v && !/^https?:\/\//i.test(v)) F.er.textContent = 'Paste the full link, starting with https://';
    else return true;
    return false;
  }
  function textarea(label, help) {
    const w = el('div', 'fm-f'), id = 'fm' + (++uid);
    const lab = el('label', '', label); lab.htmlFor = id; w.appendChild(lab);
    const ta = el('textarea', 'fm-ta'); ta.id = id; ta.rows = 3; w.appendChild(ta);
    if (help) w.appendChild(el('div', 'fm-help', help));
    return { w: w, ta: ta };
  }
  function resultBox(body, res) {
    const box = el('div'); body.appendChild(box);
    if (res) {
      const r = el('div', 'res ' + (res.ok ? 'ok' : 'bad'), res.text); box.appendChild(r);
      if (res.extra) box.appendChild(res.extra);
    }
    return box;
  }
  function needOnline(body) {
    if (token) return false;
    body.appendChild(el('p', 'note', 'You are viewing an offline copy. Press Lock, then enter your code again with internet on to save entries.'));
    return true;
  }
  function skuList(body) {
    const dl = el('datalist'); dl.id = 'ivSkus' + (++uid);
    DATA.pieces.slice().reverse().forEach(p => { const o = el('option'); o.value = p._sku; const n = get(p, 'Design / Name'); if (n) o.label = n; dl.appendChild(o); });
    body.appendChild(dl);
    return dl.id;
  }
  const findPiece = s => { s = String(s || '').trim().toUpperCase(); return DATA.pieces.find(p => p._sku === s) || null; };
  function saveBtn(body, label) {
    const bar = el('div', 'fm-actions');
    const btn = el('button', 'btn', label); btn.type = 'button'; bar.appendChild(btn);
    body.appendChild(bar);
    return btn;
  }
  function submit(btn, action, payload, onDone) {
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Saving…';
    call({ action: action, token: token, fields: payload }).then(j => {
      btn.disabled = false; btn.textContent = label;
      if (!j.ok && /session/i.test(j.error || '')) return lockInv('Inventory session ended. Enter the code again. Nothing was saved.');
      if (j.data) store(j.data);
      onDone({ ok: !!j.ok, text: j.ok ? j.result : 'Not saved: ' + (j.error || j.result) });
    }, () => {
      btn.disabled = false; btn.textContent = label;
      onDone({ ok: false, text: 'The app could not reach the server, so it cannot confirm the save. Check the piece in Find a piece before trying again.' }, true);
    });
  }

  // Fields that had a value and were emptied: erased only after a second press of Save.
  function erased(F, extra) {
    return F.filter(x => x.orig && !x.val()).map(x => x.f.q).concat(extra || []);
  }
  function eraseCheckbox(label) {
    const w = el('label', 'fm-check'); const cb = el('input'); cb.type = 'checkbox';
    w.appendChild(cb); w.appendChild(document.createTextNode(' ' + label)); w.hidden = true;
    return { w: w, cb: cb };
  }
  function dangerBtn(body, label, confirmLabel, run) {
    const b = el('button', 'fm-del', label); b.type = 'button'; b.hidden = true;
    let armed = false, t = null;
    b.onclick = () => {
      if (!armed) { armed = true; b.textContent = confirmLabel(); b.classList.add('armed'); t = setTimeout(reset, 6000); return; }
      clearTimeout(t); reset(); run(b);
    };
    function reset() { armed = false; b.textContent = label; b.classList.remove('armed'); }
    b.reset = reset;
    body.appendChild(b);
    return b;
  }
  function showRes(resBox, text, ok) { resBox.innerHTML = ''; resBox.appendChild(el('div', 'res ' + (ok ? 'ok' : 'bad'), text)); det.scrollTop = 0; }

  /* ----- Piece form ----- */
  function openPiece(opt) {
    opt = opt || {};
    const body = openPanel('Piece');
    if (needOnline(body)) return;
    const L = DATA.lists, H = DATA.hints;
    let mode = opt.mode || 'new';
    const resBox = resultBox(body, opt.res);

    const seg = el('div', 'seg');
    const bNew = el('button', '', 'New piece'), bUpd = el('button', '', 'Update existing piece');
    bNew.type = bUpd.type = 'button'; seg.appendChild(bNew); seg.appendChild(bUpd); body.appendChild(seg);

    // SKU area
    const newBox = el('div', 'fm-sku');
    newBox.appendChild(el('span', 'fm-help', 'SKU (built automatically from item type, metal and shape)'));
    const preview = el('b'); newBox.appendChild(preview);
    const skuNote = el('div', 'fm-help', 'The running number is confirmed when you save. Last created: ' + (H.last.join(', ') || 'none yet'));
    newBox.appendChild(skuNote);
    body.appendChild(newBox);

    const updBox = el('div');
    const updF = field({ q: 'SKU', t: 'text', req: true, ph: 'Start typing to search', list: skuList(body) });
    updBox.appendChild(updF.w);
    const updInfo = el('div', 'fm-help'); updBox.appendChild(updInfo);
    const skuChg = el('div', 'fm-skuchg'); skuChg.hidden = true; updBox.appendChild(skuChg);
    body.appendChild(updBox);

    const F = PIECE_F.map(f => field(f));
    const byQ = q => F.find(x => x.f.q === q);
    const grid = el('div', 'fm two');
    F.forEach(x => grid.appendChild(x.w));
    body.appendChild(grid);
    const oldNotes = el('p', 'fm-help'); body.appendChild(oldNotes);
    const eraseNotes = eraseCheckbox('Erase the existing notes'); body.appendChild(eraseNotes.w);
    const notes = textarea('Notes', 'Added to any existing notes, never replaces them.'); body.appendChild(notes.w);
    const btn = saveBtn(body, 'Save piece');
    let confirmKey = '';
    const delBtn = dangerBtn(body, 'Delete this piece', () => 'Tap again to delete ' + (findPiece(updF.val()) || {})._sku + ' and its diamonds', b => {
      const p = findPiece(updF.val()); if (!p) return;
      submit(b, 'deletePiece', { SKU: p._sku }, res => {
        if (!res.ok) return showRes(resBox, res.text, false);
        openPiece({ mode: 'new', res: res });
      });
    });

    function code(q) { const v = byQ(q).val(); return v ? L.codes[v] || '' : ''; }
    function updatePreview() {
      const parts = [code('Item Type'), code('Metal'), code('Main Diamond Shape')];
      preview.textContent = parts.every(Boolean) ? ['NX'].concat(parts, [H.next]).join('-') : 'Choose Item Type, Metal and Main Diamond Shape';
    }
    ['Item Type', 'Metal', 'Main Diamond Shape'].forEach(q => byQ(q).inp.addEventListener('change', () => { updatePreview(); updSkuLine(); }));
    // Update mode: show what the SKU becomes when item type, metal or shape is corrected
    function updSkuLine() {
      skuChg.innerHTML = ''; skuChg.hidden = true;
      const p = mode === 'upd' ? findPiece(updF.val()) : null;
      if (!p) return;
      const keys = ['Item Type', 'Metal', 'Main Diamond Shape'];
      const missing = keys.filter(q => byQ(q).val() && !code(q));
      const num = (p._sku.match(/-(\d+)$/) || [])[1];
      const expected = !missing.length && num && keys.every(q => code(q)) ? ['NX'].concat(keys.map(code), [num]).join('-') : '';
      const changed = keys.some(q => byQ(q).val() !== byQ(q).orig);
      if (missing.length) { skuChg.textContent = '"' + byQ(missing[0]).val() + '" has no SKU code on the Lookups tab yet, so the SKU cannot be rebuilt.'; skuChg.hidden = false; return; }
      if (!expected || expected === p._sku) return;
      skuChg.hidden = false;
      if (changed) { skuChg.textContent = 'When you save, the SKU changes to ' + expected + ' (same number). Its diamonds move with it.'; return; }
      skuChg.appendChild(el('span', '', 'This SKU does not match the piece details. It should be ' + expected + '. '));
      const fix = el('button', 'iv-link', 'Fix the SKU'); fix.type = 'button';
      fix.onclick = () => submit(fix, 'savePiece', { 'Entry Type': 'Update existing piece', SKU: p._sku, rebuildSku: 'yes' }, res => {
        if (!res.ok) return showRes(resBox, res.text, false);
        openPiece({ mode: 'upd', sku: expected, res: res });
      });
      skuChg.appendChild(fix);
    }
    let loadedSku = null;
    function prefill(force) {
      const key = updF.val().toUpperCase();
      if (force !== true && key === loadedSku) return;     // same piece: keep what has been typed
      loadedSku = key;
      const p = findPiece(updF.val());
      F.forEach(x => x.set(p ? get(p, x.f.h) : ''));
      oldNotes.textContent = p && get(p, 'Notes') ? 'Existing notes: ' + get(p, 'Notes') : '';
      eraseNotes.w.hidden = !(p && get(p, 'Notes')); eraseNotes.cb.checked = false;
      delBtn.hidden = !p; delBtn.reset(); confirmKey = '';
      updSkuLine();
      updInfo.textContent = p ? [get(p, 'Design / Name'), get(p, 'Status')].filter(Boolean).join(' · ') + '. Change what you need. To erase a value, empty the box and press Save twice.'
                              : (updF.val() ? 'No piece with this SKU yet.' : '');
    }
    updF.inp.addEventListener('input', prefill); updF.inp.addEventListener('change', prefill);

    function setMode(m) {
      mode = m;
      bNew.classList.toggle('on', m === 'new'); bUpd.classList.toggle('on', m === 'upd');
      newBox.hidden = m !== 'new'; updBox.hidden = m !== 'upd';
      ['Status', 'Item Type'].forEach(q => { byQ(q).w.querySelector('label').textContent = q + (m === 'new' ? ' *' : ''); });
      ['Metal', 'Main Diamond Shape'].forEach(q => { byQ(q).w.querySelector('label').textContent = q + (m === 'new' ? ' *' : ''); });
      if (m === 'new') { F.forEach(x => x.set('')); oldNotes.textContent = ''; eraseNotes.w.hidden = true; delBtn.hidden = true; skuChg.hidden = true; loadedSku = null; updatePreview(); } else prefill(true);
    }
    bNew.onclick = () => setMode('new'); bUpd.onclick = () => setMode('upd');
    if (opt.sku) updF.inp.value = opt.sku;
    setMode(mode);

    btn.onclick = () => {
      let ok = F.map(check).every(Boolean);
      const out = { 'Entry Type': mode === 'new' ? 'New piece' : 'Update existing piece' };
      if (mode === 'new') {
        ['Status', 'Item Type', 'Metal', 'Main Diamond Shape'].forEach(q => {
          if (!byQ(q).val()) { byQ(q).er.textContent = 'Required for a new piece.'; ok = false; }
        });
        ['Item Type', 'Metal', 'Main Diamond Shape'].forEach(q => {
          if (byQ(q).val() && !code(q)) { byQ(q).er.textContent = 'This option has no SKU code on the Lookups tab yet. Add its code there first.'; ok = false; }
        });
      } else {
        const p = findPiece(updF.val());
        if (!p) { updF.er.textContent = updF.val() ? 'No piece with this SKU. Pick one from the list.' : 'Choose the piece to update.'; ok = false; }
        else out.SKU = p._sku;
      }
      if (!ok) { const e = body.querySelector('.fm-err:not(:empty)'); if (e) e.scrollIntoView({ block: 'center' }); return; }
      F.forEach(x => {
        let v = x.val(); if (!v) return;
        if (mode === 'upd' && v === x.orig) return;          // unchanged values are not re-sent
        if (x.f.t === 'num') v = v.replace(/,/g, '');
        out[x.f.q] = v;
      });
      const n = notes.ta.value.trim(); if (n) out.Notes = n;
      const clears = mode === 'upd' ? erased(F, eraseNotes.cb.checked ? ['Notes'] : []) : [];
      if (mode === 'upd' && Object.keys(out).length <= 2 && !clears.length) return showRes(resBox, 'Nothing changed, so nothing was saved.', false);
      if (clears.length && confirmKey !== clears.join('|')) {
        confirmKey = clears.join('|');
        return showRes(resBox, 'You emptied: ' + clears.join(', ') + '. Press Save piece again to erase ' + (clears.length > 1 ? 'these values' : 'this value') + ', or put the value back.', false);
      }
      if (clears.length) out.clear = clears;
      submit(btn, 'savePiece', out, (res, unsure) => {
        if (!res.ok) return showRes(resBox, res.text, false);
        const m = res.text.match(/^New piece created (\S+)/), rn = res.text.match(/^SKU changed \S+ → (\S+?)\. /);
        const sku = m ? m[1] : rn ? rn[1] : out.SKU;
        let extra = null;
        if (m) { extra = el('button', 'ghost fm-next', 'Add diamonds for ' + sku); extra.type = 'button'; extra.onclick = () => openDiamond({ sku: sku }); }
        openPiece(m ? { mode: 'new', res: { ok: true, text: res.text, extra: extra } } : { mode: 'upd', sku: sku, res: res });
      });
    };
  }

  /* ----- Diamond form ----- */
  function openDiamond(opt) {
    opt = opt || {};
    const body = openPanel('Diamond');
    if (needOnline(body)) return;
    const resBox = resultBox(body, opt.res);
    body.appendChild(el('p', 'fm-hint', 'One entry per diamond group on a piece. Save the same SKU and role again later to update it, for example when the cost arrives. Blank fields stay as they are.'));

    const waiting = (DATA.hints.waiting || []).slice(0, 15);
    let chipsBox = null;
    if (waiting.length) {
      body.appendChild(el('div', 'fm-help', 'Pieces still waiting for diamond details:'));
      chipsBox = el('div', 'chips fm-chips'); body.appendChild(chipsBox);
    }
    const skuF = field({ q: 'SKU', t: 'text', req: true, ph: 'Start typing to search', list: skuList(body) });
    const roleF = field({ q: 'Diamond Role', t: 'sel', o: 'role', req: true, blank: 'Choose…' });
    const top = el('div', 'fm two'); top.appendChild(skuF.w); top.appendChild(roleF.w); body.appendChild(top);
    const have = el('div'); body.appendChild(have);
    const state = el('div', 'fm-state'); body.appendChild(state);

    const F = DIA_F.map(f => field(f));
    const grid = el('div', 'fm two'); F.forEach(x => grid.appendChild(x.w)); body.appendChild(grid);
    const oldNotes = el('p', 'fm-help'); body.appendChild(oldNotes);
    const eraseNotes = eraseCheckbox('Erase the existing notes'); body.appendChild(eraseNotes.w);
    const notes = textarea('Notes', 'Added to any existing notes, never replaces them.'); body.appendChild(notes.w);
    const btn = saveBtn(body, 'Save diamond');
    let confirmKey = '';
    const delBtn = dangerBtn(body, 'Remove this diamond group', () => 'Tap again to remove the ' + roleF.val() + ' group', b => {
      const p = findPiece(skuF.val()); if (!p || !current) return;
      submit(b, 'deleteDiamond', { SKU: p._sku, 'Diamond Role': roleF.val() }, res => {
        if (!res.ok) return showRes(resBox, res.text, false);
        openDiamond({ sku: p._sku, res: res });
      });
    });

    if (chipsBox) waiting.forEach(s => {
      const c = el('button', 'chip sm', s); c.type = 'button';
      c.onclick = () => { skuF.inp.value = s; sync(); roleF.inp.focus(); };
      chipsBox.appendChild(c);
    });
    let current = null, loadedKey = null;
    function sync(force) {
      const p = findPiece(skuF.val()), role = roleF.val();
      const key = skuF.val().toUpperCase() + '|' + role;
      if (force !== true && key === loadedKey) return;      // same piece and role: keep what has been typed
      loadedKey = key;
      const list = p ? DATA.diamonds[p._sku] || [] : [];
      have.innerHTML = '';
      if (p) {
        have.appendChild(el('div', 'fm-help', (get(p, 'Design / Name') || p._sku) + (list.length ? '. Already entered (tap to update):' : '. No diamonds entered yet.')));
        if (list.length) {
          const cb = el('div', 'chips fm-chips');
          list.forEach(d => {
            const r = get(d, 'Diamond Role'), bits = [get(d, 'Shape'), get(d, 'Total Carat Weight') ? get(d, 'Total Carat Weight') + ' ct' : ''].filter(Boolean).join(', ');
            const c = el('button', 'chip sm' + (r === role ? ' on' : ''), r + (bits ? ' · ' + bits : '')); c.type = 'button';
            c.onclick = () => { roleF.set(r); sync(); };
            cb.appendChild(c);
          });
          have.appendChild(cb);
        }
      } else if (skuF.val()) have.appendChild(el('div', 'fm-help', 'No piece with this SKU. Add the piece first with the Piece form.'));
      current = p && role ? list.find(d => get(d, 'Diamond Role') === role) || null : null;
      F.forEach(x => x.set(current ? get(current, x.f.h) : ''));
      oldNotes.textContent = current && get(current, 'Notes') ? 'Existing notes: ' + get(current, 'Notes') : '';
      eraseNotes.w.hidden = !(current && get(current, 'Notes')); eraseNotes.cb.checked = false;
      delBtn.hidden = !current; delBtn.reset(); confirmKey = '';
      state.textContent = p && role ? (current ? 'Updating the ' + role + ' group. Change what you need; to erase a value, empty the box and press Save twice.' : 'New ' + role + ' group for this piece.') : '';
    }
    skuF.inp.addEventListener('input', sync); skuF.inp.addEventListener('change', sync); roleF.inp.addEventListener('change', sync);
    if (opt.sku) skuF.inp.value = opt.sku;
    if (opt.role) roleF.set(opt.role);
    sync(true);

    btn.onclick = () => {
      let ok = F.map(check).every(Boolean);
      const p = findPiece(skuF.val()), role = roleF.val();
      if (!p) { skuF.er.textContent = skuF.val() ? 'No piece with this SKU. Pick one from the list.' : 'Choose the piece.'; ok = false; }
      if (!role) { roleF.er.textContent = 'Choose the diamond role.'; ok = false; }
      if (!ok) { const e = body.querySelector('.fm-err:not(:empty)'); if (e) e.scrollIntoView({ block: 'center' }); return; }
      const out = { SKU: p._sku, 'Diamond Role': role };
      F.forEach(x => {
        let v = x.val(); if (!v) return;
        if (current && v === x.orig) return;
        if (x.f.t === 'num') v = v.replace(/,/g, '');
        out[x.f.q] = v;
      });
      const n = notes.ta.value.trim(); if (n) out.Notes = n;
      const clears = current ? erased(F, eraseNotes.cb.checked ? ['Notes'] : []) : [];
      if (current && Object.keys(out).length <= 2 && !clears.length) return showRes(resBox, 'Nothing changed, so nothing was saved.', false);
      if (clears.length && confirmKey !== clears.join('|')) {
        confirmKey = clears.join('|');
        return showRes(resBox, 'You emptied: ' + clears.join(', ') + '. Press Save diamond again to erase ' + (clears.length > 1 ? 'these values' : 'this value') + ', or put the value back.', false);
      }
      if (clears.length) out.clear = clears;
      submit(btn, 'saveDiamond', out, res => {
        if (!res.ok) return showRes(resBox, res.text, false);
        openDiamond({ sku: p._sku, res: res });
      });
    };
  }

  /* ================= DATA ================= */
  function setData(d) {
    DATA = d; $('ivLogin').innerHTML = ''; $('ivMain').hidden = false;
    renderForms(); renderDash(d.dash);
    if (d.role === 'full' && d.pieces) {
      d.pieces.forEach(p => {
        const dv = (d.diamonds[p._sku] || []).map(x => Object.keys(x).map(k => x[k]).join(' ')).join(' ');
        p._h = (Object.keys(p).map(k => p[k]).join(' ') + ' ' + dv).toLowerCase();
      });
      const sts = []; d.pieces.forEach(p => { const s = get(p, 'Status'); if (s && sts.indexOf(s) < 0) sts.push(s); }); sts.sort();
      const sel = $('ivSt'), cur = sel.value; sel.innerHTML = '';
      [''].concat(sts).forEach(s => { const o = el('option', '', s || 'All statuses'); o.value = s; sel.appendChild(o); });
      sel.value = sts.indexOf(cur) > -1 ? cur : '';
      $('ivFind').hidden = false; render();
    } else { $('ivFind').hidden = true; $('ivInfo').textContent = 'Updated ' + stamp(); }
  }

  $('ivQ').addEventListener('input', () => { DATA && DATA.pieces && render(); });
  $('ivSt').addEventListener('change', () => { DATA && DATA.pieces && render(); });
  $('ivRef').onclick = () => refresh();
  $('ivLock').onclick = () => lockInv('');

  NixApp.on('unlock', () => {
    const t = ss.get(TOKK), e = parseInt(ss.get(ENDK) || '0', 10);
    if (t && e > Date.now()) {
      token = t; endT = e; startExpiry();
      try { const c = ls.get(LS_DATA); if (c) setData(JSON.parse(c)); } catch (x) {}
      refresh();
    } else showLogin();
  });
  NixApp.on('lock', () => lockInv(''));
  NixApp.on('view', v => {
    if (v !== 'inv') return;
    if (endT && Date.now() > endT) lockInv('Inventory session ended. Enter the code again.');
    const c = $('ivCode'); if (c) setTimeout(() => c.focus(), 50);
  });
})();
