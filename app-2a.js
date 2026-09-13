// ASHEN VOICE STUDIO v0.7.1 — phone-first build
const VERSION='0.7.1';
const KOKORO_MODEL='onnx-community/Kokoro-82M-v1.0-ONNX';
const STORAGE_KEY='ashen-voice-v071-state';
const DB_NAME='ashen-voice-v071'; const DB_STORE='clips';
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const clone=o=>globalThis.structuredClone?structuredClone(o):JSON.parse(JSON.stringify(o));
const clamp=(n,a,b)=>Math.min(b,Math.max(a,Number(n)||a));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const byId=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const slug=s=>String(s||'audio').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'audio';

const VOICES=[
['af_heart','Heart · American female'],['af_bella','Bella · American female'],['af_nicole','Nicole · American female'],['af_kore','Kore · American female'],['af_sarah','Sarah · American female'],['af_aoede','Aoede · American female'],['af_nova','Nova · American female'],['af_alloy','Alloy · American female'],['af_jessica','Jessica · American female'],['af_river','River · American female'],['af_sky','Sky · American female'],
['am_fenrir','Fenrir · American male'],['am_michael','Michael · American male'],['am_puck','Puck · American male'],['am_onyx','Onyx · American male'],['am_eric','Eric · American male'],['am_echo','Echo · American male'],['am_liam','Liam · American male'],['am_adam','Adam · American male'],
['bf_emma','Emma · British female'],['bf_isabella','Isabella · British female'],['bf_alice','Alice · British female'],['bf_lily','Lily · British female'],['bm_george','George · British male'],['bm_lewis','Lewis · British male'],['bm_daniel','Daniel · British male'],['bm_fable','Fable · British male']
];
const TONES=['neutral','warm','dark','bright','crisp','soft','hollow','radio'];
const EMOTIONS={
neutral:{speed:.96,pitch:0,tone:'neutral',pause:.34,intensity:1,expr:.5},solemn:{speed:.88,pitch:-.8,tone:'dark',pause:.48,intensity:.94,expr:.38},tense:{speed:.97,pitch:.5,tone:'crisp',pause:.35,intensity:1.03,expr:.72},urgent:{speed:1.08,pitch:.7,tone:'bright',pause:.22,intensity:1.06,expr:.8},fearful:{speed:1.02,pitch:1.25,tone:'bright',pause:.38,intensity:.95,expr:.78},grief:{speed:.85,pitch:-1.1,tone:'warm',pause:.58,intensity:.86,expr:.45},angry:{speed:1.01,pitch:-.4,tone:'crisp',pause:.25,intensity:1.10,expr:.9},intimate:{speed:.90,pitch:-.3,tone:'warm',pause:.44,intensity:.84,expr:.35},deadpan:{speed:.93,pitch:-.5,tone:'neutral',pause:.38,intensity:.91,expr:.2},ominous:{speed:.84,pitch:-1.6,tone:'dark',pause:.62,intensity:.92,expr:.5},whispered:{speed:.89,pitch:.15,tone:'soft',pause:.46,intensity:.72,expr:.28}
};
const DESC_LIBRARY={
'deep':{voice:'am_onyx',pitch:-2,tone:'dark',speed:.9},'gravel':{voice:'bm_george',pitch:-1.4,tone:'crisp',speed:.9},'rough':{voice:'bm_george',pitch:-1.1,tone:'crisp',speed:.94},'old':{voice:'bm_lewis',pitch:-.8,tone:'warm',speed:.88},'young':{voice:'am_puck',pitch:.9,tone:'bright',speed:1.02},'warm':{voice:'am_michael',pitch:-.3,tone:'warm',speed:.94},'cold':{voice:'am_onyx',pitch:-.7,tone:'crisp',speed:.92},'menacing':{voice:'am_fenrir',pitch:-1.3,tone:'dark',speed:.88},'scholarly':{voice:'bm_daniel',pitch:0,tone:'warm',speed:.92},'calm':{voice:'am_michael',pitch:-.2,tone:'soft',speed:.9},'female':{voice:'af_heart',pitch:0,tone:'neutral',speed:.96},'older woman':{voice:'bf_emma',pitch:-.7,tone:'warm',speed:.88},'young woman':{voice:'af_bella',pitch:.5,tone:'bright',speed:1},'british':{voice:'bm_daniel',pitch:0,tone:'neutral',speed:.95},'american':{voice:'am_michael',pitch:0,tone:'neutral',speed:.96},'soft':{voice:'af_heart',pitch:0,tone:'soft',speed:.9},'commanding':{voice:'am_fenrir',pitch:-.8,tone:'crisp',speed:.96}
};

