# Ashen Voice Studio

Canonical clean repository for the phone-first audiobook production app.

## Current build

**v0.7.0**

This repository is designed for direct Vercel deployment from GitHub.

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

The studio loads `/book-data/manifest.json`, then automatically pulls the active chapter production map, manuscript, cast cards, pronunciation rules, production guide, and SFX library.

Kokoro runs in `kokoro-worker.js` so TTS model work stays off the main UI thread. `/diagnostics.html` checks the worker, project files and iPhone audio without loading the full model.

Manual character edits, speaker corrections, line-direction overrides, Auto Director, clean narration assembly, and post-production SFX mixing are all part of the app.
