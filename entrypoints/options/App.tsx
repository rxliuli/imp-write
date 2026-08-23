import { useCallback, useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { FaDiscord } from 'react-icons/fa'
import { browser } from 'wxt/browser'
import { ShadowProvider } from '@/integrations/shadow/ShadowProvider'
import { ThemeProvider } from '@/integrations/theme/ThemeProvider'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import {
  getSettings,
  mergeSettings,
  saveSettings,
  type Settings,
} from '@/lib/settings'
import { ProviderSection } from './components/ProviderSection'
import { CommandsSection } from './components/CommandsSection'

// Loads settings once, then keeps them fresh: the connect flow finishes in a
// different tab and writes `settings` directly to storage, so this page has
// to pick that up via storage.onChanged rather than only reading on mount.
function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    getSettings().then(setSettings)

    const listener = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes.settings) return
      setSettings(mergeSettings(changes.settings.newValue as Partial<Settings>))
    }
    browser.storage.onChanged.addListener(listener)
    return () => browser.storage.onChanged.removeListener(listener)
  }, [])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
    saveSettings(patch)
  }, [])

  return { settings, update }
}

export function App(props: { container: HTMLElement }) {
  const { settings, update } = useSettings()

  return (
    <ShadowProvider container={props.container}>
      <ThemeProvider>
        <Toaster richColors closeButton />
        <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
          <header className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold">Imp Write</h1>
              <a
                href="https://store.rxliuli.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Explore our other extensions
              </a>
            </div>
            <a
              href="https://discord.gg/gFhKUthc88"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="secondary" className="px-2 sm:px-4">
                <FaDiscord className="h-4 w-4 text-indigo-500" />
                <span className="hidden sm:inline">Join Discord</span>
              </Button>
            </a>
          </header>

          {settings ? (
            <div className="space-y-6">
              <ProviderSection settings={settings} update={update} />
              <CommandsSection settings={settings} update={update} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          )}
        </div>
      </ThemeProvider>
    </ShadowProvider>
  )
}
