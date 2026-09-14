// Ashen Voice Studio v0.8.6 — Dead King performance-audio override + non-destructive tweaks
// Chapter One Dead King line uses recorded/imported performance audio, never TTS.
(function(){
  const PERF_KEY='ashen:performance:dead-king:zikir-ashur:v1';
  const META_KEY='ashen-dead-king-performance-v085-meta';
  const TWEAK_KEY='ashen-dead-king-performance-v086-tweaks';
  const DEFAULT_TWEAKS={speed:1,volume:1,darkness:0,thinness:0,rasp:0,echo:0};
  let mediaRecorder=null,mediaStream=null,mediaChunks=[];
  let renderPatched=false;

  const norm=s=>String(s||'').toLowerCase().replace(/[“”\"'.,!?;:—–-]+/g,' ').replace(/\s+/g,' ').trim();
  const isDeadKing=c=>norm(c?.name||c?.speaker)==='dead king';
  const isTargetLine=l=>isDeadKing(l)&&/\bzikir\s+ashur\b/.test(norm(l?.text));
  const nclamp=(v,a,b)=>Math.min(b,Math.max(a,Number.isFinite(Number(v))?Number(v):a));
  const getMeta=()=>{try{return JSON.parse(localStorage.getItem(META_KEY)||'null')}catch{return null}};
  const setMeta=m=>{try{localStorage.setItem(META_KEY,JSON.stringify(m))}catch{}};
  const getTweaks=()=>{try{return {...DEFAULT_TWEAKS,...JSON.parse(localStorage.getItem(TWEAK_KEY)||'{}')}}catch{return {...DEFAULT_TWEAKS}}};
  const setTweaks=t=>{try{localStorage.setItem(TWEAK_KEY,JSON.stringify({...DEFAULT_TWEAKS,...t}))}catch{}};

  function applyDeadKingPreset(c){
    Object.assign(c,{mode:'preset',voice:'am_onyx',speed:.76,pitch:-1.4,tone:'dark',emotion:'whispered',intensity:.72,pause:.90});
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
      return encodeWav(pcm,buf.sampleRate||48000);
    }finally{try{await ac.close()}catch{}}
  }

  async function applyPerformanceTweaks(blob){
    const t=getTweaks();
    const clean=Math.abs(t.speed-1)<.001&&Math.abs(t.volume-1)<.001&&!t.darkness&&!t.thinness&&!t.rasp&&!t.echo;
    if(clean)return blob;
    const AC=window.AudioContext||window.webkitAudioContext;
    const OC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if(!AC||!OC)return blob;
    const ac=new AC();
    let buf;
    try{buf=await ac.decodeAudioData((await blob.arrayBuffer()).slice(0))}finally{try{await ac.close()}catch{}}
    const sr=buf.sampleRate||48000;
    const speed=nclamp(t.speed,.85,1.15);
    const tail=t.echo?Math.ceil(sr*1.1):0;
    const frames=Math.max(1,Math.ceil(buf.length/speed)+tail);
    const ctx=new OC(1,frames,sr);
    const src=ctx.createBufferSource();
    src.buffer=buf;
    src.playbackRate.value=speed;
    let node=src;

    if(t.thinness>0){
      const hp=ctx.createBiquadFilter();
      hp.type='highpass';
      hp.frequency.value=80+nclamp(t.thinness,0,100)*2.7;
      hp.Q.value=.55;
      node.connect(hp);node=hp;
    }
    if(t.darkness>0){
      const lp=ctx.createBiquadFilter();
      lp.type='lowpass';
      lp.frequency.value=9000-nclamp(t.darkness,0,100)*55;
      lp.Q.value=.5;
      node.connect(lp);node=lp;
    }

    const master=ctx.createGain();
    master.gain.value=nclamp(t.volume,.5,1.25);
    node.connect(master);
    master.connect(ctx.destination);

    if(t.rasp>0){
      const sh=ctx.createWaveShaper();
      const curve=new Float32Array(1024);
      const drive=1.8+nclamp(t.rasp,0,100)*.045;
      const den=Math.tanh(drive);
      for(let i=0;i<curve.length;i++){
        const x=i/(curve.length-1)*2-1;
        curve[i]=Math.tanh(drive*x)/den;
      }
      sh.curve=curve;
      try{sh.oversample='2x'}catch{}
      const rg=ctx.createGain();
      rg.gain.value=nclamp(t.rasp,0,100)/100*.16*nclamp(t.volume,.5,1.25);
      node.connect(sh);sh.connect(rg);rg.connect(ctx.destination);
    }

    if(t.echo>0){
      const amount=nclamp(t.echo,0,100)/100;
      const delay=ctx.createDelay(1);
      delay.delayTime.value=.105;
      const damp=ctx.createBiquadFilter();
      damp.type='lowpass';damp.frequency.value=3300;damp.Q.value=.5;
      const wet=ctx.createGain();wet.gain.value=.24*amount;
      const fb=ctx.createGain();fb.gain.value=.18*amount;
      node.connect(delay);delay.connect(damp);damp.connect(wet);wet.connect(ctx.destination);
      damp.connect(fb);fb.connect(delay);
    }

    src.start(0);
    const out=await ctx.startRendering();
    const raw=out.getChannelData(0);
    const pcm=new Float32Array(raw.length);
    pcm.set(raw);
    let peak=0;
    for(const x of pcm)peak=Math.max(peak,Math.abs(x));
    if(peak>.97){const g=.97/peak;for(let i=0;i<pcm.length;i++)pcm[i]*=g}
    return encodeWav(pcm,sr);
  }

  async function invalidateTarget(){
    try{
      for(const l of chapter().lines||[]){if(isTargetLine(l)){l.generated=false;await dbDel(lineKey(l)).catch(()=>{})}}
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
  async function getRenderedPerformance(){const b=await getPerformance();return b?applyPerformanceTweaks(b):null}

  function installRenderPatch(){
    if(renderPatched)return;
    const prior=renderLine;
    if(typeof prior!=='function')return;
    renderLine=async function(l){
      if(isTargetLine(l)){
        const b=await getRenderedPerformance();
        if(!b)throw new Error('Dead King performance audio is not set. Open Dead King → Voice Lab and record or import “Zikir Ashur”.');
        return b;
      }
      return prior(l);
    };
    renderPatched=true;
  }

  if(typeof patchRender==='function'){
    const priorPatchRender=patchRender;
    patchRender=function(){priorPatchRender();renderPatched=false;installRenderPatch()};
  }
  setTimeout(installRenderPatch,350);
  setTimeout(installRenderPatch,900);

  function stopStream(){try{for(const t of mediaStream?.getTracks?.()||[])t.stop()}catch{}mediaStream=null}

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
      }catch(e){alert('Could not save Dead King recording: '+e.message);if(status)status.textContent='Recording was not saved.'}
      finally{stopStream();mediaRecorder=null;mediaChunks=[];if(recBtn)recBtn.disabled=false;if(stopBtn)stopBtn.disabled=true}
    };
    mediaRecorder.start(250);
    if(status)status.textContent='RECORDING · whisper “Zikir Ashur”, then tap Stop';
    if(recBtn)recBtn.disabled=true;
    if(stopBtn)stopBtn.disabled=false;
  }

  function stopRecording(){if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop()}

  async function refreshPanel(panel){
    const b=await getPerformance();
    const m=getMeta();
    const st=panel.querySelector('#dkPerfStatus');
    ['#dkPreview','#dkOriginal','#dkSave','#dkClear'].forEach(sel=>{const el=panel.querySelector(sel);if(el)el.disabled=!b});
    if(st)st.textContent=b?`Saved performance · ${m?.sourceName||'audio'} · ${(b.size/1024).toFixed(0)} KB`:'No performance saved yet. Record or import the final “Zikir Ashur” line.';
  }

  function tweakRow(id,label,min,max,step,value,suffix=''){
    return `<div class="field"><label>${label} <span id="${id}Val" class="mini">${value}${suffix}</span></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
  }

  function attachPerformancePanel(c){
    if(!isDeadKing(c))return;
    const modal=byId('voiceModal');
    const card=modal?.querySelector('.modalCard');
    if(!card||card.querySelector('#deadKingPerformance'))return;
    const tw=getTweaks();
    const panel=document.createElement('div');
    panel.id='deadKingPerformance';
    panel.className='card';
    panel.style.marginTop='12px';
    panel.innerHTML=`
      <div class="sectionHead"><div><strong>Dead King · Performance Audio</strong><div class="mini">Chapter One line: “Zikir Ashur”</div></div><span class="chip">iPhone</span></div>
      <div class="infoBox" style="margin-top:8px"><b>TTS is disabled for this line.</b> Ashen Voice uses the performance stored here. The original file stays untouched; the controls below are applied only when previewing/rendering.</div>
      <div id="dkPerfStatus" class="mini" style="margin:10px 0">Checking saved performance…</div>
      <input id="dkPerfFile" type="file" accept="audio/*,.wav,.mp3,.m4a,.aac" style="display:none">
      <div class="toolbar"><button id="dkRecord" class="btn warn">Record “Zikir Ashur”</button><button id="dkStop" class="btn" disabled>Stop</button><button id="dkImport" class="btn primary">Import Audio</button><button id="dkOriginal" class="btn" disabled>Original</button><button id="dkPreview" class="btn good" disabled>Preview Tweaked</button></div>
      <div style="margin-top:12px"><strong>Performance Tweaks</strong><div class="mini">Small moves work best. These settings are non-destructive.</div></div>
      <div class="voiceGrid" style="margin-top:8px">
        ${tweakRow('dkSpeed','Speed',.85,1.15,.01,Number(tw.speed).toFixed(2),'×')}
        ${tweakRow('dkVolume','Volume',.5,1.25,.01,Number(tw.volume).toFixed(2),'×')}
        ${tweakRow('dkDark','Darkness',0,100,1,Math.round(tw.darkness),'%')}
        ${tweakRow('dkThin','Brittle / thin',0,100,1,Math.round(tw.thinness),'%')}
        ${tweakRow('dkRasp','Throat rasp',0,100,1,Math.round(tw.rasp),'%')}
        ${tweakRow('dkEcho','Tomb echo',0,100,1,Math.round(tw.echo),'%')}
      </div>
      <div class="toolbar"><button id="dkReset" class="btn">Reset Tweaks</button><button id="dkSave" class="btn good" disabled>Save Tweaked WAV</button><button id="dkClear" class="btn bad" disabled>Clear Performance</button></div>
      <div class="mini" style="margin-top:8px">Target sound: almost a whisper, inflamed/strep-throat rasp, brittle breath, very little chest tone, no theatrical growl.</div>`;
    card.appendChild(panel);

    const file=panel.querySelector('#dkPerfFile');
    panel.querySelector('#dkImport').onclick=()=>file.click();
    file.onchange=async()=>{const f=file.files?.[0];if(!f)return;try{await storePerformance(f,f.name);await refreshPanel(panel)}catch(e){alert('Import failed: '+e.message)}file.value=''};
    panel.querySelector('#dkRecord').onclick=async()=>{try{await startRecording(panel)}catch(e){alert('Recording failed: '+e.message);stopStream()}};
    panel.querySelector('#dkStop').onclick=stopRecording;

    const inputs={speed:'#dkSpeed',volume:'#dkVolume',darkness:'#dkDark',thinness:'#dkThin',rasp:'#dkRasp',echo:'#dkEcho'};
    const suffix={speed:'×',volume:'×',darkness:'%',thinness:'%',rasp:'%',echo:'%'};
    const saveFromUi=async()=>{
      const t=getTweaks();
      for(const [k,sel] of Object.entries(inputs))t[k]=Number(panel.querySelector(sel).value);
      setTweaks(t);await invalidateTarget();setStatus('Dead King performance tweaks saved');
    };
    for(const [k,sel] of Object.entries(inputs)){
      const input=panel.querySelector(sel),val=panel.querySelector(sel+'Val');
      input.oninput=()=>{if(val)val.textContent=(k==='speed'||k==='volume'?Number(input.value).toFixed(2):Math.round(Number(input.value)))+suffix[k]};
      input.onchange=saveFromUi;
    }

    panel.querySelector('#dkOriginal').onclick=async()=>{const b=await getPerformance();if(!b)return;unlockPreviewAudio();await playBlob(b,'Dead King · Zikir Ashur · original')};
    panel.querySelector('#dkPreview').onclick=async()=>{const b=await getRenderedPerformance();if(!b)return;unlockPreviewAudio();await playBlob(b,'Dead King · Zikir Ashur · tweaked')};
    panel.querySelector('#dkSave').onclick=async()=>{const b=await getRenderedPerformance();if(b)await shareBlob(b,'dead-king-zikir-ashur-tweaked.wav')};
    panel.querySelector('#dkReset').onclick=async()=>{setTweaks(DEFAULT_TWEAKS);await invalidateTarget();for(const [k,sel] of Object.entries(inputs)){const input=panel.querySelector(sel),v=DEFAULT_TWEAKS[k];input.value=v;const val=panel.querySelector(sel+'Val');if(val)val.textContent=(k==='speed'||k==='volume'?Number(v).toFixed(2):Math.round(v))+suffix[k]}setStatus('Dead King tweaks reset')};
    panel.querySelector('#dkClear').onclick=async()=>{if(!confirm('Clear the saved Dead King “Zikir Ashur” performance?'))return;await dbDel(PERF_KEY).catch(()=>{});try{localStorage.removeItem(META_KEY)}catch{}await invalidateTarget();await refreshPanel(panel);setStatus('Dead King performance cleared')};
    refreshPanel(panel);
  }

  const priorOpenVoiceLab=openVoiceLab;
  openVoiceLab=function(id){priorOpenVoiceLab(id);const c=state.characters.find(x=>x.id===id)||state.characters[0];if(isDeadKing(c)){applyDeadKingPreset(c);attachPerformancePanel(c)}};

  if(typeof direct==='function'){
    const baseDirect=direct;
    direct=function(l,i,ls){const d=baseDirect(l,i,ls);if(isTargetLine(l))Object.assign(d,{label:'recorded performance / brittle near-whisper / haunted',emotionPreset:'whispered',speedFactor:1,pitchDelta:0,tone:'dark',intensity:.72,postPause:Math.max(d.postPause||0,.9),confidence:1});return d};
  }

  window.addEventListener('pagehide',()=>{try{stopRecording()}catch{}stopStream()});
})();
