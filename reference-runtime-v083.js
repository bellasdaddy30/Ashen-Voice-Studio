// Ashen Voice Studio v0.8.3 — Safari same-origin ONNX runtime hotfix
(function(){
  const TF_URL='https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
  const VOX_URL='https://esm.sh/voxshot@0.3.0?external=@huggingface/transformers';
  const ORT_BASE='/ort/';
  const ORT_VERSION='1.26.0-dev.20260416-b7804b056c';

  function progress(p){
    try{
      if(!p)return;
      if(p.status==='load-start')return setStatus(`Reference engine · trying ${p.plan||'backend'}…`);
      if(p.status==='load-fallback')return setStatus(`Reference engine fallback · ${p.plan||''} · ${p.reason||''}`);
      if(p.status==='load-compiling')return setStatus('Reference engine · compiling ONNX sessions…');
      if(p.status==='load-ready')return setStatus(`Reference engine ready · ${p.plan||'backend'}`);
      if(p.status==='progress'||p.status==='progress_total'){
        const raw=Number(p.progress);
        if(Number.isFinite(raw)){
          const pct=Math.round(raw<=1?raw*100:raw);
          setStatus(`Downloading reference engine · ${Math.max(0,Math.min(100,pct))}%`);
        }
      }
    }catch{}
  }

  async function preflightOrt(){
    // Chatterbox's WebGPU path uses the JSEP runtime. Test the exact same-origin
    // module before we spend time downloading model weights.
    const url=`${ORT_BASE}ort-wasm-simd-threaded.jsep.mjs?v=083`;
    const r=await fetch(url,{cache:'no-store'});
    if(!r.ok)throw new Error(`same-origin ONNX module returned HTTP ${r.status}: ${url}`);
    const ct=(r.headers.get('content-type')||'').toLowerCase();
    if(!ct.includes('javascript')&&!ct.includes('ecmascript')){
      throw new Error(`same-origin ONNX module has the wrong MIME type (${ct||'unknown'}): ${url}`);
    }
    try{await import(url)}catch(e){
      throw new Error(`Safari could not import the same-origin ONNX module ${url}: ${e?.message||e}`);
    }
    return true;
  }

  async function pinnedTf(){
    setStatus('Loading Transformers.js 4.2.0 + same-origin ONNX runtime…');
    const tf=await import(TF_URL);
    try{tf.env.backends.onnx.wasm.numThreads=1}catch{}
    try{tf.env.backends.onnx.wasm.proxy=false}catch{}
    // Critical v0.8.3 fix: ONNX's .mjs/.wasm assets now come from this Vercel
    // origin, which proxies the exact ORT version bundled by Transformers 4.2.0.
    try{tf.env.backends.onnx.wasm.wasmPaths=ORT_BASE}catch{}
    try{tf.env.useBrowserCache=true}catch{}
    try{tf.env.allowRemoteModels=true}catch{}
    window.__ashenReferenceRuntime={
      build:'0.8.3',
      transformers:'4.2.0',
      onnxruntime:ORT_VERSION,
      wasmPaths:ORT_BASE,
      webgpu:!!navigator.gpu,
      sameOrigin:true
    };
    return tf;
  }

  loadCloneEngine=async function(){
    if(cloneTTS)return cloneTTS;
    if(cloneLoading)return cloneLoading;
    cloneLoading=(async()=>{
      setStatus('Reference engine v0.8.3 · checking Safari runtime…');
      await preflightOrt();
      const [mod,tf]=await Promise.all([import(VOX_URL),pinnedTf()]);
      if(!mod?.ChatterboxEngine||!mod?.VoxShot)throw new Error('VoxShot loaded without Chatterbox exports.');
      const engine=new mod.ChatterboxEngine({
        requiresGpu:false,
        onProgress:progress,
        stallTimeoutMs:300000,
        loadModule:async()=>tf
      });
      cloneTTS=await mod.VoxShot.create({
        engine,
        device:navigator.gpu?'webgpu':'wasm',
        minChunkLength:20,
        maxChunkLength:120
      });
      const actual=engine.loadedPlan?.device||engine.loadedDevice||cloneTTS.device||'auto';
      setStatus(`Reference Voice ready · ${actual} · same-origin ORT ${ORT_VERSION}`);
      return cloneTTS;
    })();
    try{return await cloneLoading}catch(e){
      cloneTTS=null;
      const msg=String(e?.message||e||'unknown engine error');
      throw new Error(`Reference engine v0.8.3 failed: ${msg}`);
    }finally{cloneLoading=null}
  };
})();
