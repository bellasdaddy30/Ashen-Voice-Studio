// Ashen Voice Studio v0.8.5 — Dead King performance-audio override
// Chapter One Dead King line uses recorded/imported performance audio, never TTS.
(function(){
  const PERF_KEY='ashen:performance:dead-king:zikir-ashur:v1';
  const META_KEY='ashen-dead-king-performance-v085-meta';
  let mediaRecorder=null,mediaStream=null,mediaChunks=[];
  let renderPatched=false;

  const norm=s=>String(s||'').toLowerCase().replace(/[“”\"'.,!?;:—–-]+/g,' ').replace(/\s+/g,' ').trim();
  const isDeadKing=c=>norm(c?.name||c?.speaker)==='dead king';
  const isTargetLine=l=>isDeadKing(l)&&/\bzikir\s+ashur\b/.test(norm(l?.text));
  const getMeta=()=>{try{return JSON.parse(localStorage.getItem(META_KEY)||'null')}catch{return null}};
  const setMeta=m=>{try{localStorage.setItem(META_KEY,JSON.stringify(m))}catch{}};

  function applyDeadKingPreset(c){
    Object.assign(c,{
      mode:'preset',
      voice:'am_onyx',
      speed:.76,
      pitch:-1.4,
      tone:'dark',
      emotion:'whispered',
      intensity:.72,
      pause:.90
    });
    try{rememberChar(c)}catch{}
    try{save()}catch{}
  }

  async function blobToMonoWav(blob){
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)throw new Error('This browser cannot decode audio files.');
    const ac=new AC();
    try{
      const buf=await ac.decodeAudioData((await blob.arrayBuffer()).slice(0));
      const pcm=new Float32Array(buf.length);
      const channels=Math.max(1,buf.numberOfChannels||1);
      for(let ch=0;ch<channels;ch++){
        const data=buf.getChannelData(ch);
        for(let i=0;i<pcm.length;i++)pcm[i]+=data[i]/channels;
      }
      // Preserve whisper dynamics. Do not normalize the performance louder.
      return encodeWav(pcm,buf.sampleRate||48000);
    }finally{
      try{await ac.close()}catch{}
    }
  }

  async function invalidateTarget(){
    try{
      for(const l of chapter().lines||[]){
        if(!isTargetLine(l))continue;
        l.generated=false;
        await dbDel(lineKey(l)).catch(()=>{});
      }
      chapter().masterReady=false;
      await dbDel(masterKey()).catch(()=>{});
      save();
    }catch(e){console.warn('Dead King invalidate failed',e)}
  }

  async function storePerformance(blob,sourceName='iPhone performance'){
    if(!blob||!blob.size)throw new Error('The selected recording is empty.');
    setStatus('Preparing Dead King performance audio…');
    const wav=await blobToMonoWav(blob);
    await dbPut(PERF_KEY,wav);
    setMeta({sourceName,storedAt:Date.now(),bytes:wav.size,target:'Zikir Ashur'});
    await invalidateTarget();
    setStatus('Dead King performance saved · “Zikir Ashur”');
    return wav;
  }

  async function getPerformance(){return dbGet(PERF_KEY).catch(()=>null)}

  function installRenderPatch(){
    if(renderPatched)return;
    const prior=renderLine;
    if(typeof prior!=='function')return;
    renderLine=async function(l){
      if(isTargetLine(l)){
        const b=await getPerformance();
        if(!b)throw new Error('Dead King performance audio is not set. Open Dead King → Voice Lab and record or import “Zikir Ashur”.');
        return b;
      }
      return prior(l);
    };
    renderPatched=true;
  }

  // app-3a installs its own render wrapper after startup. Make our performance
  // override the final wrapper, regardless of script timing.
  if(typeof patchRender==='function'){
    const priorPatchRender=patchRender;
    patchRender=function(){
      priorPatchRender();
      renderPatched=false;
      installRenderPatch();
    };
  }
  setTimeout(installRenderPatch,350);
  setTimeout(installRenderPatch,900);

  function stopStream(){
    try{for(const t of mediaStream?.getTracks?.()||[])t.stop()}catch{}
    mediaStream=null;
  }

  async function startRecording(panel){
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Microphone recording is unavailable in this browser. Use Import Audio instead.');
    stopStream();
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const choices=['audio/mp4','audio/webm;codecs=opus','audio/webm'];
    const mime=choices.find(x=>{try{return MediaRecorder.isTypeSupported?.(x)}catch{return false}});
    mediaChunks=[];
    mediaRecorder=new MediaRecorder(mediaStream,mime?{mimeType:mime}:undefined);
    const status=panel.querySelector('#dkPerfStatus');
    const recBtn=panel.querySelector('#dkRecord');
    const stopBtn=panel.querySelector('#dkStop');
    mediaRecorder.ondataavailable=e=>{if(e.data?.size)mediaChunks.push(e.data)};
    mediaRecorder.onerror=e=>{if(status)status.textContent='Recording error: '+(e.error?.message||e.message||'unknown');stopStream()};
    mediaRecorder.onstop=async()=>{
      try{
        if(status)status.textContent='Converting recording to WAV…';
        const raw=new Blob(mediaChunks,{type:mediaRecorder?.mimeType||mime||'audio/mp4'});
        await storePerformance(raw,'Recorded on iPhone');
        await refreshPanel(panel);
      }catch(e){
        alert('Could not save Dead King recording: '+e.message);
        if(status)status.textContent='Recording was not saved.';
      }finally{
        stopStream();
        mediaRecorder=null;
        mediaChunks=[];
        if(recBtn)recBtn.disabled=false;
        if(stopBtn)stopBtn.disabled=true;
      }
    };
    mediaRecorder.start(250);
    if(status)status.textContent='RECORDING · whisper “Zikir Ashur”, then tap Stop';
    if(recBtn)recBtn.disabled=true;
    if(stopBtn)stopBtn.disabled=false;
  }

  function stopRecording(){
    if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();
  }

  async function refreshPanel(panel){
    const b=await getPerformance();
    const m=getMeta();
    const st=panel.querySelector('#dkPerfStatus');
    const preview=panel.querySelector('#dkPreview');
    const clear=panel.querySelector('#dkClear');
    if(b){
      if(st)st.textContent=`Saved performance · ${m?.sourceName||'audio'} · ${(b.size/1024).toFixed(0)} KB`;
      if(preview)preview.disabled=false;
      if(clear)clear.disabled=false;
    }else{
      if(st)st.textContent='No performance saved yet. Record or import the final “Zikir Ashur” line.';
      if(preview)preview.disabled=true;
      if(clear)clear.disabled=true;
    }
  }

  function attachPerformancePanel(c){
    if(!isDeadKing(c))return;
    const modal=byId('voiceModal');
    const card=modal?.querySelector('.modalCard');
    if(!card||card.querySelector('#deadKingPerformance'))return;
    const panel=document.createElement('div');
    panel.id='deadKingPerformance';
    panel.className='card';
    panel.style.marginTop='12px';
    panel.innerHTML=`
      <div class="sectionHead">
        <div><strong>Dead King · Performance Audio</strong><div class="mini">Chapter One line: “Zikir Ashur”</div></div>
        <span class="chip">iPhone</span>
      </div>
      <div class="infoBox" style="margin-top:8px"><b>TTS is disabled for this line.</b> Ashen Voice will use the performance stored here when previewing, rendering, and assembling the chapter.</div>
      <div id="dkPerfStatus" class="mini" style="margin:10px 0">Checking saved performance…</div>
      <input id="dkPerfFile" type="file" accept="audio/*,.wav,.mp3,.m4a,.aac" style="display:none">
      <div class="toolbar">
        <button id="dkRecord" class="btn warn">Record “Zikir Ashur”</button>
        <button id="dkStop" class="btn" disabled>Stop</button>
        <button id="dkImport" class="btn primary">Import Audio</button>
        <button id="dkPreview" class="btn good" disabled>Preview Stored</button>
        <button id="dkClear" class="btn" disabled>Clear</button>
      </div>
      <div class="mini" style="margin-top:8px">For the sound you described: almost a whisper, inflamed/strep-throat rasp, brittle breath, very little chest tone, no theatrical growl.</div>`;
    card.appendChild(panel);

    const file=panel.querySelector('#dkPerfFile');
    panel.querySelector('#dkImport').onclick=()=>file.click();
    file.onchange=async()=>{
      const f=file.files?.[0];
      if(!f)return;
      try{await storePerformance(f,f.name);await refreshPanel(panel)}catch(e){alert('Import failed: '+e.message)}
      file.value='';
    };
    panel.querySelector('#dkRecord').onclick=async()=>{try{await startRecording(panel)}catch(e){alert('Recording failed: '+e.message);stopStream()}};
    panel.querySelector('#dkStop').onclick=stopRecording;
    panel.querySelector('#dkPreview').onclick=async()=>{
      const b=await getPerformance();
      if(!b)return;
      unlockPreviewAudio();
      await playBlob(b,'Dead King · Zikir Ashur · performance');
    };
    panel.querySelector('#dkClear').onclick=async()=>{
      if(!confirm('Clear the saved Dead King “Zikir Ashur” performance?'))return;
      await dbDel(PERF_KEY).catch(()=>{});
      try{localStorage.removeItem(META_KEY)}catch{}
      await invalidateTarget();
      await refreshPanel(panel);
      setStatus('Dead King performance cleared');
    };
    refreshPanel(panel);
  }

  const priorOpenVoiceLab=openVoiceLab;
  openVoiceLab=function(id){
    priorOpenVoiceLab(id);
    const c=state.characters.find(x=>x.id===id)||state.characters[0];
    if(isDeadKing(c)){
      applyDeadKingPreset(c);
      attachPerformancePanel(c);
    }
  };

  if(typeof direct==='function'){
    const baseDirect=direct;
    direct=function(l,i,ls){
      const d=baseDirect(l,i,ls);
      if(isTargetLine(l))Object.assign(d,{
        label:'recorded performance / brittle near-whisper / haunted',
        emotionPreset:'whispered',
        speedFactor:1,
        pitchDelta:0,
        tone:'dark',
        intensity:.72,
        postPause:Math.max(d.postPause||0,.9),
        confidence:1
      });
      return d;
    };
  }

  window.addEventListener('pagehide',()=>{try{stopRecording()}catch{}stopStream()});
})();
