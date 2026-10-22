function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read only public Session catalog facts. Legacy DSH owns selection in `current`;
 * newer Web exposes the main view through SessionSummary.retainedBy.mainView.
 * Unknown or ambiguous ownership keeps the root overlay available.
 */
export function dockSurfaceForSessionList(snapshot: unknown): 'rightbar' | 'overlay' {
  if (!record(snapshot) || !record(snapshot.byId)) return 'overlay'
  let selected: unknown
  if ('current' in snapshot) {
    // An explicit legacy absence remains authoritative; do not revive a row.
    if (typeof snapshot.current !== 'string') return 'overlay'
    selected = snapshot.byId[snapshot.current]
  } else {
    const mainViews = Object.values(snapshot.byId).filter((row) => {
      if (!record(row) || !record(row.retainedBy)) return false
      const count = row.retainedBy.mainView
      return typeof count === 'number' && Number.isFinite(count) && count > 0
    })
    if (mainViews.length !== 1) return 'overlay'
    selected = mainViews[0]
  }
  return record(selected) && selected.blank === false ? 'rightbar' : 'overlay'
}
