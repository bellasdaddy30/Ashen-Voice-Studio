# Ashen Voice Studio

Canonical clean repository for the phone-first audiobook production app.

## Current build

**v0.7.0**

This repository is designed for direct Vercel deployment from GitHub.

## Repository layout

```text
Ashen-voice-studio/
├── index.html
├── kokoro-worker.js
├── diagnostics.html
├── vercel.json
├── .gitignore
├── README.md
├── docs/
└── book-data/
    ├── manifest.json
    ├── characters/
    │   └── character-cards.json
    ├── global/
    │   └── pronunciations.txt
    ├── chapters/
    │   └── 01-the-sealed-tomb/
    │       ├── production.json
    │       ├── manuscript.txt
    │       ├── pronunciations.txt
    │       ├── pronunciation-notes.txt
    │       ├── production-guide.txt
    │       ├── overrides.json
    │       ├── sfx-suggestions.json
    │       └── qa-checklist.txt
    └── sfx/
        ├── library.json
        └── audio/
```

## Chapter One canon

Segments: **196**

- Narrator: 89
- Zik: 49
- Balag: 16
- Enhedu: 16
- Kurash: 20
- Bel-iddin: 5
- Dead King: 1

There are no unidentified/unknown character profiles.

Zik, Zikir and Zikir Ashur are one character profile.
The second-door written warning is assigned to Bel-iddin.
The crowned skeleton speaker uses the canon role Dead King.

## Startup flow

1. `index.html` starts.
2. It fetches `/book-data/manifest.json`.
3. The manifest identifies the active chapter and project files.
4. Character cards, production, manuscript, pronunciations and guide load automatically.
5. Auto Director creates contextual performance direction.
6. Manual character, speaker and performance overrides remain available.
7. Kokoro is loaded only when voice generation is requested.
8. Kokoro runs in `kokoro-worker.js` so model work does not block the main UI.
9. SFX are mixed after the clean narration master.

## iPhone preview behavior

The Preview tap unlocks Web Audio immediately. Kokoro then generates in the worker.
When the WAV is ready, Ashen Voice attempts playback through the unlocked context and also shows a visible HTML audio player as a fallback.

## Diagnostics

Open:

`/diagnostics.html`

This checks the worker, manifest, data files, WebGPU, IndexedDB and iPhone audio without loading the full Kokoro model.

## Adding SFX

Put licensed audio under:

`book-data/sfx/audio/`

Then register it in:

`book-data/sfx/library.json`

Do not put GitHub tokens or other secrets in `index.html`.
