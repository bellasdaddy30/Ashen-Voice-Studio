
(function(){
  function fatal(msg){
    var el=document.getElementById('startupError');
    if(el){el.textContent='Startup error: '+msg;}
    else {document.body.innerHTML='<div style="padding:20px;color:white;background:#0b0908;font-family:system-ui"><h2>Ashen Voice could not start</h2><pre style="white-space:pre-wrap;color:#efada6">'+String(msg).replace(/[&<>]/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]})+'</pre></div>';}
  }
  window.__ashenFatal=fatal;
  function runtimeError(msg){
    console.error(msg);
    var s=document.getElementById('status');
    if(s){s.textContent='Runtime error · tap engine again';}
    var err=document.getElementById('runtimeErrorBox');
    if(err){err.textContent=String(msg);}
  }
  window.addEventListener('error',function(e){
    var msg=(e.error&&e.error.stack)||e.message||'Unknown JavaScript error';
    if(document.body.dataset.ashenReady==='1') runtimeError(msg); else fatal(msg);
  });
  window.addEventListener('unhandledrejection',function(e){
    var msg=(e.reason&&e.reason.stack)||String(e.reason||'Unhandled promise rejection');
    if(document.body.dataset.ashenReady==='1') runtimeError(msg); else fatal(msg);
  });
})();
