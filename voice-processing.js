// Ashen Voice Studio v0.7.6 — true blend + audible voice controls
// Loaded after app-2b1.js so it replaces the old phone DSP bypass.

function avToneSpec(tone){
  switch(tone){
    case'warm':return{type:'lowshelf',frequency:240,gain:1.6,Q:.7};
    case'dark':return{type:'highshelf',frequency:3400,gain:-2.1,Q:.7};
    case'bright':return{type:'highshelf',frequency:3600,gain:1.8,Q:.7};
    case'crisp':return{type:'peaking',frequency:2850,gain:1.6,Q:.85};
    case'soft':return{type:'lowpass',frequency:7800,gain:0,Q:.45};
    case'hollow':return{type:'peaking',frequency:950,gain:-2.0,Q:1.0};
    case'radio':return{type:'bandpass',frequency:1750,gain:0,Q:.7};
    default:return null;
  }
}
function avLimitPcm(pcm,target=.985){
  let peak=0;for(let i=0;i<pcm.length;i++){const a=Math.abs(pcm[i]);if(a>peak)peak=a}
  if(!peak||peak<=target)return pcm;
  const g=target/peak,out=new Float32Array(pcm.length);for(let i=0;i<pcm.length;i++)out[i]=pcm[i]*g;return out;
}
async function avProcessVoice(blob,{pitch=0,tone='neutral',intensity=1}={}){
  pitch=clamp(pitch,-6,6);intensity=clamp(intensity,.5,1.35);
  const spec=avToneSpec(tone);
  if(Math.abs(pitch)<.01&&!spec&&Math.abs(intensity-1)<.01)return blob;
  const AC=window.AudioContext||window.webkitAudioContext;
  const ac=new AC();let buf;
  try{buf=await ac.decodeAudioData((await blob.arrayBuffer()).slice(0))}finally{try{await ac.close()}catch{}}
  const factor=Math.pow(2,pitch/12);
  const frames=Math.max(1,Math.ceil(buf.length/factor));
  const OC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  const ctx=new OC(1,frames,buf.sampleRate),src=ctx.createBufferSource();
  src.buffer=buf;src.playbackRate.value=factor;
  let node=src;
  if(spec){const f=ctx.createBiquadFilter();f.type=spec.type;f.frequency.value=spec.frequency;if('gain'in f&&spec.gain!=null)f.gain.value=spec.gain;if(spec.Q!=null)f.Q.value=spec.Q;node.connect(f);node=f}
  const gain=ctx.createGain();gain.gain.value=intensity;node.connect(gain);gain.connect(ctx.destination);src.start(0);
  const out=await ctx.startRendering();
  const pcm=avLimitPcm(new Float32Array(out.getChannelData(0)));
  return encodeWav(pcm,out.sampleRate);
}
async function avTrueBlendBlob(text,c,speed){
  const engine=await loadKokoro();
  if(typeof engine.generateBlend!=='function')throw new Error('True blend engine is not available in this build');
  return engine.generateBlend(applyDictionary(text),{
    voiceA:c.blendA,voiceB:c.blendB,weight:clamp(c.blendWeight??.5,0,1),speed
  });
}

synthesizeProfile=async function(text,c){
  const em=EMOTIONS[c.emotion]||EMOTIONS.neutral;
  const targetSpeed=clamp((c.speed||1)*(em.speed||1),.5,1.6);
  const pitch=clamp((c.pitch||0)+(em.pitch||0),-6,6);
  const tone=c.tone==='neutral'?(em.tone||'neutral'):c.tone;
  const intensity=clamp((c.intensity||1)*(em.intensity||1),.5,1.35);
  const pitchFactor=Math.pow(2,pitch/12);
  // Generate at the inverse compensated tempo. The single resample changes pitch,
  // while the final speaking pace remains close to the user's selected speed.
  const generationSpeed=clamp(targetSpeed/pitchFactor,.5,1.6);
  let blob;
  if(c.mode==='clone'){
    blob=await clonedBlob(text,{...c,speed:generationSpeed,expressiveness:c.expressiveness??em.expr});
  }else if(c.mode==='blend'){
    blob=await avTrueBlendBlob(text,c,generationSpeed);
  }else{
    blob=await kokoroBlob(text,c.voice,generationSpeed);
  }
  return avProcessVoice(blob,{pitch,tone,intensity});
};
