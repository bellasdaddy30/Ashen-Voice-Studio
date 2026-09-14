// Ashen Voice Studio v0.9.1 — iPhone recording reliability patch
// Avoid MediaRecorder as the critical path. Capture microphone PCM with Web Audio,
// save a mono WAV directly, and offer native iPhone capture as a fallback.
(function(){
  const META_KEY='ashen-performance-v090-meta';
  let currentLineId=null;
  let stream=null,ctx=null,source=null,processor=null,silent=null,chunks=[],rate=48000,activeLine=null;

  const $=id=>document.getElementById(id);
  const lineById=id=>{try{return chapter().lines.find(x=>x.id===id)||null}catch{return null}};
  const perfKey=l=>`ashen:performance:v090:${chapter().id}:${l.id}`;
  const metaRead=()=>{try{return JSON.parse(localStorage.getItem(META_KEY)||'{}')}catch{return{}}};
  const metaWrite=m=>{try{localStorage.setItem(META_KEY,JSON.stringify(m))}catch{}};

  function wavBlob(pcm,sampleRate){
    const ab=new ArrayBuffer(44+pcm.length*2),v=new DataView(ab);
    const wr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
    wr(0,'RIFF');v.setUint32(4,36+pcm.length*2,true);wr(8,'WAVE');wr(12,'fmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
    wr(36,'data');v.setUint32(40,pcm.length*2,true);
    let o=44;for(let i=0;i<pcm.length;i++,o+=2){let x=Math.max(-1,Math.min(1,pcm[i]));v.setInt16(o,x<0?x*32768:x*32767,true)}
    return new Blob([ab],{type:'audio/wav'});
  }

  function joinChunks(parts){let n=0;for(const a of parts)n+=a.length;const out=new Float32Array(n);let p=0;for(const a of parts){out.set(a,p);p+=a.length}return out}

  async function savePerformance(l,blob,name){
    if(!l||!blob?.size)throw Error('No audio was captured.');
    await dbPut(perfKey(l),blob);
    const m=metaRead();m[l.id]={sourceName:name||'Recorded on iPhone',bytes:blob.size,storedAt:Date.now(),speaker:l.speaker,text:String(l.text||'').slice(0,90)};metaWrite(m);
    l.generated=false;chapter().masterReady=false;
    await dbDel(lineKey(l)).catch(()=>{});await dbDel(masterKey()).catch(()=>{});
    try{save()}catch{}
  }

  function status(msg){const e=$('perfRecordStatus');if(e)e.textContent=msg;try{setStatus(msg)}catch{}}

  function cleanup(){
    try{processor&&(processor.onaudioprocess=null)}catch{}
    try{processor?.disconnect()}catch{};try{source?.disconnect()}catch{};try{silent?.disconnect()}catch{};
    try{stream?.getTracks?.().forEach(t=>t.stop())}catch{}
    try{ctx?.close()}catch{}
    stream=ctx=source=processor=silent=null;
  }

  async function stopPcm(){
    const l=activeLine;activeLine=null;
    const parts=chunks;chunks=[];
    cleanup();
    if(!l)return;
    if(!parts.length){status('No audio was captured. Tap Record and try again.');return}
    const pcm=joinChunks(parts),blob=wavBlob(pcm,rate);
    status('Saving recording…');
    await savePerformance(l,blob,'Recorded on iPhone · WAV');
    status(`${l.speaker} recording saved.`);
    try{render()}catch{}
  }

  async function startPcm(l){
    if(activeLine)return;
    if(!window.isSecureContext)throw Error('Microphone recording requires HTTPS.');
    if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser is blocking web microphone access. Open Ashen Voice in Safari, or use iPhone Recorder below.');
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)throw Error('Web Audio recording is unavailable here. Use iPhone Recorder below.');
    cleanup();chunks=[];activeLine=l;
    status('Requesting microphone permission…');
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      ctx=new AC();if(ctx.state==='suspended')await ctx.resume();rate=ctx.sampleRate||48000;
      source=ctx.createMediaStreamSource(stream);
      if(!ctx.createScriptProcessor)throw Error('This Safari build does not expose PCM recording.');
      processor=ctx.createScriptProcessor(4096,1,1);
      silent=ctx.createGain();silent.gain.value=0;
      processor.onaudioprocess=e=>{const a=e.inputBuffer.getChannelData(0);chunks.push(new Float32Array(a))};
      source.connect(processor);processor.connect(silent);silent.connect(ctx.destination);
      const start=$('perfStart'),stop=$('perfStop');if(start)start.disabled=true;if(stop)stop.disabled=false;
      status('RECORDING… perform the line, then tap Stop.');
    }catch(e){
      activeLine=null;cleanup();
      const msg=e?.name==='NotAllowedError'
        ? 'Safari did not grant microphone access. Open this page in Safari and allow Microphone, or tap iPhone Recorder.'
        : `Microphone could not start: ${e?.message||e}. Use iPhone Recorder below.`;
      status(msg);throw Error(msg);
    }
  }

  async function decodeToWav(file){
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('Web Audio cannot decode this recording.');
    const ac=new AC();try{
      const b=await ac.decodeAudioData((await file.arrayBuffer()).slice(0));
      const out=new Float32Array(b.length),count=Math.max(1,b.numberOfChannels||1);
      for(let c=0;c<count;c++){const x=b.getChannelData(c);for(let i=0;i<out.length;i++)out[i]+=x[i]/count}
      return wavBlob(out,b.sampleRate||48000);
    }finally{try{await ac.close()}catch{}}
  }

  function addNativeFallback(modal,l){
    if($('avNativeCapture'))return;
    const input=document.createElement('input');input.id='avNativeCapture';input.type='file';input.accept='audio/*';input.setAttribute('capture','');input.style.display='none';modal.appendChild(input);
    const btn=document.createElement('button');btn.id='avNativeRecord';btn.className='btn';btn.textContent='iPhone Recorder';
    const importBtn=$('perfImport');importBtn?.parentElement?.insertBefore(btn,importBtn);
    btn.onclick=()=>{input.value='';status('Opening iPhone recorder…');input.click()};
    input.onchange=async()=>{const f=input.files?.[0];if(!f)return;try{status('Importing iPhone recording…');const wav=await decodeToWav(f);await savePerformance(l,wav,f.name||'iPhone recording');status(`${l.speaker} recording saved.`);render()}catch(e){status('Could not import that capture. Record it in Voice Memos, save to Files, then use Import Audio.');alert('iPhone capture import failed: '+(e?.message||e))}};
  }

  function patchModal(){
    const modal=$('voiceModal'),start=$('perfStart'),stop=$('perfStop');
    if(!modal||!start||!stop||start.dataset.pcm091==='1')return;
    const l=lineById(currentLineId);if(!l)return;
    start.dataset.pcm091='1';start.textContent='● Record';
    start.onclick=()=>startPcm(l).catch(e=>{console.warn(e);alert(e.message)});
    stop.onclick=()=>stopPcm().catch(e=>{console.warn(e);alert('Could not save recording: '+e.message)});
    addNativeFallback(modal,l);
    const st=$('perfRecordStatus');
    if(st&&!/saved/i.test(st.textContent||''))st.textContent='Ready. Tap Record for direct WAV capture. If microphone access is blocked, use iPhone Recorder or Import Audio.';
  }

  document.addEventListener('click',e=>{const b=e.target.closest?.('.linePerf');if(b?.dataset?.id){currentLineId=b.dataset.id;setTimeout(patchModal,0)}},true);
  const mo=new MutationObserver(()=>patchModal());mo.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>{activeLine=null;cleanup()});
})();
