// Ashen Voice Studio v0.7.7 — deterministic throat texture processor
// Adds controllable rasp, breath, crackle, and dryness after single-waveform synthesis.
(function(){
  const n01=v=>Math.max(0,Math.min(1,Number(v)||0));

  // Preserve throat controls through project migration / repo reloads.
  const baseMakeChar=makeChar;
  makeChar=function(c={}){
    const out=baseMakeChar(c);
    out.rasp=n01(c.rasp);
    out.breath=n01(c.breath);
    out.crackle=n01(c.crackle);
    out.dryness=n01(c.dryness);
    return out;
  };

  // Preserve throat controls in character overrides as well as normal local state.
  if(typeof rememberChar==='function'){
    const baseRememberChar=rememberChar;
    rememberChar=function(c){
      baseRememberChar(c);
      try{
        const o=ov();
        o.characters[c.name]={...(o.characters[c.name]||{}),rasp:n01(c.rasp),breath:n01(c.breath),crackle:n01(c.crackle),dryness:n01(c.dryness)};
        putOv(o);
      }catch{}
    };
  }

  // Seeded PRNG keeps a character's throat texture repeatable instead of random on every preview.
  function rng32(seed){
    let x=(seed>>>0)||0x6d2b79f5;
    return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return((x>>>0)/4294967296)};
  }

  async function throatProcess(blob,{rasp=0,breath=0,crackle=0,dryness=0}={}){
    rasp=n01(rasp);breath=n01(breath);crackle=n01(crackle);dryness=n01(dryness);
    if(Math.max(rasp,breath,crackle,dryness)<.005)return blob;

    const AC=window.AudioContext||window.webkitAudioContext;
    const ac=new AC();let buf;
    try{buf=await ac.decodeAudioData((await blob.arrayBuffer()).slice(0))}
    finally{try{await ac.close()}catch{}}

    const src=buf.getChannelData(0),rate=buf.sampleRate,N=src.length,out=new Float32Array(N);
    let seed=(N^(rate<<7)^0x41a57e7)>>>0;
    for(let i=0;i<Math.min(N,128);i+=11)seed=(seed^((Math.abs(src[i])*2147483647)|0))>>>0;
    const rand=rng32(seed);

    let env=0,prevX=0,low=0,prevNoise=0;
    let crackLeft=0,crackLen=1,crackShape=0,nextCrack=Math.floor(rate*(.08+rand()*.16));
    let fryPhase=rand()*Math.PI*2;
    const fryHz=34+rand()*28;
    const drive=1+rasp*6.5;
    const driveNorm=Math.tanh(drive)||1;

    for(let i=0;i<N;i++){
      const x=src[i];
      const a=Math.abs(x);
      env += (a>env?.16:.0025)*(a-env);

      // Dry throat: reduce some low body and emphasize the leading edge of consonants.
      low += .018*(x-low);
      const edge=x-prevX;prevX=x;
      let y=x + dryness*(edge*.11-low*.045);

      // Rasp: gentle nonlinear fry plus tiny low-frequency irregularity. It roughens
      // the existing speaker rather than adding a second voice.
      const saturated=Math.tanh(y*drive)/driveNorm;
      const raspMix=rasp*.24;
      y=y*(1-raspMix)+saturated*raspMix;
      fryPhase+=Math.PI*2*fryHz/rate;
      if(fryPhase>Math.PI*2)fryPhase-=Math.PI*2;
      y*=1-rasp*.055*(.5+.5*Math.sin(fryPhase))*Math.min(1,env*5);

      // Breath: high-passed deterministic noise, active mostly while speech is present.
      const white=rand()*2-1;
      const hp=white-prevNoise*.94;prevNoise=white;
      const breathGain=breath*(.0025+.012*Math.sqrt(Math.min(1,env*4)));
      y+=hp*breathGain;

      // Crackle: sparse 2–7 ms throat catches/noise bursts, only while there is voice.
      if(i>=nextCrack&&env>.018&&crackle>.01){
        crackLen=Math.max(2,Math.floor(rate*(.002+rand()*.005)));
        crackLeft=crackLen;crackShape=.7+rand()*.3;
        const gap=.07+rand()*(.24-.14*crackle);
        nextCrack=i+Math.floor(rate*Math.max(.025,gap));
      }
      if(crackLeft>0){
        const p=1-crackLeft/crackLen;
        const win=Math.sin(Math.PI*Math.min(1,Math.max(0,p)));
        const grit=(rand()*2-1)*crackle*(.007+.026*env)*win*crackShape;
        y+=grit;
        y*=1-crackle*.10*win;
        crackLeft--;
      }

      out[i]=Math.max(-.985,Math.min(.985,y));
    }
    return encodeWav(avLimitPcm(out,.965),rate);
  }

  // Apply throat texture after the v0.7.6 true blend / pitch / tone path.
  const baseSynthesize=synthesizeProfile;
  synthesizeProfile=async function(text,c){
    const clean=await baseSynthesize(text,c);
    return throatProcess(clean,{rasp:c.rasp,breath:c.breath,crackle:c.crackle,dryness:c.dryness});
  };

  // Add the four throat controls to Voice Lab without duplicating the core dialog code.
  const baseOpenVoiceLab=openVoiceLab;
  openVoiceLab=function(id){
    baseOpenVoiceLab(id);
    const c=state.characters.find(x=>x.id===id)||state.characters[0];
    const preview=byId('previewText');
    if(!preview||byId('throatFxBox'))return;
    const box=document.createElement('div');
    box.id='throatFxBox';box.className='card';
    box.style.margin='12px 0';
    box.innerHTML=`<div class="sectionHead"><div><strong>Throat Texture</strong><div class="mini">Adds damaged-throat texture after synthesis without layering another speaker.</div></div><span class="chip">vocal FX</span></div>
      <div class="voiceGrid">
        ${fxSlider('Rasp','vRasp',c.rasp,'harmonic fry / rough vocal cords')}
        ${fxSlider('Breath','vBreath',c.breath,'airy leak through the throat')}
        ${fxSlider('Crackle','vCrackle',c.crackle,'intermittent dry throat catches')}
        ${fxSlider('Dryness','vDryness',c.dryness,'thinner body / scratchier articulation')}
      </div>
      <div class="toolbar"><button id="deadThroatPreset" class="btn warn">Dead Throat Preset</button><button id="clearThroatFx" class="btn">Clear Throat FX</button></div>
      <div class="mini">For subtle voices stay below .25. For the Dead King, rasp and dryness can go much higher while crackle stays moderate.</div>`;
    preview.closest('.field')?.before(box);
    box.querySelectorAll('input[type=range]').forEach(r=>r.oninput=()=>{const o=byId(r.id+'Out');if(o)o.textContent=Number(r.value).toFixed(2)});
    byId('deadThroatPreset').onclick=()=>setFxInputs({rasp:.62,breath:.28,crackle:.30,dryness:.58});
    byId('clearThroatFx').onclick=()=>setFxInputs({rasp:0,breath:0,crackle:0,dryness:0});
  };

  function fxSlider(label,id,value,note){
    const v=n01(value);
    return `<div class="field"><label>${label} · <span id="${id}Out">${v.toFixed(2)}</span></label><input id="${id}" type="range" min="0" max="1" step=".01" value="${v}"><div class="mini">${note}</div></div>`;
  }
  function setFxInputs(v){
    for(const[k,val]of Object.entries({vRasp:v.rasp,vBreath:v.breath,vCrackle:v.crackle,vDryness:v.dryness})){
      const e=byId(k);if(e){e.value=val;const o=byId(k+'Out');if(o)o.textContent=Number(val).toFixed(2)}
    }
  }

  const baseSaveVoiceBase=saveVoiceBase;
  saveVoiceBase=function(c,rerender=false){
    c.rasp=n01(byId('vRasp')?.value??c.rasp);
    c.breath=n01(byId('vBreath')?.value??c.breath);
    c.crackle=n01(byId('vCrackle')?.value??c.crackle);
    c.dryness=n01(byId('vDryness')?.value??c.dryness);
    return baseSaveVoiceBase(c,rerender);
  };

  const baseProfileSummary=profileSummary;
  profileSummary=function(c){
    const s=baseProfileSummary(c),m=Math.max(n01(c.rasp),n01(c.breath),n01(c.crackle),n01(c.dryness));
    return m>.02?`${s} · throat FX ${Math.round(m*100)}%`:s;
  };

  const baseDesign=designFromDescription;
  designFromDescription=function(c,desc){
    baseDesign(c,desc);
    const low=String(desc||'').toLowerCase();
    if(/gravel|rasp|scratch|damaged throat|dry throat|crackl/.test(low)){
      c.rasp=Math.max(n01(c.rasp),.48);c.dryness=Math.max(n01(c.dryness),.42);c.crackle=Math.max(n01(c.crackle),.18);
    }
    if(/whisper|breathy|air/.test(low))c.breath=Math.max(n01(c.breath),.22);
  };
})();
