// Ashen Voice Studio v0.9.9 — visible SFX controls + manual graphical mixer/EQ
(function(){
  'use strict';

  var MIX_VERSION='099';
  var MIX_DB_SUFFIX=':MANUAL_MIX_V099';
  var PREVIEW_SECONDS=20;
  var FREQS=[31,63,125,250,500,1000,2000,4000,8000,10000];
  var LABELS=['31','63','125','250','500','1k','2k','4k','8k','10k'];
  var selectedBus='voice';
  var mixBusy=false;

  function mixStorageKey(){
    var ch=(typeof chapter==='function'&&chapter())||{id:'chapter'};
    return 'ashen-mixer-v099:'+(state&&state.title?state.title:'book')+':'+ch.id;
  }
  function flatBus(){return{gainDb:0,bypass:false,eq:FREQS.map(function(){return 0})}}
  function freshMix(){return{voice:flatBus(),sfx:flatBus(),master:flatBus(),normalize:false,previewStart:0}}
  function sanitizeBus(b){
    var d=flatBus();b=b||{};
    d.gainDb=Math.max(-36,Math.min(12,Number(b.gainDb)||0));
    d.bypass=!!b.bypass;
    d.eq=FREQS.map(function(_,i){var v=Number((b.eq||[])[i]);return Number.isFinite(v)?Math.max(-12,Math.min(12,v)):0});
    return d;
  }
  function loadMix(){
    var m=freshMix();
    try{var raw=JSON.parse(localStorage.getItem(mixStorageKey())||'null');if(raw)m=raw}catch(e){}
    return{voice:sanitizeBus(m.voice),sfx:sanitizeBus(m.sfx),master:sanitizeBus(m.master),normalize:!!m.normalize,previewStart:Math.max(0,Number(m.previewStart)||0)};
  }
  function saveMix(m){try{localStorage.setItem(mixStorageKey(),JSON.stringify(m))}catch(e){console.warn('Mixer settings could not be saved',e)}}
  function mixKey(){return state.title+':'+chapter().id+MIX_DB_SUFFIX}
  function dbGain(db){return Math.pow(10,(Number(db)||0)/20)}
  function dbText(v){v=Number(v)||0;return(v>0?'+':'')+v.toFixed(1)+' dB'}

  function ensureStyles(){
    if(document.getElementById('ashenMixerStyles'))return;
    var s=document.createElement('style');s.id='ashenMixerStyles';s.textContent='\
      .mixLaunch{font-weight:800}.mixerCard{width:min(920px,100%)}\
      .mixerTabs{display:flex;gap:6px;overflow:auto;margin:8px 0 12px}.mixerTab{flex:1;min-width:90px}\
      .mixerTab.active{border-color:#915d41;background:#281a14;color:#fff}.mixStrip{border:1px solid var(--line);background:#100d0b;border-radius:14px;padding:10px}\
      .mixGainRow{display:grid;grid-template-columns:1fr 94px;gap:10px;align-items:center}.mixGainRow input[type=range]{padding:0}\
      .eqScroll{overflow-x:auto;padding:6px 2px 2px}.eqBank{display:flex;gap:8px;min-width:500px;justify-content:space-between;align-items:end}\
      .eqBand{width:42px;text-align:center}.eqTrack{height:142px;display:grid;place-items:center;overflow:visible}.eqSlider{width:128px;height:24px;transform:rotate(-90deg);padding:0;margin:0}\
      .eqBand b{display:block;font-size:.66rem}.eqVal{display:block;font-size:.6rem;color:var(--accent2);min-height:16px}.eqZero{height:1px;background:#4c3a31;margin:4px 0}\
      .mixMeters{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:10px 0}.mixMeter{border:1px solid var(--line);border-radius:11px;padding:8px;text-align:center;background:#0f0c0a}.mixMeter b{display:block}.mixMeter span{font-size:.64rem;color:var(--muted)}\
      .mixerPlayer{margin-top:10px}.mixerPlayer audio{width:100%;height:38px}.mixNote{font-size:.68rem;color:var(--muted);line-height:1.45;margin-top:7px}\
      @media(max-width:520px){.mixerCard{padding:10px}.mixGainRow{grid-template-columns:1fr 78px}.eqBank{min-width:480px}.eqBand{width:38px}.mixMeters{grid-template-columns:1fr 1fr 1fr}.bottomBar .mixMobileBtn{font-size:.62rem;padding-left:3px;padding-right:3px}}\
    ';document.head.appendChild(s);
  }

  function scrollToSfx(){
    try{if(typeof enhance==='function')enhance()}catch(e){}
    var s=document.getElementById('v7sfx');
    if(!s){alert('The SFX panel is still loading. Give it a moment and tap SFX again.');return}
    s.scrollIntoView({behavior:'smooth',block:'start'});
    setTimeout(function(){s.style.boxShadow='0 0 0 2px rgba(210,122,73,.45),0 16px 44px rgba(0,0,0,.18)';setTimeout(function(){s.style.boxShadow=''},1000)},350);
  }

  function ensureLaunchButtons(){
    ensureStyles();
    var wf=document.querySelector('.toolbar.workflow');
    if(wf&&!document.getElementById('openSfxTop')){
      var sfx=document.createElement('button');sfx.id='openSfxTop';sfx.className='btn mixLaunch';sfx.textContent='SFX';sfx.onclick=scrollToSfx;
      var mix=document.createElement('button');mix.id='openMixerTop';mix.className='btn warn mixLaunch';mix.textContent='Mixer / EQ';mix.onclick=openMixer;
      wf.appendChild(sfx);wf.appendChild(mix);
    }
    var bb=document.querySelector('.bottomBar');
    if(bb&&!document.getElementById('mobileSfx')){
      var ms=document.createElement('button');ms.id='mobileSfx';ms.className='btn mixMobileBtn';ms.textContent='SFX';ms.onclick=scrollToSfx;
      var mm=document.createElement('button');mm.id='mobileMixer';mm.className='btn warn mixMobileBtn';mm.textContent='Mixer';mm.onclick=openMixer;
      bb.insertBefore(ms,bb.lastElementChild);bb.insertBefore(mm,bb.lastElementChild);
    }
  }

  function modal(){
    var m=document.getElementById('mixerModal');
    if(!m){m=document.createElement('div');m.id='mixerModal';m.className='modal hidden';document.body.appendChild(m)}
    return m;
  }

  function bandHtml(bus){
    return FREQS.map(function(f,i){var v=bus.eq[i]||0;return '<div class="eqBand"><span class="eqVal" id="eqv'+i+'">'+dbText(v)+'</span><div class="eqTrack"><input class="eqSlider" data-band="'+i+'" type="range" min="-12" max="12" step="0.5" value="'+v+'"></div><div class="eqZero"></div><b>'+LABELS[i]+'</b></div>'}).join('');
  }

  function channelTitle(k){return k==='voice'?'VOICE BUS':k==='sfx'?'SFX BUS':'MASTER'}
  function renderMixerControls(){
    var m=loadMix(),b=m[selectedBus],body=document.getElementById('mixerControls');if(!body)return;
    body.innerHTML='<div class="mixStrip"><div class="sectionHead"><div><h3>'+channelTitle(selectedBus)+'</h3><div class="mini">10-band EQ · '+(selectedBus==='voice'?'all narration and character speech':selectedBus==='sfx'?'all enabled effects; each cue keeps its own volume':'final combined output')+'</div></div><label class="row"><input id="eqBypass" type="checkbox" style="width:auto" '+(b.bypass?'checked':'')+'><span class="mini">Bypass EQ</span></label></div><div class="mixGainRow"><div><label>Channel level</label><input id="mixGain" type="range" min="-36" max="12" step="0.5" value="'+b.gainDb+'"></div><strong id="mixGainVal">'+dbText(b.gainDb)+'</strong></div><div class="eqScroll"><div class="eqBank">'+bandHtml(b)+'</div></div><div class="toolbar"><button id="flatChannel" class="btn">Flat '+channelTitle(selectedBus)+'</button>'+(selectedBus==='master'?'<label class="btn"><input id="mixNormalize" type="checkbox" style="width:auto;margin-right:6px" '+(m.normalize?'checked':'')+'>Normalize final</label>':'')+'</div></div>';
    document.getElementById('eqBypass').onchange=function(){var x=loadMix();x[selectedBus].bypass=this.checked;saveMix(x)};
    var gain=document.getElementById('mixGain');gain.oninput=function(){document.getElementById('mixGainVal').textContent=dbText(this.value)};gain.onchange=function(){var x=loadMix();x[selectedBus].gainDb=Number(this.value);saveMix(x)};
    body.querySelectorAll('.eqSlider').forEach(function(sl){sl.oninput=function(){var i=Number(this.dataset.band);var val=Number(this.value);document.getElementById('eqv'+i).textContent=dbText(val)};sl.onchange=function(){var x=loadMix(),i=Number(this.dataset.band);x[selectedBus].eq[i]=Number(this.value);saveMix(x)}});
    document.getElementById('flatChannel').onclick=function(){var x=loadMix();x[selectedBus]=flatBus();saveMix(x);renderMixerControls()};
    var norm=document.getElementById('mixNormalize');if(norm)norm.onchange=function(){var x=loadMix();x.normalize=this.checked;saveMix(x)};
  }

  function openMixer(){
    ensureStyles();var m=modal(),cfg=loadMix();
    m.classList.remove('hidden');
    m.innerHTML='<div class="modalCard mixerCard"><div class="sectionHead"><div><h2>Manual Mixer & Graphical EQ</h2><div class="mini">Mix narration, SFX, and final output yourself. The clean narration master is never overwritten.</div></div><button id="closeMixer" class="btn">Close</button></div><div class="mixerTabs"><button class="btn mixerTab '+(selectedBus==='voice'?'active':'')+'" data-bus="voice">VOICE</button><button class="btn mixerTab '+(selectedBus==='sfx'?'active':'')+'" data-bus="sfx">SFX</button><button class="btn mixerTab '+(selectedBus==='master'?'active':'')+'" data-bus="master">MASTER</button></div><div id="mixerControls"></div><div class="mixMeters"><div class="mixMeter"><b>'+dbText(cfg.voice.gainDb)+'</b><span>Voice bus</span></div><div class="mixMeter"><b>'+dbText(cfg.sfx.gainDb)+'</b><span>SFX bus</span></div><div class="mixMeter"><b>'+dbText(cfg.master.gainDb)+'</b><span>Master</span></div></div><div class="card"><div class="row"><div class="field grow" style="margin:0"><label>Preview start · seconds</label><input id="mixPreviewStart" type="number" min="0" step="1" value="'+cfg.previewStart+'"></div><div style="align-self:end" class="chip">'+enabledCueCount()+' enabled SFX</div></div><div class="toolbar"><button id="previewMix" class="btn primary">Preview 20 sec</button><button id="renderMix" class="btn good">Render Full Manual Mix</button><button id="gotoSfx" class="btn">SFX Library / Cues</button><button id="resetMixer" class="btn bad">Reset Entire Mixer</button></div><div id="mixerStatus" class="mixNote">EQ range ±12 dB. Bus level range -36 to +12 dB. Existing per-cue SFX volume and timing are honored.</div></div><div id="mixerPlayer" class="mixerPlayer"></div></div>';
    document.getElementById('closeMixer').onclick=function(){m.classList.add('hidden')};
    m.querySelectorAll('.mixerTab').forEach(function(t){t.onclick=function(){selectedBus=this.dataset.bus;m.querySelectorAll('.mixerTab').forEach(function(x){x.classList.remove('active')});this.classList.add('active');renderMixerControls()}});
    document.getElementById('mixPreviewStart').onchange=function(){var x=loadMix();x.previewStart=Math.max(0,Number(this.value)||0);saveMix(x)};
    document.getElementById('gotoSfx').onclick=function(){m.classList.add('hidden');scrollToSfx()};
    document.getElementById('resetMixer').onclick=function(){if(!confirm('Reset Voice, SFX, and Master EQ to flat?'))return;saveMix(freshMix());openMixer()};
    document.getElementById('previewMix').onclick=function(){renderManualMix(true)};
    document.getElementById('renderMix').onclick=function(){renderManualMix(false)};
    renderMixerControls();restoreManualMix();
  }

  function enabledCueCount(){try{return (state.v7&&state.v7.sfxCues||[]).filter(function(c){return c.enabled}).length}catch(e){return 0}}
  function buildEqBus(ctx,settings,dest){
    var input=ctx.createGain(),node=input;
    if(!settings.bypass){
      FREQS.forEach(function(freq,i){
        var f=ctx.createBiquadFilter();
        f.type=i===0?'lowshelf':i===FREQS.length-1?'highshelf':'peaking';
        f.frequency.value=Math.min(freq,(ctx.sampleRate/2)-50);
        if(f.type==='peaking')f.Q.value=1.0;
        f.gain.value=settings.eq[i]||0;
        node.connect(f);node=f;
      });
    }
    var g=ctx.createGain();g.gain.value=dbGain(settings.gainDb);node.connect(g);g.connect(dest);return input;
  }

  async function getCueItems(rows,start,end){
    var cues=(state.v7&&state.v7.sfxCues||[]).filter(function(c){return c.enabled});
    var cache={},items=[];
    for(var i=0;i<cues.length;i++){
      var c=cues[i],r=rows.find(function(x){return x.id===c.lineId});if(!r)continue;
      var t=c.anchor==='end'?r.end:c.anchor==='after'?r.end+r.pause:c.anchor==='before'?Math.max(0,r.start-.2):r.start;
      t=Math.max(0,t+(Number(c.offset)||0));
      if(end!=null&&t>end)continue;
      var a=cache[c.effectId];
      if(!a){try{a=await decode(await fxBlob(c.effectId));cache[c.effectId]=a}catch(e){console.warn('Skipping SFX '+c.effectId,e);continue}}
      if(t+a.duration<start)continue;
      items.push({buffer:a,time:t,volume:Math.max(0,Math.min(2,Number(c.volume==null?.5:c.volume)))})
    }
    return items;
  }

  async function renderManualMix(preview){
    if(mixBusy)return;
    var st=document.getElementById('mixerStatus');
    try{
      mixBusy=true;if(st)st.textContent='Preparing clean narration and SFX…';
      var clean=await dbGet(masterKey()).catch(function(){return null});
      if(!clean)throw new Error('Assemble the clean narration WAV first.');
      var voice=await decode(clean),cfg=loadMix(),start=preview?Math.max(0,cfg.previewStart||0):0;
      if(start>=voice.duration)start=Math.max(0,voice.duration-PREVIEW_SECONDS);
      var rows=await timeline();
      var items=await getCueItems(rows,start,preview?start+PREVIEW_SECONDS:null);
      var fullEnd=voice.duration;
      items.forEach(function(x){fullEnd=Math.max(fullEnd,x.time+x.buffer.duration)});
      var lenSec=preview?Math.max(.25,Math.min(PREVIEW_SECONDS,fullEnd-start)):fullEnd+.15;
      var R=voice.sampleRate,O=window.OfflineAudioContext||window.webkitOfflineAudioContext;
      if(!O)throw new Error('Offline audio mixing is not supported in this browser.');
      if(st)st.textContent=preview?'Rendering 20-second EQ preview…':'Rendering full manual mix…';
      var ctx=new O(1,Math.max(1,Math.ceil(lenSec*R)),R);
      var masterIn=buildEqBus(ctx,cfg.master,ctx.destination);
      var voiceIn=buildEqBus(ctx,cfg.voice,masterIn);
      var sfxIn=buildEqBus(ctx,cfg.sfx,masterIn);
      var vs=ctx.createBufferSource();vs.buffer=voice;vs.connect(voiceIn);
      var voiceAvail=Math.max(0,Math.min(lenSec,voice.duration-start));if(voiceAvail>0)vs.start(0,start,voiceAvail);
      for(var i=0;i<items.length;i++){
        var x=items[i],offset=Math.max(0,start-x.time),when=Math.max(0,x.time-start),avail=x.buffer.duration-offset;
        if(avail<=0||when>=lenSec)continue;avail=Math.min(avail,lenSec-when);
        var src=ctx.createBufferSource(),g=ctx.createGain();src.buffer=x.buffer;g.gain.value=x.volume;src.connect(g);g.connect(sfxIn);src.start(when,offset,avail);
      }
      var out=await ctx.startRendering(),pcm=new Float32Array(out.getChannelData(0));
      if(cfg.normalize)pcm=normalizePcm(pcm,.95);
      var blob=encodeWav(pcm,out.sampleRate);
      if(!preview)await dbPut(mixKey(),blob);
      showMixerBlob(blob,preview?'Manual mix preview':'Manual mixer master',!preview);
      if(st)st.textContent=(preview?'Preview ready.':'Full manual mix ready.')+' Voice, SFX, and Master EQ settings were applied.';
    }catch(e){console.error(e);if(st)st.textContent='Mixer error: '+(e&&e.message?e.message:String(e));alert('Mixer: '+(e&&e.message?e.message:String(e)))}finally{mixBusy=false}
  }

  function showMixerBlob(blob,label,persisted){
    var h=document.getElementById('mixerPlayer');if(!h||!blob)return;
    var u=URL.createObjectURL(blob);try{objectUrls.push(u)}catch(e){}
    h.innerHTML='<div class="master"><strong>'+label+'</strong><audio controls preload="metadata" src="'+u+'"></audio><div class="toolbar">'+(persisted?'<button id="shareMixer" class="btn good">Save / Share Manual Mix WAV</button>':'')+'</div></div>';
    var b=document.getElementById('shareMixer');if(b)b.onclick=function(){shareBlob(blob,slug(state.title)+'-'+slug(chapter().title)+'-manual-mix.wav')};
  }
  async function restoreManualMix(){
    var h=document.getElementById('mixerPlayer');if(!h)return;
    var b=await dbGet(mixKey()).catch(function(){return null});if(b)showMixerBlob(b,'Saved manual mixer master',true);
  }

  function install(){
    ensureLaunchButtons();
    var app=document.getElementById('app');
    if(app&&!app.__ashenMixerObserver){
      var queued=false,obs=new MutationObserver(function(){if(queued)return;queued=true;setTimeout(function(){queued=false;ensureLaunchButtons()},0)});obs.observe(app,{childList:true,subtree:true});app.__ashenMixerObserver=obs;
    }
    window.openAshenMixer=openMixer;window.openAshenSfx=scrollToSfx;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(install,120)},{once:true});else setTimeout(install,120);
})();
