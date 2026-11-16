import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { CompanionEntry } from '../../src/client/CompanionEntry.tsx'
import type { DockController } from '../../src/client/index.ts'

const root = createRoot(document.getElementById('app')!)
const listeners = new Set<() => void>()
let open = false
let wide = true
const dock = {
  isOpen: () => open,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  toggle() {
    open = !open
    for (const listener of listeners) listener()
  },
} as unknown as DockController
function render(): void {
  root.render(
    createElement(
      'section',
      { style: { width: wide ? 280 : 36 }, 'aria-label': '测试侧栏' },
      createElement(CompanionEntry, { wide, dock }),
      createElement(
        'button',
        {
          type: 'button',
          onClick() {
            wide = !wide
            render()
          },
        },
        '切换侧栏宽度',
      ),
    ),
  )
}
render()
