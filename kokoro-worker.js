// Ashen Voice Studio v0.7.6 — isolated Kokoro worker
// True voice blending happens in embedding/style space before synthesis.
let tts=null;
let currentDevice=null;
let currentDtype=null;
let inferenceTail=Promise.resolve();
const STYLE_DIM=256;
const SAMPLE_RATE=24000;
const VOICE_DATA_URL='https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices';
const voiceCache=new Map();
const blendCache=new Map();

function ensureReadableStreamAsyncIterator(){const RS=self.ReadableStream;if(!RS||!self.Symbol||!Symbol.asyncIterator)return;if(!RS.prototype[Symbol.asyncIterator]){Object.defineProperty(RS.prototype,Symbol.asyncIterator,{configurable:true,writable:true,value:async function*(){const reader=this.getReader();try{while(true){const r=await reader.read();if(r.done)return;yield r.value}}finally{try{reader.releaseLock()}catch{}}}})}if(!RS.prototype.values){Object.defineProperty(RS.prototype,'values',{configurable:true,writable:true,value:function(){return this[Symbol.asyncIterator]()}})}}
function status(message,busy=true){postMessage({type:'status',message,busy})}
function errorText(e){return(e&&e.stack)||String(e&&e.message||e)}
async function getModule(){ensureReadableStreamAsyncIterator();status('Loading Kokoro browser library…',true);return await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js')}
async function loadEngine(model,device,dtype){if(tts&&device===currentDevice&&dtype===currentDtype)return{device,dtype};tts=null;const{KokoroTTS}=await getModule();if(!KokoroTTS)throw new Error('KokoroTTS export missing');const progress_callback=data=>{try{postMessage({type:'progress',data})}catch{}};try{status(`Loading Kokoro model · ${device} ${dtype}`,true);tts=await KokoroTTS.from_pretrained(model,{device,dtype,progress_callback});currentDevice=device;currentDtype=dtype;return{device,dtype}}catch(e){if(device==='webgpu'){status('WebGPU load failed · retrying WASM q8',true);tts=await KokoroTTS.from_pretrained(model,{device:'wasm',dtype:'q8',progress_callback});currentDevice='wasm';currentDtype='q8';return{device:'wasm',dtype:'q8'}}throw e}}

async function getVoiceData(id){
  if(voiceCache.has(id))return voiceCache.get(id);
  const r=await fetch(`${VOICE_DATA_URL}/${encodeURIComponent(id)}.bin`,{cache:'force-cache'});
  if(!r.ok)throw new Error(`Could not load voice ${id}: HTTP ${r.status}`);
  const data=new Float32Array(await r.arrayBuffer());
  if(data.length<STYLE_DIM)throw new Error(`Voice ${id} returned invalid style data`);
  voiceCache.set(id,data);
  return data;
}
async function getBlendData(a,b,w){
  const weight=Math.max(0,Math.min(1,Number(w)));
  if(a===b||weight>=.9999)return getVoiceData(a);
  if(weight<=.0001)return getVoiceData(b);
  const key=`${a}|${b}|${weight.toFixed(4)}`;
  if(blendCache.has(key))return blendCache.get(key);
  const [A,B]=await Promise.all([getVoiceData(a),getVoiceData(b)]);
  if(A.length!==B.length)throw new Error('Voice embedding sizes do not match');
  const out=new Float32Array(A.length),bw=1-weight;
  for(let i=0;i<out.length;i++)out[i]=A[i]*weight+B[i]*bw;
  blendCache.set(key,out);
  return out;
}
function pcmResult(a){
  const src=a?.audio||a?.samples||a?.data;
  if(!src)throw new Error('Kokoro returned no PCM audio');
  const pcm=src instanceof Float32Array?new Float32Array(src):new Float32Array(src);
  return{pcm,sampleRate:a?.sampling_rate||a?.sampleRate||SAMPLE_RATE};
}
async function generatePreset(text,voice,speed){
  const a=await tts.generate(text,{voice,speed:speed||1});
  return pcmResult(a);
}
async function generateBlend(text,voiceA,voiceB,weight,speed){
  if(!tts)throw new Error('Voice engine is not loaded');
  if(!voiceA||!voiceB)throw new Error('Blend requires two voices');
  if(voiceA===voiceB)return generatePreset(text,voiceA,speed);
  const blended=await getBlendData(voiceA,voiceB,weight);
  const original=tts.generate_from_ids;
  tts.generate_from_ids=async function(input_ids,{speed:innerSpeed=1}={}){
    const dims=input_ids?.dims||[];
    const n=dims.length?dims[dims.length-1]:0;
    const numTokens=Math.min(Math.max(n-2,0),509);
    const offset=numTokens*STYLE_DIM;
    const styleData=blended.slice(offset,offset+STYLE_DIM);
    if(styleData.length!==STYLE_DIM)throw new Error('Blend style slice was incomplete');
    const TensorCtor=input_ids.constructor;
    const inputs={
      input_ids,
      style:new TensorCtor('float32',styleData,[1,STYLE_DIM]),
      speed:new TensorCtor('float32',[innerSpeed],[1])
    };
    const {waveform}=await tts.model(inputs);
    return{audio:new Float32Array(waveform.data),sampling_rate:SAMPLE_RATE};
  };
  try{
    // voiceA supplies the language/phonemization path; the actual style is the blended tensor.
    const a=await tts.generate(text,{voice:voiceA,speed:speed||1});
    return pcmResult(a);
  }finally{
    tts.generate_from_ids=original;
  }
}
function enqueue(fn){const run=inferenceTail.then(fn,fn);inferenceTail=run.catch(()=>{});return run}
function postPcm(id,r,extra={}){const pcm=r.pcm instanceof Float32Array?r.pcm:new Float32Array(r.pcm);postMessage({id,ok:true,pcmBuffer:pcm.buffer,sampleRate:r.sampleRate||SAMPLE_RATE,...extra},[pcm.buffer])}

self.onmessage=async ev=>{
  const m=ev.data||{},id=m.id;
  try{
    if(m.type==='ping'){postMessage({id,ok:true,type:'pong',version:'0.7.6'});return}
    if(m.type==='load'){const r=await loadEngine(m.model,m.device,m.dtype);status(`Voice engine ready · ${r.device} ${r.dtype}`,false);postMessage({id,ok:true,...r});return}
    if(m.type==='generate'){
      if(!tts)throw new Error('Voice engine is not loaded');
      status('Generating voice preview…',true);
      const r=await enqueue(()=>generatePreset(m.text,m.voice,m.speed||1));
      status('Voice preview generated',false);postPcm(id,r);return
    }
    if(m.type==='generateBlend'){
      if(!tts)throw new Error('Voice engine is not loaded');
      status(`Blending ${m.voiceA} + ${m.voiceB} in voice space…`,true);
      const r=await enqueue(()=>generateBlend(m.text,m.voiceA,m.voiceB,m.weight,m.speed||1));
      status('Blended voice generated',false);postPcm(id,r,{blend:true});return
    }
    if(m.type==='dispose'){try{await tts?.dispose?.()}catch{}tts=null;currentDevice=null;currentDtype=null;voiceCache.clear();blendCache.clear();postMessage({id,ok:true});return}
    throw new Error('Unknown worker command');
  }catch(e){postMessage({id,ok:false,error:errorText(e)})}
};
