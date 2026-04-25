# Privacy Policy

AoE4 Replay Launcher does not collect, store, or transmit any personal data.

## What the extension does

- Checks replay availability by sending game IDs to `aoe-api.worldsedgelink.com`
- Checks current game patch version via `aoe4world.com/api`
- Caches availability results locally in your browser (game ID, patch number, true/false, 24h expiry)
- Saves favorited replays locally in your browser (gzipped replay data, max 10)
- Sends replay data to a locally-installed native host to decompress and launch

## What it does NOT do

- No analytics or tracking
- No user accounts
- No personal data collection
- No data shared with third parties
- No data leaves your machine (except API checks to the services listed above)

## Local storage

The extension uses `chrome.storage.local` to store:
- Replay availability cache (game ID + patch + boolean, 24h expiry)
- Current patch version (24h cache)
- Saved/favorited replays (gzipped game data, max 10)

This data never leaves your browser.

## Contact

GitHub: https://github.com/spartain-aoe/aoe4world-replay-extension
