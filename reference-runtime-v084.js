// Ashen Voice Studio v0.8.4 — Safari WASM-only Reference Voice runtime
// Avoids the external ONNX .mjs import entirely on iPhone Safari.
(function(){
  const TF_URL='https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
  const VOX_URL='https://esm.sh/voxshot@0.3.0?external=@huggingface/transformers';
  const ORT_VERSION='1.26.0-dev.20260416-b7804b056c';
  const WASM_URL=new URL('/ort/ort-wasm-simd-threaded.jsep.wasm',location.origin).href;

  function progress(p){
    try{
      if(!p)return;
      if(p.status==='load-start')return setStatus(`Reference engine · trying ${p.plan||'wasm'}…`);
      if(p.status==='load-fallback')return setStatus(`Reference engine fallback · ${p.plan||''} · ${p.reason||''}`);
      if(p.status==='load-compiling')return setStatus('Reference engine · compiling CPU/WASM sessions…');
      if(p.status==='load-ready')return setStatus(`Reference engine ready · ${p.plan||'wasm'}`);
      if(p.status==='progress'||p.status==='progress_total'){
        const raw=Number(p.progress);
        if(Number.isFinite(raw)){
          const pct=Math.round(raw<=1?raw*100:raw);
          setStatus(`Downloading reference engine · ${Math.max(0,Math.min(100,pct))}%`);
        }
      }
    }catch{}
  }

  async function preflightWasm(){
    setStatus('Reference engine v0.8.4 · checking same-origin WASM…');
    const r=await fetch(WASM_URL,{cache:'no-store'});
    if(!r.ok)throw new Error(`same-origin ONNX WASM returned HTTP ${r.status}: ${WASM_URL}`);
    const ct=(r.headers.get('content-type')||'').toLowerCase();
    const buf=await r.arrayBuffer();
    if(buf.byteLength<1024)throw new Error(`same-origin ONNX WASM response is unexpectedly small (${buf.byteLength} bytes)`);
    try{await WebAssembly.compile(buf)}catch(e){throw new Error(`Safari could not compile the ONNX WASM binary: ${e?.message||e}`)}
    return true;
  }

  async function pinnedTf(){
    setStatus('Loading Transformers.js 4.2.0 · CPU/WASM mode…');
    const tf=await import(TF_URL);
    const wasm=tf.env?.backends?.onnx?.wasm;
    if(!wasm)throw new Error('Transformers.js loaded without the ONNX WASM environment.');
    wasm.numThreads=1;
    wasm.proxy=false;
    // Critical v0.8.4 change: provide only the binary override. With one thread,
    // ONNX uses its embedded Emscripten JS glue and does NOT dynamically import
    // ort-wasm-*.mjs, which is the import Safari has been rejecting.
    wasm.wasmPaths={wasm:WASM_URL};
    try{wasm.simd=true}catch{}
    try{tf.env.useBrowserCache=true}catch{}
    try{tf.env.allowRemoteModels=true}catch{}
    window.__ashenReferenceRuntime={
      build:'0.8.4',
      transformers:'4.2.0',
      onnxruntime:ORT_VERSION,
      device:'wasm',
      numThreads:1,
      proxy:false,
      externalMjs:false,
      wasm:WASM_URL
    };
    return tf;
  }

  loadCloneEngine=async function(){
    if(cloneTTS)return cloneTTS;
    if(cloneLoading)return cloneLoading;
    cloneLoading=(async()=>{
      await preflightWasm();
      const [mod,tf]=await Promise.all([import(VOX_URL),pinnedTf()]);
      if(!mod?.ChatterboxEngine||!mod?.VoxShot)throw new Error('VoxShot loaded without Chatterbox exports.');
      const engine=new mod.ChatterboxEngine({
        requiresGpu:false,
        onProgress:progress,
        stallTimeoutMs:300000,
        loadModule:async()=>tf
      });
      // Do NOT start with WebGPU on Safari. A failed WebGPU bootstrap poisons the
      // shared ORT initialization before VoxShot can reach its WASM fallback.
      cloneTTS=await mod.VoxShot.create({
        engine,
        device:'wasm',
        minChunkLength:20,
        maxChunkLength:120
      });
      const actual=engine.loadedPlan?.device||engine.loadedDevice||cloneTTS.device||'wasm';
      setStatus(`Reference Voice ready · ${actual} · one-thread CPU/WASM`);
      return cloneTTS;
    })();
    try{return await cloneLoading}catch(e){
      cloneTTS=null;
      const msg=String(e?.message||e||'unknown engine error');
      throw new Error(`Reference engine v0.8.4 failed: ${msg}`);
    }finally{cloneLoading=null}
  };
})();
