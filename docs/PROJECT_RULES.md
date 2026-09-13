# Project Rules

1. `book-data/manifest.json` is the app's entry point for book data.
2. Manuscript files are source text and must not be modified by pronunciation substitutions.
3. Manual speaker corrections and manual direction overrides outrank automatic analysis.
4. Never create `Unknown`, `Unknown Writer`, or `Unidentified` character profiles.
5. Clean narration WAVs are generated first.
6. SFX are applied afterward to a separate mixed master.
7. Repo SFX must include source/license information.
8. Keep the clean narration master even after an SFX master is created.
9. Change the app version and worker cache query together when the worker changes.
10. Use `/diagnostics.html` before changing architecture when a deployment behaves strangely.
