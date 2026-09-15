// Ashen Voice Studio v0.9.5 — UI truthfulness patch
(function(){
  const baseRenderMode=renderMode;
  renderMode=function(c){
    baseRenderMode(c);
    if(c.mode==='blend'){
      const info=byId('modeBody')?.querySelector('.infoBox');
      if(info)info.innerHTML='<b>True Kokoro embedding blend.</b> Voice A and Voice B are blended in style-vector space before synthesis, then Kokoro generates one waveform. The weight is Voice A\'s share; Voice B receives the remainder.';
    }
  };
  let queued=false;
  function syncLabels(){
    queued=false;
    const v=document.querySelector('.version');if(v&&v.textContent!=='v0.9.5')v.textContent='v0.9.5';
    const dt=byId('dtype');if(dt){
      const q4=[...dt.options].find(o=>o.value==='q4');if(q4&&q4.textContent!=='q4 · experimental')q4.textContent='q4 · experimental';
      const q8=[...dt.options].find(o=>o.value==='q8');if(q8&&q8.textContent!=='q8 · recommended / mobile')q8.textContent='q8 · recommended / mobile';
      const fp=[...dt.options].find(o=>o.value==='fp32');if(fp&&fp.textContent!=='fp32 · highest precision / huge')fp.textContent='fp32 · highest precision / huge';
    }
    const castHead=[...document.querySelectorAll('.sectionHead .mini')].find(x=>/Preset, designed, layered blend/i.test(x.textContent||''));
    if(castHead)castHead.textContent='Preset, designed, true embedding blend, recorded performance, or recorded clone reference per character.';
    const mem=byId('memoryBanner');if(mem&&/compact model precision/i.test(mem.textContent||''))mem.textContent='Memory Saver is ON: mobile-safe q8, short previews, one render at a time.';
  }
  const app=byId('app');
  if(app){new MutationObserver(()=>{if(queued)return;queued=true;setTimeout(syncLabels,0)}).observe(app,{childList:true,subtree:true})}
  setTimeout(syncLabels,0);
})();
