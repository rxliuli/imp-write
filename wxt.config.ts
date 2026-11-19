import { defineConfig } from 'wxt'
import type { UserManifest } from 'wxt'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@extport/wxt'],
  extport: {
    extension: 'ext_mL6uUg0M36wJpyHuHYNg',
    // Daily anonymous usage ping + the Firefox data-collection declaration,
    // injected by @extport/wxt. Opt-in; fill the store data-disclosure forms
    // before shipping it: https://github.com/rxliuli/extport/blob/main/docs/analytics-design.md
    analytics: true,
    // Publishing to Safari? Uncomment and fill in your own values —
    // extport.config.json is generated from these at `wxt prepare`.
    safari: {
      appCategory: 'public.app-category.productivity',
      bundleIdentifier: 'com.rxliuli.imp-write',
      developmentTeam: 'N2X78TUUFG',
      issuerId: '48f39427-c063-4e33-98d2-31de80aad0be',
      keyId: '8N27UWG9RG',
      // Keep Xcode closed after conversion: opening it on a headless
      // macOS CI runner can fail (non-zero exit) and break the safari job.
      openProject: false,
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      tsconfigPaths: true,
    },
  }),
  manifestVersion: 3,
  manifest: (env) => {
    const manifest: UserManifest = {
      name: 'Imp Write: AI Fix & Rewrite in Any Textbox',
      description:
        'Fix grammar & rewrite text in any textbox with /fix, /improve, /shorten commands. Press Esc to undo. Use BYOK or Imp Credits.',
      permissions: ['storage', 'contextMenus'],
      host_permissions: ['<all_urls>'],
      author: {
        email: 'rxliuli@gmail.com',
      },
      action: {
        default_icon: {
          '16': 'icon/16.png',
          '32': 'icon/32.png',
          '48': 'icon/48.png',
          '96': 'icon/96.png',
          '128': 'icon/128.png',
        },
      },
      homepage_url: 'https://store.rxliuli.com/extensions/imp-write/',
    }

    if (env.browser === 'firefox') {
      manifest.browser_specific_settings = {
        gecko: {
          id: 'imp-write@rxliuli.com',
          data_collection_permissions: {
            required: ['none'],
          },
        },
        // Empty = compatible with Firefox for Android at AMO's default
        // minimum — compatibility is a property of the build, not a
        // submission-time checkbox.
        gecko_android: {},
      }
      // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/author
      // @ts-expect-error
      manifest.author = 'rxliuli'
    }
    if (env.browser === 'safari') {
      manifest.name = 'Imp Write'
      manifest.description =
        'Fix grammar & rewrite text in any textbox with /fix, /improve, /shorten. Press Esc to undo. BYOK or Imp.'
    }
    return manifest
  },
  webExt: {
    disabled: true,
  },
})
