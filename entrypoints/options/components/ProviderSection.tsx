import { useEffect, useState } from 'react'
import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { browser } from 'wxt/browser'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { IMP_CONNECT_URL } from '@/lib/imp'
import { messager } from '@/lib/message'
import type { ByokProvider, ProviderSettings, Settings } from '@/lib/settings'

export function ProviderSection({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}) {
  const provider = settings.provider
  const connected = provider.mode === 'imp' && !!provider.imp

  const [byokOpen, setByokOpen] = useState(
    () => provider.mode === 'byok' && !!provider.byok.apiKey,
  )

  const [baseUrlDraft, setBaseUrlDraft] = useState(provider.byok.baseUrl)
  const [modelDraft, setModelDraft] = useState(provider.byok.model)
  const [apiKeyDraft, setApiKeyDraft] = useState(provider.byok.apiKey)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [testing, setTesting] = useState(false)

  // Auto-verify the stored Imp key when the options page opens (and whenever
  // the key changes), so the "Connected" badge reflects whether the key is
  // still valid rather than just "we have a stored key". Never calls the
  // model — see background.ts's checkConnection handler.
  const [connStatus, setConnStatus] = useState<'idle' | 'checking' | 'connected' | 'disconnected' | 'unknown'>('idle')
  useEffect(() => {
    if (!connected) {
      setConnStatus('idle')
      return
    }
    let cancelled = false
    setConnStatus('checking')
    void (async () => {
      let next: 'connected' | 'disconnected' | 'unknown'
      try {
        const result = await messager.sendMessage('checkConnection')
        next = result.ok ? 'connected' : 'disconnected'
      } catch {
        next = 'unknown'
      }
      if (!cancelled) setConnStatus(next)
    })()
    return () => {
      cancelled = true
    }
  }, [connected, provider.imp?.apiKey])

  // Re-sync drafts whenever the committed value changes from elsewhere
  // (another edit, a storage.onChanged event, etc). This never fires while
  // the user is mid-keystroke since we only persist on blur.
  useEffect(() => {
    setBaseUrlDraft(provider.byok.baseUrl)
  }, [provider.byok.baseUrl])
  useEffect(() => {
    setModelDraft(provider.byok.model)
  }, [provider.byok.model])
  useEffect(() => {
    setApiKeyDraft(provider.byok.apiKey)
  }, [provider.byok.apiKey])

  function updateProvider(patch: Partial<ProviderSettings>) {
    update({ provider: { ...provider, ...patch } })
  }

  function updateByok(patch: Partial<ByokProvider>) {
    updateProvider({ mode: 'byok', byok: { ...provider.byok, ...patch } })
  }

  function connect() {
    browser.tabs.create({ url: IMP_CONNECT_URL })
  }

  function useByokInstead() {
    updateProvider({ mode: 'byok' })
    setByokOpen(true)
  }

  async function testConnection() {
    setTesting(true)
    try {
      const result = await messager.sendMessage('testConnection', undefined)
      if (result.ok) {
        toast.success('Connection successful.')
      } else {
        toast.error(result.error)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  const connInfo = {
    idle: { dot: 'bg-muted', label: 'Not connected' },
    checking: { dot: 'bg-muted animate-pulse', label: 'Checking connection…' },
    connected: { dot: 'bg-green-500', label: `Connected · ${provider.imp?.model ?? 'imp'}` },
    disconnected: { dot: 'bg-red-500', label: 'Connection lost — reconnect' },
    unknown: { dot: 'bg-amber-500', label: "Couldn't verify connection" },
  }[connStatus]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider</CardTitle>
        <CardDescription>
          Connect a hosted Imp account, or bring your own OpenAI-compatible
          API key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className={cn('size-2 shrink-0 rounded-full', connInfo.dot)} />
              <span className="truncate">{connInfo.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={useByokInstead}>
                Use your own API key instead
              </Button>
              <Button variant="secondary" onClick={connect}>
                Reconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Button className="w-full" onClick={connect}>
              Connect Imp Account
            </Button>
            {provider.imp && (
              <Button
                variant="ghost"
                className="h-auto min-h-9 w-full whitespace-normal"
                onClick={() => updateProvider({ mode: 'imp' })}
              >
                {`Switch back to connected Imp account (${provider.imp.model})`}
              </Button>
            )}
          </div>
        )}

        <Collapsible open={byokOpen} onOpenChange={setByokOpen}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-between px-2"
            >
              <span>Bring your own API key (advanced)</span>
              <ChevronDown
                className={cn(
                  'size-4 transition-transform',
                  byokOpen && 'rotate-180',
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="byok-base-url">Base URL</Label>
              <Input
                id="byok-base-url"
                value={baseUrlDraft}
                onChange={(e) => setBaseUrlDraft(e.target.value)}
                onBlur={() => {
                  const trimmed = baseUrlDraft.trim()
                  setBaseUrlDraft(trimmed)
                  if (trimmed !== provider.byok.baseUrl) {
                    updateByok({ baseUrl: trimmed })
                  }
                }}
                placeholder="https://api.openai.com/v1"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="byok-model">Model</Label>
              <Input
                id="byok-model"
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onBlur={() => {
                  const trimmed = modelDraft.trim()
                  setModelDraft(trimmed)
                  if (trimmed !== provider.byok.model) {
                    updateByok({ model: trimmed })
                  }
                }}
                placeholder="gpt-5-mini"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="byok-api-key">API Key</Label>
              <div className="relative">
                <Input
                  id="byok-api-key"
                  type={apiKeyVisible ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  onBlur={() => {
                    const trimmed = apiKeyDraft.trim()
                    setApiKeyDraft(trimmed)
                    if (trimmed !== provider.byok.apiKey) {
                      updateByok({ apiKey: trimmed })
                    }
                  }}
                  placeholder="sk-..."
                  className="pr-9 font-mono text-base md:text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-1/2 right-1.5 -translate-y-1/2"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setApiKeyVisible((v) => !v)}
                  aria-label={apiKeyVisible ? 'Hide API key' : 'Show API key'}
                >
                  {apiKeyVisible ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={testConnection}
                disabled={testing}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
