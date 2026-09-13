async function generateOne(id,{quiet=false}={}){const l=chapter().lines.find(x=>x.id===id);if(!l)return false;setStatus(`Rendering ${l.speaker}…`);try{const blob=await renderLine(l);await dbPut(lineKey(l),blob);l.generated=true;chapter().masterReady=false;await dbDel(masterKey()).catch(()=>{});save();if(state.settings.memorySaver)await sleep(40);if(!quiet)render();return true}catch(e){console.error(e);l.generated=false;save();if(!quiet)alert(`Render failed: ${e.message}`);return false}}
async function generateMissing(){queueAbort=false;const todo=chapter().lines.filter(l=>!l.generated&&l.text.trim());let n=0;for(const l of todo){if(queueAbort)break;const ok=await generateOne(l.id,{quiet:true});if(!ok)break;n++;setProgress(n,todo.length,'WAVs rendered');if(state.settings.memorySaver&&n%8===0)await sleep(120)}setStatus(queueAbort?'Stopped':'Generation pass finished');render();}
async function produceChapter(){queueAbort=false;if(Object.values(intake).some(Boolean))await mapFiles(true);if(!chapter().lines.length)throw alert('No production segments yet. Load your production/manuscript files first.');const todo=chapter().lines.filter(l=>!l.generated);let n=0;for(const l of todo){if(queueAbort)break;const ok=await generateOne(l.id,{quiet:true});if(!ok)break;n++;setProgress(n,todo.length,'Producing chapter');}if(!queueAbort){await assemble(true);setStatus('Chapter complete')}render();}
async function assemble(silent=false){const blobs=[],pauses=[];for(const l of chapter().lines){const b=await dbGet(lineKey(l));if(!b)continue;blobs.push(b);const c=charByName(l.speaker),em=EMOTIONS[l.emotion||c.emotion]||EMOTIONS.neutral;pauses.push(l.pause??c.pause??em.pause)}if(!blobs.length){if(!silent)alert('No WAVs generated yet.');return}setStatus('Assembling master WAV…');const out=await merge(blobs,pauses);await dbPut(masterKey(),out);chapter().masterReady=blobs.length===chapter().lines.length;save();if(!silent)render();return out;}
async function previewCharacter(id){if(voicePreviewBusy)return;unlockPreviewAudio();const c=state.characters.find(x=>x.id===id);if(!c)return;const sample=previewText(c.name).slice(0,state.settings.memorySaver?72:140);setVoiceBusy(true,`Preparing ${c.name} preview…`);try{const b=await synthesizeProfile(sample,c);await playBlob(b,`${c.name} voice preview`);setEngineProgress(`${c.name} preview ready`,false)}catch(e){alert(`Preview failed: ${e.message}`);setEngineProgress('Preview failed',false)}finally{setVoiceBusy(false)}}
async function previewLine(id){if(voicePreviewBusy)return;unlockPreviewAudio();const l=chapter().lines.find(x=>x.id===id);if(!l)return;const short={...l,text:l.text.slice(0,state.settings.memorySaver?80:160)};setVoiceBusy(true,`Preparing line preview · ${l.speaker}…`);try{const b=await renderLine(short);await playBlob(b,`${l.speaker} · line preview`);setEngineProgress('Line preview ready',false)}catch(e){alert(`Preview failed: ${e.message}`);setEngineProgress('Preview failed',false)}finally{setVoiceBusy(false)}}
let previewAudioContext=null;
let previewBufferSource=null;
let previewUnlockPromise=null;

function unlockPreviewAudio(){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC)return Promise.resolve(false);
  try{
    if(!previewAudioContext)previewAudioContext=new AC();
    previewUnlockPromise=previewAudioContext.state==='suspended'
      ? previewAudioContext.resume().catch(()=>false)
      : Promise.resolve(true);

    const b=previewAudioContext.createBuffer(1,1,previewAudioContext.sampleRate||24000);
    const s=previewAudioContext.createBufferSource();
    s.buffer=b;s.connect(previewAudioContext.destination);s.start(0);
    return previewUnlockPromise;
  }catch(e){
    console.warn('Audio unlock failed',e);
    return Promise.resolve(false);
  }
}