let kokoro=null,kokoroLoading=null,cloneTTS=null,cloneLoading=null,queueAbort=false,objectUrls=[],selectedCharacterId=null;
const intake={production:null,manuscript:null,pronunciation:null,guide:null};
let state=null; selectedCharacterId=null;

function freshState(){const chapter={id:uid(),title:'Chapter One',lines:[],masterReady:false};return{schema:5,title:'The First City',author:'C. R. Ashen',activeChapterId:chapter.id,chapters:[chapter],characters:[makeChar({name:'Narrator',voice:'am_michael',speed:.94,pause:.42})],dictionary:[],settings:{dtype:'q4',device:'auto',memorySaver:true,normalize:true,fadeMs:10},sources:{productionText:'',manuscriptText:'',pronunciationText:'',guideText:'',names:{}},guideNotes:'',updatedAt:Date.now()};}
function makeChar(c={}){return{id:c.id||uid(),name:c.name||'Character',mode:c.mode||'preset',voice:c.voice||'am_fenrir',speed:clamp(c.speed??.96,.5,1.6),pause:Math.max(0,Number(c.pause??.34)),pitch:clamp(c.pitch??0,-6,6),tone:TONES.includes(c.tone)?c.tone:'neutral',emotion:EMOTIONS[c.emotion]?c.emotion:'neutral',intensity:clamp(c.intensity??1,.5,1.35),expressiveness:clamp(c.expressiveness??.5,0,1.5),blendA:c.blendA||'am_fenrir',blendB:c.blendB||'am_michael',blendWeight:clamp(c.blendWeight??.5,0,1),description:c.description||'',cloneId:c.cloneId||'',cloneReady:!!c.cloneReady,cloneFileName:c.cloneFileName||''};}
function migrate(s){if(!s)return freshState();s.schema=5;s.settings={dtype:'q4',device:'auto',memorySaver:true,normalize:true,fadeMs:10,...s.settings};s.characters=(s.characters||[]).map(makeChar);if(!s.characters.length)s.characters=freshState().characters;s.dictionary=Array.isArray(s.dictionary)?s.dictionary:[];s.chapters=(s.chapters||[]).map(ch=>({...ch,id:ch.id||uid(),lines:(ch.lines||[]).map(l=>({...l,id:l.id||uid(),speaker:l.speaker||'Narrator',generated:false}))}));if(!s.chapters.length){const f=freshState();s.chapters=f.chapters;s.activeChapterId=f.activeChapterId;}if(!s.activeChapterId||!s.chapters.some(c=>c.id===s.activeChapterId))s.activeChapterId=s.chapters[0].id;s.sources=s.sources||freshState().sources;return s;}
function loadState(){try{return migrate(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'));}catch{return freshState();}}
function save(){state.updatedAt=Date.now();localStorage.setItem(STORAGE_KEY,JSON.stringify(state));updateStats();}
function chapter(){return state.chapters.find(c=>c.id===state.activeChapterId)||state.chapters[0];}
function charByName(name){return state.characters.find(c=>c.name.toLowerCase()===String(name).toLowerCase())||state.characters[0];}
function ensureChar(name){let c=state.characters.find(x=>x.name.toLowerCase()===name.toLowerCase());if(!c){c=makeChar({name});state.characters.push(c);}return c;}
function lineKey(l){return `${state.title}:${chapter().id}:${l.id}`;}function masterKey(){return `${state.title}:${chapter().id}:MASTER`;}

function openDb(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(DB_STORE))r.result.createObjectStore(DB_STORE)};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function dbPut(k,v){const db=await openDb();await new Promise((res,rej)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(v,k);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close();}
async function dbGet(k){const db=await openDb();const out=await new Promise((res,rej)=>{const r=db.transaction(DB_STORE,'readonly').objectStore(DB_STORE).get(k);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)});db.close();return out;}
async function dbDel(k){const db=await openDb();await new Promise((res,rej)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).delete(k);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close();}
