import { defineExtensionMessaging } from '@webext-core/messaging'

export interface RunCommandInput {
  prompt: string // the selected command's template, {{text}} not yet substituted
  text: string
}

export type RunCommandResult =
  | { ok: true; text: string }
  | { ok: false; error: string }

interface ProtocolMap {
  // content => background
  runCommand(input: RunCommandInput): Promise<RunCommandResult>

  // connect content script => background
  impConnect(code: string): Promise<{ ok: boolean; error?: string }>

  // background => content: the user picked a command from the right-click
  // (contextMenus) menu; content resolves it against the most recent
  // contextmenu target it saw.
  menuCommand(commandName: string): void

  // options page (the "Test connection" button) => background: exercises
  // whatever provider config is currently saved, without touching any input
  // box's content.
  testConnection(): Promise<{ ok: true } | { ok: false; error: string }>

  // background => content: the user tapped the toolbar action icon on a
  // mobile browser (there's no popup UI there — see background.ts's
  // `action.onClicked`). Sent to every frame of the active tab (no
  // `frameId`, so it broadcasts); each frame independently decides whether
  // it has a fresh enough focus target to show its floating command menu
  // for — see `lib/commandMenu.ts`.
  showCommandMenu(): void

  // content => background: the floating command menu's "Settings" entry.
  // `browser.runtime.openOptionsPage()` isn't callable from a content
  // script's context, so route the request through background instead.
  openOptionsPage(): void
}

export const messager = defineExtensionMessaging<ProtocolMap>()
