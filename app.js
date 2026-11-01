/* Nix app shell: PIN lock, 15-minute session, theme, bottom navigation.
   Other modules (calc.js, inventory.js) plug in with NixApp.on('unlock' | 'lock' | 'view', fn). */
(function(){
  var PIN_SALT=window.PIN_SALT||'', PIN_HASH=window.PIN_HASH||'';
  var ITER=250000, SESSION_MS=15*60*1000, SKEY='nix_session_end', FKEY='nix_fails';
  var $=function(i){return document.getElementById(i)};
  var H={unlock:[],lock:[],view:[]}, tick=null;
  var app=window.NixApp={locked:true,view:'calc',
    on:function(e,f){H[e].push(f)},
    emit:function(e,a){H[e].forEach(function(f){try{f(a)}catch(x){if(window.console)console.error(x)}})}};

  function ss(k,v){try{if(v===undefined)return sessionStorage.getItem(k);if(v===null)sessionStorage.removeItem(k);else sessionStorage.setItem(k,v)}catch(e){}}
  function b64(b){return btoa(String.fromCharCode.apply(null,new Uint8Array(b)))}
  function unb64(t){return Uint8Array.from(atob(t),function(c){return c.charCodeAt(0)})}
  function derive(pin,salt){
    return crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']).then(function(k){
      return crypto.subtle.deriveBits({name:'PBKDF2',salt:salt,iterations:ITER,hash:'SHA-256'},k,256)});
  }

  /* ----- views and navigation ----- */
  function showView(v){
    app.view=v;$('viewCalc').hidden=v!=='calc';$('viewInv').hidden=v!=='inv';
    document.querySelectorAll('.nv button').forEach(function(b){var on=b.dataset.v===v;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
    window.scrollTo(0,0);app.emit('view',v);
  }
  document.querySelectorAll('.nv button').forEach(function(b){b.addEventListener('click',function(){showView(b.dataset.v)})});

  /* ----- theme ----- */
  $('theme').addEventListener('click',function(){var r=document.documentElement,c=r.getAttribute('data-theme');
    var d=c?c==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.setAttribute('data-theme',d?'light':'dark')});

  /* ----- PIN lock and session ----- */
  function showLock(msg){
    app.locked=true;app.emit('lock');
    $('app').hidden=true;$('lock').hidden=false;
    if(tick){clearInterval(tick);tick=null}
    ss(SKEY,null);
    $('lockSetup').hidden=!!PIN_HASH;$('lockEnter').hidden=!PIN_HASH;
    $('pin').value='';$('pinErr').textContent=msg||'';
    setTimeout(function(){(PIN_HASH?$('pin'):$('np1')).focus()},50);
  }
  function openSession(end){
    $('lock').hidden=true;$('app').hidden=false;
    ss(SKEY,String(end));
    function t(){
      var left=end-Date.now();
      if(left<=0){showLock('Session ended after 15 minutes. Enter your PIN code to continue.');return}
      var m=Math.floor(left/60000),sec=Math.floor(left%60000/1000);
      $('timer').textContent='Session '+m+':'+(sec<10?'0':'')+sec;
    }
    t();if(tick)clearInterval(tick);tick=setInterval(t,1000);
    app.locked=false;showView('calc');app.emit('unlock');
  }
  function tryUnlock(){
    var fails=parseInt(ss(FKEY)||'0',10),until=parseInt(ss('nix_until')||'0',10);
    if(Date.now()<until){$('pinErr').textContent='Too many attempts. Wait '+Math.ceil((until-Date.now())/1000)+' seconds.';return}
    var pin=$('pin').value;if(!pin)return;
    $('unlock').disabled=true;
    derive(pin,unb64(PIN_SALT)).then(function(h){
      $('unlock').disabled=false;
      if(b64(h)===PIN_HASH){ss(FKEY,null);ss('nix_until',null);openSession(Date.now()+SESSION_MS)}
      else{fails++;ss(FKEY,String(fails));
        if(fails>=3){var w=Math.min(300,15*Math.pow(2,fails-3));ss('nix_until',String(Date.now()+w*1000));$('pinErr').textContent='Incorrect PIN code. Wait '+w+' seconds before trying again.'}
        else $('pinErr').textContent='Incorrect PIN code.';
        $('pin').value='';$('pin').focus()}
    },function(){$('unlock').disabled=false;$('pinErr').textContent='This browser cannot run the PIN check. Open the page over https.'});
  }
  function makePin(){
    var a=$('np1').value,b=$('np2').value,e=$('setupErr');
    if(a.length<8){e.textContent='Use at least 8 characters.';return}
    if(a!==b){e.textContent='The two entries do not match.';return}
    e.textContent='';
    var salt=crypto.getRandomValues(new Uint8Array(16));
    derive(a,salt).then(function(h){
      $('setupText').value="var PIN_SALT='"+b64(salt)+"';\nvar PIN_HASH='"+b64(h)+"';";
      $('setupOut').hidden=false;$('np1').value='';$('np2').value='';
    },function(){e.textContent='This browser cannot create the PIN code. Open the page over https.'});
  }
  $('unlock').addEventListener('click',tryUnlock);
  $('pin').addEventListener('keydown',function(e){if(e.key==='Enter')tryUnlock()});
  $('mk').addEventListener('click',makePin);
  $('lockNow').addEventListener('click',function(){showLock('')});

  app.start=function(){var end=parseInt(ss(SKEY)||'0',10);if(PIN_HASH&&end>Date.now())openSession(end);else showLock('')};
})();
