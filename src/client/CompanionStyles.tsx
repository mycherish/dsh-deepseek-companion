/** Scoped presentation, mounted with each surface and removed on unmount. */
export function CompanionStyles(): JSX.Element {
  return <style>{styles}</style>
}

const styles = `
[data-companion-root] {
  font-family: var(--dsw-font-family, system-ui, sans-serif);
  font-size: var(--dsh-content-font-size, 14px);
  color: var(--dsw-alias-label-primary, CanvasText);
  line-height: 1.5;
  animation: dsc-appear 160ms ease-out;
}
[data-companion-root], [data-companion-root] * { box-sizing: border-box; }
[data-companion-root] button, [data-companion-root] textarea { font-family: inherit; }
[data-companion-root] button { transition: background-color 120ms ease, color 120ms ease; }
[data-companion-root] button:not(:disabled):hover { --dsc-control-bg: var(--dsw-alias-interactive-bg-hover); }
[data-companion-root] button:not(:disabled):active { --dsc-control-bg: var(--dsw-alias-interactive-bg-active); }
[data-companion-root] button:disabled { opacity: .45; cursor: not-allowed; }
[data-companion-root] :is(button, textarea, summary):focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, Highlight));
  outline-offset: 2px;
}
[data-companion-root] [data-companion-input]:focus-within { --dsc-input-border: var(--dsw-alias-label-secondary); }
[data-companion-root] [data-companion-history], [data-companion-root] details[open] > div {
  animation: dsc-appear 140ms ease-out;
}
[data-companion-root] [role="status"], [data-companion-root] [role="alert"] {
  animation: dsc-appear 140ms ease-out;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-companion-root] [role="alert"] { border-inline-start: 2px solid var(--dsw-alias-label-secondary); }
@keyframes dsc-appear { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  [data-companion-root], [data-companion-root] * {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
`
