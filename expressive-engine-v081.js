// Ashen Voice Studio v0.8.1 — reference-conditioned expressive engine
// Routes selected characters to a private Chatterbox Nano server instead of post-processing Kokoro.
(function(){
  const ENDPOINT_KEY='ashen-voice-expressive-endpoint';
  let recordedReference=null,mediaRecorder=null,mediaStream=null,recordTimer=null;

  const cleanEndpoint=s=>String(s||'').trim().replace(/\/+$/,'');
  const getEndpoint=()=>cleanEndpoint(localStorage.getItem(ENDPOINT_KEY)||'');
  const setEndpoint=v=>localStorage.setItem(ENDPOINT_KEY,cleanEndpoint(v));

  const baseMakeChar=makeChar;
  makeChar=function(c={}){
    const out=baseMakeChar(c);
    out.engine=c.engine||out.engine||'kokoro';
    out.voiceRefId=c.voiceRefId||out.voiceRefId||slug(out.name||'character');
    return out;
  };

  async function fetchJson(url,options={}){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const r=await fetch(url,{...options,signal:controller.signal,cache:'no-store'});
      let data=null;try{data=await r.json()}catch{}
      if(!r.ok)throw new Error(data?.detail||data?.error||`${r.status} ${r.statusText}`);
      return data||{};
    }finally{clearTimeout(timer)}
  }

  async function expressiveBlob(text,c){
    const endpoint=getEndpoint();
    if(!endpoint)throw new Error('Expressive Engine URL is not set. Open this character in Voice Lab and enter the Ragnarok/Tailscale HTTPS address.');
    const payload={text:applyDictionary(text),voice_id:c.voiceRefId||slug(c.name),character:c.name};
    const r=await fetch(`${endpoint}/synthesize`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'
    });
    if(!r.ok){let msg=`${r.status} ${r.statusText}`;try{const j=await r.json();msg=j.detail||j.error||msg}catch{}throw new Error(`Expressive engine: ${msg}`)}
    const b=await r.blob();
    if(!b.size)throw new Error('Expressive engine returned an empty audio file.');
    return b.type?.startsWith('audio/')?b:new Blob([await b.arrayBuffer()],{type:'audio/wav'});
  }

  const baseSynthesize=synthesizeProfile;
  synthesizeProfile=async function(text,c){
    if(c?.engine==='chatterbox-local')return expressiveBlob(text,c);
    return baseSynthesize(text,c);
  };

  function status(msg,bad=false){const el=byId('expressiveStatus');if(el){el.textContent=msg;el.style.color=bad?'#efada6':''}}
  function syncEngineUi(c){
    const expressive=c.engine==='chatterbox-local';
    const old=byId('throatFxBox');if(old)old.style.display=expressive?'none':'';
    const modeTabs=document.querySelector('.tabs');if(modeTabs)modeTabs.style.opacity=expressive?.45:'1';
    const modeBody=byId('modeBody');if(modeBody)modeBody.style.opacity=expressive?.45:'1';
  }

  async function testEngine(){
    const ep=cleanEndpoint(byId('expressiveEndpoint')?.value||getEndpoint());
    if(!ep)return status('Enter the HTTPS Tailscale address first.',true);
    setEndpoint(ep);status('Checking Ragnarok…');
    try{const h=await fetchJson(`${ep}/health`);status(`Connected · ${h.engine||'Chatterbox Nano'} · ${h.model_loaded?'model loaded':'model loads on first preview'}`)}
    catch(e){status(`Connection failed: ${e.message}`,true)}
  }

  async function uploadReference(c){
    const ep=cleanEndpoint(byId('expressiveEndpoint')?.value||getEndpoint());
    if(!ep)return status('Enter and test the Expressive Engine URL first.',true);
    setEndpoint(ep);
    const picked=byId('expressiveRefFile')?.files?.[0];
    const file=recordedReference||picked;
    if(!file)return status('Record or choose a 5–15 second gravelly whispered reference first.',true);
    const fd=new FormData();fd.append('file',file,file.name||'dead-king-reference.m4a');
    status('Uploading and preparing reference…');
    try{
      const r=await fetchJson(`${ep}/reference/${encodeURIComponent(c.voiceRefId||slug(c.name))}`,{method:'POST',body:fd});
      status(`Reference saved · ${Math.round((r.duration_seconds||0)*10)/10 || '?'} sec · ready for model conditioning`);
      c.engine='chatterbox-local';save();syncEngineUi(c);
    }catch(e){status(`Reference failed: ${e.message}`,true)}
  }

  async function startRecording(){
    if(!navigator.mediaDevices?.getUserMedia)return status('This browser cannot record microphone audio here. Use Choose Recording instead.',true);
    try{
      mediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      const types=['audio/mp4','audio/webm;codecs=opus','audio/webm'];
      const mime=types.find(t=>window.MediaRecorder?.isTypeSupported?.(t))||'';
      const chunks=[];mediaRecorder=new MediaRecorder(mediaStream,mime?{mimeType:mime}:undefined);
      mediaRecorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
      mediaRecorder.onstop=()=>{
        const type=mediaRecorder.mimeType||mime||'audio/webm';
        const ext=type.includes('mp4')?'m4a':'webm';
        recordedReference=new File([new Blob(chunks,{type})],`dead-king-reference.${ext}`,{type});
        mediaStream?.getTracks().forEach(t=>t.stop());mediaStream=null;
        const u=URL.createObjectURL(recordedReference);objectUrls.push(u);
        const p=byId('expressiveRefPreview');if(p)p.innerHTML=`<audio controls src="${u}"></audio>`;
        status('Recording captured. Listen once, then Save Reference if the throat/style is right.');
      };
      mediaRecorder.start();status('Recording… perform the scratchy whisper for 8–12 seconds.');
      byId('recordReference').disabled=true;byId('stopReference').disabled=false;
      recordTimer=setTimeout(()=>stopRecording(),12000);
    }catch(e){status(`Microphone failed: ${e.message}`,true)}
  }
  function stopRecording(){
    clearTimeout(recordTimer);recordTimer=null;
    if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();
    const a=byId('recordReference'),b=byId('stopReference');if(a)a.disabled=false;if(b)b.disabled=true;
  }

  const baseOpenVoiceLab=openVoiceLab;
  openVoiceLab=function(id){
    baseOpenVoiceLab(id);
    const c=state.characters.find(x=>x.id===id)||state.characters[0];
    if(!c)return;
    const host=byId('modeBody');if(!host||byId('expressiveEngineBox'))return;
    const box=document.createElement('div');box.id='expressiveEngineBox';box.className='card';box.style.margin='12px 0';
    const ep=getEndpoint();
    box.innerHTML=`<div class="sectionHead"><div><strong>Expressive Reference Engine</strong><div class="mini">Chatterbox Nano on Ragnarok. Uses a real reference voice instead of fake rasp/static processing.</div></div><span class="chip">v0.8.1</span></div>
      <div class="field"><label>Engine for ${esc(c.name)}</label><select id="characterEngine"><option value="kokoro" ${c.engine!=='chatterbox-local'?'selected':''}>Kokoro · built-in voices</option><option value="chatterbox-local" ${c.engine==='chatterbox-local'?'selected':''}>Chatterbox Nano · reference-conditioned</option></select></div>
      <div class="field"><label>Ragnarok Expressive Engine HTTPS address</label><input id="expressiveEndpoint" type="url" placeholder="https://ragnarok.your-tailnet.ts.net" value="${esc(ep)}"></div>
      <div class="toolbar"><button id="testExpressive" class="btn">Test Engine</button></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:10px 0">
      <div class="infoBox"><b>Reference performance:</b> 5–15 seconds, one speaker, no music. Speak in the exact dry, scratchy, low whispered throat you want the character to keep. For the Dead King: “The stone remembers every name. You should not have opened this tomb. Zikir Ashur.”</div>
      <div class="toolbar"><button id="recordReference" class="btn warn">Record Reference</button><button id="stopReference" class="btn" disabled>Stop</button></div>
      <div class="field"><label>Or choose an existing recording</label><input id="expressiveRefFile" type="file" accept="audio/*,.wav,.m4a,.mp3,.webm"></div>
      <div id="expressiveRefPreview"></div>
      <div class="toolbar"><button id="uploadReference" class="btn primary">Save Reference to Ragnarok</button></div>
      <div id="expressiveStatus" class="mini">${c.engine==='chatterbox-local'?'Reference engine selected.':'Kokoro selected.'}</div>`;
    host.before(box);
    byId('characterEngine').onchange=e=>{c.engine=e.target.value;c.voiceRefId=c.voiceRefId||slug(c.name);save();syncEngineUi(c)};
    byId('expressiveEndpoint').onchange=e=>setEndpoint(e.target.value);
    byId('testExpressive').onclick=testEngine;
    byId('recordReference').onclick=startRecording;byId('stopReference').onclick=stopRecording;
    byId('uploadReference').onclick=()=>uploadReference(c);
    syncEngineUi(c);
  };
})();
