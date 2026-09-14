# Ashen Voice Studio

Canonical phone-first audiobook production app for *The First City*.

## Current build

**v0.9.0**

The repository deploys directly to Vercel from GitHub.

## Active runtime

The production page loads the core split app, `voice-processing.js`, `ui-v076.js`, the Auto Director/SFX modules, and `performance-v090.js`.

`performance-v090.js` is the unified recorded-performance layer:

- Any character may use normal TTS, true voice blend, or Recorded mode.
- Any individual line may be recorded on iPhone or imported as audio.
- Recorded performances use the same speed, pitch, tone, emotion, intensity, rasp, breath, throat-catch, dryness, and room/echo controls.
- Recorded source audio is stored locally in IndexedDB and is not committed to the public repository.
- Dead King defaults to Recorded mode for the Chapter One line “Zikir Ashur.”

Failed Reference Voice / Chatterbox / VoxShot experiments and obsolete throat-effect generations have been removed from the repository.

## Repository layout

```text
Ashen-voice-studio/
├── index.html
├── styles.css
├── kokoro-worker.js
├── performance-v090.js
├── voice-processing.js
├── ui-v076.js
├── app-*.js
├── audio-hotfix.js
├── diagnostics.html
├── vercel.json
├── .gitignore
├── README.md
├── docs/
│   └── PROJECT_RULES.md
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
    │       ├── production-guide.txt
    │       └── segments/
    │           ├── lines-001-049.json
    │           ├── lines-050-098.json
    │           ├── lines-099-147.json
    │           └── lines-148-196.json
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

There are no unidentified or unknown character profiles.

Zik, Zikir, and Zikir Ashur are one character profile. The second-door written warning is assigned to Bel-iddin. The crowned skeleton speaker uses the canon role Dead King.

## Startup flow

1. `index.html` loads the production scripts.
2. `/book-data/manifest.json` identifies the active chapter and data files.
3. Character cards, production data, manuscript, pronunciations, and production guide load automatically.
4. Auto Director creates contextual performance direction.
5. Manual speaker and direction corrections override automatic analysis.
6. Kokoro loads only when synthetic voice generation is requested.
7. Recorded line performances bypass TTS and are processed locally in the browser.
8. SFX are mixed after the clean narration master.

## Diagnostics

Open `/diagnostics.html` to check the worker, manifest, data files, IndexedDB, browser audio, and device capabilities.

## Adding SFX

Put licensed audio under `book-data/sfx/audio/`, then register it in `book-data/sfx/library.json` with source/license information.

Do not commit tokens, passwords, API keys, private voice recordings, or other secrets to this public repository.
