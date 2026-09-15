// Ashen Voice Studio v0.9.5 — generation completeness guard
// Reject truncated WAVs, split risky synthetic lines into smaller TTS chunks,
// and repair stored state before Generate Missing / Produce / Assemble.
(function(){
  const PERF_META='ashen-performance-v090-meta';

  function perfMeta(){try{return JSON.parse(localStorage.getItem(PERF_META)||'{}')}catch{return{}}}
  function hasRecordedPerformance(l){
    try{return !!perfMeta()[l.id] || (charByName(l.speaker)?.mode==='record')}catch{return false}
  }
  function wordCount(text){return (String(text||'').trim().match(/[A-Za-z0-9À-ÖØ-öø-ÿ'’\-]+/g)||[]).length}
  function charCount(text){return String(text||'').replace(/\s+/g,' ').trim().length}
  function effectiveSpeed(l){
    try{
      const c=charByName(l.speaker)||{};
      const em=EMOTIONS[l.emotion||c.emotion]||EMOTIONS.neutral||{};
      const d=(typeof dFor==='function')?dFor(l):null;
      return Math.max(.55,Math.min(1.8,(Number(c.speed)||1)*(Number(em.speed)||1)*(Number(d?.speedFactor)||1)));
    }catch{return 1}
  }

  async function inspectLineAudio(l,blob){
    if(!blob||!blob.size)return{ok:false,reason:'missing audio',duration:0};
    if(blob.size<700)return{ok:false,reason:'audio file is too small',duration:0};
    let a;
    try{a=await decode(blob)}catch(e){return{ok:false,reason:'WAV cannot be decoded',duration:0,error:e?.message||String(e)}}
    const dur=Number(a.duration)||0;
    if(dur<.12)return{ok:false,reason:'audio is effectively empty',duration:dur};
    if(hasRecordedPerformance(l))return{ok:true,recorded:true,duration:dur};

    const words=wordCount(l.text),chars=charCount(l.text),spd=effectiveSpeed(l);
    if(words<=2)return{ok:dur>=.18,reason:dur>=.18?'':'short line audio is incomplete',duration:dur};

    // 312 wpm at 1.0x is deliberately generous. Anything shorter is almost certainly cut off.
    const minByWords=words/(5.2*spd);
    const minByChars=chars/(30*spd);
    const hardMin=Math.max(.22,minByWords,minByChars);

    let abrupt=false,tailRatio=0;
    try{
      const pcm=a.getChannelData(0),rate=a.sampleRate||24000;
      const tailN=Math.min(pcm.length,Math.max(64,Math.round(rate*.055)));
      let all=0,allN=0,tail=0,tailPeak=0;
      const step=Math.max(1,Math.floor(pcm.length/5000));
      for(let i=0;i<pcm.length;i+=step){all+=pcm[i]*pcm[i];allN++}
      for(let i=pcm.length-tailN;i<pcm.length;i++){const x=pcm[i];tail+=x*x;tailPeak=Math.max(tailPeak,Math.abs(x))}
      const allRms=Math.sqrt(all/Math.max(1,allN)),tailRms=Math.sqrt(tail/Math.max(1,tailN));
      tailRatio=allRms?tailRms/allRms:0;
      abrupt=tailPeak>.055&&tailRatio>.38;
    }catch{}

    // A second, softer test catches audio that ends abruptly while already suspiciously fast.
    const softMin=words/(4.0*spd);
    const ok=dur>=hardMin && !(abrupt&&dur<softMin);
    return{ok,reason:ok?'':(dur<hardMin?'duration is too short for the text':'audio ends abruptly before the expected line length'),duration:dur,hardMin,softMin,abrupt,tailRatio,words};
  }
  window.__ashenLineAudioQC=inspectLineAudio;

  function hardSplit(text,max=145){
    const words=String(text||'').trim().split(/\s+/).filter(Boolean),out=[];let cur='';
    for(const w of words){
      const next=(cur?cur+' ':'')+w;
      if(next.length>max&&cur){out.push(cur);cur=w}else cur=next;
      if(cur.length>82&&/[,:;]$/.test(w)){out.push(cur);cur=''}
    }
    if(cur)out.push(cur);return out;
  }
  function safeChunks(text,max=155){
    const src=String(text||'').trim();if(src.length<=max)return[src];
    const units=src.match(/[^.!?…]+[.!?…]+[”"']?|[^.!?…]+$/g)||[src];
    const out=[];let cur='';
    for(const raw of units){
      const u=raw.trim();if(!u)continue;
      if(u.length>max){if(cur){out.push(cur);cur=''};out.push(...hardSplit(u,max-10));continue}
      const next=(cur?cur+' ':'')+u;
      if(next.length>max&&cur){out.push(cur);cur=u}else cur=next;
    }
    if(cur)out.push(cur);return out.filter(Boolean);
  }
  function chunkPause(s){s=String(s||'').trim();return /[.!?…][”"']?$/.test(s)?.11:/[,;:][”"']?$/.test(s)?.065:.035}

  async function robustRender(l,forceSplit=false){
    if(hasRecordedPerformance(l))return renderLine(l);
    const chunks=safeChunks(l.text,forceSplit?82:155);
    if(chunks.length===1&&!forceSplit)return renderLine(l);
    const blobs=[],pauses=[];
    for(const part of chunks){
      const piece={...l,text:part};
      const b=await renderLine(piece);
      const q=await inspectLineAudio(piece,b);
      if(!q.ok)throw new Error(`Incomplete TTS chunk: ${q.reason}`);
      blobs.push(b);pauses.push(chunkPause(part));
    }
    return merge(blobs,pauses);
  }

  async function auditStored({deleteBad=true}={}){
    const ch=chapter();let good=0,bad=0,missing=0;
    for(const l of ch.lines||[]){
      const b=await dbGet(lineKey(l)).catch(()=>null);
      if(!b){l.generated=false;missing++;continue}
      const q=await inspectLineAudio(l,b);
      if(q.ok){l.generated=true;good++}
      else{
        l.generated=false;bad++;
        if(deleteBad)await dbDel(lineKey(l)).catch(()=>{});
      }
    }
    if(bad||missing){ch.masterReady=false;await dbDel(masterKey()).catch(()=>{})}
    save();
    return{good,bad,missing};
  }
  window.auditGeneratedAudio=()=>auditStored({deleteBad:true});

  const oldGenerateOne=generateOne;
  generateOne=async function(id,{quiet=false}={}){
    const l=chapter().lines.find(x=>x.id===id);if(!l)return false;
    setStatus(`Rendering ${l.speaker}…`);
    try{
      let blob=await robustRender(l,false),q=await inspectLineAudio(l,blob);
      if(!q.ok&&!hasRecordedPerformance(l)){
        setStatus(`Repairing incomplete ${l.speaker} line…`);
        blob=await robustRender(l,true);q=await inspectLineAudio(l,blob);
      }
      if(!q.ok)throw new Error(`Incomplete line rejected: ${q.reason}`);
      await dbPut(lineKey(l),blob);l.generated=true;chapter().masterReady=false;
      await dbDel(masterKey()).catch(()=>{});save();
      if(state.settings.memorySaver)await sleep(55);
      if(!quiet)render();return true;
    }catch(e){
      console.error(e);await dbDel(lineKey(l)).catch(()=>{});l.generated=false;chapter().masterReady=false;save();
      if(!quiet)alert(`Render failed or was incomplete: ${e.message}`);return false;
    }
  };
  generateOne.__avCompletenessV095=true;

  const oldGenerateMissing=generateMissing;
  generateMissing=async function(){
    const a=await auditStored({deleteBad:true});
    if(a.bad)setStatus(`${a.bad} incomplete WAV${a.bad===1?'':'s'} removed · regenerating…`);
    return oldGenerateMissing();
  };

  const oldProduceChapter=produceChapter;
  produceChapter=async function(){
    const a=await auditStored({deleteBad:true});
    if(a.bad)setStatus(`${a.bad} incomplete WAV${a.bad===1?'':'s'} removed · repairing chapter…`);
    return oldProduceChapter();
  };

  const oldAssemble=assemble;
  assemble=async function(silent=false){
    const a=await auditStored({deleteBad:true});
    if(a.bad||a.missing){
      const msg=`Cannot assemble final master: ${a.bad} incomplete and ${a.missing} missing line${a.bad+a.missing===1?'':'s'}. Run Generate Missing first.`;
      setStatus(msg);render();if(!silent)alert(msg);return null;
    }
    return oldAssemble(silent);
  };

  if(typeof loadRepo==='function'){
    const oldLoadRepo=loadRepo;
    loadRepo=async function(...args){
      const ok=await oldLoadRepo(...args);if(!ok)return ok;
      const a=await auditStored({deleteBad:true});
      render();
      if(a.bad)setStatus(`Project loaded · ${a.good} valid WAVs · ${a.bad} incomplete WAV${a.bad===1?'':'s'} removed`);
      return ok;
    };
  }
})();
