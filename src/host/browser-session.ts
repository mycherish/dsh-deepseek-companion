import type { DeepSeekBrowser } from './browser.ts'
import type { CompanionState, BrowserSessionMode } from '../shared/state.ts'

type RunMode = 'background' | 'login'
type Operation = 'activate' | 'login' | 'finish' | 'closed'

export interface BrowserSessionOptions {
  create(mode: RunMode, isCurrent: () => boolean): Promise<DeepSeekBrowser>
  /** Host atomically claims the page only when sends and managed drafts are idle. */
  claim(): boolean
  release(): void
  onMode(mode: BrowserSessionMode): void
  onError?(error: unknown): void
}

/** Intentional mode changes never interrupt recovery, sends or managed drafts. */
export function canSwitchBrowserMode(state: Pick<CompanionState, 'connection' | 'chat' | 'composer'>): boolean {
  return (
    state.connection.status !== 'recovering' &&
    !state.chat.sending &&
    !state.composer.stopping &&
    state.composer.attachments.length === 0
  )
}

/** Own exactly one profile/context, with explicit (never automatic) visible login. */
export function createBrowserSession(options: BrowserSessionOptions) {
  let active: DeepSeekBrowser | null = null
  let mode: BrowserSessionMode = 'idle'
  let generation = 0
  let users = 0
  let disposed = false
  let disposal: Promise<void> | undefined
  let readiness: Promise<DeepSeekBrowser | null> | undefined
  let flight: { kind: Operation; promise: Promise<DeepSeekBrowser | null> } | undefined

  const publish = (next: BrowserSessionMode): void => {
    mode = next
    if (!disposed) options.onMode(next)
  }

  const replace = async (next: RunMode): Promise<DeepSeekBrowser | null> => {
    const mine = ++generation
    const previous = active
    active = null
    // Never open the same user-data-dir before the previous owner releases it.
    if (previous) await previous.dispose()
    if (disposed) return null
    const created = await options.create(next, () => !disposed && generation === mine)
    if (disposed || mine !== generation) {
      await created.dispose()
      return null
    }
    active = created
    if (next === 'login') await created.showLogin()
    else if ((await created.check()) === 'error') throw new Error('background browser preparation failed')
    if (disposed || mine !== generation) return null
    publish(next)
    return created
  }

  const run = (kind: Operation, operation: () => Promise<DeepSeekBrowser | null>) => {
    if (disposed) return Promise.resolve(null)
    if (flight) return flight.kind === kind ? flight.promise : Promise.resolve(null)
    if (users > 0 || !options.claim()) return Promise.resolve(null)
    publish(active ? 'switching' : 'starting')
    const promise = Promise.resolve()
      .then(operation)
      .catch(async (error: unknown) => {
        const failed = active
        active = null
        generation++
        if (failed) await failed.dispose().catch(() => {})
        if (!disposed) {
          publish('error')
          options.onError?.(error)
        }
        return null
      })
      .finally(() => {
        flight = undefined
        options.release()
      })
    flight = { kind, promise }
    return promise
  }

  const use = async <T>(operation: (browser: DeepSeekBrowser) => Promise<T>): Promise<T | undefined> => {
    if (disposed || flight || mode !== 'background' || active === null) return undefined
    users++
    try {
      return await operation(active)
    } finally {
      users--
    }
  }

  return {
    mode: () => mode,
    use,
    isCurrent: (browser: DeepSeekBrowser) => !disposed && !flight && mode === 'background' && active === browser,
    peek: () => (!disposed && !flight && mode === 'background' ? active : null),
    activate(): Promise<DeepSeekBrowser | null> {
      if (disposed) return Promise.resolve(null)
      if (!flight && active && mode === 'login') return Promise.resolve(active)
      if (!flight && active && mode === 'background') {
        if (readiness) return readiness
        readiness = use(async (current) => {
          const status = await current.ensureReady()
          return !disposed && active === current && status !== 'error' ? current : null
        })
          .then((current) => current ?? null)
          .finally(() => {
            readiness = undefined
          })
        return readiness
      }
      return run('activate', () => replace('background'))
    },
    async showLogin(): Promise<boolean> {
      if (mode === 'login' && active && !flight) {
        return (
          (await run('login', async () => {
            await active!.showLogin()
            publish('login')
            return active
          })) !== null
        )
      }
      return (await run('login', () => replace('login'))) !== null
    },
    async finishLogin(): Promise<boolean> {
      if (mode !== 'login' && flight?.kind !== 'finish') return false
      const browser = await run('finish', async () => {
        if (!active || (await active.ensureReady()) !== 'logged_in') {
          publish('login')
          return active
        }
        return replace('background')
      })
      return browser !== null && mode === 'background'
    },
    async loginClosed(): Promise<void> {
      if (flight) await flight.promise
      if (!disposed && mode === 'login') await run('closed', () => replace('background'))
    },
    dispose(): Promise<void> {
      if (disposal) return disposal
      disposed = true
      generation++
      const owned = active
      active = null
      disposal = Promise.all([owned?.dispose(), flight?.promise, readiness]).then(() => {})
      return disposal
    },
  }
}
