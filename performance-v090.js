// Ashen Voice Studio v0.9.0 — unified performance/recording layer
// Any line may use TTS/blend or a recorded/imported performance. All voices share the same FX controls.
(function(){
  const META_KEY='ashen-performance-v090-meta';
  const MIGRATION_KEY='ashen-performance-v090-migrated';
  const OLD_DK_KEY='ashen:performance:dead-king:zikir-ashur:v1';
  const FX_DEFAULTS={rasp:0,breath:0,crackle:0,dryness:0,echo:0};
  let rec=null,recStream=null,recChunks=[],recLineId=null;

  const n=(v,a,b,d=a)=>{v=Number(v);return Number.isFinite(v)?Math.min(b,Math.max(a,v)):d};
  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const metaRead=()=>{try{return JSON.parse(localStorage.getItem(META_KEY)||'{}')}catch{return{}}};
  const metaWrite=m=>{try{localStorage.setItem(META_KEY,JSON.stringify(m))}catch{}};
  const perfKey=l=>`ashen:performance:v090:${chapter().id}:${l.id}`;
  const hasPerf=id=>!!metaRead()[id];

  function withFx(c){
    c.rasp=n(c.rasp,0,1,0);c.breath=n(c.breath,0,1,0);c.crackle=n(c.crackle,0,1,0);c.dryness=n(c.dryness,0,1,0);c.echo=n(c.echo,0,1,0);
    return c;
  }

  const baseMakeChar=makeChar;
  makeChar=function(c={}){return withFx(baseMakeChar(c))};

  if(typeof rememberChar==='function'){
    const baseRemember=rememberChar;
    rememberChar=function(c){
      baseRemember(c);
      try{
        const o=ov();
        o.characters[c.name]={...(o.characters[c.name]||{}),mode:c.mode,rasp:c.rasp,breath:c.breath,crackle:c.crackle,dryness:c.dryness,echo:c.echo};
        putOv(o);
      }catch{}
    };
  }

  function deadKingPreset(c){
    Object.assign(c,{mode:'record',speed:1,pitch:-.20,tone:'hollow',emotion:'whispered',intensity:.92,pause:.95,rasp:.14,breath:.10,crackle:.06,dryness:.28,echo:.07});
    return c;
  }

  async function migrateLegacy(){
    for(const c of state.characters||[]){
      withFx(c);
      if(c.mode==='clone')c.mode='preset';
      if(norm(c.name)==='dead king')deadKingPreset(c);
    }
    if(!localStorage.getItem(MIGRATION_KEY)){
      try{await dbDel(OLD_DK_KEY)}catch{}
      try{localStorage.removeItem('ashen-dead-king-performance-v085-meta');localStorage.removeItem('ashen-dead-king-performance-v086-tweaks')}catch{}
      localStorage.setItem(MIGRATION_KEY,'1');
    }
    try{save()}catch{}
  }

  if(typeof loadRepo==='function'){
    const baseLoadRepo=loadRepo;
    loadRepo=async function(...args){const ok=await baseLoadRepo(...args);if(ok)await migrateLegacy();return ok};
  }
  setTimeout(()=>{if(window.state)migrateLegacy().catch(()=>{})},700);
  setTimeout(()=>{if(window.state)migrateLegacy().catch(()=>{})},1800);

  function sourceToneSpec(tone){
    if(typeof avToneSpec==='function')return avToneSpec(tone);
    switch(tone){
      case'warm':return{type:'lowshelf',frequency:240,gain:1.5,Q:.7};
      case'dark':return{type:'highshelf',frequency:3400,gain:-2.2,Q:.7};
      case'bright':return{type:'highshelf',frequency:3600,gain:1.8,Q:.7};
      case'crisp':return{type:'peaking',frequency:2850,gain:1.6,Q:.85};
      case'soft':return{type:'lowpass',frequency:7600,gain:0,Q:.45};
      case'hollow':return{type:'peaking',frequency:950,gain:-2.4,Q:1};
      case'radio':return{type:'bandpass',frequency:1750,gain:0,Q:.7};
      default:return null;
    }
  }

  async function decodeMono(blob){
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('Web Audio is unavailable on this device.');
    const ac=new AC();
    try{
      const b=await ac.decodeAudioData((await blob.arrayBuffer()).slice(0));
      const out=new Float32Array(b.length),ch=Math.max(1,b.numberOfChannels||1);
      for(let j=0;j<ch;j++){const x=b.getChannelData(j);for(let i=0;i<out.length;i++)out[i]+=x[i]/ch}
      return{pcm:out,rate:b.sampleRate||48000};
    }finally{try{await ac.close()}catch{}}
  }

  function resampleLinear(src,len){
    len=Math.max(1,Math.round(len));if(len===src.length)return new Float32Array(src);
    const out=new Float32Array(len),scale=(src.length-1)/Math.max(1,len-1);
    for(let i=0;i<len;i++){const x=i*scale,lo=Math.floor(x),hi=Math.min(src.length-1,lo+1),t=x-lo;out[i]=src[lo]*(1-t)+src[hi]*t}
    return out;
  }

  function stretchOLA(src,targetLen){
    targetLen=Math.max(1,Math.round(targetLen));
    if(src.length<2048||Math.abs(targetLen/src.length-1)<.015)return resampleLinear(src,targetLen);
    const win=1024,hopIn=256,ratio=targetLen/src.length,hopOut=Math.max(64,Math.round(hopIn*ratio));
    const out=new Float32Array(targetLen+win*2),weight=new Float32Array(out.length);
    const window=new Float32Array(win);for(let i=0;i<win;i++)window[i]=.5-.5*Math.cos(2*Math.PI*i/(win-1));
    let inPos=0,outPos=0;
    while(inPos+win<src.length&&outPos+win<out.length){
      for(let i=0;i<win;i++){const w=window[i];out[outPos+i]+=src[inPos+i]*w;weight[outPos+i]+=w}
      inPos+=hopIn;outPos+=hopOut;
    }
    for(let i=0;i<out.length;i++)if(weight[i]>.001)out[i]/=weight[i];
    return out.slice(0,targetLen);
  }

  function shiftPitchAndSpeed(src,pitchSemis,speed){
    pitchSemis=n(pitchSemis,-6,6,0);speed=n(speed,.65,1.45,1);
    const pf=Math.pow(2,pitchSemis/12);
    if(Math.abs(pitchSemis)<.01&&Math.abs(speed-1)<.01)return new Float32Array(src);
    const pitched=resampleLinear(src,src.length/pf);
    return stretchOLA(pitched,src.length/speed);
  }

  async function renderFxFromPcm(pcm,rate,fx){
    const OC=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!OC)return encodeWav(pcm,rate);
    const echo=n(fx.echo,0,1,0),tail=echo?Math.ceil(rate*.9):0;
    const ctx=new OC(1,pcm.length+tail,rate),buffer=ctx.createBuffer(1,pcm.length,rate);buffer.getChannelData(0).set(pcm);
    const src=ctx.createBufferSource();src.buffer=buffer;let node=src;
    const spec=sourceToneSpec(fx.tone);
    if(spec){const f=ctx.createBiquadFilter();f.type=spec.type;f.frequency.value=spec.frequency;if(spec.gain!=null&&'gain'in f)f.gain.value=spec.gain;if(spec.Q!=null)f.Q.value=spec.Q;node.connect(f);node=f}
    if(fx.dryness>0){const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=70+fx.dryness*190;hp.Q.value=.5;node.connect(hp);node=hp}
    const master=ctx.createGain();master.gain.value=n(fx.intensity,.35,1.5,1);node.connect(master);master.connect(ctx.destination);

    if(fx.breath>0){const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=2500;hp.Q.value=.5;const g=ctx.createGain();g.gain.value=.18*fx.breath;node.connect(hp);hp.connect(g);g.connect(ctx.destination)}
    if(fx.rasp>0){const sh=ctx.createWaveShaper(),curve=new Float32Array(1024),drive=1.2+fx.rasp*2.8,den=Math.tanh(drive);for(let i=0;i<curve.length;i++){const x=i/(curve.length-1)*2-1;curve[i]=Math.tanh(drive*x)/den}sh.curve=curve;try{sh.oversample='2x'}catch{}const g=ctx.createGain();g.gain.value=.11*fx.rasp;node.connect(sh);sh.connect(g);g.connect(ctx.destination)}
    if(fx.crackle>0){const d=ctx.createDelay(.03);d.delayTime.value=.006;const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=1700;const g=ctx.createGain();g.gain.value=.06*fx.crackle;node.connect(d);d.connect(hp);hp.connect(g);g.connect(ctx.destination)}
    if(echo>0){const d=ctx.createDelay(.5);d.delayTime.value=.105;const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=3300;const wet=ctx.createGain();wet.gain.value=.16*echo;const fb=ctx.createGain();fb.gain.value=.14*echo;node.connect(d);d.connect(lp);lp.connect(wet);wet.connect(ctx.destination);lp.connect(fb);fb.connect(d)}
    src.start(0);const out=await ctx.startRendering(),raw=out.getChannelData(0),final=new Float32Array(raw.length);final.set(raw);
    let peak=0;for(const x of final)peak=Math.max(peak,Math.abs(x));if(peak>.97){const g=.97/peak;for(let i=0;i<final.length;i++)final[i]*=g}
    return encodeWav(final,rate);
  }

  function fxFor(c,l,{recorded=false}={}){
    c=withFx({...c});
    let speed=1,pitch=0,tone='neutral',intensity=1;
    if(recorded){
      const name=(l?.emotion&&l.emotion!=='neutral')?l.emotion:c.emotion;
      const em=EMOTIONS[name]||EMOTIONS.neutral;
      speed=n((c.speed||1)*(em.speed||1),.65,1.45,1);
      pitch=n((c.pitch||0)+(em.pitch||0),-6,6,0);
      tone=c.tone==='neutral'?(em.tone||'neutral'):c.tone;
      intensity=n((c.intensity||1)*(em.intensity||1),.35,1.5,1);
    }
    return{speed,pitch,tone,intensity,rasp:c.rasp,breath:c.breath,crackle:c.crackle,dryness:c.dryness,echo:c.echo};
  }

  async function processRecorded(blob,c,l){const d=await decodeMono(blob),fx=fxFor(c,l,{recorded:true});const shifted=shiftPitchAndSpeed(d.pcm,fx.pitch,fx.speed);return renderFxFromPcm(shifted,d.rate,fx)}
  async function processSyntheticTexture(blob,c){const d=await decodeMono(blob),fx=fxFor(c,null,{recorded:false});return renderFxFromPcm(d.pcm,d.rate,fx)}
  async function toMonoWav(blob){const d=await decodeMono(blob);return encodeWav(d.pcm,d.rate)}

  async function invalidateLine(l){l.generated=false;chapter().masterReady=false;await dbDel(lineKey(l)).catch(()=>{});await dbDel(masterKey()).catch(()=>{});try{save()}catch{}}
  async function storePerf(l,blob,name='recording'){
    if(!blob?.size)throw Error('That recording is empty.');
    const wav=await toMonoWav(blob);await dbPut(perfKey(l),wav);
    const m=metaRead();m[l.id]={sourceName:name,bytes:wav.size,storedAt:Date.now(),speaker:l.speaker,text:l.text.slice(0,90)};metaWrite(m);
    await invalidateLine(l);return wav;
  }
  async function clearPerf(l){await dbDel(perfKey(l)).catch(()=>{});const m=metaRead();delete m[l.id];metaWrite(m);await invalidateLine(l)}
  async function getPerf(l){return dbGet(perfKey(l)).catch(()=>null)}

  const baseRenderLine=renderLine;
  renderLine=async function(l){
    const c=withFx({...charByName(l.speaker)}),p=await getPerf(l);
    if(p)return processRecorded(p,c,l);
    if(c.mode==='record')throw Error(`${c.name} is set to Recorded mode, but this line has no recording. Tap Record / Import on the line.`);
    const out=await baseRenderLine(l);
    if(Math.max(c.rasp,c.breath,c.crackle,c.dryness,c.echo)<.005)return out;
    return processSyntheticTexture(out,c);
  };

  const baseProfileSummary=profileSummary;
  profileSummary=function(c){if(c.mode==='record')return 'Recorded performances · per-line audio';const s=baseProfileSummary(c);const mx=Math.max(c.rasp||0,c.breath||0,c.crackle||0,c.dryness||0,c.echo||0);return mx>.01?`${s} · texture ${Math.round(mx*100)}%`:s};
  const baseCastCard=castCard;
  castCard=function(c){return baseCastCard(c).replace('<span class="chip">record</span>','<span class="chip">Recorded</span>')};

  const baseRenderMode=renderMode;
  renderMode=function(c){
    if(c.mode!=='record')return baseRenderMode(c);
    const el=byId('modeBody');if(!el)return;
    el.innerHTML=`<div class="infoBox"><b>Recorded Performance mode.</b> No speech model is used for this character. Each line uses the audio you record or import from the Chapter Production card. Pitch, tone, emotion, intensity and the Texture & Space controls below are still applied non-destructively.</div><div class="mini">This is the highest-fidelity option when you can perform the line yourself. Missing recorded lines stop instead of silently falling back to TTS.</div>`;
  };

  function slider(id,label,val,note){return `<div class="field"><label>${label} · <span id="${id}Out">${Number(val).toFixed(2)}</span></label><input id="${id}" type="range" min="0" max="1" step=".01" value="${Number(val).toFixed(2)}"><div class="mini">${note}</div></div>`}
  function setFxUi(v){for(const[k,val]of Object.entries({vRasp:v.rasp,vBreath:v.breath,vCrackle:v.crackle,vDryness:v.dryness,vEcho:v.echo})){const e=byId(k);if(e){e.value=val;const o=byId(k+'Out');if(o)o.textContent=Number(val).toFixed(2)}}}

  const baseOpenVoiceLab=openVoiceLab;
  openVoiceLab=function(id){
    baseOpenVoiceLab(id);
    const c=withFx(state.characters.find(x=>x.id===id)||state.characters[0]);
    const oldTab=document.querySelector('.modeTab[data-mode="clone"]');
    if(oldTab){oldTab.dataset.mode='record';oldTab.textContent='Record';oldTab.classList.toggle('active',c.mode==='record')}
    const modal=byId('voiceModal'),card=modal?.querySelector('.modalCard'),preview=byId('previewText');
    if(!card||byId('unifiedFxBox'))return;
    const box=document.createElement('div');box.id='unifiedFxBox';box.className='card';box.style.margin='12px 0';
    box.innerHTML=`<div class="sectionHead"><div><strong>Texture & Space</strong><div class="mini">Available for Preset, Designed, Blend and Recorded voices.</div></div><span class="chip">unified</span></div><div class="voiceGrid">${slider('vRasp','Throat rasp',c.rasp,'mild parallel roughness')}${slider('vBreath','Breath / air',c.breath,'uses the voice\'s own high frequencies, not generated hiss')}${slider('vCrackle','Throat catch',c.crackle,'short source-derived edge')}${slider('vDryness','Dry / brittle',c.dryness,'removes chest weight')}${slider('vEcho','Room / tomb echo',c.echo,'short dark reflection')}</div><div class="toolbar"><button id="cleanFx" class="btn">Clean</button>${norm(c.name)==='dead king'?'<button id="deadKingNatural" class="btn warn">Dead King · Brittle Whisper</button>':''}</div>`;
    (preview?.closest('.field')||card.querySelector('.toolbar'))?.before(box);
    box.querySelectorAll('input[type=range]').forEach(r=>r.oninput=()=>{const o=byId(r.id+'Out');if(o)o.textContent=Number(r.value).toFixed(2)});
    byId('cleanFx').onclick=()=>setFxUi(FX_DEFAULTS);
    if(byId('deadKingNatural'))byId('deadKingNatural').onclick=()=>{
      const vals={rasp:.14,breath:.10,crackle:.06,dryness:.28,echo:.07};setFxUi(vals);
      if(byId('vSpeed'))byId('vSpeed').value='1.00';if(byId('vPitch'))byId('vPitch').value='-0.20';if(byId('vTone'))byId('vTone').value='hollow';if(byId('vEmotion'))byId('vEmotion').value='whispered';if(byId('vIntensity'))byId('vIntensity').value='.92';if(byId('vPause'))byId('vPause').value='.95';
    };
  };

  const baseSaveVoiceBase=saveVoiceBase;
  saveVoiceBase=function(c,rerender=false){
    c.rasp=n(byId('vRasp')?.value??c.rasp,0,1,0);c.breath=n(byId('vBreath')?.value??c.breath,0,1,0);c.crackle=n(byId('vCrackle')?.value??c.crackle,0,1,0);c.dryness=n(byId('vDryness')?.value??c.dryness,0,1,0);c.echo=n(byId('vEcho')?.value??c.echo,0,1,0);
    return baseSaveVoiceBase(c,rerender);
  };

  const baseLineCard=lineCard;
  lineCard=function(l,i){
    let h=baseLineCard(l,i),ok=hasPerf(l.id),label=ok?'Replace Recording':'Record / Import';
    const needle=`<button class="btn tiny previewOne" data-id="${l.id}">Preview</button>`;
    const add=`${needle}<button class="btn tiny linePerf ${ok?'good':''}" data-id="${l.id}">${label}</button>${ok?'<span class="chip good">RECORDED</span>':''}`;
    return h.includes(needle)?h.replace(needle,add):h;
  };

  const baseWire=wire;
  wire=function(){baseWire();document.querySelectorAll('.linePerf').forEach(b=>b.onclick=()=>openPerformanceModal(b.dataset.id))};

  function stopRec(){try{if(rec&&rec.state==='recording')rec.stop()}catch{}}
  function stopTracks(){try{recStream?.getTracks?.().forEach(t=>t.stop())}catch{}recStream=null}
  function mimeChoice(){const list=['audio/mp4','audio/webm;codecs=opus','audio/webm'];return list.find(x=>{try{return MediaRecorder.isTypeSupported?.(x)}catch{return false}})||''}

  async function beginRec(l){
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('Microphone recording is unavailable here. Use Import Audio instead.');
    stopTracks();recStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const mime=mimeChoice();recChunks=[];recLineId=l.id;rec=new MediaRecorder(recStream,mime?{mimeType:mime}:undefined);
    rec.ondataavailable=e=>{if(e.data?.size)recChunks.push(e.data)};
    rec.onstop=async()=>{try{const raw=new Blob(recChunks,{type:rec.mimeType||mime||'audio/mp4'});await storePerf(l,raw,'Recorded on iPhone');setStatus(`${l.speaker} recording saved`);render()}catch(e){alert('Could not save recording: '+e.message)}finally{rec=null;recChunks=[];recLineId=null;stopTracks()}};
    rec.start(250);const st=byId('perfRecordStatus');if(st)st.textContent='RECORDING… perform the line, then tap Stop.';byId('perfStart').disabled=true;byId('perfStop').disabled=false;
  }

  async function openPerformanceModal(id){
    const l=chapter().lines.find(x=>x.id===id);if(!l)return;const c=withFx(charByName(l.speaker)),existing=await getPerf(l),m=metaRead()[l.id];
    const modal=byId('voiceModal');modal.classList.remove('hidden');modal.innerHTML=`<div class="modalCard"><div class="sectionHead"><div><h2>Recorded Performance · ${esc(l.speaker)}</h2><div class="mini">This recording replaces TTS for this line only.</div></div><button id="perfClose" class="btn">Close</button></div><div class="card"><div class="mini">Line</div><div style="margin-top:6px">${esc(l.text)}</div></div><div class="infoBox"><b>Same voice controls still apply:</b> ${esc(c.emotion)} emotion · ${c.pitch>=0?'+':''}${Number(c.pitch).toFixed(1)} st pitch · ${esc(c.tone)} tone · ${Number(c.intensity).toFixed(2)} intensity, plus Texture & Space from ${esc(c.name)}'s Voice Lab.</div><input id="perfFile" type="file" accept="audio/*,.wav,.m4a,.mp3,.aac" style="display:none"><div class="toolbar"><button id="perfStart" class="btn warn">● Record</button><button id="perfStop" class="btn" disabled>Stop</button><button id="perfImport" class="btn primary">Import Audio</button>${existing?'<button id="perfOriginal" class="btn">Original</button><button id="perfProcessed" class="btn good">Preview With Voice Tweaks</button><button id="perfClear" class="btn bad">Remove Recording</button>':''}</div><div id="perfRecordStatus" class="mini">${existing?`Saved · ${esc(m?.sourceName||'recording')} · ${Math.round(existing.size/1024)} KB`:'No recorded performance for this line yet.'}</div><div class="mini" style="margin-top:10px">For best quality, perform the words exactly as you want them delivered. Effects can shape a real performance; they cannot remove robotic articulation from a synthetic one.</div></div>`;
    byId('perfClose').onclick=()=>{stopRec();stopTracks();modal.classList.add('hidden')};byId('perfStart').onclick=()=>beginRec(l).catch(e=>alert(e.message));byId('perfStop').onclick=stopRec;byId('perfImport').onclick=()=>byId('perfFile').click();
    byId('perfFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{await storePerf(l,f,f.name);setStatus(`${l.speaker} performance imported`);render()}catch(err){alert('Import failed: '+err.message)}};
    if(existing){byId('perfOriginal').onclick=()=>{unlockPreviewAudio();playBlob(existing,`${l.speaker} · original recording`)};byId('perfProcessed').onclick=async()=>{unlockPreviewAudio();const b=await processRecorded(existing,c,l);playBlob(b,`${l.speaker} · recorded + voice tweaks`)};byId('perfClear').onclick=async()=>{if(!confirm('Remove this recorded performance and return the line to its character voice?'))return;await clearPerf(l);render()}}
  }
  window.openPerformanceModal=openPerformanceModal;
  window.addEventListener('pagehide',()=>{stopRec();stopTracks()});
})();
