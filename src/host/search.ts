/**
 * DeepSeek web-search ("智能搜索") toggle (Phase 07H).
 *
 * Same DOM contract as Deep Think — see `./toggle.ts` for the locating rules and
 * the request flow. This module only pins down Search's labels and exposes the
 * Host-side request entry point. Nothing here knows about search results,
 * citations or progress UI: Phase 07H only controls the composer switch.
 */
import type { ComposerToggleState, SearchState } from '../shared/state.ts'
import type { CompanionStateStore } from './state.ts'
import { handleToggleRequest, type ToggleControlResponse } from './toggle.ts'

/** The slice of the browser the Search route needs (stubbed in tests). */
export interface SearchController {
  getSearchState(): Promise<SearchState>
  setSearchEnabled(enabled: boolean): Promise<SearchState>
}

export type SearchResponseBody = ComposerToggleState & { error?: string }

export type SearchResponse = ToggleControlResponse

/**
 * Host-side Search request flow (Phase 07H). The store is ALWAYS written with
 * the page's real state — never an optimistic guess; on failure the real state
 * is still read and mirrored.
 */
export async function handleSearchRequest(
  store: CompanionStateStore,
  controller: SearchController | null,
  body: unknown,
): Promise<SearchResponse> {
  return handleToggleRequest(
    store,
    controller === null
      ? null
      : {
          read: () => controller.getSearchState(),
          set: (enabled) => controller.setSearchEnabled(enabled),
          mirrored: () => store.getState().deepseek.search,
          mirror: (state) => store.setSearchState(state),
        },
    body,
    { failure: 'failed to set Search' },
  )
}
