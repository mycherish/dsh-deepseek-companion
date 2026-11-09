import type { ReactNode } from 'react'

/** Shared SVG geometry avoids font-dependent window glyphs. */
const icons: Record<string, ReactNode> = {
  '×': <path d="m5 5 10 10M15 5 5 15" />,
  '↗': <path d="M6 4h10v10M16 4 4 16" />,
  '□': (
    <>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M3 7h14" />
    </>
  ),
  '◧': (
    <>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M12 3v14" />
    </>
  ),
}

export function HeaderIconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: string
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        padding: 6,
        flexShrink: 0,
        border: 'none',
        borderRadius: 6,
        background: 'var(--dsc-control-bg, transparent)',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {icons[children]}
      </svg>
    </button>
  )
}
