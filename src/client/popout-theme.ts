/**
 * Read the host's public, resolved CSS presentation, including body-scoped
 * aliases. No theme settings are written and no host implementation is imported.
 */
export function syncPopoutTheme(source: Window, target: Window): () => void {
  const { document } = source
  const copied = new Set<string>()
  let disposed = false
  const update = (): void => {
    if (disposed) return
    const computed = source.getComputedStyle(document.body)
    const style = target.document.documentElement.style
    const next = new Set<string>()
    for (let index = 0; index < computed.length; index++) {
      const name = computed.item(index)
      if (!/^--(?:dsw-|ds-font-|dsh-(?:content-|code-|font-))/.test(name)) continue
      const value = computed.getPropertyValue(name).trim()
      if (value === '') continue
      style.setProperty(name, value)
      next.add(name)
    }
    for (const name of copied) if (!next.has(name)) style.removeProperty(name)
    copied.clear()
    for (const name of next) copied.add(name)
    Object.assign(target.document.body.style, {
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      colorScheme: computed.colorScheme,
    })
  }
  update()
  // Theme snapshots are presented on html/body via standard attributes/styles.
  // Watching both also supports the older host's body-only palette switch.
  const Observer = (source as Window & typeof globalThis).MutationObserver
  const observer = new Observer(update)
  const options = {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-ds-dark-theme', 'data-ds-theme-source'],
  }
  observer.observe(document.documentElement, options)
  observer.observe(document.body, options)
  const media = source.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', update)
  return () => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    media.removeEventListener('change', update)
  }
}
