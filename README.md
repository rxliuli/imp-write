# Imp Write

A browser extension that fixes and rewrites text in any textbox, without leaving the page.

## Usage

Type your text, then append a command at the end — `/fix`, `/improve`, `/shorten`, `/tl`
(translate to English), or any custom command you've defined — and pause briefly. The AI
response replaces the input's content in place. Press Esc right after to undo the
replacement — or use your browser/OS's own undo (Cmd/Ctrl+Z); either way, undoing won't
cause the replacement to fire again. Known limitation: if you switch away to another tab
while a request is still in flight, the write-back can occasionally land as an append
after the original text instead of a clean replace — Esc still reverts the whole field
either way.

You can also run a command without the `/token` trigger: right-click inside any textbox
for an "Imp Write" context menu listing every command, or bind a keyboard shortcut to a
command from the options page (VSCode-style — click the field, then press the combo).
Either way, if you have text selected only the selection is rewritten; otherwise the
whole field is.

You can bring your own OpenAI-compatible API key (BYOK, completely free — works with
OpenAI, DeepSeek, Gemini's OpenAI-compatible endpoint, and more), or connect an Imp
account for a one-click, pay-as-you-go option with no key management. Configure either
from the extension's options page, along with custom commands and their shortcuts. The
Commands section's "…" menu can also export your command set to a JSON file, or import
one back in (merged with your existing commands, same-named entries skipped).

### v1 limitations

This version targets plain `<input>` and `<textarea>` elements, plus best-effort support
for `contenteditable` regions. It does **not** support canvas-based or deeply custom
editors such as Google Docs or Notion — those are out of scope for now.

## Getting Started

### Initialize Project

```sh
git clone https://github.com/<your-github-username>/<your-project-name>.git
cd <your-project-name>
pnpm i
pnpm init-project
```

Follow the prompts to enter your project name and complete the initialization.

## Development

Chrome is used as the baseline version for development. Edge, Firefox, and Safari builds are only created when needed for publishing, testing, or debugging platform-specific issues.

### Start Development Server

```sh
pnpm dev
```

After running the development server:

1. Navigate to the `*.output/chrome-mv3-dev` directory to find the compiled extension files
2. Open `chrome://extensions` in Chrome
3. Enable "Developer mode"
4. Drag and drop the output directory to load the extension for debugging

### End-to-End Tests

```sh
pnpm e2e
```

Builds the extension and runs Playwright scenario tests against a real Chromium instance
with the built `.output/chrome-mv3` extension loaded (via `launchPersistentContext` +
`--load-extension`), talking to a local mock OpenAI-compatible server instead of a real
provider. These cover the idle-pause trigger, keyboard shortcuts, selection-scoped
replacement, undo/Esc, and contenteditable fields.

The right-click context menu can't be exercised this way — Playwright cannot interact
with a browser's native context menu — so that trigger path is verified by hand instead.

### Troubleshooting

In dev mode, content scripts are registered at runtime over a WebSocket connection to the
WXT dev server, and that connection doesn't automatically reconnect. If the extension
seems completely unresponsive on every page (no trigger, no loading indicator), reload
it from `chrome://extensions` and then refresh the page you're testing on. You can
confirm the connection is healthy by opening the extension's service worker console and
looking for a "Connected to dev server" log line.

## Build & Package

### Chrome, Edge, and Firefox

Generate production builds and create zip files for distribution:

```sh
pnpm zip && pnpm zip:firefox
```

#### Stable extension ID (local vs. CI)

Chrome derives an extension's ID from a public key, so the ID stays stable only if the
key stays the same. Without an explicit `key`, every fresh load/re-install gets a new
generated ID.

This repo takes a `key` into account only for **local** builds, via `is-ci` in
`wxt.config.ts`:

- **Local** `pnpm build` / `pnpm zip` → the manifest includes `key`, so loading the
  build (`Load unpacked` on `.output/chrome-mv3` or dragging the zip in) always yields
  the exact same extension ID:

  ```
  neiaiilbnhnfhickkhphbpcgnbhaiihj
  ```

- **CI** → the `key` is omitted from the manifest, so a package uploaded to the Chrome
  Web Store doesn't carry it (CWS assigns its own ID).

The private key lives in `key.pem` at the project root, which is git-ignored. **Keep it
local — never commit or delete it.** It's what makes the ID recoverable later and is
required to sign a `.crx` (the key must match the public key in the manifest).

If the `.pem` is ever regenerated, the ID changes. To re-export the public key for the
manifest:

```sh
openssl pkey -in key.pem -pubout -outform DER | openssl base64 -A
```

and update the `manifest.key` value in `wxt.config.ts`. To view the ID the current key
would produce:

```sh
node -e "const c=require('crypto');const k=require('fs').readFileSync('.output/chrome-mv3/manifest.json','utf8');const m=JSON.parse(k);if(!m.key){console.log('no key');process.exit(0)}const h=c.createHash('sha256').update(Buffer.from(m.key,'base64')).digest().subarray(0,16);let id='';for(const b of h)id+=String.fromCharCode(97+(b>>4))+String.fromCharCode(97+(b&15));console.log(id)"
```

### Safari

Safari extension requires macOS environment and Xcode for building and publishing.

#### Build Steps

1. Update `developmentTeam` in `wxt.config.ts` with your Apple Developer Team ID
2. Run `pnpm build:safari` - this will automatically build and open Xcode
3. Build the project in Xcode and test in Safari
4. To publish: In Xcode, select **Product → Archive** to submit to the App Store

## Requirements

- Node.js (latest LTS recommended)
- pnpm package manager
- macOS with Xcode (for Safari development only)
