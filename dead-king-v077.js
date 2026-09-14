// Ashen Voice Studio v0.7.7 — Dead King complete performance preset
(function(){
  function applyDeadKingPreset(c){
    Object.assign(c,{
      mode:'blend',
      voice:'am_onyx',
      blendA:'am_onyx',
      blendB:'bm_george',
      blendWeight:.65,
      speed:.76,
      pitch:-1.4,
      tone:'dark',
      emotion:'whispered',
      intensity:.90,
      pause:.90,
      rasp:.62,
      breath:.28,
      crackle:.30,
      dryness:.58
    });
    try{rememberChar(c)}catch{}
    try{invalidateSpeaker(c.name)}catch{try{save()}catch{}}
  }

  // Make the Voice Lab preset button configure the entire voice recipe.
  const priorOpenVoiceLab=openVoiceLab;
  openVoiceLab=function(id){
    priorOpenVoiceLab(id);
    const c=state.characters.find(x=>x.id===id)||state.characters[0];
    const b=byId('deadThroatPreset');
    if(b)b.onclick=()=>{applyDeadKingPreset(c);openVoiceLab(c.id)};
  };

  // The chapter Auto Director must preserve the whisper rather than replacing it
  // with the older ominous preset during line rendering.
  if(typeof direct==='function'){
    const baseDirect=direct;
    direct=function(l,i,ls){
      const d=baseDirect(l,i,ls);
      if((l.speaker||'').toLowerCase()==='dead king'){
        Object.assign(d,{
          label:'ancient / cracked whisper / threatening',
          emotionPreset:'whispered',
          speedFactor:.94,
          pitchDelta:-.20,
          tone:'dark',
          intensity:1.0,
          postPause:Math.max(d.postPause||0,.9),
          confidence:.99
        });
      }
      return d;
    };
  }
})();
