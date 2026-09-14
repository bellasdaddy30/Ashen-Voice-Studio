import { ChatterboxEngine } from 'voxshot-fixed';
import * as tf from '@huggingface/transformers';

const BUILD = 'FIXED-VOXSHOT-8091';
const button = document.querySelector('#test');
const log = document.querySelector('#log');
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/ort-wasm-simd-threaded.wasm';

function write(line = '') {
  log.textContent += `${line}\n`;
  log.scrollTop = log.scrollHeight;
}
function fail(error) {
  const text = error?.stack || error?.message || String(error);
  log.className = 'bad';
  write('\nFAILED');
  write(text);
  if (/kokoro-js|kokoro\.web/i.test(text)) {
    write('\nWRONG PAGE/SERVER DETECTED: this build never imports Kokoro. Open the forwarded port labeled “Ashen Voice · Fixed VoxShot WASM · PORT 8091”.');
  }
}

button.addEventListener('click', async () => {
  button.disabled = true;
  log.className = '';
  log.textContent = '';
  try {
    write(`Build: ${BUILD}`);
    write(`URL: ${location.href}`);
    write(`User agent: ${navigator.userAgent}`);
    write(`WebGPU exposed by browser: ${Boolean(navigator.gpu)}`);
    write('Requested engine: Chatterbox WASM only');
    write('Requested language model: q4');
    write('Kokoro imported by this page: NO');
    write('VoxShot source: b6abd46a724b381fb787aac534d3f59936644d7b');
    write('');

    const wasm = tf.env?.backends?.onnx?.wasm;
    if (!wasm) throw new Error('Transformers.js did not expose the ONNX WASM environment.');
    wasm.numThreads = 1;
    wasm.proxy = false;
    wasm.wasmPaths = { wasm: ORT_WASM };
    try { tf.env.useBrowserCache = true; } catch {}
    try { tf.env.allowRemoteModels = true; } catch {}

    write('Transformers.js 4.2.0 loaded.');
    write('ONNX: one thread, proxy off, plain WASM binary.');
    write('Creating fixed Chatterbox engine...');

    const engine = new ChatterboxEngine({
      requiresGpu: false,
      dtype: { language_model: 'q4' },
      supportsFp16: () => false,
      stallTimeoutMs: 300000,
      loadModule: async () => tf,
      onProgress: (p) => {
        if (!p) return;
        if (p.status === 'load-start') write(`LOAD START: ${p.plan}`);
        else if (p.status === 'load-fallback') write(`FALLBACK: ${p.plan} · ${p.reason || ''}`);
        else if (p.status === 'load-compiling') write(`COMPILING: ${p.plan}`);
        else if (p.status === 'load-ready') write(`LOAD READY: ${p.plan}`);
        else if (p.status === 'progress_total' && Number.isFinite(Number(p.progress))) {
          const n = Number(p.progress);
          const pct = Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)));
          log.textContent = log.textContent.replace(/DOWNLOAD: \d+%\n?$/m, '');
          write(`DOWNLOAD: ${pct}%`);
        }
      }
    });

    write('Calling engine.load("wasm")...');
    await engine.load('wasm');
    const plan = engine.loadedPlan || { device: engine.loadedDevice || 'wasm' };
    log.className = 'good';
    write('');
    write(`SUCCESS: ${JSON.stringify(plan)}`);
    write('This iPhone loaded the fixed Chatterbox engine in browser WASM mode.');
    window.__ashenFixedEngine = engine;
  } catch (error) {
    fail(error);
  } finally {
    button.disabled = false;
  }
});
