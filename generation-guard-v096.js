// Ashen Voice Studio v0.9.6 — strict phrase-chunk generation for mobile reliability
// Regenerates risky synthetic WAVs once, preserves recorded performances, and
// produces TTS in short punctuation-aware phrases to prevent mid-sentence cutoffs.
(function(){
  const PERF_META='ashen-performance-v090-meta';
  const MIGRATION_KEY='ashen-v096-strict-chunks-migrated';
  const MAX_WORDS=9;
  const MAX_CHARS=72;

  function perfMeta(){try{return JSON.parse(localStorage.getItem(PERF_META)||'{}')}catch{return{}}}
  function hasRecordedPerformance(l){
    try{return !!perfMeta()[l.id] || (charByName(l.speaker)?.mode==='record')}catch{return false}
  }
  function wordsOf(t){return (String(t||'').trim().match(/[A-Za-z0-9À-ÖØ-öø-ÿ'’\-]+/g)||[])}
  function wordCount(t){return wordsOf(t).length}
  function charCount(t){return String(t||'').replace(/\s+/g,' ').trim().length}
  function risky(l){return !hasRecordedPerformance(l)&&(wordCount(l.text)>7||charCount(l.text)>55)}

  function splitWords(text,maxWords=MAX_WORDS,maxChars=MAX_CHARS){
    const ws=String(text||'').trim().split(/\s+/).filter(Boolean),out=[];let cur=[];
    for(const w of ws){
      const next=[...cur,w],s=next.join(' ');
      if(cur.length&&(next.length>maxWords||s.length>maxChars)){out.push(cur.join(' '));cur=[w]}else cur=next;
    }
    if(cur.length)out.push(cur.join(' '));
    return out;
  }

  function phraseChunks(text){
    const src=String(text||'').replace(/\s+/g,' ').trim();if(!src)return[];
    const sentences=src.match(/[^.!?…]+[.!?…]+[”"']?|[^.!?…]+$/g)||[src];
    const out=[];
    for(const sentence0 of sentences){
      const sentence=sentence0.trim();if(!sentence)continue;
      const clauses=sentence.match(/[^,;:]+[,;:]?|[,;:]+/g)?.map(x=>x.trim()).filter(Boolean)||[sentence];
      let cur='';
      const flush=()=>{if(cur){out.push(cur.trim());cur=''}};
      for(const clause of clauses){
        const cand=(cur?cur+' ':'')+clause;
        if(wordCount(cand)<=MAX_WORDS&&cand.length<=MAX_CHARS){cur=cand;continue}
        flush();
        if(wordCount(clause)<=MAX_WORDS&&clause.length<=MAX_CHARS)cur=clause;
        else out.push(...splitWords(clause));
      }
      flush();
    }
    return out.filter(Boolean);
  }

  function effectiveSpeed(l){
    try{
      const c=charByName(l.speaker)||{},em=EMOTIONS[l.emotion||c.emotion]||EMOTIONS.neutral||{},d=typeof dFor==='function'?dFor(l):null;
      return Math.max(.55,Math.min(1.8,(Number(c.speed)||1)*(Number(em.speed)||1)*(Number(d?.speedFactor)||1)));
    }catch{return 1}
  }

  async function qcChunk(l,blob,text){
    if(!blob?.size||blob.size<700)return{ok:false,reason:'empty or tiny audio',duration:0};
    let a;try{a=await decode(blob)}catch{return{ok:false,reason:'undecodable audio',duration:0}}
    const dur=Number(a.duration)||0,w=Math.max(1,wordCount(text)),spd=effectiveSpeed(l);
    // Short phrase generations should comfortably exceed this even at brisk delivery.
    const min=Math.max(.18,w/(4.25*spd));
    let abrupt=false;
    try{
      const pcm=a.getChannelData(0),rate=a.sampleRate||24000,n=Math.min(pcm.length,Math.max(64,Math.round(rate*.05)));
      let peak=0,ss=0,all=0,allN=0;const step=Math.max(1,Math.floor(pcm.length/4000));
      for(let i=0;i<pcm.length;i+=step){all+=pcm[i]*pcm[i];allN++}
      for(let i=pcm.length-n;i<pcm.length;i++){const x=pcm[i];peak=Math.max(peak,Math.abs(x));ss+=x*x}
      const allR=Math.sqrt(all/Math.max(1,allN)),tailR=Math.sqrt(ss/Math.max(1,n));
      abrupt=peak>.06&&allR>0&&tailR/allR>.48;
    }catch{}
    return{ok:dur>=min&&!abrupt,reason:dur<min?'too short for phrase':abrupt?'phrase ends abruptly':'',duration:dur,min,abrupt};
  }

  function internalPause(s){
    s=String(s||'').trim();
    if(/[.!?…][”"']?$/.test(s))return .065;
    if(/[,;:][”"']?$/.test(s))return .035;
    return .018;
  }

  async function renderPhrase(l,text,isLast){
    // Give an otherwise bare internal phrase a tiny prosodic boundary so Kokoro
    // does not treat it as an unfinished stream of text.
    const spoken=/[.!?…,;:][”"']?$/.test(text)||isLast?text:text+',';
    const piece={...l,text:spoken};
    let best=null,bestDur=-1,lastReason='incomplete phrase';
    for(let attempt=1;attempt<=3;attempt++){
      const b=await renderLine(piece),q=await qcChunk(l,b,text);
      if(q.duration>bestDur){best=b;bestDur=q.duration}
      if(q.ok)return b;
      lastReason=q.reason||lastReason;
      await sleep(55*attempt);
    }
    if(best){const q=await qcChunk(l,best,text);if(q.ok)return best}
    throw new Error(`TTS phrase failed QC: ${lastReason}`);
  }

  async function strictRender(l){
    if(hasRecordedPerformance(l))return renderLine(l);
    const chunks=phraseChunks(l.text);
    if(!chunks.length)throw new Error('Line has no speakable text');
    const blobs=[],pauses=[];
    for(let i=0;i<chunks.length;i++){
      setStatus(`Rendering ${l.speaker} · phrase ${i+1}/${chunks.length}…`);
      blobs.push(await renderPhrase(l,chunks[i],i===chunks.length-1));
      pauses.push(i===chunks.length-1?0:internalPause(chunks[i]));
    }
    return blobs.length===1?blobs[0]:merge(blobs,pauses);
  }

  async function invalidateLegacyRisky(){
    if(localStorage.getItem(MIGRATION_KEY))return 0;
    let n=0;
    for(const l of chapter().lines||[]){
      if(!risky(l))continue;
      const b=await dbGet(lineKey(l)).catch(()=>null);
      if(b){await dbDel(lineKey(l)).catch(()=>{});n++}
      l.generated=false;
    }
    if(n){await dbDel(masterKey()).catch(()=>{});chapter().masterReady=false}
    localStorage.setItem(MIGRATION_KEY,'1');save();return n;
  }

  // Replace the v0.9.5 generator. Short lines also use strict phrase rendering,
  // so newly generated synthetic speech follows one deterministic path.
  generateOne=async function(id,{quiet=false}={}){
    const l=chapter().lines.find(x=>x.id===id);if(!l)return false;
    try{
      const blob=await strictRender(l);
      if(!hasRecordedPerformance(l)){
        // Validate the finished line against all of its text, but do not rely on
        // this alone. Every component phrase already passed QC above.
        const a=await decode(blob),w=Math.max(1,wordCount(l.text)),spd=effectiveSpeed(l);
        if((Number(a.duration)||0)<Math.max(.18,w/(4.4*spd)))throw new Error('assembled line is shorter than its phrase set allows');
      }
      await dbPut(lineKey(l),blob);l.generated=true;chapter().masterReady=false;
      await dbDel(masterKey()).catch(()=>{});save();if(state.settings.memorySaver)await sleep(65);
      if(!quiet)render();return true;
    }catch(e){
      console.error(e);await dbDel(lineKey(l)).catch(()=>{});l.generated=false;chapter().masterReady=false;save();
      if(!quiet)alert(`Render failed or was incomplete: ${e.message}`);return false;
    }
  };
  generateOne.__avStrictPhraseV096=true;

  const priorGenerateMissing=generateMissing;
  generateMissing=async function(){
    const removed=await invalidateLegacyRisky();
    if(removed)setStatus(`${removed} older long WAV${removed===1?'':'s'} removed · regenerating with strict phrases…`);
    return priorGenerateMissing();
  };

  const priorProduce=produceChapter;
  produceChapter=async function(){
    const removed=await invalidateLegacyRisky();
    if(removed)setStatus(`${removed} older long WAV${removed===1?'':'s'} removed · rebuilding safely…`);
    return priorProduce();
  };

  const priorAssemble=assemble;
  assemble=async function(silent=false){
    const removed=await invalidateLegacyRisky();
    if(removed){const msg=`${removed} older long WAV${removed===1?' was':'s were'} invalidated. Run Generate Missing before assembling.`;setStatus(msg);render();if(!silent)alert(msg);return null}
    return priorAssemble(silent);
  };

  if(typeof loadRepo==='function'){
    const priorLoadRepo=loadRepo;
    loadRepo=async function(...args){
      const ok=await priorLoadRepo(...args);if(!ok)return ok;
      const removed=await invalidateLegacyRisky();
      if(removed){render();setStatus(`Project loaded · ${removed} older long WAV${removed===1?'':'s'} marked for safe regeneration`)}
      return ok;
    };
  }

  window.__ashenPhraseChunks=phraseChunks;
})();
