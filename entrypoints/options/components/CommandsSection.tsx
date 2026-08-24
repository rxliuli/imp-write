import { useRef, useState } from 'react'
import { ChevronDown, Download, RotateCcw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ShortcutInput } from '@/components/extra/ShortcutInput'
import { BUILTIN_COMMANDS, TRIGGER_PREFIX } from '@/lib/commands'
import {
  mergeImportedCommands,
  parseCommandsFile,
  serializeCommands,
} from '@/lib/commandsTransfer'
import { saveBlob } from '@/lib/saveFile'
import type { Command, Settings } from '@/lib/settings'

// YYYY-MM-DD for today, used in the exported file's name.
function todayDateString(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

type FormTarget = 'new' | number

function validateCommand(
  name: string,
  prompt: string,
  existingCommands: Command[],
  excludeIndex: FormTarget,
): string | null {
  const trimmedName = name.trim()
  if (!trimmedName) return 'Name is required.'
  if (/\s/.test(trimmedName)) return 'Name cannot contain whitespace.'
  if (!prompt.trim()) return 'Prompt is required.'

  const lower = trimmedName.toLowerCase()
  // There's no separate "built-in" table any more — every command lives in
  // `settings.commands`, so a plain duplicate-within-the-list check is all
  // that's needed to keep names unique.
  const duplicate = existingCommands.some(
    (c, i) => i !== excludeIndex && c.name.toLowerCase() === lower,
  )
  if (duplicate) return `A command named "${trimmedName}" already exists.`

  return null
}

function CommandFormFields({
  name,
  prompt,
  onNameChange,
  onPromptChange,
  error,
  onSave,
  onCancel,
}: {
  name: string
  prompt: string
  onNameChange: (v: string) => void
  onPromptChange: (v: string) => void
  error: string | null
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. concise"
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <Label>Prompt</Label>
        <Textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder={'Rewrite the text below to be more concise.\n\n{{text}}'}
          // Keep the prompt textarea at >=16px on touch (mobile) so iOS
          // Safari doesn't auto-zoom the page on focus; the smaller mono
          // size is reserved for desktop where that zoom doesn't apply.
          className="min-h-40 font-mono text-base md:text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Use <code className="rounded bg-muted px-1">{'{{text}}'}</code>{' '}
          where the input text should go; if omitted, the text is appended
          after the prompt.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function CommandsSection({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}) {
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftPrompt, setDraftPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  // Snapshot of the draft's values as of the moment the dialog was opened —
  // compared against the live draft to decide whether an outside click/Esc
  // should be treated as an accidental dismiss (dirty) or a no-op close
  // (clean). Kept in a ref (not state) since it's only ever read, never
  // rendered.
  const initialDraftRef = useRef({ name: '', prompt: '' })

  function openNew() {
    setFormTarget('new')
    setDraftName('')
    setDraftPrompt('')
    setError(null)
    initialDraftRef.current = { name: '', prompt: '' }
  }

  function openEdit(index: number) {
    const cmd = settings.commands[index]
    // An index can be stale if the command was removed between render and
    // click — treat a missing one as a no-op rather than crashing.
    if (!cmd) return
    setFormTarget(index)
    setDraftName(cmd.name)
    setDraftPrompt(cmd.prompt)
    setError(null)
    initialDraftRef.current = { name: cmd.name, prompt: cmd.prompt }
  }

  function closeForm() {
    setFormTarget(null)
    setError(null)
  }

  // True once the user has actually typed something different from what the
  // dialog opened with — used to gate accidental-dismiss paths (overlay
  // click / Esc) below, without blocking the explicit Cancel button.
  const isDraftDirty =
    draftName !== initialDraftRef.current.name ||
    draftPrompt !== initialDraftRef.current.prompt

  // Radix calls this for every close request (overlay click, Esc, Cancel's
  // onOpenChange-less direct closeForm() call bypasses this entirely). When
  // the dialog is asked to close and the draft is clean, treat it exactly
  // like Cancel; when dirty, the onEscapeKeyDown/onInteractOutside guards
  // below already prevented the request from reaching here.
  function handleDialogOpenChange(open: boolean) {
    if (!open) closeForm()
  }

  function saveDraft() {
    if (formTarget === null) return
    const err = validateCommand(
      draftName,
      draftPrompt,
      settings.commands,
      formTarget,
    )
    if (err) {
      setError(err)
      return
    }
    const entry: Command = { name: draftName.trim(), prompt: draftPrompt.trim() }
    const next = [...settings.commands]
    let nextShortcuts = settings.shortcuts
    if (formTarget === 'new') {
      next.push(entry)
    } else {
      const existing = settings.commands[formTarget]
      if (!existing) return
      const oldName = existing.name
      next[formTarget] = entry
      // Renaming a custom command: migrate its shortcut binding (keyed by
      // name) to the new name instead of silently dropping it.
      if (oldName !== entry.name && oldName in settings.shortcuts) {
        nextShortcuts = { ...settings.shortcuts }
        const bound = nextShortcuts[oldName]
        if (bound !== undefined) {
          nextShortcuts[entry.name] = bound
        }
        delete nextShortcuts[oldName]
      }
    }
    update({ commands: next, shortcuts: nextShortcuts })
    closeForm()
  }

  function removeCommand(index: number) {
    const removed = settings.commands[index]
    if (!removed) return
    const nextShortcuts = { ...settings.shortcuts }
    delete nextShortcuts[removed.name]
    update({
      commands: settings.commands.filter((_, i) => i !== index),
      shortcuts: nextShortcuts,
    })
    if (formTarget === index) closeForm()
  }

  function setShortcut(commandName: string, spec: string | undefined) {
    const nextShortcuts = { ...settings.shortcuts }
    if (spec) {
      nextShortcuts[commandName] = spec
    } else {
      delete nextShortcuts[commandName]
    }
    update({ shortcuts: nextShortcuts })
  }

  function checkShortcutConflict(
    commandName: string,
    spec: string,
  ): string | null {
    const conflict = Object.entries(settings.shortcuts).find(
      ([name, s]) => s === spec && name !== commandName,
    )
    return conflict ? conflict[0] : null
  }

  // Restores any `BUILTIN_COMMANDS` entries missing from `settings.commands`
  // (by name, case-insensitive) — never overwrites or duplicates one the
  // user already has, whether it's untouched, edited, or renamed-and-kept.
  function restoreDefaults() {
    const existingNames = new Set(
      settings.commands.map((c) => c.name.toLowerCase()),
    )
    const missing = BUILTIN_COMMANDS.filter(
      (c) => !existingNames.has(c.name.toLowerCase()),
    )
    if (missing.length === 0) {
      toast.info('All default commands are already present.')
      return
    }
    update({ commands: [...settings.commands, ...missing] })
    toast.success(
      `Restored ${missing.length} default command${missing.length === 1 ? '' : 's'}.`,
    )
  }

  // Export scope is deliberately narrow: only settings.commands (name +
  // prompt), never provider/apiKey/imp credentials/shortcuts. See
  // lib/commandsTransfer.ts's serializeCommands.
  function exportCommands() {
    const json = serializeCommands(settings.commands)
    const blob = new Blob([json], { type: 'application/json' })
    void saveBlob(blob, `imp-write-commands-${todayDateString()}.json`, {
      title: 'Imp Write commands',
    }).then((result) => {
      if (!result.ok) {
        toast.error('Failed to export commands.')
      }
    })
  }

  function openImportDialog() {
    importInputRef.current?.click()
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset so re-selecting the exact same file still fires a "change" next
    // time (the input's value staying the same would otherwise suppress it).
    e.target.value = ''
    if (!file) return

    const text = await file.text()
    const parsed = parseCommandsFile(text)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }

    const result = mergeImportedCommands(settings.commands, parsed.commands)
    if (result.added > 0) {
      update({ commands: result.merged })
    }
    toast.success(
      `Imported ${result.added} command${result.added === 1 ? '' : 's'} ` +
        `(skipped ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? '' : 's'}, ` +
        `${result.skippedInvalid} invalid).`,
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commands</CardTitle>
        <CardDescription>
          End your text with a command's trigger, then pause for a moment to
          run it. Esc undoes the replacement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Commands
            </h3>
            <div className="flex gap-2">
              <ButtonGroup>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openNew}
                  aria-label="Add command"
                  title="Add command"
                >
                  Add command
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="More command actions"
                      title="More command actions"
                    >
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={restoreDefaults}>
                      <RotateCcw />
                      Restore default commands
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={exportCommands}>
                      <Download />
                      Export commands…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={openImportDialog}>
                      <Upload />
                      Import commands…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
          </div>

          {settings.commands.length === 0 && (
            <p className="text-sm text-muted-foreground">No commands yet.</p>
          )}

          <ul className="space-y-2">
            {settings.commands.map((cmd, index) => (
              <li key={index} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm">
                      {TRIGGER_PREFIX}
                      {cmd.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {cmd.prompt}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ShortcutInput
                      className="hidden sm:block sm:w-36"
                      value={settings.shortcuts[cmd.name]}
                      onChange={(spec) => setShortcut(cmd.name, spec)}
                      checkConflict={(spec) =>
                        checkShortcutConflict(cmd.name, spec)
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(index)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCommand(index)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>

      <Dialog open={formTarget !== null} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => {
            if (isDraftDirty) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (isDraftDirty) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {formTarget === 'new' ? 'Add command' : 'Edit command'}
            </DialogTitle>
            <DialogDescription>
              {formTarget === 'new'
                ? 'Create a new command trigger and its prompt.'
                : "Update this command's trigger name or prompt."}
            </DialogDescription>
          </DialogHeader>
          <CommandFormFields
            name={draftName}
            prompt={draftPrompt}
            onNameChange={setDraftName}
            onPromptChange={setDraftPrompt}
            error={error}
            onSave={saveDraft}
            onCancel={closeForm}
          />
        </DialogContent>
      </Dialog>
    </Card>
  )
}
