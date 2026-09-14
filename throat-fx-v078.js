// Ashen Voice Studio v0.7.8 — strong deterministic throat texture processor
// 0 = clean, .25 subtle, .5 obvious, .75 damaged, 1 = extreme.
(function(){
  const n01=v=>Math.max(0,Math.min(1,Number(v)||0));
  const shape=v=>v*v*(3-2*v);

  const baseMakeChar=makeChar;
  makeChar=function(c={}){
    const out=baseMakeChar(c);
    out.rasp=n01(c.rasp);out.breath=n01(c.breath);out.crackle=n01(c.crackle);out.dryness=n01(c.dryness);
    return out;
  };

  if(typeof rememberChar==='function'){
    const baseRememberChar=rememberChar;
    rememberChar=function(c){
      baseRememberChar(c);
      try{const o=ov();o.characters[c.name]={...(o.characters[c.name]||{}),rasp:n01(c.rasp),breath:n01(c.breath),crackle:n01(c.crackle),dryness:n01(c.dryness)};putOv(o)}catch{}
    };
  }

  function rng32(seed){let x=(seed>>>0)||0x6d2b79f5;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return((x>>>0)/4294967296)}}

  async function throatProcess(blob,{rasp=0,breath=0,crackle=0,dryness=0}={}){
    rasp=n01(rasp);breath=n01(breath);crackle=n01(crackle);dryness=n01(dryness);
    const R=shape(rasp),B=shape(breath),C=shape(crackle),D=shape(dryness);
    window.__lastThroatFx={rasp,breath,crackle,dryness};
    const readout=byId('throatFxApplied');
    if(readout)readout.textContent=`Last render applied: R ${rasp.toFixed(2)} · B ${breath.toFixed(2)} · C ${crackle.toFixed(2)} · D ${dryness.toFixed(2)}`;
    if(Math.max(R,B,C,D)<.0005)return blob;

    const AC=window.AudioContext||window.webkitAudioContext;
    const ac=new AC();let buf;
    try{buf=await ac.decodeAudioData((await blob.arrayBuffer()).slice(0))}finally{try{await ac.close()}catch{}}
    const src=buf.getChannelData(0),rate=buf.sampleRate,N=src.length,out=new Float32Array(N);

    let seed=(N^(rate<<7)^0x41a57e7)>>>0;
    for(let i=0;i<Math.min(N,256);i+=13)seed=(seed^((Math.abs(src[i])*2147483647)|0))>>>0;
    const rand=rng32(seed);

    let env=0,slow=0,prev=0,noiseLP=0,crackLeft=0,crackLen=1;
    let nextCrack=Math.floor(rate*(.045+rand()*.10));
    let fryPhase=rand()*Math.PI*2;
    const fryHz=28+rand()*24;
    const drive=1+R*22;
    const norm=Math.tanh(drive)||1;

    for(let i=0;i<N;i++){
      const x=src[i],a=Math.abs(x);
      env+=(a>env ? .22 : .004)*(a-env);
      slow+=.012*(x-slow);
      const edge=x-prev;prev=x;

      let y=x - slow*(D*.30) + edge*(D*.34);

      const distorted=Math.tanh(y*drive)/norm;
      const wet=.08+R*.58;
      y=y*(1-wet)+distorted*wet;
      fryPhase+=Math.PI*2*fryHz/rate;
      if(fryPhase>Math.PI*2)fryPhase-=Math.PI*2;
      const fry=(.5+.5*Math.sin(fryPhase));
      const jitter=.72+.28*rand();
      y*=1-R*(.06+.24*fry*jitter)*Math.min(1,env*7);

      const white=rand()*2-1;
      noiseLP+=.08*(white-noiseLP);
      const hp=white-noiseLP;
      const breathGain=B*(.010+.075*Math.sqrt(Math.min(1,env*6)));
      y+=hp*breathGain;

      if(i>=nextCrack&&env>.010&&C>.005){
        crackLen=Math.max(3,Math.floor(rate*(.002+rand()*(.006+.006*C))));
        crackLeft=crackLen;
        const minGap=.020,maxGap=.20-.13*C;
        nextCrack=i+Math.floor(rate*(minGap+rand()*Math.max(.015,maxGap-minGap)));
      }
      if(crackLeft>0){
        const pos=1-crackLeft/crackLen;
        const win=Math.sin(Math.PI*Math.max(0,Math.min(1,pos)));
        const grit=(rand()*2-1)*C*(.025+.18*Math.min(1,env*5))*win;
        y+=grit;
        y*=1-C*.38*win;
        crackLeft--;
      }

      y+=edge*R*D*.20;
      out[i]=Math.max(-.985,Math.min(.985,y));
    }

    const result=encodeWav(avLimitPcm(out,.955),rate);
    if(readout)readout.textContent=`Last render applied: R ${rasp.toFixed(2)} · B ${breath.toFixed(2)} · C ${crackle.toFixed(2)} · D ${dryness.toFixed(2)} ✓`;
    return result;
  }

  const baseSynthesize=synthesizeProfile;
  synthesizeProfile=async function(text,c){
    const clean=await baseSynthesize(text,c);
    return throatProcess(clean,{rasp:c.rasp,breath:c.breath,crackle:c.crackle,dryness:c.dryness});
  };

  const baseOpenVoiceLab=openVoiceLab;
  openVoiceLab=function(id){
    baseOpenVoiceLab(id);
    const c=state.characters.find(x=>x.id===id)||state.characters[0];
    const preview=byId('previewText');
    if(!preview||byId('throatFxBox'))return;
    const box=document.createElement('div');box.id='throatFxBox';box.className='card';box.style.margin='12px 0';
    box.innerHTML=`<div class="sectionHead"><div><strong>Throat Texture</strong><div class="mini">Strong damaged-throat processing. 0 = clean · .5 = obvious · 1 = extreme.</div></div><span class="chip">vocal FX</span></div>
      <div class="voiceGrid">
        ${fxSlider('Rasp','vRasp',c.rasp,'vocal fry + nonlinear cord damage')}
        ${fxSlider('Breath','vBreath',c.breath,'audible breath leak / whisper air')}
        ${fxSlider('Crackle','vCrackle',c.crackle,'dry throat catches and micro-breaks')}
        ${fxSlider('Dryness','vDryness',c.dryness,'less body, sharper scratchy consonants')}
      </div>
      <div class="toolbar"><button id="deadThroatPreset" class="btn warn">Dead Throat Preset</button><button id="extremeThroatPreset" class="btn bad">Extreme Test</button><button id="clearThroatFx" class="btn">Clear Throat FX</button></div>
      <div id="throatFxApplied" class="mini">Last render applied: none yet</div>`;
    preview.closest('.field')?.before(box);
    box.querySelectorAll('input[type=range]').forEach(r=>r.oninput=()=>{const o=byId(r.id+'Out');if(o)o.textContent=Number(r.value).toFixed(2)});
    byId('deadThroatPreset').onclick=()=>setFxInputs({rasp:.72,breath:.34,crackle:.38,dryness:.68});
    byId('extremeThroatPreset').onclick=()=>setFxInputs({rasp:1,breath:.65,crackle:1,dryness:1});
    byId('clearThroatFx').onclick=()=>setFxInputs({rasp:0,breath:0,crackle:0,dryness:0});
  };

  function fxSlider(label,id,value,note){const v=n01(value);return `<div class="field"><label>${label} · <span id="${id}Out">${v.toFixed(2)}</span></label><input id="${id}" type="range" min="0" max="1" step=".01" value="${v}"><div class="mini">${note}</div></div>`}
  function setFxInputs(v){for(const[k,val]of Object.entries({vRasp:v.rasp,vBreath:v.breath,vCrackle:v.crackle,vDryness:v.dryness})){const e=byId(k);if(e){e.value=val;const o=byId(k+'Out');if(o)o.textContent=Number(val).toFixed(2)}}}

  const baseSaveVoiceBase=saveVoiceBase;
  saveVoiceBase=function(c,rerender=false){
    c.rasp=n01(byId('vRasp')?.value??c.rasp);c.breath=n01(byId('vBreath')?.value??c.breath);c.crackle=n01(byId('vCrackle')?.value??c.crackle);c.dryness=n01(byId('vDryness')?.value??c.dryness);
    return baseSaveVoiceBase(c,rerender);
  };

  const baseProfileSummary=profileSummary;
  profileSummary=function(c){const s=baseProfileSummary(c),m=Math.max(n01(c.rasp),n01(c.breath),n01(c.crackle),n01(c.dryness));return m>.02?`${s} · throat FX ${Math.round(m*100)}%`:s};

  const baseDesign=designFromDescription;
  designFromDescription=function(c,desc){baseDesign(c,desc);const low=String(desc||'').toLowerCase();if(/gravel|rasp|scratch|damaged throat|dry throat|crackl/.test(low)){c.rasp=Math.max(n01(c.rasp),.58);c.dryness=Math.max(n01(c.dryness),.52);c.crackle=Math.max(n01(c.crackle),.28)}if(/whisper|breathy|air/.test(low))c.breath=Math.max(n01(c.breath),.30)};
})();
