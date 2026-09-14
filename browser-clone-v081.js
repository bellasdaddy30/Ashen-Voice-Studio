// Ashen Voice Studio v0.8.1 — browser-native reference voice for iPhone/Safari
// Uses VoxShot + Chatterbox ONNX directly in the browser. No backend, no laptop.
(function(){
  const refs=new Map();
  let recorder=null,recordStream=null,recordChunks=[],recordTimer=null,recordCharId=null;

  function cloneProgress(p){
    try{
      if(!p)return;
      if(p.status==='load-start')return setStatus(`Reference engine · trying ${p.plan||'WebGPU'}…`);
      if(p.status==='load-fallback')return setStatus(`Reference engine fallback · ${p.plan||''}`);
      if(p.status==='load-compiling')return setStatus('Reference engine · compiling model… this can take a while on first load');
      if(p.status==='load-ready')return setStatus(`Reference engine ready · ${p.plan||'WebGPU'}`);
      if(p.status==='progress'){
        const raw=Number(p.progress);
        if(Number.isFinite(raw)){
          const pct=Math.round(raw<=1?raw*100:raw);
          return setStatus(`Downloading reference engine · ${Math.max(0,Math.min(100,pct))}%`);
        }
      }
    }catch{}
  }

  // Replace the old clone loader. Safari 26+ on iOS has WebGPU; use it instead of blocking iPhone.
  loadCloneEngine=async function(){
    if(cloneTTS)return cloneTTS;
    if(cloneLoading)return cloneLoading;
    cloneLoading=(async()=>{
      if(!navigator.gpu){
        throw new Error('WebGPU is not available in this browser. Open Ashen Voice Studio in Safari 26 or newer on this iPhone. The reference-voice model is intentionally not forced through the much slower WASM fallback on mobile.');
      }
      setStatus('Loading Reference Voice engine… first load downloads a large model');
      let mod;
      const urls=[
        'https://esm.sh/voxshot?bundle&deps=@huggingface/transformers',
        'https://esm.sh/voxshot?deps=@huggingface/transformers'
      ];
      let lastErr;
      for(const u of urls){
        try{mod=await import(u);break}catch(e){lastErr=e}
      }
      if(!mod)throw new Error(`Could not load VoxShot in Safari: ${lastErr?.message||lastErr||'module load failed'}`);
      const engine=new mod.ChatterboxEngine({requiresGpu:true,onProgress:cloneProgress,stallTimeoutMs:180000});
      cloneTTS=await mod.VoxShot.create({engine,device:'webgpu',minChunkLength:20,maxChunkLength:120});
      setStatus(`Reference Voice ready · ${cloneTTS.device||'webgpu'}`);
      return cloneTTS;
    })();
    try{return await cloneLoading}finally{cloneLoading=null}
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
    // Chatterbox speed is waveform resampling and also shifts pitch. Preserve the recorded throat
    // and pace at 1.0; the performance should come from the reference itself.
    let spoken=applyDictionary(text).trim();
    // Very short Chatterbox prompts are less stable. Punctuation pads the Dead King's tiny line
    // without adding extra spoken words.
    if(spoken.length<20)spoken=`... ${spoken} ...`;
    const a=await t.speak(spoken,{speed:1,expressiveness:Math.max(0,Number(c.expressiveness??.34))});
    if(typeof a.toBlob==='function')return await a.toBlob();
    if(typeof a.toWav==='function')return new Blob([a.toWav()],{type:'audio/wav'});
    return encodeWav(a.samples,a.sampleRate||24000);
  };

  // Clone/Reference mode must stay clean. Do not feed Chatterbox output through any of the old
  // Kokoro throat/static processors. Non-clone modes keep their existing synthesis path.
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
    recordChunks=[];recordCharId=c.id;
    recorder.ondataavailable=e=>{if(e.data?.size)recordChunks.push(e.data)};
    recorder.onerror=e=>setRefStatus(`Recording error: ${e.error?.message||'unknown error'}`);
    recorder.onstop=()=>{
      clearTimeout(recordTimer);recordTimer=null;
      const type=recorder.mimeType||mime||'audio/mp4';
      const blob=new Blob(recordChunks,{type});
      const ext=type.includes('webm')?'webm':'m4a';
      const file=new File([blob],`${slug(c.name)}-reference-${Date.now()}.${ext}`,{type});
      refs.set(c.id,file);
      stopTracks();
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
    setRefStatus('Recording… speak in the exact gravelly, cracked whisper you want the Dead King to use.');
    recordTimer=setTimeout(()=>{try{if(recorder?.state==='recording')recorder.stop()}catch{}},15000);
  }

  function stopReferenceRecording(){try{if(recorder?.state==='recording')recorder.stop()}catch{} }

  async function useRecordedReference(c){
    const file=refs.get(c.id);
    if(!file)throw new Error('Record the reference first.');
    const consent=byId('cloneConsent');
    if(consent&&!consent.checked)throw new Error('Check the permission box first. For your own recording, that confirms you have permission to use the voice.');
    const btn=byId('useRecordedReference');if(btn)btn.disabled=true;
    setRefStatus('Loading the on-device Reference Voice model… first load is large and may take several minutes. Keep this tab open.');
    try{await cloneFromFile(c,file);setRefStatus('Reference Voice saved. Preview now uses Chatterbox directly, with no throat/static filters.');openVoiceLab(c.id)}finally{if(btn)btn.disabled=false}
  }

  const priorOpen=openVoiceLab;
  openVoiceLab=function(id){
    priorOpen(id);
    const c=state.characters.find(x=>x.id===id)||state.characters[0];
    if(c.mode!=='clone')return;

    // Never show the old artificial throat controls in Reference Voice mode.
    byId('throatFxBox')?.remove();
    const body=byId('modeBody');
    if(!body||byId('referenceVoicePanel'))return;
    const panel=document.createElement('div');panel.id='referenceVoicePanel';panel.className='card';panel.style.marginTop='12px';
    const gpu=!!navigator.gpu;
    panel.innerHTML=`<div class="sectionHead"><div><strong>Reference Voice · on this iPhone</strong><div class="mini">Real browser-native Chatterbox voice conditioning. No laptop, backend, API key, static layer, or artificial rasp filter.</div></div><span class="chip">${gpu?'WebGPU ready':'WebGPU unavailable'}</span></div>
      <div class="infoBox"><b>First use:</b> the Chatterbox model is large (roughly 1.5 GB). Safari caches it after download. Record 8–15 seconds in the exact damaged, breathy, scratchy throat you want. The engine learns that reference and synthesizes new lines from it.</div>
      <div class="field"><label>Reference script</label><div class="mini">Read this slowly in the Dead King's voice: “The stone remembers every name. You should not have opened this door. Come closer, and listen.”</div></div>
      <div class="toolbar"><button id="startRefRecord" class="btn warn">● Record Reference</button><button id="stopRefRecord" class="btn" disabled>Stop</button><button id="useRecordedReference" class="btn good" disabled>Use Recording</button></div>
      <audio id="refRecordingPreview" class="hidden" controls style="width:100%;margin-top:8px"></audio>
      <div id="refRecordStatus" class="mini">${gpu?'WebGPU detected. Ready to record.':'Open this app in Safari 26+ to use the on-device Reference Voice engine.'}</div>`;
    body.appendChild(panel);
    byId('startRefRecord').onclick=()=>startReferenceRecording(c).catch(e=>{setRefStatus(e.message);alert(e.message)});
    byId('stopRefRecord').onclick=stopReferenceRecording;
    byId('useRecordedReference').onclick=()=>useRecordedReference(c).catch(e=>{setRefStatus(e.message);alert(e.message)});
  };

  window.addEventListener('pagehide',()=>{try{if(recorder?.state==='recording')recorder.stop()}catch{}stopTracks()});
})();
