// Ashen Voice Studio v0.9.4 — fast startup + persistent generated-audio recovery
(function(){
  const DATA_BUILD='094';
  const fastUrl=p=>{const u=new URL(url(p));u.searchParams.set('b',DATA_BUILD);return u.toString()};

  text=async function(p,req=true){
    if(!p)return null;
    const r=await fetch(fastUrl(p),{cache:'default'});
    if(!r.ok){if(req)throw Error(`${p}: HTTP ${r.status}`);return null}
    return r.text();
  };

  json=async function(p,req=true){
    const t=await text(p,req);
    return t==null?null:JSON.parse(t);
  };

  async function storedAudioKeys(){
    const db=await openDb();
    try{
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(DB_STORE,'readonly');
        const req=tx.objectStore(DB_STORE).getAllKeys();
        req.onsuccess=()=>resolve(req.result||[]);
        req.onerror=()=>reject(req.error||new Error('Could not read stored audio keys'));
      });
    }finally{try{db.close()}catch{}}
  }

  async function reconcileStoredAudio(){
    try{
      const keys=new Set(await storedAudioKeys());
      const ch=chapter();
      let count=0;
      for(const l of ch.lines||[]){
        const exists=keys.has(lineKey(l));
        l.generated=exists;
        if(exists)count++;
      }
      ch.masterReady=keys.has(masterKey())&&count===(ch.lines||[]).length;
      save();
      return count;
    }catch(e){
      console.warn('Stored-audio recovery skipped',e);
      return (chapter().lines||[]).filter(l=>l.generated).length;
    }
  }

  loadRepo=async function(noAlert=false){
    try{
      setStatus('Loading repository project…');
      const m=await json('manifest.json');
      const key=m.activeChapter||Object.keys(m.chapters||{})[0],cfg=m.chapters[key];
      if(!cfg)throw Error('No active chapter in manifest');

      const productionPromise=json(cfg.production);
      const cardsPromise=json(m.characters,false);
      const manuscriptPromise=text(cfg.manuscript,false);
      const globalPronPromise=text(m.globalPronunciations,false);
      const chapterPronPromise=text(cfg.pronunciations,false);
      const guidePromise=text(cfg.guide,false);
      const sfxPromise=json(m.sfxLibrary,false);

      const p=await productionPromise;
      if(p?.chapters?.[0]?.lineFiles?.length){
        const dir=cfg.production.split('/').slice(0,-1).join('/');
        const chunks=await Promise.all(p.chapters[0].lineFiles.map(f=>json((dir?dir+'/':'')+f)));
        p.chapters[0].lines=chunks.flat();
      }

      const [cards,man,gp,cp,guide,sfx]=await Promise.all([
        cardsPromise,manuscriptPromise,globalPronPromise,chapterPronPromise,guidePromise,sfxPromise
      ]);

      state=migrate(p);
      sanitize();
      if(cards){state.characters=(cards.characters||cards).filter(c=>c?.name&&!/^unknown/i.test(c.name)).map(makeChar)}
      if(man){state.sources=state.sources||{};state.sources.manuscriptText=man}
      state.dictionary=[];
      if(gp)applyPronunciations(gp);
      if(cp)applyPronunciations(cp);
      if(guide){state.guideNotes=guide;state.sources=state.sources||{};state.sources.guideText=guide}
      repoSfx=(sfx?.effects||sfx||[]).map(x=>({...x,source:x.source||'repo'}));
      state.v7=state.v7||{};
      state.v7.repo={loaded:true,chapter:key,version:m.version||1,loadedAt:Date.now()};
      state.v7.sfxCues=state.v7.sfxCues||[];
      state.v7.customSfx=state.v7.customSfx||[];
      applyOv();
      autoDirect(false);

      const recovered=await reconcileStoredAudio();
      render();
      setStatus(recovered?`Project loaded · ${recovered} stored WAV${recovered===1?'':'s'} recovered`:'Project loaded');
      return true;
    }catch(e){
      console.error(e);
      if(!noAlert)alert('Repository load failed: '+e.message);
      setStatus('Repository load failed');
      return false;
    }
  };

  // Public recovery hook for a manual repair without regenerating anything.
  window.recoverGeneratedAudio=async function(){const n=await reconcileStoredAudio();render();setStatus(`${n} stored WAV${n===1?'':'s'} recovered`);return n};
  window.__ASHEN_DATA_BUILD=DATA_BUILD;
})();
