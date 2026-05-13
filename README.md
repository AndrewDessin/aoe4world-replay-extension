# AoE4 Replay Launcher

Watch any AoE4 ranked game replay directly from [aoe4world.com](https://aoe4world.com) with one click. Optionally inject custom charts (army composition, resource gathered, build-order value) and in-game player colors.

![Games list with Watch Replay buttons](assets/screenshot-3.png)

## Features

- **One-click replay launching** from any game on aoe4world.com
- **Save replays** — star games to keep them locally for offline viewing
- **Custom charts** — army composition, resource gathered, army value lead charts on game summary pages (opt-in)
- **In-game player colors** — recolors aoe4world's default swatches with actual replay colors (opt-in)
- **Patch-aware** — warns when a replay is from a previous patch, shows "Replay Unavailable" for older patches
- **DLC support** — handles new civs and colors automatically
- **Works with Chrome and Edge**

## Setup

### 1. Install the Chrome/Edge extension

**From the Chrome Web Store:** [AoE4 Replay Launcher](https://chromewebstore.google.com/detail/ckkbdeejodfnpehhllhmhhannpgojfec)

Or load manually:
1. Download the latest `chrome-extension-store.zip` from [Releases](https://github.com/spartain-aoe/aoe4world-replay-extension/releases/latest)
2. Extract it
3. Open `chrome://extensions/` (or `edge://extensions/`)
4. Enable **Developer mode** (top right)
5. Click **Load unpacked** → select the extracted folder

### 2. Install the native host (for replay launching)

1. Download `aoe4-replay-launcher.zip` from [Releases](https://github.com/spartain-aoe/aoe4world-replay-extension/releases/latest)
2. Extract it anywhere
3. Run `install.bat`
4. Files are installed to `%LOCALAPPDATA%\AoE4ReplayLauncher`

### 3. Enable features

Click the extension icon to open settings:

- **Parse additional game data** — master toggle for chart/color features
  - **Inject custom charts** — adds army composition and resource charts to game pages
  - **Use in-game player colors** — recolors swatches with actual replay colors

All features are off by default. Replay launching works without enabling any of these.

## Development

```bash
npm ci                  # install dependencies
npm run build           # build all bundles + pbgid-map
npm run dev             # watch mode (rebuilds on file changes)
npm run typecheck       # tsc --noEmit
npm test                # fixtures + adversarial + build + unit + regression tests
```

### Project structure

```
src/
  content/       # content script modules (TypeScript)
  background/    # service worker + replay parser
  popup/         # popup UI
build/           # esbuild bundler + pbgid-map builder
tests/
  unit/          # unit tests
  regression/    # regression tests (bundle smoke, favorites bugs)
  fixtures/      # HTML page fixtures for DOM tests
    replay/      # .gz replay files for parser tests
  check-*.mjs    # fixture + adversarial parser tests
chrome-extension/  # extension manifest, icons, styles, built outputs (gitignored JS)
native-host/       # replay launcher installer (PowerShell)
```

## Uninstall

1. Run `install.bat uninstall`
2. Remove the extension from `chrome://extensions/`

## Requirements

- Windows
- Age of Empires IV installed via Steam
- PowerShell 5.1+
- Chrome or Edge

## Privacy

No user data is collected. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
