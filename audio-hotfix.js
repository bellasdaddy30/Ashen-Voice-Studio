// Ashen Voice Studio v1.2.1 audio engine bridge + low-memory assembly
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
  const w=new Worker('/kokoro-worker.js?v=121',{type:'module'});
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
    try{e.preventDefault?.();e.stopPropagation?.()}catch{}
    const raw=String(e?.message||'').trim();
    const msg=raw&&raw!=='Script error.'?raw:'Kokoro voice worker crashed in Safari';
    console.error('Kokoro worker error',e);
    rejectWorkerPending(msg);
    try{w.terminate()}catch{}
    if(kokoroWorker===w)kokoroWorker=null;
    kokoroWorkerReady=false;
    kokoro=null;
    kokoroLoading=null;
    setVoiceBusy(false);
    setEngineProgress(msg+' · retrying is safe',false);
    return true;
  };
  w.onmessageerror=(e)=>{
    const msg='Kokoro worker returned unreadable audio data';
    rejectWorkerPending(msg);
    try{w.terminate()}catch{}
    if(kokoroWorker===w)kokoroWorker=null;
    kokoroWorkerReady=false;kokoro=null;kokoroLoading=null;
    setVoiceBusy(false);setEngineProgress(msg,false);
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

// Low-memory WAV assembly. The old merge() decoded every line and retained all
// AudioBuffers simultaneously. This version keeps source WAV data as Blob slices
// whenever possible and only decodes one non-standard line at a time.
async function ashenWavInfo(blob){
  const ab=await blob.slice(0,Math.min(blob.size,65536)).arrayBuffer(),v=new DataView(ab);
  const s=(o,n)=>{let x='';for(let i=0;i<n&&o+i<v.byteLength;i++)x+=String.fromCharCode(v.getUint8(o+i));return x};
  if(v.byteLength<44||s(0,4)!=='RIFF'||s(8,4)!=='WAVE')return null;
  let off=12,fmt=null,dataOffset=0,dataSize=0;
  while(off+8<=v.byteLength){const id=s(off,4),z=v.getUint32(off+4,true),p=off+8;if(id==='fmt '&&p+16<=v.byteLength)fmt={format:v.getUint16(p,true),channels:v.getUint16(p+2,true),rate:v.getUint32(p+4,true),blockAlign:v.getUint16(p+12,true),bits:v.getUint16(p+14,true)};else if(id==='data'){dataOffset=p;dataSize=Math.min(z,blob.size-p);break}off=p+z+(z&1)}
  return fmt&&dataOffset&&dataSize?{...fmt,dataOffset,dataSize}:null;
}
function ashenWavHeader(dataBytes,rate){const b=new ArrayBuffer(44),v=new DataView(b),w=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i))};w(0,'RIFF');v.setUint32(4,36+dataBytes,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,dataBytes,true);return b}
function floatToPcm16Bytes(src){const b=new ArrayBuffer(src.length*2),v=new DataView(b);for(let i=0;i<src.length;i++){const x=Math.max(-1,Math.min(1,src[i]||0));v.setInt16(i*2,x<0?x*32768:x*32767,true)}return new Uint8Array(b)}
merge=async function(blobs,pauses){
  if(!blobs?.length)return new Blob([],{type:'audio/wav'});
  let first=await ashenWavInfo(blobs[0]).catch(()=>null),rate=first?.rate||0;
  if(!rate){const d=await decode(blobs[0]);rate=d.sampleRate}
  const parts=[],zeroCache=new Map();let dataBytes=0;
  for(let i=0;i<blobs.length;i++){
    const b=blobs[i],info=await ashenWavInfo(b).catch(()=>null);
    if(info&&info.format===1&&info.channels===1&&info.bits===16&&info.rate===rate){parts.push(b.slice(info.dataOffset,info.dataOffset+info.dataSize));dataBytes+=info.dataSize}
    else{
      const d=await decode(b),src=d.getChannelData(0),pcm=d.sampleRate===rate?src:resample(src,d.sampleRate,rate),bytes=floatToPcm16Bytes(pcm);parts.push(bytes);dataBytes+=bytes.byteLength
    }
    const pauseFrames=Math.max(0,Math.round((Number(pauses?.[i])||0)*rate)),pauseBytes=pauseFrames*2;
    if(pauseBytes){let z=zeroCache.get(pauseBytes);if(!z){z=new Uint8Array(pauseBytes);if(zeroCache.size<8)zeroCache.set(pauseBytes,z)}parts.push(z);dataBytes+=pauseBytes}
    if(i%12===0)await new Promise(r=>setTimeout(r,0));
  }
  return new Blob([ashenWavHeader(dataBytes,rate),...parts],{type:'audio/wav'});
};
