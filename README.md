# Imp Write

A browser extension that fixes and rewrites text in any textbox, without leaving the page.

## Usage

### Triggering a command

**All platforms**

- Type a command at the end of your text — e.g. `/fix`, `/improve`, `/shorten`, `/tl`
  (translate to English), or any custom command you've defined — then pause briefly; it
  runs automatically. Command names can be renamed from the options page.

**Desktop**

- Keyboard shortcuts — assign one to any command from the options page (VSCode-style:
  click the field, then press the combo)
- Right-click inside any textbox for an "Imp Write" context menu listing every command
- Click the toolbar icon to open the options page

**Mobile (Firefox for Android, Safari on iOS)**

- Tap space three times at the end of your text to bring up the command menu, then tap a
  command (a few extra taps won't hurt)
- Tap the extension icon to bring up the same command menu
- The gear item in the command menu opens the options page
- Commands in the menu are sorted by most recently used

Whichever trigger you use, if you have text selected only the selection is rewritten;
otherwise the whole field is. The AI response replaces the input's content in place. Press
Esc right after to undo the replacement — or use your browser/OS's own undo (Cmd/Ctrl+Z);
either way, undoing won't cause the replacement to fire again. Known limitation: if you
switch away to another tab while a request is still in flight, the write-back can
occasionally land as an append after the original text instead of a clean replace — Esc
still reverts the whole field either way.

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

### Safari

Safari extension requires macOS environment and Xcode for building and publishing.

#### Build Steps

1. Update `developmentTeam` in `wxt.config.ts` with your Apple Developer Team ID
2. Run `pnpm build:safari` - this will automatically build the Xcode project
   (then open it in Xcode manually to test)
3. Build the project in Xcode and test in Safari
4. To publish: In Xcode, select **Product → Archive** to submit to the App Store

## Requirements

- Node.js (latest LTS recommended)
- pnpm package manager
- macOS with Xcode (for Safari development only)
