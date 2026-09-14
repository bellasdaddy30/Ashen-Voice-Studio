// Ashen Voice Studio v0.7.9 — source-derived throat texture
// No generated noise. Rasp, air, crackle, and dryness are derived from the voice waveform itself.
(function(){
  const n01=v=>Math.max(0,Math.min(1,Number(v)||0));
  const shape=v=>v*v*(3-2*v);
  const TAU=Math.PI*2;

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

  const lpAlpha=(hz,rate)=>1-Math.exp(-TAU*hz/rate);

  async function throatProcess(blob,{rasp=0,breath=0,crackle=0,dryness=0}={}){
    rasp=n01(rasp);breath=n01(breath);crackle=n01(crackle);dryness=n01(dryness);
    const R=shape(rasp),B=shape(breath),C=shape(crackle),D=shape(dryness);
    window.__lastThroatFx={rasp,breath,crackle,dryness,processor:'source-derived-v079'};
    const readout=byId('throatFxApplied');
    if(readout)readout.textContent=`Last render applied: R ${rasp.toFixed(2)} · Air ${breath.toFixed(2)} · C ${crackle.toFixed(2)} · D ${dryness.toFixed(2)}`;
    if(Math.max(R,B,C,D)<.0005)return blob;

    const AC=window.AudioContext||window.webkitAudioContext;
    const ac=new AC();let buf;
    try{buf=await ac.decodeAudioData((await blob.arrayBuffer()).slice(0))}finally{try{await ac.close()}catch{}}
    const src=buf.getChannelData(0),rate=buf.sampleRate,N=src.length,out=new Float32Array(N);

    const a90=lpAlpha(90,rate),a430=lpAlpha(430,rate),a2800=lpAlpha(2800,rate),a6500=lpAlpha(6500,rate);
    let lp90=0,lp430=0,lp2800=0,lp6500=0,env=0,prev=0;
    let fryPhase=.31,jitterPhase=1.17,catchPhase=.41,catchVarPhase=2.03;
    let catchLeft=0,catchLen=1;

    // Power-wave shaping keeps the grit tied to the speech instead of adding hiss.
    const power=.90-.26*R;
    const ref=.18;
    const powerGain=Math.pow(ref,1-power);
    const raspWet=.08+.62*R;

    for(let i=0;i<N;i++){
      const x=src[i],a=Math.abs(x);
      env+=(a>env ? .18 : .0035)*(a-env);
      const voiced=Math.min(1,env*7);

      lp90+=a90*(x-lp90);
      lp430+=a430*(x-lp430);
      lp2800+=a2800*(x-lp2800);
      lp6500+=a6500*(x-lp6500);
      const body=lp430;
      const mid=lp2800-lp90;
      const air=x-lp2800;
      const sparkle=x-lp6500;
      const edge=x-prev;prev=x;

      // Dryness removes some chest/body energy and makes the existing consonant texture more prominent.
      let y=x-body*(.08+.24*D)+air*(.12+.38*D);

      // Rasp is a nonlinear reshaping of the vocal mid-band itself. No random signal is introduced.
      const rough=Math.sign(mid)*Math.pow(Math.abs(mid)+1e-9,power)*powerGain;
      y+= (rough-mid)*raspWet;

      // Vocal fry: irregular low-rate cord breakup, amplitude-modulating only while speech is voiced.
      jitterPhase+=TAU*1.21/rate;if(jitterPhase>TAU)jitterPhase-=TAU;
      const fryHz=34+10*Math.sin(jitterPhase)+5*Math.sin(jitterPhase*.47+1.3);
      fryPhase+=TAU*Math.max(20,fryHz)/rate;if(fryPhase>TAU)fryPhase-=TAU;
      const fry=.5+.5*Math.sin(fryPhase);
      y*=1-R*(.035+.28*fry)*voiced;

      // "Breath" is now source-derived air/sibilance, not generated white noise.
      // It can make a whisper airier but cannot create radio static on its own.
      y+=B*(air*1.18+sparkle*.55+edge*.10)*(1.05-.35*voiced);

      // Crackle becomes short deterministic throat catches made from the source waveform:
      // a micro-drop in level plus a tiny edge emphasis, never an added noise burst.
      catchVarPhase+=TAU*.73/rate;if(catchVarPhase>TAU)catchVarPhase-=TAU;
      const catchesPerSec=1.0+C*6.2+.7*Math.sin(catchVarPhase);
      const oldCatch=catchPhase;
      catchPhase+=TAU*Math.max(.4,catchesPerSec)/rate;
      if(catchPhase>=TAU)catchPhase-=TAU;
      if(catchPhase<oldCatch&&voiced>.12&&C>.01){
        catchLen=Math.max(3,Math.floor(rate*(.003+.007*C)));
        catchLeft=catchLen;
      }
      if(catchLeft>0){
        const p=1-catchLeft/catchLen;
        const win=Math.sin(Math.PI*Math.max(0,Math.min(1,p)));
        y*=1-C*.62*win;
        y+=edge*C*.16*win;
        catchLeft--;
      }

      // Final source-derived scratch, strongest only when rasp + dryness are both high.
      y+=edge*R*D*.14;
      out[i]=Math.max(-.985,Math.min(.985,y));
    }

    const result=encodeWav(avLimitPcm(out,.955),rate);
    if(readout)readout.textContent=`Last render applied: R ${rasp.toFixed(2)} · Air ${breath.toFixed(2)} · C ${crackle.toFixed(2)} · D ${dryness.toFixed(2)} ✓ no added noise`;
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
    box.innerHTML=`<div class="sectionHead"><div><strong>Throat Texture</strong><div class="mini">v0.7.9 source-derived rasp. No generated noise or static layer.</div></div><span class="chip">vocal FX</span></div>
      <div class="voiceGrid">
        ${fxSlider('Rasp','vRasp',c.rasp,'rough vocal-cord reshaping + fry')}
        ${fxSlider('Air','vBreath',c.breath,'uses the voice\'s own breath/sibilance, no white noise')}
        ${fxSlider('Crackle','vCrackle',c.crackle,'source-derived throat catches / micro-breaks')}
        ${fxSlider('Dryness','vDryness',c.dryness,'less chest body, scratchier articulation')}
      </div>
      <div class="toolbar"><button id="deadThroatPreset" class="btn warn">Dead Throat Preset</button><button id="raspOnlyPreset" class="btn bad">Rasp-Only Test</button><button id="clearThroatFx" class="btn">Clear Throat FX</button></div>
      <div id="throatFxApplied" class="mini">Last render applied: none yet</div>`;
    preview.closest('.field')?.before(box);
    box.querySelectorAll('input[type=range]').forEach(r=>r.oninput=()=>{const o=byId(r.id+'Out');if(o)o.textContent=Number(r.value).toFixed(2)});
    byId('deadThroatPreset').onclick=()=>setFxInputs({rasp:.82,breath:.16,crackle:.48,dryness:.72});
    byId('raspOnlyPreset').onclick=()=>setFxInputs({rasp:1,breath:0,crackle:.55,dryness:.85});
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
  designFromDescription=function(c,desc){
    baseDesign(c,desc);const low=String(desc||'').toLowerCase();
    if(/gravel|rasp|scratch|damaged throat|dry throat|crackl/.test(low)){c.rasp=Math.max(n01(c.rasp),.68);c.dryness=Math.max(n01(c.dryness),.58);c.crackle=Math.max(n01(c.crackle),.32)}
    if(/whisper|breathy|air/.test(low))c.breath=Math.max(n01(c.breath),.12);
  };
})();