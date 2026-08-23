import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { eventToShortcut, formatShortcutForDisplay } from '@/lib/shortcut'

/**
 * VSCode-style "click, then press the keys" shortcut recorder. Read-only —
 * never accepts typed text, only a recorded key combo via `eventToShortcut`.
 */
export function ShortcutInput({
  value,
  onChange,
  checkConflict,
  className,
}: {
  /** The currently bound shortcut spec (e.g. `Ctrl+Alt+F`), or unset. */
  value: string | undefined
  onChange: (value: string | undefined) => void
  /**
   * Called with a freshly-recorded spec before it's accepted. Return the
   * name of the command that already owns it to reject the recording (a
   * toast is shown), or `null`/`undefined` if it's free to take.
   */
  checkConflict?: (spec: string) => string | null | undefined
  className?: string
}) {
  const [recording, setRecording] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function stopRecording() {
    setRecording(false)
    inputRef.current?.blur()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!recording) return
    if (e.key === 'Escape') {
      e.preventDefault()
      stopRecording()
      return
    }
    // Swallow every other keydown while recording — this both stops the
    // combo from also reaching the page (e.g. a browser shortcut) and stops
    // stray keystrokes from doing anything besides being recorded.
    e.preventDefault()
    e.stopPropagation()

    const spec = eventToShortcut(e)
    if (!spec) return // not a usable combo yet (bare key, mid-chord, Shift-only, ...)

    const conflictingCommand = checkConflict?.(spec)
    if (conflictingCommand) {
      toast.error(`"${spec}" is already used by "?${conflictingCommand}"`)
      stopRecording()
      return
    }

    onChange(spec)
    stopRecording()
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        ref={inputRef}
        readOnly
        value={recording ? '' : value ? formatShortcutForDisplay(value) : ''}
        placeholder={recording ? 'Press keys…' : value ? '' : 'Click to record'}
        onFocus={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={handleKeyDown}
        className={cn('cursor-pointer', value && 'pr-7')}
      />
      {value && !recording && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(undefined)}
          aria-label="Clear shortcut"
        >
          <X />
        </Button>
      )}
    </div>
  )
}
