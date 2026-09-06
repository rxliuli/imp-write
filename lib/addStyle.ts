/**
 * Applies CSS to a shadow root, or to the document, using constructable
 * stylesheets (`CSSStyleSheet` + `adoptedStyleSheets`) when the engine
 * supports them.
 *
 * Why: a content script that injects a `<style>` element into the page is
 * subject, in some browsers, to the host page's Content-Security-Policy
 * `style-src` directive. On strict-CSP sites (e.g. addons.mozilla.org,
 * which sends `style-src ...` without `'unsafe-inline'`), Safari refuses
 * the inline `<style>` — the console reports "Refused to apply a stylesheet
 * because its hash, its nonce, or 'unsafe-inline' does not appear in the
 * style-src directive of the Content Security Policy." — so the injected
 * UI renders unstyled. A constructable stylesheet lives in the CSSOM, not
 * in inline markup, so it is NOT subject to that CSP restriction. (This is
 * also why the bug is Safari-specific: Chrome isolates content scripts from
 * the page CSP, Safari does not.)
 *
 * Falls back to a real `<style>` element for engines that predate
 * `adoptedStyleSheets`, where the injected-`<style>`-under-page-CSP issue
 * simply doesn't apply the same way.
 */

/** True when the engine supports constructable stylesheets + `adoptedStyleSheets` on `target`. */
function canAdopt(target: Document | ShadowRoot): boolean {
  return (
    typeof CSSStyleSheet !== 'undefined' &&
    typeof CSSStyleSheet.prototype.replaceSync === 'function' &&
    'adoptedStyleSheets' in target
  )
}

/**
 * Applies `css` to `shadow`. The shadow root is freshly created per UI
 * instance (e.g. one `CommandMenu` host per show/destroy cycle), so no
 * deduplication is needed — each call attaches its own sheet. The sheet (and
 * its CSS) is discarded automatically when the shadow root is garbage
 * collected, so there's nothing for the caller to clean up.
 */
export function applyShadowStyle(shadow: ShadowRoot, css: string): void {
  if (!canAdopt(shadow)) {
    const style = document.createElement('style')
    style.textContent = css
    shadow.appendChild(style)
    return
  }
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  shadow.adoptedStyleSheets = [sheet]
}

// Module-level registry of document-level sheets, keyed by the stable `id`
// each caller passes in. Preserves the "add exactly once, remove when gone"
// contract the previous `if (document.getElementById(id)) return` guard gave
// us, but for the adopted-Sheet path (where there's no element to look up).
const documentSheets = new Map<string, CSSStyleSheet>()

/**
 * Applies `css` to the document exactly once for a given `id`. Idempotent:
 * a second call with the same `id` is a no-op. `removeDocumentStyle` peels
 * it back off.
 */
export function addDocumentStyle(id: string, css: string): void {
  if (!canAdopt(document)) {
    // Fallback path. Mirrors the old `<style id>` dedup via getElementById.
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = css
    document.head.appendChild(style)
    return
  }
  if (documentSheets.has(id)) return
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  documentSheets.set(id, sheet)
}

/** Removes a document-level sheet previously registered by `addDocumentStyle`. Safe to call when none is registered. */
export function removeDocumentStyle(id: string): void {
  if (documentSheets.has(id)) {
    const sheet = documentSheets.get(id)!
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet)
    documentSheets.delete(id)
    return
  }
  document.getElementById(id)?.remove()
}
