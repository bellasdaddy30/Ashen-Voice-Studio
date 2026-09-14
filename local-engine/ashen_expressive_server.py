#!/usr/bin/env python3
import io, os, re, subprocess, tempfile, threading, wave
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

APP_DIR = Path.home()/'.local'/'share'/'ashen-voice'
REF_DIR = APP_DIR/'references'
REF_DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault('HF_HOME', str(APP_DIR/'hf-cache'))

app = FastAPI(title='Ashen Voice Expressive Engine', version='0.8.1')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=False, allow_methods=['*'], allow_headers=['*'])

_model = None
_lock = threading.Lock()

class SynthesisRequest(BaseModel):
    text: str
    voice_id: str = 'dead-king'
    character: str | None = None


def safe_id(value: str) -> str:
    v = re.sub(r'[^a-zA-Z0-9_.-]+', '-', value or '').strip('-').lower()
    return v[:80] or 'voice'


def get_model():
    global _model
    if _model is None:
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        import torch
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 2)))
        _model = ChatterboxTurboTTS.from_pretrained(device='cpu', nano=True)
    return _model


def wav_bytes(tensor, sample_rate: int) -> bytes:
    x = tensor.detach().cpu().float().numpy().squeeze()
    if x.ndim != 1:
        x = x.reshape(-1)
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    if peak > 0.98:
        x = x * (0.98 / peak)
    pcm = np.clip(x, -1, 1)
    pcm = (pcm * 32767.0).astype('<i2')
    bio = io.BytesIO()
    with wave.open(bio, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(int(sample_rate)); w.writeframes(pcm.tobytes())
    return bio.getvalue()


def probe_duration(path: Path) -> float:
    try:
        p = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(path)], capture_output=True, text=True, check=True)
        return float((p.stdout or '0').strip() or 0)
    except Exception:
        return 0.0

@app.get('/health')
def health():
    return {'ok': True, 'engine': 'Chatterbox Nano CPU', 'model_loaded': _model is not None, 'reference_dir': str(REF_DIR)}

@app.get('/reference/{voice_id}')
def reference_status(voice_id: str):
    p = REF_DIR/f'{safe_id(voice_id)}.wav'
    return {'ok': True, 'exists': p.exists(), 'duration_seconds': probe_duration(p) if p.exists() else 0}

@app.post('/reference/{voice_id}')
async def save_reference(voice_id: str, file: UploadFile = File(...)):
    vid = safe_id(voice_id)
    raw = await file.read()
    if not raw:
        raise HTTPException(400, 'Reference file is empty.')
    if len(raw) > 30*1024*1024:
        raise HTTPException(413, 'Reference file is too large. Keep it under 30 MB.')
    suffix = Path(file.filename or 'reference.bin').suffix or '.bin'
    with tempfile.TemporaryDirectory(prefix='ashen-ref-') as td:
        src = Path(td)/f'input{suffix}'
        src.write_bytes(raw)
        out = REF_DIR/f'{vid}.wav'
        cmd = ['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(src),'-t','15','-ac','1','-ar','24000','-c:a','pcm_s16le',str(out)]
        try:
            subprocess.run(cmd, check=True, capture_output=True)
        except FileNotFoundError:
            raise HTTPException(500, 'ffmpeg is not installed on Ragnarok.')
        except subprocess.CalledProcessError as e:
            raise HTTPException(400, f'Could not decode that recording: {e.stderr.decode(errors="ignore")[-400:]}')
    dur = probe_duration(out)
    if dur < 3.0:
        out.unlink(missing_ok=True)
        raise HTTPException(400, 'Reference is too short. Record at least 5 seconds of continuous speech.')
    return {'ok': True, 'voice_id': vid, 'duration_seconds': dur}

@app.post('/synthesize')
def synthesize(req: SynthesisRequest):
    text = (req.text or '').strip()
    if not text:
        raise HTTPException(400, 'Text is empty.')
    if len(text) > 500:
        raise HTTPException(400, 'Keep expressive-engine requests under 500 characters.')
    ref = REF_DIR/f'{safe_id(req.voice_id)}.wav'
    if not ref.exists():
        raise HTTPException(409, f'No reference saved for {safe_id(req.voice_id)}. Upload one from Voice Lab first.')
    with _lock:
        try:
            model = get_model()
            audio = model.generate(text, audio_prompt_path=str(ref))
            payload = wav_bytes(audio, model.sr)
        except Exception as e:
            raise HTTPException(500, f'Chatterbox synthesis failed: {type(e).__name__}: {e}')
    return Response(payload, media_type='audio/wav', headers={'Cache-Control':'no-store','X-Ashen-Engine':'chatterbox-nano'})
