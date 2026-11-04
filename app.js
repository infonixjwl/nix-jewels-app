/* Nix app shell: theme, bottom navigation, and a fresh reload whenever the app is opened again.
   The calculator opens straight away; Inventory has its own access code (inventory.js).
   Modules plug in with NixApp.on('unlock' | 'lock' | 'view', fn). */
(function(){
  var $=function(i){return document.getElementById(i)};
  var H={unlock:[],lock:[],view:[]};
  var app=window.NixApp={locked:false,view:'calc',
    on:function(e,f){H[e].push(f)},
    emit:function(e,a){H[e].forEach(function(f){try{f(a)}catch(x){if(window.console)console.error(x)}})}};

  /* ----- views and navigation ----- */
  function showView(v){
    app.view=v;$('viewCalc').hidden=v!=='calc';$('viewInv').hidden=v!=='inv';
    document.querySelectorAll('.nv button').forEach(function(b){var on=b.dataset.v===v;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
    try{sessionStorage.setItem('nix_view',v)}catch(e){}
    window.scrollTo(0,0);app.emit('view',v);
  }
  document.querySelectorAll('.nv button').forEach(function(b){b.addEventListener('click',function(){showView(b.dataset.v)})});

  /* ----- theme ----- */
  $('theme').addEventListener('click',function(){var r=document.documentElement,c=r.getAttribute('data-theme');
    var d=c?c==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.setAttribute('data-theme',d?'light':'dark')});

  /* ----- reload when the app is opened again ----- */
  // Coming back to the app after 10 seconds or more reloads it, so prices, data and the app itself are fresh.
  // Skipped while a piece screen or form is open, so nothing you are typing is lost (prices still refresh).
  var hiddenAt=0;
  function busy(){var d=$('ivDet');return d&&!d.hidden}
  document.addEventListener('visibilitychange',function(){
    if(document.hidden){hiddenAt=Date.now();return}
    if(hiddenAt&&Date.now()-hiddenAt>10000&&!busy())location.reload();
  });
  window.addEventListener('pageshow',function(e){if(e.persisted&&!busy())location.reload()});

  app.start=function(){
    var v='calc';
    try{if(sessionStorage.getItem('nix_view')==='inv')v='inv'}catch(e){}
    showView(v);app.emit('unlock');
  };
})();
