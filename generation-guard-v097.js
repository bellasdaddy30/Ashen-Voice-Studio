// Ashen Voice Studio v0.9.7 — Safari-safe phrase generation
(function(){
  var MIG='ashen-v097-safe-chunks-migrated';
  var PERF='ashen-performance-v090-meta';

  function perf(){try{return JSON.parse(localStorage.getItem(PERF)||'{}')}catch(e){return{}}}
  function recorded(l){try{return !!perf()[l.id]||charByName(l.speaker)?.mode==='record'}catch(e){return false}}
  function words(s){return String(s||'').trim().split(/\s+/).filter(Boolean)}
  function count(s){return words(s).length}

  function splitSentence(s){
    s=String(s||'').trim();
    if(!s)return[];
    var rough=s.split(/(?<=[.!?…])\s+|(?<=[,;:])\s+/).filter(Boolean);
    var out=[];
    for(var i=0;i<rough.length;i++){
      var part=rough[i].trim();
      var w=words(part);
      while(w.length>12){
        out.push(w.slice(0,10).join(' '));
        w=w.slice(10);
      }
      if(w.length)out.push(w.join(' '));
    }
    return out;
  }

  function pauseFor(s){
    s=String(s||'').trim();
    if(/[.!?…]$/.test(s))return .07;
    if(/[,;:]$/.test(s))return .035;
    return .02;
  }

  async function renderPiece(l,text,last){
    var piece=Object.assign({},l,{text:text});
    var lastError=null;
    for(var attempt=0;attempt<2;attempt++){
      try{
        var b=await renderLine(piece);
        if(!b||!b.size)throw new Error('empty audio returned');
        var a=await decode(b);
        var d=Number(a.duration)||0;
        var min=Math.max(.18,count(text)/5.0);
        if(d<min)throw new Error('generated phrase was too short');
        return b;
      }catch(e){
        lastError=e;
        try{stopKokoroWorker('Restarting voice engine after failed phrase')}catch(x){}
        await sleep(180);
      }
    }
    throw lastError||new Error('phrase generation failed');
  }

  async function safeRender(l){
    if(recorded(l))return renderLine(l);
    var parts=splitSentence(l.text);
    if(!parts.length)throw new Error('No speakable text');
    var blobs=[],pauses=[];
    for(var i=0;i<parts.length;i++){
      setStatus('Rendering '+l.speaker+' · part '+(i+1)+'/'+parts.length+'…');
      blobs.push(await renderPiece(l,parts[i],i===parts.length-1));
      pauses.push(i===parts.length-1?0:pauseFor(parts[i]));
      await sleep(45);
    }
    return blobs.length===1?blobs[0]:merge(blobs,pauses);
  }

  async function invalidateOld(){
    if(localStorage.getItem(MIG))return 0;
    var n=0,ch=chapter();
    for(var i=0;i<ch.lines.length;i++){
      var l=ch.lines[i];
      if(recorded(l)||count(l.text)<=10)continue;
      var b=await dbGet(lineKey(l)).catch(function(){return null});
      if(b){await dbDel(lineKey(l)).catch(function(){});n++}
      l.generated=false;
    }
    if(n){await dbDel(masterKey()).catch(function(){});ch.masterReady=false}
    localStorage.setItem(MIG,'1');
    save();
    return n;
  }

  generateOne=async function(id,opt){
    opt=opt||{};
    var quiet=!!opt.quiet;
    var l=chapter().lines.find(function(x){return x.id===id});
    if(!l)return false;
    try{
      var blob=await safeRender(l);
      await dbPut(lineKey(l),blob);
      l.generated=true;
      chapter().masterReady=false;
      await dbDel(masterKey()).catch(function(){});
      save();
      if(state.settings.memorySaver)await sleep(80);
      if(!quiet)render();
      return true;
    }catch(e){
      console.error(e);
      await dbDel(lineKey(l)).catch(function(){});
      l.generated=false;
      chapter().masterReady=false;
      save();
      if(!quiet)alert('Render failed: '+(e&&e.message?e.message:String(e)));
      return false;
    }
  };

  var gm=generateMissing;
  generateMissing=async function(){
    var n=await invalidateOld();
    if(n)setStatus(n+' older long WAV'+(n===1?'':'s')+' removed · rebuilding safely…');
    return gm();
  };

  var pc=produceChapter;
  produceChapter=async function(){
    var n=await invalidateOld();
    if(n)setStatus(n+' older long WAV'+(n===1?'':'s')+' removed · rebuilding safely…');
    return pc();
  };

  if(typeof loadRepo==='function'){
    var lr=loadRepo;
    loadRepo=async function(){
      var ok=await lr.apply(this,arguments);
      if(ok){
        var n=await invalidateOld();
        if(n){render();setStatus('Project loaded · '+n+' older long WAV'+(n===1?'':'s')+' marked for regeneration')}
      }
      return ok;
    };
  }
})();
