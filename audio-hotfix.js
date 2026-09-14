// Ashen Voice Studio v0.7.6 audio engine bridge
// iPhone/iPad: force Kokoro WASM q8. Worker returns raw Float32 PCM buffers.

function isAppleMobile(){return /iPhone|iPad|iPod/i.test(navigator.userAgent)}
function workerAudioToBlob(g){
  if(g?.pcmBuffer){
    const pcm=new Float32Array(g.pcmBuffer);
    return encodeWav(pcm,g.sampleRate||24000);
  }
  if(g?.audioBuffer)return new Blob([g.audioBuffer],{type:g.mime||'audio/wav'});
  if(g?.blob)return g.blob;
  throw new Error('Voice worker returned no audio data');
}

ensureKokoroWorker=function(){
  if(kokoroWorker)return kokoroWorker;
  const w=new Worker('/kokoro-worker.js?v=076',{type:'module'});
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
};

loadKokoro=async function(){
  if(kokoro&&kokoroWorkerReady)return kokoro;
  if(kokoroLoading)return kokoroLoading;
  kokoroLoading=(async()=>{
    const apple=isAppleMobile();
    let device=state.settings.device;
    let dtype=state.settings.dtype||'q8';
    if(apple){
      device='wasm';dtype='q8';state.settings.device='wasm';state.settings.dtype='q8';
    }else{
      if(device==='auto')device=navigator.gpu?'webgpu':'wasm';
      if(state.settings.memorySaver)dtype='q8';
      if(device==='webgpu'&&dtype==='fp32')dtype='fp16';
    }
    const cfg=`${device}:${dtype}`;
    if(kokoroWorkerReady&&kokoroWorkerConfigKey===cfg)return kokoro;
    setVoiceBusy(true,apple?'Starting iPhone quality engine · WASM q8':`Starting voice engine · ${device} ${dtype}`);
    const r=await kokoroWorkerCall('load',{model:KOKORO_MODEL,device,dtype});
    kokoroWorkerReady=true;
    kokoroWorkerConfigKey=`${r.device||device}:${r.dtype||dtype}`;
    kokoro={
      generate:async(text,opts={})=>{
        const g=await kokoroWorkerCall('generate',{text,voice:opts.voice,speed:opts.speed||1});
        return{toBlob:async()=>workerAudioToBlob(g)};
      },
      generateBlend:async(text,opts={})=>{
        const g=await kokoroWorkerCall('generateBlend',{
          text,voiceA:opts.voiceA,voiceB:opts.voiceB,weight:opts.weight,speed:opts.speed||1
        });
        return workerAudioToBlob(g);
      },
      dispose:async()=>{try{await kokoroWorkerCall('dispose')}catch{}}
    };
    setVoiceBusy(false);
    setEngineProgress(`Voice engine ready · ${r.device||device} ${r.dtype||dtype}`,false);
    try{save()}catch{}
    return kokoro;
  })();
  try{return await kokoroLoading}
  catch(e){
    console.error(e);
    stopKokoroWorker('Voice engine failed · '+(e?.message||e));
    throw e;
  }finally{kokoroLoading=null}
};
