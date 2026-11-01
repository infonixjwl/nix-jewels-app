/* Nix app: Inventory view (dashboard, piece search, piece details, form links).
   Needs the inventory access code, checked by the Apps Script web app. Unlocked for 15 minutes. */
(function(){
  var API_URL='https://script.google.com/macros/s/AKfycby4IDr0w-aAu54uZzLpOZu2XEE0y2k7pR-zzFK9obZwg9Os_Z6qi-aMZJm5aRIcCMhQBQ/exec';
  var ITEMS=[
  { group:'Forms', icon:'💎', title:'Piece',            desc:'Add or update a piece',        url:'https://docs.google.com/forms/d/e/1FAIpQLSdh0zXuIUej02hDR00Xb97NI4DQHmo_gaepcWqFbXS54pq-0w/viewform?usp=header' },
  { group:'Forms', icon:'🔹', title:'Diamond',          desc:'Add or update diamonds',       url:'https://docs.google.com/forms/d/e/1FAIpQLSfL_X2Orxu4IcivKMPYUUCDPS7Cp4PiDmBKF76WYJ0R4H_dKw/viewform?usp=header' },
  { group:'Forms', icon:'✏️', title:'Fix SKU',          desc:'Correct a wrong SKU',          url:'https://docs.google.com/forms/d/e/1FAIpQLSfXztrc6Lq_yjB0uog5mOxUt_XjNsouk5i2FHEX4oal2INAyw/viewform?usp=header' },
  { group:'Forms', icon:'🔓', title:'Inventory access', desc:'Urgent manual edit',           url:'https://docs.google.com/forms/d/e/1FAIpQLSd-Cl8hK4d9TDtvRJP8FJjlY-KtOSbiGGYmoeD3hWi4hbR5VA/viewform?usp=header' },
];
  var KEYK='nix_inv_key',ENDK='nix_inv_end',LS_DATA='nixData',LS_CHK='nixChk',SESSION_MS=15*60*1000;
  var $=function(i){return document.getElementById(i)};
  var root=$('viewInv'),DATA=null,key='',endT=0,expiry=null;
  function wrap(s){return{get:function(k){try{return s.getItem(k)}catch(e){return null}},set:function(k,v){try{s.setItem(k,v)}catch(e){}},del:function(k){try{s.removeItem(k)}catch(e){}}}}
  var ls=wrap(localStorage),ss=wrap(sessionStorage);
  ls.del('nixKey');   // the old launcher kept the access code here permanently; remove it
  function el(t,c,txt){var e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e}
  function get(o,name){var k=Object.keys(o).find(function(x){return x.toLowerCase()===name.toLowerCase()});return k?o[k]:''}
  function sha(s){return crypto.subtle.digest('SHA-256',new TextEncoder().encode('nixInv1|'+s)).then(function(b){return btoa(String.fromCharCode.apply(null,new Uint8Array(b)))})}

  root.innerHTML='<div class="iv-wrap"><div id="ivLogin"></div><div id="ivMain" hidden>'+
    '<div class="iv-meta"><span id="ivInfo"></span><span><button class="iv-link" id="ivRef" type="button">Refresh</button><button class="iv-link" id="ivLock" type="button">Lock</button></span></div>'+
    '<div id="ivDash"></div>'+
    '<div id="ivFind" hidden><h2 class="iv-h">Find a piece</h2><div class="iv-bar"><input id="ivQ" type="search" placeholder="SKU, name, metal, certificate" autocomplete="off" enterkeyhint="search"><select id="ivSt"></select></div><div id="ivRes"></div></div>'+
    '<div id="ivForms"></div></div></div>';
  var det=el('div','iv-det');det.id='ivDet';det.hidden=true;document.body.appendChild(det);
  var stamp=function(){return new Date(DATA.fetched||Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})};

  /* ----- login ----- */
  function showLogin(msg,isErr){
    $('ivMain').hidden=true;var box=$('ivLogin');box.innerHTML='';
    var c=el('div','card iv-login');
    c.appendChild(el('h2','','Inventory'));
    c.appendChild(el('p','sub','Enter your inventory access code. It stays unlocked for 15 minutes.'));
    var inp=el('input');inp.type='password';inp.id='ivCode';inp.placeholder='Access code';inp.autocomplete='off';c.appendChild(inp);
    var er=el('div','err',isErr?msg:'');er.id='ivErr';c.appendChild(er);
    if(msg&&!isErr)c.insertBefore(el('p','sub',msg),inp);
    var go=el('button','btn','Unlock');go.type='button';go.id='ivGo';c.appendChild(go);
    var submit=function(){var v=inp.value.trim();if(!v)return;key=v;endT=0;load()};
    go.onclick=submit;inp.onkeydown=function(e){if(e.key==='Enter')submit()};
    box.appendChild(c);
  }
  function lockInv(msg){
    key='';endT=0;DATA=null;ss.del(KEYK);ss.del(ENDK);
    if(expiry){clearInterval(expiry);expiry=null}
    closeDetail();showLogin(msg,false);
  }
  function startExpiry(){
    if(expiry)clearInterval(expiry);
    expiry=setInterval(function(){if(endT&&Date.now()>endT)lockInv('Inventory session ended. Enter the code again.')},5000);
  }
  function fail(msg){key='';endT=0;ss.del(KEYK);ss.del(ENDK);showLogin(msg,true)}

  /* ----- dashboard ----- */
  function renderDash(d){
    var box=$('ivDash');box.innerHTML='';if(!d)return;
    box.appendChild(el('h2','iv-h','Dashboard'));
    var g=el('div','iv-kpis');
    d.cards.forEach(function(c){var k=el('div','iv-kpi');k.appendChild(el('small','',c.label));k.appendChild(el('b','',c.value));g.appendChild(k)});
    box.appendChild(g);
    var rows=d.status.filter(function(s){return !(/^Other/.test(s.label)&&s.value===0)});
    var max=Math.max.apply(null,[1].concat(rows.map(function(s){return s.value})));
    box.appendChild(el('h2','iv-h','Pieces by status'));
    var card=el('div','iv-card');
    rows.forEach(function(s){
      var r=el('div','iv-st'),tr=el('i'),fl=el('em');
      fl.style.width=(s.value/max*100)+'%';tr.appendChild(fl);
      r.appendChild(el('span','',s.label));r.appendChild(tr);r.appendChild(el('b','',String(s.value)));card.appendChild(r);
    });
    box.appendChild(card);
    if(d.rate)box.appendChild(el('p','iv-note','INR conversion uses CAD to INR '+d.rate+'.'));
  }

  /* ----- form links (replaced by in-app forms in the next step) ----- */
  function renderForms(){
    var box=$('ivForms');box.innerHTML='';
    if(!DATA||DATA.role==='dash')return;
    var groups=[];ITEMS.forEach(function(i){if(groups.indexOf(i.group)<0)groups.push(i.group)});
    groups.forEach(function(gname){
      box.appendChild(el('h2','iv-h',gname));
      var grid=el('div','ftiles');
      ITEMS.filter(function(i){return i.group===gname}).forEach(function(i){
        var ready=/^https?:\/\//.test(i.url),t=el(ready?'a':'div','ftile');
        if(ready){t.href=i.url;t.target='_blank';t.rel='noopener'}else t.style.opacity='.55';
        var ic=el('span','ic',i.icon),tx=el('span');tx.appendChild(el('b','',i.title));tx.appendChild(el('small','',ready?i.desc:'Link not set yet'));
        t.appendChild(ic);t.appendChild(tx);grid.appendChild(t);
      });
      box.appendChild(grid);
    });
  }

  /* ----- piece list ----- */
  function render(){
    var terms=$('ivQ').value.trim().toLowerCase().split(/\s+/).filter(Boolean),st=$('ivSt').value,res=$('ivRes');
    var rows=DATA.pieces.slice().reverse().filter(function(p){return (!st||get(p,'Status')===st)&&terms.every(function(t){return p._h.indexOf(t)>-1})});
    var total=rows.length,filtered=terms.length||st,limit=filtered?50:20;
    rows=rows.slice(0,limit);res.innerHTML='';
    if(!rows.length)res.appendChild(el('p','iv-note','No piece matches. Try a shorter search.'));
    rows.forEach(function(p){
      var b=el('button','iv-row'),left=el('span');b.type='button';
      left.appendChild(el('b','',p._sku));
      var sub=get(p,'Design / Name')||get(p,'Item Type');if(sub)left.appendChild(el('small','',sub));
      b.appendChild(left);
      var s=get(p,'Status');if(s)b.appendChild(el('span','pill',s));
      b.onclick=function(){openDetail(p)};res.appendChild(b);
    });
    $('ivInfo').textContent=(filtered?total+' found'+(total>limit?', showing '+limit:''):'Latest '+rows.length+' of '+DATA.pieces.length)+'. Updated '+stamp();
  }

  /* ----- piece detail ----- */
  function fields(obj,skip){
    var card=el('div','iv-card');
    Object.keys(obj).forEach(function(k){
      if(k[0]==='_'||skip.indexOf(k.toLowerCase())>-1)return;
      var row=el('div','iv-f'),b=el('b'),v=obj[k];row.appendChild(el('span','',k));
      if(/^https?:\/\//.test(v)){var a=el('a','','Open link');a.href=v;a.target='_blank';a.rel='noopener';b.appendChild(a)}else b.textContent=v;
      row.appendChild(b);card.appendChild(row);
    });
    return card.children.length?card:null;
  }
  function openDetail(p){
    det.innerHTML='';var body=el('div','iv-body');det.appendChild(body);
    var back=el('button','iv-back','‹ Back');back.type='button';back.onclick=function(){history.back()};body.appendChild(back);
    body.appendChild(el('h3','',p._sku));
    var nm=get(p,'Design / Name');if(nm)body.appendChild(el('p','nm',nm));
    var st=get(p,'Status');if(st)body.appendChild(el('span','pill',st));
    var pk=Object.keys(p).find(function(k){return /photo/i.test(k)&&/^https?:/.test(p[k])});
    if(pk){var id=(p[pk].match(/[-\w]{25,}/)||[])[0];
      if(id){var im=el('img');im.alt='Photo of '+p._sku;im.src='https://drive.google.com/thumbnail?id='+id+'&sz=w800';im.onerror=function(){im.remove()};body.appendChild(im)}}
    var main=fields(p,['sku','status','design / name','notes']);if(main)body.appendChild(main);
    var dia=DATA.diamonds[p._sku]||[];
    body.appendChild(el('h2','iv-h','Diamonds ('+dia.length+')'));
    if(!dia.length)body.appendChild(el('p','iv-note','No diamond details entered yet.'));
    dia.forEach(function(d){
      var role=get(d,'Diamond Role')||'Diamond',shape=get(d,'Shape');
      body.appendChild(el('div','iv-note',role+(shape?', '+shape:'')));
      var c=fields(d,['diamond role']);if(c)body.appendChild(c);
    });
    var note=get(p,'Notes');if(note){body.appendChild(el('h2','iv-h','Notes'));body.appendChild(el('p','iv-note',note))}
    det.hidden=false;det.scrollTop=0;document.body.style.overflow='hidden';history.pushState({iv:1},'');
  }
  function closeDetail(){det.hidden=true;document.body.style.overflow=''}
  window.addEventListener('popstate',closeDetail);

  /* ----- data ----- */
  function setData(d){
    DATA=d;$('ivLogin').innerHTML='';$('ivMain').hidden=false;
    renderDash(d.dash);renderForms();
    if(d.role==='full'&&d.pieces){
      d.pieces.forEach(function(p){
        var dv=(d.diamonds[p._sku]||[]).map(function(x){return Object.keys(x).map(function(k){return x[k]}).join(' ')}).join(' ');
        p._h=(Object.keys(p).map(function(k){return p[k]}).join(' ')+' '+dv).toLowerCase();
      });
      var sts=[];d.pieces.forEach(function(p){var s=get(p,'Status');if(s&&sts.indexOf(s)<0)sts.push(s)});sts.sort();
      var sel=$('ivSt'),cur=sel.value;sel.innerHTML='';
      [''].concat(sts).forEach(function(s){var o=el('option','',s||'All statuses');o.value=s;sel.appendChild(o)});
      sel.value=sts.indexOf(cur)>-1?cur:'';
      $('ivFind').hidden=false;render();
    }else{$('ivFind').hidden=true;$('ivInfo').textContent='Updated '+stamp()}
  }
  function opened(d,offline){
    if(!endT)endT=Date.now()+SESSION_MS;
    ss.set(KEYK,key);ss.set(ENDK,String(endT));startExpiry();setData(d);
    if(offline)$('ivInfo').textContent+=' (offline copy)';
  }
  function offline(){
    var c=ls.get(LS_DATA),h=ls.get(LS_CHK);
    if(!c||!h)return fail('Could not load. Check your internet.');
    return sha(key).then(function(x){
      if(x!==h)return fail('Could not reach the server, and that code does not match the saved copy.');
      try{opened(JSON.parse(c),true)}catch(e){fail('Could not load. Check your internet.')}
    });
  }
  function load(){
    if(!/^https?:/.test(API_URL)){showLogin('Not connected yet. Paste the web app link at the top of inventory.js.',true);return}
    if(!key){showLogin();return}
    var go=$('ivGo');if(go){go.disabled=true;go.textContent='Checking…'}
    $('ivInfo').textContent='Updating…';
    return fetch(API_URL+'?key='+encodeURIComponent(key)).then(function(r){return r.json()}).then(function(j){
      if(!j.ok){if(/^Wrong/.test(j.error)){ls.del(LS_DATA);ls.del(LS_CHK)}return fail(j.error)}
      j.data.fetched=Date.now();ls.set(LS_DATA,JSON.stringify(j.data));
      return sha(key).then(function(h){ls.set(LS_CHK,h);opened(j.data,false)});
    },function(){return offline()});
  }

  $('ivQ').addEventListener('input',function(){DATA&&DATA.pieces&&render()});
  $('ivSt').addEventListener('change',function(){DATA&&DATA.pieces&&render()});
  $('ivRef').onclick=function(){load()};
  $('ivLock').onclick=function(){lockInv('')};

  NixApp.on('unlock',function(){
    var k=ss.get(KEYK),e=parseInt(ss.get(ENDK)||'0',10);
    if(k&&e>Date.now()){key=k;endT=e;load()}else showLogin();
  });
  NixApp.on('lock',function(){lockInv('')});
  NixApp.on('view',function(v){
    if(v!=='inv')return;
    if(endT&&Date.now()>endT)lockInv('Inventory session ended. Enter the code again.');
    var c=$('ivCode');if(c)setTimeout(function(){c.focus()},50);
  });
})();
