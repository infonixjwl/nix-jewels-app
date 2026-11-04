(function(){
  var OZ=31.1034768, KEY='nix_calc_v2';
  var $=function(i){return document.getElementById(i)};
  var fx={CAD:null,INR:null,date:'',src:'',ts:0};
  var gold={usdoz:null,ts:0,src:'',daily:false,warn:''};

  function num(v){var n=parseFloat(String(v).replace(/,/g,''));return isFinite(n)?n:NaN}
  function fmt(v,c,d){if(!isFinite(v))return '–';d=d==null?2:d;
    return new Intl.NumberFormat(c==='INR'?'en-IN':'en-CA',{style:'currency',currency:c,minimumFractionDigits:d,maximumFractionDigits:d}).format(v)}
  function getJSON(u){return fetch(u,{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})}
  function when(ts){return new Date(ts).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}
  function ago(ts){var m=Math.round((Date.now()-ts)/60000);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'}

  function save(){try{localStorage.setItem(KEY,JSON.stringify({fx:fx,gold:gold}))}catch(e){}}
  function load(){try{var s=JSON.parse(localStorage.getItem(KEY)||'null');if(!s)return;
    if(s.fx&&s.fx.CAD)fx=s.fx;if(s.gold&&s.gold.usdoz)gold=s.gold;
}catch(e){}}

  /* ---------- FX ---------- */
  function fxOK(c,i){return c>0.8&&c<2.5&&i>40&&i<200}
  function fetchFx(){
    var a=getJSON('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CAD,INR').then(function(d){
      if(!fxOK(d.rates.CAD,d.rates.INR))throw 0;return{CAD:d.rates.CAD,INR:d.rates.INR,date:d.date,src:'ECB via Frankfurter'}});
    var b=function(){return getJSON('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json').then(function(d){
      if(!fxOK(d.usd.cad,d.usd.inr))throw 0;return{CAD:d.usd.cad,INR:d.usd.inr,date:d.date,src:'Currency-API (backup source)'}})};
    return a.catch(b).then(function(r){r.ts=Date.now();fx=r;return true},function(){return false});
  }
  function dot(ids,st){ids.forEach(function(i){$(i).className='dot '+st})}
  function showFx(failed){
    if(!fx.CAD){$('tCad').textContent='–';$('tInr').textContent='–';dot(['dFx','dFx2'],'bad');$('sFx').textContent='Rates unavailable. Press Refresh all.';return}
    $('tCad').textContent=fx.CAD.toFixed(4);$('tInr').textContent=fx.INR.toFixed(2);
    dot(['dFx','dFx2'],(failed||Date.now()-fx.ts>864e5)?'warn':'ok');
    $('sFx').textContent=(failed?'Refresh failed, showing last saved rates. ':'')+'Rates dated '+fx.date+' · '+fx.src+' · fetched '+ago(fx.ts);
  }

  /* ---------- Gold ---------- */
  function goldOK(p){return p>300&&p<50000}
  function fetchGold(){
    var p1=getJSON('https://api.gold-api.com/price/XAU').then(function(d){
      if(!goldOK(d.price))throw 0;return{usd:d.price,ts:d.updatedAt?Date.parse(d.updatedAt):Date.now(),src:'Gold-API.com'}}).catch(function(){return null});
    var p2=getJSON('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.json').then(function(d){
      if(!goldOK(d.xau.usd))throw 0;return{usd:d.xau.usd,ts:Date.parse(d.date+'T00:00:00Z'),src:'Currency-API (daily)'}}).catch(function(){return null});
    return Promise.all([p1,p2]).then(function(r){
      var a=r[0],b=r[1],use=a||b;
      if(!use)return false;
      var w='';
      if(a&&b&&Math.abs(a.usd-b.usd)/a.usd>0.03)w='The two price sources differ by more than 3%. Confirm the gold price with your supplier before quoting.';
      gold={usdoz:use.usd,ts:use.ts,src:use.src,daily:use===b,warn:w};return true});
  }
  function showGold(failed){
    var W=$('goldWarn');
    if(!gold.usdoz){$('tGold').textContent='–';$('tG').textContent='–';dot(['dGold','dGold2'],'bad');$('sGold').textContent='Gold price unavailable. Press Refresh all.';W.innerHTML='';return}
    $('tGold').textContent=fmt(gold.usdoz,'USD');$('tG').textContent=fmt(gold.usdoz/OZ,'USD');
    var stale=failed||gold.daily||Date.now()-gold.ts>6*36e5;dot(['dGold','dGold2'],stale?'warn':'ok');
    $('sGold').textContent=(failed?'Refresh failed, showing last saved price. ':'')+'Gold: '+gold.src+' · '+(gold.daily?'daily price, not live (as of '+new Date(gold.ts).toISOString().slice(0,10)+')':'updated '+ago(gold.ts));
    var m=[];if(gold.warn)m.push(gold.warn);
    if(gold.daily)m.push('The live gold source was unavailable. This is a once-a-day price and may be hours behind the market.');
    W.innerHTML=m.map(function(x){return '<div class="note">'+x+'</div>'}).join('');
  }

  /* ---------- Calculations ---------- */
  var summary='',gMode='market';
  try{if(localStorage.getItem('nix_gmode')==='house')gMode='house'}catch(e){}
  function conv(v,f,t){var r={USD:1,CAD:fx.CAD,INR:fx.INR};return v/r[f]*r[t]}
  function calc(){
    var a=num($('amt').value),f=$('from').value,t=$('to').value;
    if(fx.CAD&&isFinite(a)){
      $('curOut').textContent=fmt(conv(a,f,t),t);
      $('curInv').textContent='1 '+f+' = '+conv(1,f,t).toFixed(4)+' '+t+'  ·  1 '+t+' = '+conv(1,t,f).toFixed(4)+' '+f;
      $('curAll').innerHTML=['USD','CAD','INR'].map(function(c){return '<tr><td>'+c+'</td><td>'+fmt(conv(a,f,c),c)+'</td></tr>'}).join('');
    }else{$('curOut').textContent='–';$('curInv').textContent='';$('curAll').innerHTML=''}

    var K=num($('karat').value),w=num($('gw').value),lab=num($('lab').value)||0,prem=num($('prem').value)||0;
    var house=gMode==='house';
    $('mkt').hidden=house;$('premBox').hidden=house;$('mktLab').hidden=house;$('pgBox').hidden=house;$('house').hidden=!house;$('goldSell').hidden=!house;
    document.querySelectorAll('#gMode button').forEach(function(b){b.classList.toggle('on',b.dataset.m===gMode)});
    if(house){calcHouse(w);return pgTable(prem)}
    document.querySelectorAll('.chip').forEach(function(c){c.classList.toggle('on',c.dataset.k===String(K))});
    var gUSD=gold.usdoz?gold.usdoz/OZ*(1+prem/100):NaN;
    summary='';
    if(isFinite(gUSD)&&fx.CAD&&w>0){
      // gold weight x today's price per gram for the chosen karat
      var rateU=gUSD*K/24,mU=w*rateU,lU=conv(lab,$('labCur').value,'USD'),tU=mU+lU;
      var C=function(v){return fmt(conv(v,'USD','CAD'),'CAD')};
      $('goldBig').textContent=C(tU);
      $('goldAlt').textContent=fmt(tU,'USD')+'  ·  '+fmt(conv(tU,'USD','INR'),'INR',0);
      $('goldBrk').textContent='Metal '+C(mU)+'  +  Labour '+C(lU);
      $('goldSub').textContent=w+' g × '+K+'K price '+C(rateU)+' per g';
      summary=K+'K gold, '+w+' g at '+C(rateU)+'/g: metal CAD '+C(mU)+', labour CAD '+C(lU)+', total CAD '+C(tU)+'. Gold '+fmt(gold.usdoz,'USD')+'/oz, 1 USD = '+fx.CAD.toFixed(4)+' CAD (rates dated '+fx.date+').';
    }else{$('goldBig').textContent='–';$('goldAlt').textContent='';$('goldBrk').textContent='';$('goldSub').textContent=gold.usdoz?'Enter the gold weight.':'Waiting for the gold price.'}
    $('goldLbl').textContent='Total cost (CAD)';
    pgTable(prem);
  }

  /* In-house method for 14K: fixed rupee rates (editable), plus a profit range on top of the total */
  function calcHouse(w){
    var rate=num($('hRate').value)||0,lab=num($('hLab').value)||0,per=$('hLabU').value,other=num($('hOther').value)||0,dia=num($('hDia').value)||0;
    var p1=num($('hP1').value),p2=num($('hP2').value);
    var I=function(v){return fmt(v,'INR',0)},Cd=function(v){return fx.INR?fmt(conv(v,'INR','CAD'),'CAD'):''};
    $('goldLbl').textContent='Total cost (CAD), in-house method';
    if(!(w>0)){$('goldBig').textContent='–';$('goldAlt').textContent='';$('goldBrk').textContent='';$('goldSub').textContent='Enter the gold weight.';$('goldSell').textContent='';summary='';return}
    var g=w*rate,l=per==='g'?w*lab:lab,t=g+l+other+dia;
    $('goldBig').textContent=fx.INR?Cd(t):I(t);
    $('goldAlt').textContent=I(t)+(fx.INR?'  ·  1 INR = '+conv(1,'INR','CAD').toFixed(5)+' CAD':'  ·  CAD needs the exchange rate');
    $('goldBrk').textContent='Gold '+I(g)+'  +  Labour '+I(l)+'  +  Other '+I(other)+(dia?'  +  Diamonds '+I(dia):'');
    $('goldSub').textContent=w+' g × '+I(rate)+' per g'+(per==='g'?'  ·  labour '+I(lab)+' per g':'');
    var sell='',sum='';
    if(isFinite(p1)){
      var a=t*(1+p1/100),b=isFinite(p2)?t*(1+p2/100):a,range=isFinite(p2)&&p2!==p1;
      sell='Selling price ('+p1+(range?'–'+p2:'')+'% profit): '+(fx.INR?Cd(a)+(range?' – '+Cd(b):''):I(a)+(range?' – '+I(b):''));
      sum=' Selling price at '+p1+(range?'–'+p2:'')+'%: '+(fx.INR?Cd(a)+(range?' to '+Cd(b):''):I(a)+(range?' to '+I(b):''))+'.';
    }
    $('goldSell').textContent=sell;
    summary='14K in-house, '+w+' g: gold '+I(g)+', labour '+I(l)+', other '+I(other)+(dia?', diamonds '+I(dia):'')+', total '+I(t)+(fx.INR?' ('+Cd(t)+' at 1 INR = '+conv(1,'INR','CAD').toFixed(5)+' CAD)':'')+'.'+sum;
  }
  function pgTable(prem){
    var gUSD=gold.usdoz?gold.usdoz/OZ*(1+prem/100):NaN;
    $('pgTbl').innerHTML=(isFinite(gUSD)&&fx.CAD)?[24,22,21,18,14,10,9].map(function(k){var u=gUSD*k/24;
      return '<tr><td>'+k+'K</td><td>'+fmt(u,'USD')+'</td><td>'+fmt(conv(u,'USD','CAD'),'CAD')+'</td><td>'+fmt(conv(u,'USD','INR'),'INR')+'</td></tr>'}).join('')
      :'<tr><td colspan="4" style="text-align:left">Waiting for live prices.</td></tr>';
  }
  function toast(m){var t=$('toast');t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(function(){t.hidden=true},2000)}
  function render(fxFail,goldFail){showFx(fxFail);showGold(goldFail);calc();save()}

  function busy(btn,txt,p){var o=btn.textContent;btn.disabled=true;btn.textContent=txt;return p.then(function(r){btn.disabled=false;btn.textContent=o;return r})}
  function refreshFx(){return busy($('rfFx'),'Refreshing…',fetchFx()).then(function(ok){render(!ok,false)})}
  function refreshGold(){return busy($('rfGold'),'Refreshing…',Promise.all([fetchFx(),fetchGold()])).then(function(r){render(!r[0],!r[1])})}

  ['amt','from','to','karat','gw','prem','lab','labCur','hRate','hLab','hLabU','hOther','hDia','hP1','hP2'].forEach(function(id){$(id).addEventListener('input',function(){calc();save()})});
  $('hLabU').addEventListener('change',calc);
  document.querySelectorAll('#gMode button').forEach(function(b){b.addEventListener('click',function(){gMode=b.dataset.m;try{localStorage.setItem('nix_gmode',gMode)}catch(e){}calc()})});
  function refreshAll(){return busy($('rfAll'),'Refreshing…',Promise.all([fetchFx(),fetchGold()])).then(function(r){render(!r[0],!r[1])})}
  $('rfAll').addEventListener('click',refreshAll);
  document.querySelectorAll('input[inputmode="decimal"]').forEach(function(i){i.addEventListener('focus',function(){setTimeout(function(){try{i.select()}catch(e){}},0)})});
  document.querySelectorAll('.chip').forEach(function(c){c.addEventListener('click',function(){$('karat').value=c.dataset.k;calc();save()})});
  document.querySelectorAll('.tabs button').forEach(function(b){b.addEventListener('click',function(){$('viewCalc').dataset.tab=b.dataset.t;document.querySelectorAll('.tabs button').forEach(function(x){x.classList.toggle('on',x===b)})})});
  $('cp').addEventListener('click',function(){if(!summary){toast('Nothing to copy yet');return}
    (navigator.clipboard?navigator.clipboard.writeText(summary):Promise.reject()).then(function(){toast('Summary copied')},function(){toast('Copy is not available in this browser')})});
  $('rfFx').addEventListener('click',refreshFx);
  $('rfGold').addEventListener('click',refreshGold);
  $('swap').addEventListener('click',function(){var f=$('from').value;$('from').value=$('to').value;$('to').value=f;calc();save()});

  /* ---------- start, stop and auto refresh (every minute) ---------- */
  var loaded=false,auto=null,autoBusy=false,lastAuto=0;
  function silentRefresh(){
    if(document.hidden||NixApp.locked||autoBusy)return;
    autoBusy=true;lastAuto=Date.now();
    Promise.all([fetchFx(),fetchGold()]).then(function(r){render(!r[0]&&!!fx.CAD,!r[1]&&!!gold.usdoz)}).then(function(){autoBusy=false},function(){autoBusy=false});
  }
  function stopAuto(){if(auto){clearInterval(auto);auto=null}}
  function startAuto(){stopAuto();lastAuto=Date.now();auto=setInterval(silentRefresh,60000)}
  function startApp(){
    if(!loaded){load();loaded=true}
    startAuto();
    render(false,false);
    Promise.all([fetchFx(),fetchGold()]).then(function(r){render(!r[0]&&!!fx.CAD,!r[1]&&!!gold.usdoz)});
  }
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&auto&&Date.now()-lastAuto>60000)silentRefresh()});
  NixApp.on('unlock',startApp);
  NixApp.on('view',function(v){if(v==='calc'&&auto&&Date.now()-lastAuto>60000)silentRefresh()});
})();
