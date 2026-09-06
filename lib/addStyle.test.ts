import { afterEach, describe, expect, it } from 'vitest'
import { addDocumentStyle, applyShadowStyle, removeDocumentStyle } from './addStyle'

describe('applyShadowStyle', () => {
  it('should apply a style to the shadow root', () => {
    const div = document.createElement('div')
    div.attachShadow({ mode: 'open' })
    document.body.appendChild(div)
    const root = div.shadowRoot!
    applyShadowStyle(root, '.test { color: red; }')
    const span = document.createElement('span')
    span.classList.add('test')
    root.appendChild(span)
    expect(getComputedStyle(root.querySelector('span')!).color).toBe(
      'rgb(255, 0, 0)',
    )
  })
})

describe('addDocumentStyle / removeDocumentStyle', () => {
  const ID = 'add-style-test'

  afterEach(() => {
    removeDocumentStyle(ID)
    document.getElementById(ID)?.remove()
  })

  it('should apply a style to the document', () => {
    addDocumentStyle(ID, '#add-style-test { color: green; }')
    const el = document.createElement('div')
    el.id = ID
    document.body.appendChild(el)
    expect(getComputedStyle(el).color).toBe('rgb(0, 128, 0)')
    el.remove()
  })

  it('should be idempotent for the same id', () => {
    addDocumentStyle(ID, '#add-style-test { color: green; }')
    addDocumentStyle(ID, '#add-style-test { color: red; }')
    const el = document.createElement('div')
    el.id = ID
    document.body.appendChild(el)
    // First registration wins — the second call is a no-op.
    expect(getComputedStyle(el).color).toBe('rgb(0, 128, 0)')
    el.remove()
  })

  it('should remove an applied document style', () => {
    addDocumentStyle(ID, '#add-style-test { color: green; }')
    const el = document.createElement('div')
    el.id = ID
    document.body.appendChild(el)
    expect(getComputedStyle(el).color).toBe('rgb(0, 128, 0)')
    removeDocumentStyle(ID)
    expect(getComputedStyle(el).color).not.toBe('rgb(0, 128, 0)')
    el.remove()
  })
})
