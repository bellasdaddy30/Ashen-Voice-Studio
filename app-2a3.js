function parseText(text){const paras=String(text||'').replace(/\r/g,'').split(/\n\s*\n+/).map(s=>s.trim()).filter(Boolean),out=[];for(const p of paras){const explicit=p.match(/^([A-Z][A-Z0-9 _'’\-]{1,40}):\s*([\s\S]+)$/);if(explicit){const sp=titleCase(explicit[1]);const known=state.characters.find(c=>c.name.toLowerCase()===sp.toLowerCase());if(known){out.push(mkLine(explicit[2],known.name,known.name==='Narrator'?'narration':'dialogue',1));continue}}const quoted=/^[“"][\s\S]*[”"]$/.test(p),clean=quoted?p.replace(/^[“"]|[”"]$/g,'').trim():p,l=mkLine(clean,'Narrator',quoted?'dialogue':'narration',quoted?.2:1);if(quoted){l.needsSpeakerReview=true;l.note='Speaker requires manual assignment'}out.push(l)}return out;}
function splitNarration(s){const max=420;if(s.length<=max)return[s];const sentences=s.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)||[s];const out=[];let cur='';for(const q of sentences){if((cur+' '+q).trim().length>max&&cur){out.push(cur.trim());cur=q}else cur=(cur+' '+q).trim()}if(cur)out.push(cur);return out;}
function mkLine(text,speaker,type,confidence){return{id:uid(),text:text.trim(),speaker,type,confidence,emotion:'neutral',pause:null,note:'',generated:false};}
function titleCase(s){return s.trim().toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());}


let kokoroWorker=null;
let kokoroWorkerSeq=0;
let kokoroWorkerPending=new Map();
let kokoroWorkerReady=false;
let kokoroWorkerConfigKey='';
let voicePreviewBusy=false;

function setEngineProgress(msg,busy=false){
  const e=byId('engineProgress');
  if(e)e.innerHTML=(busy?'<span class="spinner"></span>':'')+esc(msg||'');
  if(msg)setStatus(msg);
}
function setVoiceBusy(on,msg=''){
  voicePreviewBusy=!!on;
  document.querySelectorAll('.quickPreview,.previewOne,#previewVoice,#loadK').forEach(b=>b.disabled=!!on);
  const c=byId('cancelK');
  if(c)c.disabled=!on&&!kokoroWorker;
  if(msg)setEngineProgress(msg,on);
}
function rejectWorkerPending(reason){
  for(const [,p] of kokoroWorkerPending){try{p.reject(new Error(reason))}catch{}}
  kokoroWorkerPending.clear();
}
function stopKokoroWorker(reason='Voice engine canceled'){
  if(kokoroWorker){
    try{kokoroWorker.terminate()}catch{}
  }
  kokoroWorker=null;
  kokoroWorkerReady=false;
  kokoro=null;
  kokoroLoading=null;
  rejectWorkerPending(reason);
  setVoiceBusy(false);
  setEngineProgress(reason,false);
}
function ensureKokoroWorker(){
  if(kokoroWorker)return kokoroWorker;
  const w=new Worker('/kokoro-worker.js?v=070',{type:'module'});
  kokoroWorker=w;
  w.onmessage=(ev)=>{
    const m=ev.data||{};
    if(m.type==='progress'){
      const d=m.data||{};
      let text='Loading Kokoro model…';
      if(d.status==='progress'&&Number.isFinite(d.progress))text=`Loading Kokoro model · ${Math.round(d.progress)}%`;
      else if(d.file)text=`Loading ${d.file}`;
      setEngineProgress(text,true);
      return;
    }
    if(m.type==='status'){
      setEngineProgress(m.message||'Voice engine working…',m.busy!==false);
      return;
    }
    const p=kokoroWorkerPending.get(m.id);
    if(!p)return;
    kokoroWorkerPending.delete(m.id);
    if(m.ok)p.resolve(m);
    else p.reject(new Error(m.error||'Voice worker failed'));
  };
  w.onerror=(e)=>{
    console.error('Kokoro worker error',e);
    rejectWorkerPending(e.message||'Voice worker crashed');
    kokoroWorkerReady=false;
    kokoro=null;
    setVoiceBusy(false);
    setEngineProgress('Voice worker crashed · app still running',false);
  };
  return w;
}
function kokoroWorkerCall(type,payload={}){
  const w=ensureKokoroWorker();
  const id='kw-'+(++kokoroWorkerSeq)+'-'+Date.now();
  return new Promise((resolve,reject)=>{
    kokoroWorkerPending.set(id,{resolve,reject});
    try{w.postMessage({id,type,...payload})}
    catch(e){kokoroWorkerPending.delete(id);reject(e)}
  });
}
async function loadKokoro(){
  if(kokoro&&kokoroWorkerReady)return kokoro;
  if(kokoroLoading)return kokoroLoading;
  kokoroLoading=(async()=>{
    let device=state.settings.device;
    if(device==='auto')device=navigator.gpu?'webgpu':'wasm';
    let dtype;
    if(device==='webgpu')dtype=state.settings.memorySaver?'q4f16':(state.settings.dtype==='q4'?'q4f16':state.settings.dtype);
    else dtype=state.settings.memorySaver?'q4':state.settings.dtype;
    const cfg=`${device}:${dtype}`;
    if(kokoroWorkerReady&&kokoroWorkerConfigKey===cfg)return kokoro;
    setVoiceBusy(true,`Starting voice engine · ${device} ${dtype}`);
    const r=await kokoroWorkerCall('load',{model:KOKORO_MODEL,device,dtype});
    kokoroWorkerReady=true;
    kokoroWorkerConfigKey=`${r.device||device}:${r.dtype||dtype}`;
    kokoro={
      generate:async(text,opts={})=>{
        const g=await kokoroWorkerCall('generate',{text,voice:opts.voice,speed:opts.speed||1});
        return {toBlob:async()=>g.blob};
      },
      dispose:async()=>{try{await kokoroWorkerCall('dispose')}catch{}}
    };
    setVoiceBusy(false);
    setEngineProgress(`Voice engine ready · ${r.device||device} ${r.dtype||dtype}`,false);
    return kokoro;
  })();
  try{return await kokoroLoading}
  catch(e){
    console.error(e);
    stopKokoroWorker('Voice engine failed · '+(e?.message||e));
    throw e;
  }finally{kokoroLoading=null}
}
async function disposeKokoro(){stopKokoroWorker('Voice engine unloaded');}
