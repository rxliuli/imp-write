import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { test, expect } from './fixtures'

// Regression: the options page overflowed horizontally on narrow (mobile)
// viewports. Fix: the Commands section header is now a single split button
// (see components/ui/button-group.tsx) — an "Add command" button bonded to a
// narrow chevron trigger (housing Restore/Export/Import — see below) that's
// icon-only with an aria-label at every width. With only one control in the
// header, "Add command" no longer needs to collapse to icon-only on mobile;
// its label stays visible at every viewport width. The per-command
// ShortcutInput recorder — a keyboard-only affordance that's not useful on
// mobile — is hidden entirely below `sm`. Both the header row and each
// command row stay single-line at every viewport width. See
// entrypoints/options/components/CommandsSection.tsx.
test.describe('options page - narrow viewport layout', () => {
  test('labeled split button, hidden ShortcutInput, no overflow at 375px', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(`chrome-extension://${extensionId}/options.html`)

    // Reachable by accessible name via aria-label/visible text at every
    // width — no icon-only collapse any more.
    const addCommandButton = page.getByRole('button', { name: 'Add command' })
    await expect(addCommandButton).toBeVisible()
    const moreButton = page.getByRole('button', {
      name: 'More command actions',
    })
    await expect(moreButton).toBeVisible()

    // The "Add command" label stays visible even at this narrow width.
    await expect(addCommandButton).toHaveText('Add command')

    // No horizontal scroll anywhere on the page.
    const hasNoHorizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    )
    expect(hasNoHorizontalOverflow).toBe(true)

    // "Add command" must be fully visible within the viewport width.
    const addBox = await addCommandButton.boundingBox()
    expect(addBox).not.toBeNull()
    expect(addBox!.x).toBeGreaterThanOrEqual(0)
    expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(375)

    // The ShortcutInput recorder is a keyboard-only affordance and is fully
    // hidden below `sm` — not just squeezed offscreen.
    const shortcutInput = page.getByPlaceholder('Click to record').first()
    await expect(shortcutInput).toBeHidden()

    // The command row (name block + Edit + Delete) stays on a single line —
    // the flex row centers the (two-line) name block vertically against the
    // buttons, so the Edit button's center should fall within the name
    // block's vertical span rather than wrapping onto its own line below.
    const commandName = page.getByText('/fix', { exact: true })
    await expect(commandName).toBeVisible()
    const editButton = page.getByRole('button', { name: 'Edit' }).first()
    const [nameBox, editBox] = await Promise.all([
      commandName.boundingBox(),
      editButton.boundingBox(),
    ])
    expect(nameBox).not.toBeNull()
    expect(editBox).not.toBeNull()
    const editCenterY = editBox!.y + editBox!.height / 2
    expect(editCenterY).toBeGreaterThanOrEqual(nameBox!.y - 2)
    expect(editCenterY).toBeLessThanOrEqual(nameBox!.y + nameBox!.height + 2)

    // The header row (title + the two buttons) also stays single-line.
    const heading = page.getByRole('heading', { name: 'Commands' })
    const [headingBox, moreBox] = await Promise.all([
      heading.boundingBox(),
      moreButton.boundingBox(),
    ])
    expect(headingBox).not.toBeNull()
    expect(moreBox).not.toBeNull()
    const headingCenterY = headingBox!.y + headingBox!.height / 2
    const moreCenterY = moreBox!.y + moreBox!.height / 2
    expect(Math.abs(headingCenterY - moreCenterY)).toBeLessThan(4)
  })

  test('labeled Add button, visible ShortcutInput, no overflow at 1024px (desktop smoke)', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto(`chrome-extension://${extensionId}/options.html`)

    const addCommandButton = page.getByRole('button', { name: 'Add command' })
    await expect(addCommandButton).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'More command actions' }),
    ).toBeVisible()

    // Text label is visible at this width too (same as mobile — no
    // icon-only collapse for this control any more).
    await expect(addCommandButton).toHaveText('Add command')

    // The ShortcutInput recorder is visible at this width.
    await expect(
      page.getByPlaceholder('Click to record').first(),
    ).toBeVisible()

    const hasNoHorizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    )
    expect(hasNoHorizontalOverflow).toBe(true)
  })
})

