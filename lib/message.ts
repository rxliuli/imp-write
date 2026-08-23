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
}

export const messager = defineExtensionMessaging<ProtocolMap>()
