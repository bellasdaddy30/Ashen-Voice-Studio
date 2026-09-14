#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/Ashen-voice-studio"
VOX="/workspaces/voxshot-fixed"
VOX_COMMIT="b6abd46a724b381fb787aac534d3f59936644d7b"

printf '\n=== Ashen Voice Codespace setup ===\n'
printf 'Building fixed VoxShot commit %s\n' "$VOX_COMMIT"

rm -rf "$VOX"
git clone --filter=blob:none --no-tags https://github.com/m96-chan/voxshot.git "$VOX"
cd "$VOX"
git checkout "$VOX_COMMIT"
npm install
npm run build

cd "$ROOT/.codespace-test"
npm install
npm run build

printf '\nFixed VoxShot static test build ready on port 8091.\n'
