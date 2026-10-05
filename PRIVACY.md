# Privacy Policy for Imp Write

> Last updated: 2026-10-05

## What This Extension Does

Imp Write fixes and rewrites text inside text boxes on websites you visit. When you trigger a command (by typing one like `/fix` and pausing, a keyboard shortcut, or the right-click menu), the text currently in that box is sent to an AI service to be rewritten, and the result replaces it in place.

## Data Collection

Imp Write sends **only the text you explicitly ask it to rewrite** — the content of the focused input, text area, or editable region at the moment you trigger a command. The rest of the page is never collected or transmitted, and nothing is sent while you are simply typing or browsing.

All extension settings — your commands, shortcuts, provider configuration, and any API key you enter — are stored **locally in your browser** and never leave your device.

## Third-Party AI Services

To rewrite your text, the extension sends it directly from your browser to the AI service selected in your settings. Depending on your configuration, that is one of:

- **Your own OpenAI-compatible API** (BYOK, the default) — the endpoint and API key you configure, for example OpenAI, DeepSeek, or Google Gemini's OpenAI-compatible endpoint. The text is sent directly from your browser to that provider; it does not pass through or get stored on our infrastructure. Their handling of it is governed by their own privacy policy.
- **Imp Credits** (optional, hosted) — our own metered service at **imp.rxliuli.com**, running on Cloudflare. The text you rewrite is sent there, and from there to the third-party large-language-model provider that produces the result. It is used only to serve that request and meter your usage. Imp Credits stores a record of each request for billing and auditing (model, token counts, cost, duration, timestamp) but **not** the text you sent or the result returned; the per-connection API key created when you connect your Imp account is also stored, to authorize and meter your requests.

Imp Credits is not available on Apple platforms (Safari, iOS, macOS): those builds are BYOK-only and never contact `imp.rxliuli.com`.

Only the text you trigger a command on is ever sent. Imp Write does not transmit page content, URLs, browsing history, or anything else.

## Anonymous Usage Statistics

The extension sends **at most one anonymous ping per day** to our own infrastructure (extport, running on Cloudflare) so we can see how many installs are active and which versions are in use. Each ping contains exactly:

- a random install identifier (generated locally, not linked to you or your account on any service)
- the extension version
- your browser's UI language (e.g. `en-US`)

From the network request itself our server derives the browser, operating system, and country (the IP address is used only for the country lookup and is **not stored**). Raw pings are deleted after 90 days; only aggregate daily counts are kept. No browsing data, page content, or behavioral data is ever collected. This ping contains no personal information and is unrelated to the text you rewrite.

## Data Storage

Extension settings and configurations (including API keys) are stored **locally in your browser** using the browser storage API. We keep no copy of the text you rewrite: neither the extension nor the Imp Credits service stores it. What Imp Credits retains is billing metadata only — model, token counts, cost, duration, and timestamp — plus the per-connection API key. You can clear all locally stored data at any time by uninstalling the extension or clearing its storage through your browser settings.

## Data Sharing

We do **not** sell, trade, rent, or share user data with third parties. The only parties that ever receive anything, and only what is described above, are:

- **your configured AI provider** (BYOK), which receives the text you asked to rewrite
- **the third-party LLM provider** that generates the result when Imp Credits is used
- **Cloudflare**, which hosts `imp.rxliuli.com` and the extport statistics service, and receives the anonymous daily ping

We use no advertising networks, no third-party analytics, and no data brokers.

## User Choices

- **Bring your own key** — configure your own OpenAI-compatible endpoint and never contact the Imp Credits service (the anonymous daily ping described above is unaffected).
- **Disable or uninstall** the extension at any time through your browser's settings.
- **Manage permissions** through your browser's extension settings.
- **Clear data** — remove all locally stored settings or API keys by uninstalling the extension or clearing its storage.

## Open Source

This extension is fully open source. You can review the complete source code at https://github.com/rxliuli/imp-write.

## Contact

If you have questions about this privacy policy, contact us at: rxliuli@gmail.com
