// Ashen Voice Studio v0.8.2 — pinned browser-native Reference Voice runtime
// VoxShot stays the voice layer; Transformers.js 4.2.0 is loaded directly from
// Hugging Face's documented jsDelivr browser build so its ONNX JS/WASM stay matched.
(function(){
  const refs=new Map();
  let recorder=null,recordStream=null,recordChunks=[],recordTimer=null;
  const TF_URL='https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
  const TF_WASM='https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/';
  const VOX_URL='https://esm.sh/voxshot@0.3.0?external=@huggingface/transformers';

  function cloneProgress(p){
    try{
      if(!p)return;
      if(p.status==='load-start')return setStatus(`Reference engine · trying ${p.plan||'backend'}…`);
      if(p.status==='load-fallback')return setStatus(`Reference engine fallback · ${p.plan||''} · ${p.reason||''}`);
      if(p.status==='load-compiling')return setStatus('Reference engine · compiling ONNX sessions…');
      if(p.status==='load-ready')return setStatus(`Reference engine ready · ${p.plan||'backend'}`);
      if(p.status==='progress'||p.status==='progress_total'){
        const raw=Number(p.progress);
        if(Number.isFinite(raw)){
          const pct=Math.round(raw<=1?raw*100:raw);
          return setStatus(`Downloading reference engine · ${Math.max(0,Math.min(100,pct))}%`);
        }
      }
    }catch{}
  }

  async function loadPinnedTransformers(){
    setStatus('Loading pinned Transformers.js 4.2.0 runtime…');
    const tf=await import(TF_URL);
    // iOS Safari is happier with one WASM thread unless the page is explicitly
    // cross-origin isolated. This also gives the fallback a deterministic path.
    try{tf.env.backends.onnx.wasm.numThreads=1}catch{}
    try{tf.env.backends.onnx.wasm.wasmPaths=TF_WASM}catch{}
    try{tf.env.useBrowserCache=true}catch{}
    try{tf.env.allowRemoteModels=true}catch{}
    window.__ashenReferenceRuntime={
      transformers:'4.2.0',
      wasmPaths:TF_WASM,
      webgpu:!!navigator.gpu
    };
    return tf;
  }

  loadCloneEngine=async function(){
    if(cloneTTS)return cloneTTS;
    if(cloneLoading)return cloneLoading;
    cloneLoading=(async()=>{
      setStatus('Loading Reference Voice engine…');
      const [mod,tf]=await Promise.all([
        import(VOX_URL),
        loadPinnedTransformers()
      ]);
      if(!mod?.ChatterboxEngine||!mod?.VoxShot)throw new Error('VoxShot module loaded without the Chatterbox exports.');
      const engine=new mod.ChatterboxEngine({
        requiresGpu:false,
        onProgress:cloneProgress,
        stallTimeoutMs:300000,
        // Critical v0.8.2 fix: do not let VoxShot/esm.sh resolve its own copy
        // of Transformers/ONNX. Hand it the exact official browser module above.
        loadModule:async()=>tf
      });
      cloneTTS=await mod.VoxShot.create({
        engine,
        device:navigator.gpu?'webgpu':'wasm',
        minChunkLength:20,
        maxChunkLength:120
      });
      const actual=engine.loadedPlan?.device||engine.loadedDevice||cloneTTS.device||'auto';
      setStatus(`Reference Voice ready · ${actual} · Transformers 4.2.0 pinned`);
      return cloneTTS;
    })();
    try{return await cloneLoading}catch(e){
      cloneTTS=null;
      const msg=String(e?.message||e||'unknown engine error');
      throw new Error(`Reference engine v0.8.2 failed with the pinned runtime: ${msg}`);
    }finally{cloneLoading=null}
  };

  cloneFromFile=async function(c,file){
    if(!file)throw new Error('Record or choose a clean 5–15 second gravelly reference first.');
    const t=await loadCloneEngine();
    setStatus(`Learning ${c.name} reference…`);
    await t.cloneVoice(file);
    const id=c.cloneId||`ashen-${slug(c.name)}-${Date.now()}`;
    await t.saveVoice(id);
    c.cloneId=id;c.cloneReady=true;c.cloneFileName=file.name||'recorded-reference';c.mode='clone';
    if(String(c.name).toLowerCase()==='dead king')c.expressiveness=.34;
    save();
    try{invalidateSpeaker(c.name)}catch{}
    setStatus(`${c.name} Reference Voice saved`);
  };

  clonedBlob=async function(text,c){
    const t=await loadCloneEngine();
    if(!c.cloneReady||!c.cloneId)throw new Error(`${c.name} has no saved Reference Voice yet.`);
    await t.useVoice(c.cloneId);
    let spoken=applyDictionary(text).trim();
    if(spoken.length<20)spoken=`... ${spoken} ...`;
    const a=await t.speak(spoken,{speed:1,expressiveness:Math.max(0,Number(c.expressiveness??.34))});
    if(typeof a.toBlob==='function')return await a.toBlob();
    if(typeof a.toWav==='function')return new Blob([a.toWav()],{type:'audio/wav'});
    return encodeWav(a.samples,a.sampleRate||24000);
  };

  // Reference Voice output is final speech. Never run it through the legacy
  // Kokoro throat/static processors.
  const priorSynth=synthesizeProfile;
  synthesizeProfile=async function(text,c){
    if(c?.mode==='clone'){
      const em=EMOTIONS[c.emotion]||EMOTIONS.neutral;
      return clonedBlob(text,{...c,expressiveness:c.expressiveness??em.expr});
    }
    return priorSynth(text,c);
  };

  function supportedMime(){
    if(!window.MediaRecorder)return '';
    const types=['audio/mp4','audio/webm;codecs=opus','audio/webm'];
    return types.find(t=>MediaRecorder.isTypeSupported?.(t))||'';
  }
  function stopTracks(){try{recordStream?.getTracks().forEach(t=>t.stop())}catch{}recordStream=null}
  function setRefStatus(msg){const e=byId('refRecordStatus');if(e)e.textContent=msg}

  async function startReferenceRecording(c){
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Microphone recording is not available in this browser. You can still choose an audio file below.');
    if(recorder&&recorder.state!=='inactive')throw new Error('A reference recording is already running.');
    recordStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
    const mime=supportedMime();
    recorder=mime?new MediaRecorder(recordStream,{mimeType:mime}):new MediaRecorder(recordStream);
    recordChunks=[];
    recorder.ondataavailable=e=>{if(e.data?.size)recordChunks.push(e.data)};
    recorder.onerror=e=>setRefStatus(`Recording error: ${e.error?.message||'unknown error'}`);
    recorder.onstop=()=>{
      clearTimeout(recordTimer);recordTimer=null;
      const type=recorder.mimeType||mime||'audio/mp4';
      const blob=new Blob(recordChunks,{type});
      const ext=type.includes('webm')?'webm':'m4a';
      const file=new File([blob],`${slug(c.name)}-reference-${Date.now()}.${ext}`,{type});
      refs.set(c.id,file);stopTracks();
      const audio=byId('refRecordingPreview');
      if(audio){const u=URL.createObjectURL(blob);objectUrls.push(u);audio.src=u;audio.classList.remove('hidden');audio.load()}
      const use=byId('useRecordedReference');if(use)use.disabled=false;
      const start=byId('startRefRecord');if(start)start.disabled=false;
      const stop=byId('stopRefRecord');if(stop)stop.disabled=true;
      setRefStatus(`Reference captured · ${(blob.size/1024).toFixed(0)} KB. Listen once, then tap Use Recording.`);
    };
    recorder.start(250);
    const start=byId('startRefRecord');if(start)start.disabled=true;
    const stop=byId('stopRefRecord');if(stop)stop.disabled=false;
    setRefStatus('Recording… use the exact gravelly, cracked whisper you want the Dead King to keep.');
    recordTimer=setTimeout(()=>{try{if(recorder?.state==='recording')recorder.stop()}catch{}},15000);
  }
  function stopReferenceRecording(){try{if(recorder?.state==='recording')recorder.stop()}catch{}}

  async function useRecordedReference(c){
    const file=refs.get(c.id);
    if(!file)throw new Error('Record the reference first.');
    const consent=byId('cloneConsent');
    if(consent&&!consent.checked)throw new Error('Check the permission box first.');
    const btn=byId('useRecordedReference');if(btn)btn.disabled=true;
    setRefStatus('Loading pinned on-device Reference Voice engine… keep this tab open.');
    try{
      await cloneFromFile(c,file);
      setRefStatus('Reference Voice saved. Preview uses Chatterbox directly with the pinned runtime and no throat/static filters.');
      openVoiceLab(c.id);
    }finally{if(btn)btn.disabled=false}
  }

  const priorOpen=openVoiceLab;
  openVoiceLab=function(id){
    priorOpen(id);
    const c=state.characters.find(x=>x.id===id)||state.characters[0];
    if(c.mode!=='clone')return;
    byId('throatFxBox')?.remove();
    const body=byId('modeBody');
    if(!body||byId('referenceVoicePanel'))return;
    const panel=document.createElement('div');panel.id='referenceVoicePanel';panel.className='card';panel.style.marginTop='12px';
    const gpu=!!navigator.gpu;
    panel.innerHTML=`<div class="sectionHead"><div><strong>Reference Voice · v0.8.2</strong><div class="mini">Pinned Transformers.js 4.2.0 + matching ONNX runtime. No laptop, API key, or artificial rasp layer.</div></div><span class="chip">${gpu?'WebGPU detected':'WASM fallback'}</span></div>
      <div class="infoBox"><b>Runtime fix:</b> v0.8.2 no longer lets esm.sh bundle Transformers/ONNX. VoxShot receives Hugging Face’s official browser module directly, with its matching runtime files.</div>
      <div class="field"><label>Reference script</label><div class="mini">Read slowly in the exact Dead King voice: “The stone remembers every name. You should not have opened this door. Come closer, and listen.”</div></div>
      <div class="toolbar"><button id="startRefRecord" class="btn warn">● Record Reference</button><button id="stopRefRecord" class="btn" disabled>Stop</button><button id="useRecordedReference" class="btn good" disabled>Use Recording</button></div>
      <audio id="refRecordingPreview" class="hidden" controls style="width:100%;margin-top:8px"></audio>
      <div id="refRecordStatus" class="mini">Ready. Existing model files may already be cached from the previous attempt.</div>`;
    body.appendChild(panel);
    byId('startRefRecord').onclick=()=>startReferenceRecording(c).catch(e=>{setRefStatus(e.message);alert(e.message)});
    byId('stopRefRecord').onclick=stopReferenceRecording;
    byId('useRecordedReference').onclick=()=>useRecordedReference(c).catch(e=>{setRefStatus(e.message);alert(e.message)});
  };

  window.addEventListener('pagehide',()=>{try{if(recorder?.state==='recording')recorder.stop()}catch{}stopTracks()});
})();