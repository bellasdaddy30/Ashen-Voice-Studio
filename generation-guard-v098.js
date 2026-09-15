// Ashen Voice Studio v0.9.8 — natural phrase joins
// Keeps mobile-safe chunking while removing stacked edge silence between chunks.
(function(){
  var MIG='ashen-v098-natural-joins-migrated';
  var PERF='ashen-performance-v090-meta';

  function perf(){try{return JSON.parse(localStorage.getItem(PERF)||'{}')}catch(e){return{}}}
  function recorded(l){try{return !!perf()[l.id]||charByName(l.speaker)?.mode==='record'}catch(e){return false}}
  function words(s){return String(s||'').trim().split(/\s+/).filter(Boolean)}
  function count(s){return words(s).length}

  // Keep complete sentences together when they are reasonably short. Only long
  // sentences are split at natural clause boundaries, then by words as a last resort.
  function splitNatural(text){
    var src=String(text||'').replace(/\s+/g,' ').trim();
    if(!src)return[];
    var sentences=src.match(/[^.!?…]+[.!?…]+[”"']?|[^.!?…]+$/g)||[src];
    var out=[];
    for(var si=0;si<sentences.length;si++){
      var s=sentences[si].trim();
      if(!s)continue;
      if(count(s)<=15 && s.length<=115){out.push(s);continue}

      var clauses=s.match(/[^,;:]+[,;:]?|[,;:]+/g)||[s];
      var cur='';
      function flush(){if(cur.trim()){out.push(cur.trim());cur=''}}
      for(var ci=0;ci<clauses.length;ci++){
        var cl=clauses[ci].trim();
        if(!cl)continue;
        var cand=(cur?cur+' ':'')+cl;
        if(count(cand)<=13 && cand.length<=95){cur=cand;continue}
        flush();
        if(count(cl)<=13 && cl.length<=95){cur=cl;continue}
        var ws=words(cl),bucket=[];
        while(ws.length){
          bucket=ws.splice(0,11);
          out.push(bucket.join(' '));
        }
      }
      flush();
    }
    return out.filter(Boolean);
  }

  function boundaryPause(s){
    s=String(s||'').trim();
    if(/[.!?…][”"']?$/.test(s))return .085;
    if(/[,;:][”"']?$/.test(s))return .018;
    return 0;
  }

  // Remove only dead air at a generated phrase's edges. Keep a few milliseconds
  // of padding so consonants/breaths are not shaved off.
  function trimPcm(pcm,rate){
    if(!pcm||pcm.length<32)return pcm;
    var peak=0;
    for(var p=0;p<pcm.length;p+=Math.max(1,Math.floor(pcm.length/6000)))peak=Math.max(peak,Math.abs(pcm[p]));
    if(!peak)return pcm;
    var threshold=Math.max(.0008,Math.min(.006,peak*.018));
    var frame=Math.max(24,Math.round(rate*.006));
    var first=0,last=pcm.length-1;
    function activeAt(start){
      var end=Math.min(pcm.length,start+frame),mx=0;
      for(var i=start;i<end;i++)mx=Math.max(mx,Math.abs(pcm[i]));
      return mx>=threshold;
    }
    while(first<pcm.length-frame && !activeAt(first))first+=frame;
    var back=Math.max(0,pcm.length-frame);
    while(back>0 && !activeAt(back))back-=frame;
    last=Math.min(pcm.length-1,back+frame-1);
    var pre=Math.round(rate*.012),post=Math.round(rate*.018);
    first=Math.max(0,first-pre);last=Math.min(pcm.length-1,last+post);
    if(last<=first)return pcm;
    return pcm.slice(first,last+1);
  }

  async function tightMerge(blobs,parts){
    var decoded=[];
    for(var i=0;i<blobs.length;i++)decoded.push(await decode(blobs[i]));
    var rate=decoded[0].sampleRate||24000,pcs=[],pauses=[];
    for(var j=0;j<decoded.length;j++){
      var a=decoded[j],src=a.getChannelData(0);
      if(a.sampleRate!==rate)src=resample(src,a.sampleRate,rate);
      pcs.push(trimPcm(src,rate));
      pauses.push(j===decoded.length-1?0:boundaryPause(parts[j]));
    }
    var total=0;
    for(var k=0;k<pcs.length;k++)total+=pcs[k].length+Math.round(pauses[k]*rate);
    var pcm=new Float32Array(total),cur=0;
    for(var n=0;n<pcs.length;n++){
      pcm.set(pcs[n],cur);cur+=pcs[n].length;
      cur+=Math.round(pauses[n]*rate);
    }
    return encodeWav(state.settings.normalize?normalizePcm(pcm,.94):pcm,rate);
  }

  async function renderPiece(l,text){
    var piece=Object.assign({},l,{text:text}),lastError=null;
    for(var attempt=0;attempt<2;attempt++){
      try{
        var b=await renderLine(piece);
        if(!b||!b.size)throw new Error('empty audio returned');
        var a=await decode(b),dur=Number(a.duration)||0;
        if(dur<Math.max(.18,count(text)/5.1))throw new Error('generated phrase was too short');
        return b;
      }catch(e){
        lastError=e;
        try{stopKokoroWorker('Restarting voice engine after failed phrase')}catch(x){}
        await sleep(180);
      }
    }
    throw lastError||new Error('phrase generation failed');
  }

  async function naturalRender(l){
    if(recorded(l))return renderLine(l);
    var parts=splitNatural(l.text);
    if(!parts.length)throw new Error('No speakable text');
    var blobs=[];
    for(var i=0;i<parts.length;i++){
      setStatus('Rendering '+l.speaker+' · part '+(i+1)+'/'+parts.length+'…');
      blobs.push(await renderPiece(l,parts[i]));
      await sleep(35);
    }
    return blobs.length===1?blobs[0]:tightMerge(blobs,parts);
  }

  async function invalidatePreviousLong(){
    if(localStorage.getItem(MIG))return 0;
    var ch=chapter(),n=0;
    for(var i=0;i<ch.lines.length;i++){
      var l=ch.lines[i];
      if(recorded(l)||count(l.text)<=12)continue;
      var b=await dbGet(lineKey(l)).catch(function(){return null});
      if(b){await dbDel(lineKey(l)).catch(function(){});n++}
      l.generated=false;
    }
    if(n){await dbDel(masterKey()).catch(function(){});ch.masterReady=false}
    localStorage.setItem(MIG,'1');save();return n;
  }

  generateOne=async function(id,opt){
    opt=opt||{};var quiet=!!opt.quiet;
    var l=chapter().lines.find(function(x){return x.id===id});if(!l)return false;
    try{
      var blob=await naturalRender(l);
      await dbPut(lineKey(l),blob);l.generated=true;chapter().masterReady=false;
      await dbDel(masterKey()).catch(function(){});save();
      if(state.settings.memorySaver)await sleep(70);
      if(!quiet)render();return true;
    }catch(e){
      console.error(e);await dbDel(lineKey(l)).catch(function(){});l.generated=false;chapter().masterReady=false;save();
      if(!quiet)alert('Render failed: '+(e&&e.message?e.message:String(e)));return false;
    }
  };
  generateOne.__avNaturalJoinV098=true;

  var gm=generateMissing;
  generateMissing=async function(){var n=await invalidatePreviousLong();if(n)setStatus(n+' long WAV'+(n===1?'':'s')+' removed · rebuilding with natural joins…');return gm()};
  var pc=produceChapter;
  produceChapter=async function(){var n=await invalidatePreviousLong();if(n)setStatus(n+' long WAV'+(n===1?'':'s')+' removed · rebuilding with natural joins…');return pc()};

  if(typeof loadRepo==='function'){
    var lr=loadRepo;
    loadRepo=async function(){var ok=await lr.apply(this,arguments);if(ok){var n=await invalidatePreviousLong();if(n){render();setStatus('Project loaded · '+n+' long WAV'+(n===1?'':'s')+' marked for smoother regeneration')}}return ok};
  }

  window.__ashenNaturalChunks=splitNatural;
})();
