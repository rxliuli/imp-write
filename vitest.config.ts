import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { BrowserCommands } from 'vitest/internal/browser'
import { BrowserCommandContext } from 'vitest/node'

type CustomCommand<K extends keyof BrowserCommands> = (
  context: BrowserCommandContext,
  ...args: Parameters<BrowserCommands[K]>
) => Promise<Awaited<ReturnType<BrowserCommands[K]>>>

const undo: CustomCommand<'undo'> = async (ctx) => {
  await ctx.page.keyboard.press('ControlOrMeta+Z')
}

const keydown: CustomCommand<'keydown'> = async (ctx, key) => {
  await ctx.page.keyboard.down(key)
}

const keyup: CustomCommand<'keyup'> = async (ctx, key) => {
  await ctx.page.keyboard.up(key)
}

const keypress: CustomCommand<'keypress'> = async (ctx, key) => {
  await ctx.page.keyboard.press(key)
}

declare module 'vitest/internal/browser' {
  interface BrowserCommands {
    undo: () => Promise<void>

    keydown: (key: string) => Promise<void>
    keyup: (key: string) => Promise<void>
    keypress: (key: string) => Promise<void>
  }
}

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          exclude: ['**/*.unit.test.ts', 'node_modules/**', 'e2e/**'],
          browser: {
            provider: playwright(),
            enabled: true,
            // https://vitest.dev/guide/browser/playwright
            instances: [{ browser: 'chromium', headless: true }],
            commands: {
              undo,
              keydown,
              keyup,
              keypress,
            },
          },
        },
      },
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          include: ['**/*.unit.test.ts'],
          exclude: ['*.test.ts', 'node_modules/**', 'e2e/**'],
        },
      },
    ],
  },
})
