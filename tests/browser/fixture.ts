import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { CompanionDock } from '../../src/client/CompanionDock.tsx'
import { CompanionFloat } from '../../src/client/CompanionFloat.tsx'
import { disposePopout, openPopout } from '../../src/client/popout.ts'
import type { DockController } from '../../src/client/index.ts'

const root = createRoot(document.getElementById('app')!)
const dock = {
  subscribe: () => () => {},
  dockWidth: () => 420,
  openRightbarSurface() {},
  setDockWidth() {},
  commitOverlayWidth() {},
  openPopout,
  enterFloat: () => render(true),
  dockBack: () => render(false),
  close: () => root.unmount(),
} as unknown as DockController
function render(float: boolean): void {
  root.render(
    float ? createElement(CompanionFloat, { dock }) : createElement(CompanionDock, { dock, variant: 'overlay' }),
  )
}
render(false)
window.addEventListener('pagehide', disposePopout)