function showPreviewDock(blob,label='Voice preview'){
  const dock=byId('previewDock'),audio=byId('previewDockAudio'),title=byId('previewDockTitle'),st=byId('previewDockStatus');
  if(!dock||!audio)return null;
  const u=URL.createObjectURL(blob);objectUrls.push(u);
  title.textContent=label;
  st.textContent='Preview ready. If Safari blocks automatic sound, tap Play below.';
  audio.src=u;
  audio.load();
  dock.classList.add('show');
  return {audio,url:u,status:st};
}

async function playBlob(blob,label='Voice preview'){
  const dock=showPreviewDock(blob,label);
  try{
    await (previewUnlockPromise||Promise.resolve());
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!previewAudioContext&&AC)previewAudioContext=new AC();
    if(previewAudioContext){
      if(previewAudioContext.state==='suspended')await previewAudioContext.resume();
      const arr=await blob.arrayBuffer();
      const buf=await previewAudioContext.decodeAudioData(arr.slice(0));
      try{previewBufferSource?.stop()}catch{}
      const src=previewAudioContext.createBufferSource();
      src.buffer=buf;
      src.connect(previewAudioContext.destination);
      previewBufferSource=src;
      src.onended=()=>{if(dock?.status)dock.status.textContent='Preview finished. Tap Play to hear it again.'};
      src.start(0);
      if(dock?.status)dock.status.textContent='Playing preview…';
      return true;
    }
  }catch(e){
    console.warn('Web Audio autoplay path failed',e);
  }

  if(dock?.audio){
    try{
      await dock.audio.play();
      dock.status.textContent='Playing preview…';
      return true;
    }catch(e){
      dock.status.textContent='Safari blocked automatic playback. Tap Play below.';
      console.warn('HTML audio autoplay blocked',e);
    }
  }
  return false;
}
async function clearChapterAudio(){if(!confirm('Clear all generated audio for this chapter?'))return;for(const l of chapter().lines){await dbDel(lineKey(l)).catch(()=>{});l.generated=false}await dbDel(masterKey()).catch(()=>{});chapter().masterReady=false;save();render();}
async function restoreAudio(){for(const l of chapter().lines.filter(x=>x.generated)){const b=await dbGet(lineKey(l)).catch(()=>null);if(!b)continue;const h=byId(`audio-${l.id}`);if(!h)continue;const u=URL.createObjectURL(b);objectUrls.push(u);h.innerHTML=`<audio controls preload="metadata" src="${u}"></audio><button class="btn tiny saveLine">Share WAV</button>`;h.querySelector('.saveLine').onclick=()=>shareBlob(b,`${slug(l.speaker)}-${l.id.slice(0,5)}.wav`)}const master=await dbGet(masterKey()).catch(()=>null);if(master&&byId('master')){const u=URL.createObjectURL(master);objectUrls.push(u);byId('master').innerHTML=`<div class="master"><strong>Chapter Master</strong><div class="audioRow"><audio controls src="${u}"></audio></div><div class="toolbar"><button id="shareMaster" class="btn good">Save / Share Final WAV</button></div></div>`;byId('shareMaster').onclick=()=>shareBlob(master,`${slug(state.title)}-${slug(chapter().title)}.wav`)}}
function revokeUrls(){for(const u of objectUrls)URL.revokeObjectURL(u);objectUrls=[];}
async function shareBlob(blob,name){const f=new File([blob],name,{type:blob.type||'audio/wav'});if(navigator.canShare?.({files:[f]})){try{await navigator.share({files:[f],title:name});return}catch(e){if(e.name==='AbortError')return}}const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),20000)}