// Restore/Export/Import all live behind the Commands section's "…" overflow
// menu — see entrypoints/options/components/CommandsSection.tsx and
// lib/commandsTransfer.ts.
test.describe('options page - commands export/import', () => {
  test('import merges new commands and skips a same-named entry on re-import', async ({
    context,
    extensionId,
  }, testInfo) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/options.html`)

    // Fresh profile: commands are seeded from BUILTIN_COMMANDS (fix, improve,
    // shorten, tl) — none of those collide with the name below.
    const importFile = path.join(
      os.tmpdir(),
      `imp-write-import-${testInfo.workerIndex}-${Date.now()}.json`,
    )
    await fs.writeFile(
      importFile,
      JSON.stringify({
        version: 1,
        commands: [{ name: 'brand-new', prompt: 'Do a new thing: {{text}}' }],
      }),
      'utf-8',
    )

    const fileInput = page.locator('input[type="file"]')

    await page.getByRole('button', { name: 'More command actions' }).click()
    await page.getByRole('menuitem', { name: 'Import commands…' }).click()
    await fileInput.setInputFiles(importFile)

    await expect(page.getByText('Imported 1 command')).toBeVisible()
    await expect(page.getByText('/brand-new', { exact: true })).toBeVisible()

    // Re-importing the exact same file should merge nothing new — the
    // existing "brand-new" command (case-insensitively) is skipped as a
    // duplicate, not overwritten or duplicated in the list.
    await page.getByRole('button', { name: 'More command actions' }).click()
    await page.getByRole('menuitem', { name: 'Import commands…' }).click()
    await fileInput.setInputFiles(importFile)

    await expect(
      page.getByText('Imported 0 commands (skipped 1 duplicate'),
    ).toBeVisible()
    await expect(page.getByText('/brand-new', { exact: true })).toHaveCount(1)

    await fs.rm(importFile, { force: true })
  })

  // Downloads triggered via Blob + `URL.createObjectURL` + a synthetic
  // `<a download>` click are exercised end-to-end here (menu item is
  // clickable, a real download fires with the expected filename shape); the
  // exported JSON's *content* — the exact commands round-tripping through
  // serialize/parse — is covered by lib/commandsTransfer.unit.test.ts
  // instead of re-asserted here, since reading a real downloaded file's
  // content back out in this headless/persistent-context setup added
  // flakiness without adding real coverage beyond the unit tests.
  test('export triggers a download named imp-write-commands-<date>.json', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/options.html`)

    await page.getByRole('button', { name: 'More command actions' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Export commands…' }).click(),
    ])

    expect(download.suggestedFilename()).toMatch(
      /^imp-write-commands-\d{4}-\d{2}-\d{2}\.json$/,
    )
  })
})

// The Add/Edit command form used to render inline (appended to the list, or
// swapped in for the row being edited) — it now opens in a modal Dialog
// instead (see components/ui/dialog.tsx and CommandsSection.tsx). These
// tests cover the primary open/fill/save flows plus the dirty-draft guard
// that blocks an accidental overlay-click/Esc dismissal from silently
// discarding unsaved edits.
test.describe('options page - command dialog', () => {
  test('Add command opens a dialog; saving closes it and adds the command', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/options.html`)

    await page.getByRole('button', { name: 'Add command' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Add command')).toBeVisible()

    await dialog.getByPlaceholder('e.g. concise').fill('brand-new-cmd')
    await dialog
      .getByPlaceholder(/Rewrite the text below/)
      .fill('Do a new thing: {{text}}')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(dialog).toBeHidden()
    await expect(page.getByText('/brand-new-cmd', { exact: true })).toBeVisible()
  })

  test('Edit opens a dialog prefilled with the existing command; saving closes it', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/options.html`)

    // Fresh profile: BUILTIN_COMMANDS seeds "fix" as the first row.
    await page.getByRole('button', { name: 'Edit' }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Edit command')).toBeVisible()

    const nameField = dialog.getByPlaceholder('e.g. concise')
    await expect(nameField).toHaveValue('fix')
    const promptField = dialog.getByPlaceholder(/Rewrite the text below/)
    await expect(promptField).not.toHaveValue('')

    await promptField.fill('Updated fix prompt: {{text}}')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(dialog).toBeHidden()
    // Still there under its original name — only the prompt changed.
    await expect(page.getByText('/fix', { exact: true })).toBeVisible()
  })

  test('a dirty draft blocks Esc and overlay-click from closing; Cancel and a clean draft still close', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/options.html`)

    await page.getByRole('button', { name: 'Add command' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const nameField = dialog.getByPlaceholder('e.g. concise')
    await nameField.fill('temp-name')

    // Dirty: Esc must not close the dialog.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

    // Dirty: clicking the overlay (well outside the centered dialog card)
    // must not close it either.
    await page.mouse.click(5, 5)
    await expect(dialog).toBeVisible()

    // Cancel always works, dirty or not.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(
      page.getByText('/temp-name', { exact: true }),
    ).toHaveCount(0)

    // Reopen and dirty it again, then clear back to the original (empty)
    // value — once clean, Esc closes it like Cancel would.
    await page.getByRole('button', { name: 'Add command' }).click()
    await expect(dialog).toBeVisible()
    await nameField.fill('temp-name-2')
    await expect(dialog).toBeVisible()
    await nameField.fill('')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
