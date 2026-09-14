/* Ashen Voice Studio v0.7.4 — base UI renderer */
function fileSlot(kind,title,desc,accept){
  const f=intake[kind];
  return `<label class="fileCard"><div class="fileBadge">${kind.slice(0,4).toUpperCase()}</div><div class="fileMeta"><strong>${title}</strong><p class="mini">${desc}</p><div class="fileName">${f?esc(f.name):'Tap to choose file'}</div></div><input class="hiddenInput intakeFile" data-kind="${kind}" type="file" accept="${accept}"></label>`;
}

function render(){
  revokeUrls();
  const ch=chapter(),done=ch.lines.filter(l=>l.generated).length;
  byId('app').innerHTML=`<main class="shell">
<header class="top"><div class="brand"><div class="logo">AV</div><div><h1>Ashen Voice Studio <span class="version">v${VERSION}</span></h1><p>repo-backed audiobook production + voice lab</p></div></div><div id="status" class="status">Ready</div></header>

<section class="panel"><div class="sectionHead"><div><h2>Project Sources</h2><div class="mini">Book data loads automatically from this repository. Manual source files remain available as a fallback.</div></div><span class="chip">GitHub-backed</span></div>
<div class="fileGrid">${fileSlot('production','1 · Production','Speaker assignments / production JSON','.json,.txt,.md')}${fileSlot('manuscript','2 · Manuscript','Chapter source text','.txt,.md')}${fileSlot('pronunciation','3 · Pronunciations','Written → spoken replacements','.txt,.csv,.json,.md')}${fileSlot('guide','4 · Production Guide','Cast defaults and performance notes','.txt,.md')}</div>
<div class="toolbar workflow"><button id="mapFiles" class="btn">Map Files</button><button id="openVoices" class="btn primary">Choose / Build Voices</button><button id="produce" class="btn good">Produce Chapter WAV</button><button id="stop" class="btn bad">Stop</button></div>
<div class="progressWrap"><div class="progress"><div id="progressBar"></div></div><div id="progressText" class="progressText">Idle</div></div></section>

<div class="grid2"><section class="panel"><div class="sectionHead"><h2>Project</h2><span class="chip">local autosave</span></div>
<div class="field"><label>Book</label><input id="bookTitle" value="${esc(state.title)}"></div>
<div class="field"><label>Author</label><input id="author" value="${esc(state.author)}"></div>
<div class="field"><label>Chapter</label><input id="chapterTitle" value="${esc(ch.title)}"></div>
<pre id="runtimeErrorBox" class="mini" style="white-space:pre-wrap;color:#efada6;max-height:90px;overflow:auto"></pre>
<div id="memoryBanner" class="memoryBanner ${state.settings.memorySaver?'':'hidden'}">Memory Saver is ON: compact model precision, short previews, one render at a time.</div>
<div class="row"><div class="field grow"><label>Kokoro quality</label><select id="dtype"><option value="q4" ${state.settings.dtype==='q4'?'selected':''}>q4 · lowest memory</option><option value="q8" ${state.settings.dtype==='q8'?'selected':''}>q8 · better quality</option><option value="fp32" ${state.settings.dtype==='fp32'?'selected':''}>fp32 · huge</option></select></div><div class="field grow"><label>Device</label><select id="device"><option value="auto" ${state.settings.device==='auto'?'selected':''}>Auto</option><option value="webgpu" ${state.settings.device==='webgpu'?'selected':''}>WebGPU</option><option value="wasm" ${state.settings.device==='wasm'?'selected':''}>WASM</option></select></div></div>
<div class="toolbar"><button id="loadK" class="btn primary">Load Voice Engine</button><button id="cancelK" class="btn bad" disabled>Cancel Engine</button><button id="toggleMemory" class="btn">Memory Saver: ${state.settings.memorySaver?'ON':'OFF'}</button><button id="backup" class="btn">Backup Project</button><label class="btn">Restore<input id="restore" class="hiddenInput" type="file" accept=".json"></label></div>
<div class="engineBox"><div class="engineRow"><div id="engineProgress" class="engineProgress">Voice engine not loaded. First load can take a while; the interface will remain responsive.</div></div></div><div id="stats" class="stats"></div></section>

<section class="panel"><div class="sectionHead"><div><h2>Cast</h2><div class="mini">Preset, designed, layered blend, or cloned voice per character.</div></div><button id="addChar" class="btn tiny">+ Character</button></div><div class="castList">${state.characters.map(c=>castCard(c)).join('')}</div></section></div>

<section class="panel"><div class="sectionHead"><div><h2>Pronunciation Dictionary</h2><div class="mini">Replacements happen only in speech. Manuscript stays untouched.</div></div><button id="addWord" class="btn tiny">+ Word</button></div><div id="dict">${state.dictionary.length?state.dictionary.map(d=>`<div class="row card"><input class="dictFrom" data-id="${d.id}" placeholder="Written" value="${esc(d.from||'')}"><input class="dictTo" data-id="${d.id}" placeholder="Spoken" value="${esc(d.to||'')}"><button class="btn bad tiny delWord" data-id="${d.id}">×</button></div>`).join(''):'<div class="mini">No forced pronunciations yet.</div>'}</div></section>

<section class="panel"><div class="sectionHead"><div><h2>Chapter Production</h2><div class="mini">Review individual segments, regenerate only what needs fixing, then reassemble.</div></div><span class="chip ${ch.masterReady?'good':''}">${done}/${ch.lines.length} WAVs</span></div><div id="master"></div><div class="toolbar"><button id="generateMissing" class="btn primary">Generate Missing</button><button id="assemble" class="btn good">Assemble Current WAVs</button><button id="clearWavs" class="btn bad">Clear Chapter Audio</button></div><div class="lines">${ch.lines.length?ch.lines.map((l,i)=>lineCard(l,i)).join(''):'<div class="card mini">Repository chapter data is loading…</div>'}</div></section>
</main>
<div id="previewDock" class="previewDock"><div class="previewDockHead"><strong id="previewDockTitle">Preview</strong><button id="previewDockClose" class="btn tiny">×</button></div><div class="mini" id="previewDockStatus">Preparing audio…</div><audio id="previewDockAudio" controls preload="auto"></audio></div>
<div class="bottomBar"><button class="btn primary" id="mobileVoices">Voices</button><button class="btn good" id="mobileProduce">Produce</button><button class="btn" id="mobileTop">Top</button></div>
<div id="voiceModal" class="modal hidden"></div>`;
  wire();
  restoreAudio().catch(e=>console.warn('Audio restore skipped',e));
  updateStats();
}
