import { defineConfig, UserManifest } from 'wxt'
import tailwindcss from '@tailwindcss/vite'
import isCI from 'is-ci'

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
    // safari: {
    //   appCategory: 'public.app-category.productivity',
    //   bundleIdentifier: 'com.example.your-extension',
    //   developmentTeam: 'YOUR_TEAM_ID',
    // },
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
      name: 'Imp Write',
      description:
        'AI fix & rewrite in any textbox — type /fix at the end and pause',
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
      homepage_url: 'https://rxliuli.com/project/imp-write',
    }

    // 仅本地/手动打包时固定扩展 ID；CI 上架到 CWS 时去掉 key。
    // key 是 DER 公钥的 base64，用 key.pem 导出：
    //   openssl pkey -in key.pem -pubout -outform DER | openssl base64 -A
    if (!isCI) {
      manifest.key =
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzGkXYEKdUbzyte/Hj72rDKfmYAssmdUg0nA9ztv9LUkG5426TSkX2u4oHADCWCiNS0h/w1gXzSYC59GIeHFygoKHyW0+x3uGB1BxAUryrnS2A+fDosf6FQIc/aGJYDx7+wTih0QUBUcBtW6KKoobp9+RCI1w1KJa86eXYGF9qceihZfMPYqCeAtHk46gBMN8jicsiFW+dzU6HUPwgefrqIJ39Kw5b7I/OOX+m+By7gXhWDsOBzZIEK6IN8KtDjvn6dgy5YM3SxOxlFlbOaLsSRVeJGF5xbH/PDvemm2yhwq9v3HCKr3Pp89mkEl5eiVk35Us+8Gno0JNoaSK2K0tGwIDAQAB'
    }

    if (env.browser === 'firefox') {
      manifest.browser_specific_settings = {
        gecko: {
          id:
            manifest.name!.toLowerCase().replaceAll(/[^a-z0-9]/g, '-') +
            '@rxliuli.com',
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
    return manifest
  },
  webExt: {
    disabled: true,
  },
})
