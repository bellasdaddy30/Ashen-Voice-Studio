// Ashen Voice Studio v0.9.3 — clone reference recorder
// Adds direct microphone recording/import/preview for the Clone tab.
(function(){
  const META_KEY='ashen-clone-reference-v093-meta';
  let stream=null,ctx=null,source=null,processor=null,silent=null,chunks=[],rate=48000,activeChar=null;
  const $=id=>document.getElementById(id);
  const metaRead=()=>{try{return JSON.parse(localStorage.getItem(META_KEY)||'{}')}catch{return{}}};
  const metaWrite=m=>{try{localStorage.setItem(META_KEY,JSON.stringify(m))}catch{}};
  const refKey=c=>`ashen:clone-reference:v093:${c.id}`;

  function wavBlob(pcm,sampleRate){
    const ab=new ArrayBuffer(44+pcm.length*2),v=new DataView(ab),wr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
    wr(0,'RIFF');v.setUint32(4,36+pcm.length*2,true);wr(8,'WAVE');wr(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);wr(36,'data');v.setUint32(40,pcm.length*2,true);
    let o=44;for(const raw of pcm){const x=Math.max(-1,Math.min(1,raw));v.setInt16(o,x<0?x*32768:x*32767,true);o+=2}return new Blob([ab],{type:'audio/wav'});
  }
  function join(parts){let n=0;for(const a of parts)n+=a.length;const out=new Float32Array(n);let p=0;for(const a of parts){out.set(a,p);p+=a.length}return out}
  function cleanup(){try{processor&&(processor.onaudioprocess=null)}catch{}try{processor?.disconnect()}catch{}try{source?.disconnect()}catch{}try{silent?.disconnect()}catch{}try{stream?.getTracks?.().forEach(t=>t.stop())}catch{}try{ctx?.close()}catch{}stream=ctx=source=processor=silent=null}
  function status(msg){const e=$('cloneRecStatus');if(e)e.textContent=msg;try{setStatus(msg)}catch{}}

  async function saveRef(c,blob,name='Recorded reference'){
    if(!blob?.size)throw Error('No reference audio was captured.');
    await dbPut(refKey(c),blob);
    const m=metaRead();m[c.id]={name,bytes:blob.size,storedAt:Date.now()};metaWrite(m);
    c.cloneFileName=name;c.cloneReferenceReady=true;try{save()}catch{}
    status(`Reference saved · ${Math.round(blob.size/1024)} KB`);
  }
  async function getRef(c){return dbGet(refKey(c)).catch(()=>null)}
  async function clearRef(c){await dbDel(refKey(c)).catch(()=>{});const m=metaRead();delete m[c.id];metaWrite(m);c.cloneReferenceReady=false;c.cloneFileName='';try{save()}catch{};inject(c)}

  async function start(c){
    if(activeChar)return;
    if(!window.isSecureContext)throw Error('Microphone recording requires HTTPS.');
    if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser is blocking microphone access. Open the site directly in Safari/Chrome, not an in-app browser.');
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('Web Audio recording is unavailable in this browser.');
    cleanup();chunks=[];activeChar=c;status('Requesting microphone permission…');
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});ctx=new AC();if(ctx.state==='suspended')await ctx.resume();rate=ctx.sampleRate||48000;source=ctx.createMediaStreamSource(stream);
      if(!ctx.createScriptProcessor)throw Error('This browser does not expose PCM recording.');
      processor=ctx.createScriptProcessor(4096,1,1);silent=ctx.createGain();silent.gain.value=0;processor.onaudioprocess=e=>chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));source.connect(processor);processor.connect(silent);silent.connect(ctx.destination);
      if($('cloneRecStart'))$('cloneRecStart').disabled=true;if($('cloneRecStop'))$('cloneRecStop').disabled=false;status('RECORDING… speak naturally for about 8–15 seconds, then tap Stop.');
    }catch(e){activeChar=null;cleanup();throw e}
  }
  async function stop(){
    const c=activeChar,parts=chunks;activeChar=null;chunks=[];cleanup();if(!c)return;if(!parts.length)throw Error('No microphone audio was captured.');
    const blob=wavBlob(join(parts),rate);await saveRef(c,blob,'Recorded clone reference.wav');await inject(c);
  }
  async function decodeToWav(file){
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return file;const ac=new AC();try{const b=await ac.decodeAudioData((await file.arrayBuffer()).slice(0)),out=new Float32Array(b.length),count=Math.max(1,b.numberOfChannels||1);for(let c=0;c<count;c++){const x=b.getChannelData(c);for(let i=0;i<out.length;i++)out[i]+=x[i]/count}return wavBlob(out,b.sampleRate||48000)}finally{try{await ac.close()}catch{}};
  }

  async function useForClone(c){
    const blob=await getRef(c);if(!blob)throw Error('Record or import a reference first.');
    const file=new File([blob],`${String(c.name||'voice').replace(/[^a-z0-9]+/gi,'-')}-clone-reference.wav`,{type:'audio/wav'});
    if(/iPhone|iPad|iPod/i.test(navigator.userAgent)){
      throw Error('Reference recording is saved, but the current local clone engine is disabled on iPhone because it is too large for reliable mobile Safari. The same saved reference can be used from a desktop-class browser, or you can use Recorded Performance mode on iPhone.');
    }
    if(typeof cloneFromFile!=='function')throw Error('Clone engine is not available in this build.');
    await cloneFromFile(c,file);status(`${c.name} clone created from recorded reference.`);try{render()}catch{}
  }

  async function inject(c){
    if(!c||c.mode!=='clone')return;const body=$('modeBody');if(!body)return;
    const existing=await getRef(c),meta=metaRead()[c.id];
    body.innerHTML=`<div class="infoBox"><b>Clone Reference.</b> Record or import a clean sample here. Your reference stays local in this browser.</div><label class="cloneConsent card"><input id="cloneConsent" type="checkbox"><span class="mini">I have permission to create and use this voice clone.</span></label><div class="toolbar"><button id="cloneRecStart" class="btn warn">● Record Reference</button><button id="cloneRecStop" class="btn" disabled>Stop</button><button id="cloneRefImport" class="btn primary">Import Reference</button>${existing?'<button id="cloneRefPreview" class="btn good">Preview Reference</button><button id="cloneRefClear" class="btn bad">Clear</button>':''}</div><input id="cloneRefFile" type="file" accept="audio/*,.wav,.m4a,.mp3,.aac" style="display:none"><div id="cloneRecStatus" class="mini">${existing?`Saved · ${String(meta?.name||c.cloneFileName||'reference')} · ${Math.round(existing.size/1024)} KB`:'No reference saved yet. Aim for 8–15 seconds of one speaker, no music.'}</div><div class="field"><label>Expressiveness</label><input id="vExpr" type="number" min="0" max="1.5" step=".05" value="${c.expressiveness??.5}"></div><div class="toolbar"><button id="makeCloneFromRef" class="btn primary" ${existing?'':'disabled'}>Create / Replace Clone From Reference</button></div><div class="mini">On iPhone, recording and storing the reference works. The current local neural clone engine itself is still too large for reliable mobile Safari and will not be falsely advertised as working there.</div>`;
    $('cloneRecStart').onclick=()=>start(c).catch(e=>{status(e.message);alert(e.message)});$('cloneRecStop').onclick=()=>stop().catch(e=>{status(e.message);alert(e.message)});$('cloneRefImport').onclick=()=>$('cloneRefFile').click();
    $('cloneRefFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{status('Importing reference…');await saveRef(c,await decodeToWav(f),f.name);await inject(c)}catch(err){status(err.message);alert('Reference import failed: '+err.message)}};
    if(existing){$('cloneRefPreview').onclick=()=>{try{unlockPreviewAudio()}catch{};playBlob(existing,`${c.name} · clone reference`)};$('cloneRefClear').onclick=()=>clearRef(c)}
    $('makeCloneFromRef').onclick=async()=>{if(!$('cloneConsent')?.checked)return alert('Confirm that you have permission to clone this speaker.');c.expressiveness=clamp($('vExpr')?.value??c.expressiveness,0,1.5);try{save()}catch{};try{status('Preparing clone…');await useForClone(c)}catch(e){status(e.message);alert(e.message)}};
  }

  const baseOpen=window.openVoiceLab;
  if(typeof baseOpen==='function')window.openVoiceLab=function(id){baseOpen(id);const c=state.characters.find(x=>x.id===id)||state.characters[0];setTimeout(()=>inject(c),0)};
  document.addEventListener('click',e=>{const t=e.target.closest?.('.modeTab[data-mode="clone"]');if(!t)return;setTimeout(()=>{const c=state.characters.find(x=>x.id===selectedCharacterId)||state.characters[0];inject(c)},0)},true);
  const mo=new MutationObserver(()=>{try{const c=state?.characters?.find(x=>x.id===selectedCharacterId);if(c?.mode==='clone'&&$('modeBody')&&!$('cloneRecStart'))inject(c)}catch{}});mo.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>{activeChar=null;cleanup()});
})();
