// Ashen Voice Studio v0.8.0 — pulse-derived creaky throat processor
// No generated noise, no waveshaping distortion. Roughness comes from irregular voiced pulses.
(function(){
  const n01=v=>Math.max(0,Math.min(1,Number(v)||0));
  const smooth=v=>v*v*(3-2*v);
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

  async function creakyProcess(blob,{rasp=0,breath=0,crackle=0,dryness=0}={}){
    rasp=n01(rasp);breath=n01(breath);crackle=n01(crackle);dryness=n01(dryness);
    const R=smooth(rasp),B=smooth(breath),C=smooth(crackle),D=smooth(dryness);
    window.__lastThroatFx={rasp,breath,crackle,dryness,processor:'pulse-creak-v080'};
    const readout=byId('throatFxApplied');
    if(readout)readout.textContent=`Last render applied: Creak ${rasp.toFixed(2)} · Air ${breath.toFixed(2)} · Catch ${crackle.toFixed(2)} · Dry ${dryness.toFixed(2)}`;
    if(Math.max(R,B,C,D)<.0005)return blob;

    const AC=window.AudioContext||window.webkitAudioContext;
    const ac=new AC();let buf;
    try{buf=await ac.decodeAudioData((await blob.arrayBuffer()).slice(0))}finally{try{await ac.close()}catch{}}
    const src=buf.getChannelData(0),rate=buf.sampleRate,N=src.length;
    const low=new Float32Array(N),env=new Float32Array(N),out=new Float32Array(N);

    const aLow=lpAlpha(320,rate),aEnv=lpAlpha(18,rate);
    let l=0,e=0,peak=0;
    for(let i=0;i<N;i++){
      l+=aLow*(src[i]-l); low[i]=l;
      e+=aEnv*(Math.abs(src[i])-e); env[i]=e;
      if(e>peak)peak=e;
    }
    const voicedThreshold=Math.max(.004,peak*.055);

    const minPeriod=Math.max(40,Math.floor(rate/260));
    const maxPeriod=Math.floor(rate/55);
    const pulses=[];
    let last=-maxPeriod;
    for(let i=1;i<N-1;i++){
      if(env[i]<voicedThreshold)continue;
      if(low[i-1]<=0&&low[i]>0){
        const d=i-last;
        if(d>=minPeriod&&d<=maxPeriod){pulses.push(i);last=i}
        else if(d>maxPeriod){pulses.push(i);last=i}
      }
    }

    const aBody=lpAlpha(500,rate),aAir=lpAlpha(3200,rate);
    let body=0,airLp=0,prev=0;
    for(let i=0;i<N;i++){
      const x=src[i];
      body+=aBody*(x-body);
      airLp+=aAir*(x-airLp);
      const air=x-airLp;
      const edge=x-prev;prev=x;
      let y=x-body*(D*.16)+edge*(D*.09);
      y+=air*(B*.22);
      out[i]=y;
    }

    for(let p=0;p<pulses.length-1;p++){
      const start=pulses[p],end=pulses[p+1];
      const period=end-start;
      if(period<minPeriod||period>maxPeriod)continue;
      const mid=(start+end)>>1;
      const voiced=Math.min(1,env[mid]/Math.max(voicedThreshold,1e-6));
      const pattern=(p%5===1||p%7===3)?1:(p%3===2?.65:.25);
      const dip=R*voiced*(.10+.38*pattern);
      const catchDip=C*voiced*((p%11===5||p%13===7)?.46:0);
      const g=Math.max(.35,1-dip-catchDip);
      const edgeLen=Math.max(2,Math.min(24,Math.floor(period*.12)));
      for(let i=start;i<end&&i<N;i++){
        let w=1;
        if(i-start<edgeLen)w=(i-start)/edgeLen;
        else if(end-i<edgeLen)w=(end-i)/edgeLen;
        const localGain=1-(1-g)*Math.max(0,Math.min(1,w));
        out[i]*=localGain;
      }

      if(C>.05&&(p%9===4||p%17===8)){
        const snag=Math.min(Math.floor(period*(.08+.10*C)),Math.floor(rate*.0045));
        for(let k=0;k<snag&&start+k<N;k++){
          const from=Math.max(0,start-Math.min(period>>2,Math.floor(rate*.0025))+k);
          const mix=.10+.28*C;
          out[start+k]=out[start+k]*(1-mix)+out[from]*mix;
        }
      }
    }

    let max=0;for(let i=0;i<N;i++){const a=Math.abs(out[i]);if(a>max)max=a}
    const gain=max>.94?.94/max:1;
    for(let i=0;i<N;i++)out[i]=Math.max(-.98,Math.min(.98,out[i]*gain));

    const result=encodeWav(out,rate);
    if(readout)readout.textContent=`Last render applied: Creak ${rasp.toFixed(2)} · Air ${breath.toFixed(2)} · Catch ${crackle.toFixed(2)} · Dry ${dryness.toFixed(2)} ✓ pulse-derived`;
    return result;
  }

  const baseSynthesize=synthesizeProfile;
  synthesizeProfile=async function(text,c){
    const clean=await baseSynthesize(text,c);
    return creakyProcess(clean,{rasp:c.rasp,breath:c.breath,crackle:c.crackle,dryness:c.dryness});
  };

  const baseOpenVoiceLab=openVoiceLab;
  openVoiceLab=function(id){
    baseOpenVoiceLab(id);
    const c=state.characters.find(x=>x.id===id)||state.characters[0];
    const preview=byId('previewText');
    if(!preview||byId('throatFxBox'))return;
    const box=document.createElement('div');box.id='throatFxBox';box.className='card';box.style.margin='12px 0';
    box.innerHTML=`<div class="sectionHead"><div><strong>Creaky Throat</strong><div class="mini">v0.8.0 pulse-derived vocal fry. No generated noise, no distortion layer.</div></div><span class="chip">voice source FX</span></div>
      <div class="voiceGrid">
        ${fxSlider('Creak / Fry','vRasp',c.rasp,'irregular vocal-pulse strength')}
        ${fxSlider('Air','vBreath',c.breath,'small amount of the voice\'s own high-frequency breath')}
        ${fxSlider('Throat Catch','vCrackle',c.crackle,'short source-derived pulse catches / breaks')}
        ${fxSlider('Dryness','vDryness',c.dryness,'less chest body, slightly sharper articulation')}
      </div>
      <div class="toolbar"><button id="deadThroatPreset" class="btn warn">Dead King Creak</button><button id="raspOnlyPreset" class="btn bad">Creak-Only Test</button><button id="clearThroatFx" class="btn">Clean Voice</button></div>
      <div id="throatFxApplied" class="mini">Last render applied: none yet</div>`;
    preview.closest('.field')?.before(box);
    box.querySelectorAll('input[type=range]').forEach(r=>r.oninput=()=>{const o=byId(r.id+'Out');if(o)o.textContent=Number(r.value).toFixed(2)});
    byId('deadThroatPreset').onclick=()=>setFxInputs({rasp:.88,breath:.04,crackle:.62,dryness:.36});
    byId('raspOnlyPreset').onclick=()=>setFxInputs({rasp:1,breath:0,crackle:.72,dryness:.20});
    byId('clearThroatFx').onclick=()=>setFxInputs({rasp:0,breath:0,crackle:0,dryness:0});
  };

  function fxSlider(label,id,value,note){const v=n01(value);return `<div class="field"><label>${label} · <span id="${id}Out">${v.toFixed(2)}</span></label><input id="${id}" type="range" min="0" max="1" step=".01" value="${v}"><div class="mini">${note}</div></div>`}
  function setFxInputs(v){for(const[k,val]of Object.entries({vRasp:v.rasp,vBreath:v.breath,vCrackle:v.crackle,vDryness:v.dryness})){const el=byId(k);if(el){el.value=val;const o=byId(k+'Out');if(o)o.textContent=Number(val).toFixed(2)}}}

  const baseSaveVoiceBase=saveVoiceBase;
  saveVoiceBase=function(c,rerender=false){
    c.rasp=n01(byId('vRasp')?.value??c.rasp);c.breath=n01(byId('vBreath')?.value??c.breath);c.crackle=n01(byId('vCrackle')?.value??c.crackle);c.dryness=n01(byId('vDryness')?.value??c.dryness);
    return baseSaveVoiceBase(c,rerender);
  };

  const baseProfileSummary=profileSummary;
  profileSummary=function(c){const s=baseProfileSummary(c),m=Math.max(n01(c.rasp),n01(c.breath),n01(c.crackle),n01(c.dryness));return m>.02?`${s} · creaky throat ${Math.round(m*100)}%`:s};
})();
