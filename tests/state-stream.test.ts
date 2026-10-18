import assert from 'node:assert/strict'
import test from 'node:test'
import { subscribeCompanionState } from '../src/client/api.ts'
import { subscribeStateStream, type StateStreamRuntime, type StateStreamStatus } from '../src/client/state-stream.ts'

const encoder = new TextEncoder()
const event = (revision: number): Uint8Array =>
  encoder.encode(
    `data: ${JSON.stringify({ status: 'ready', revision, instanceId: 'stream-test', chat: { messages: [] } })}\n\n`,
  )

test('SSE: EOF 后自动建立新订阅并交付最新 Host 快照', async (t) => {
  let calls = 0
  let fresh: ReadableStreamDefaultController<Uint8Array> | undefined
  const revisions: number[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://host.test/api/deepseek-companion/state/stream')
    assert.equal(init.credentials, 'include')
    calls += 1
    if (calls === 1)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(event(1))
            controller.close()
          },
        }),
      )
    return new Response(
      new ReadableStream({
        start(controller) {
          fresh = controller
          controller.enqueue(event(2))
        },
      }),
    )
  })
  const unsubscribe = subscribeCompanionState('https://host.test', (state) => revisions.push(state.revision))
  t.after(unsubscribe)
  await new Promise((resolve) => setTimeout(resolve, 800))
  assert.equal(calls, 2, 'first stream ended; a fresh stream must be opened')
  assert.deepEqual(revisions, [1, 2])
  unsubscribe()
  assert.throws(() => fresh?.enqueue(event(3)), 'dispose cancels the active stream')
})

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve()
}

function clock(fetcher: StateStreamRuntime['fetch']) {
  let sequence = 0
  const timers = new Map<number, { delay: number; callback: () => void }>()
  const runtime: StateStreamRuntime = {
    fetch: fetcher,
    schedule(callback, delay) {
      const id = ++sequence
      timers.set(id, { delay, callback })
      return () => {
        timers.delete(id)
      }
    },
  }
  return {
    runtime,
    timers,
    async fire(delay: number) {
      const timer = [...timers.entries()].find(([, timer]) => timer.delay === delay)
      assert.ok(timer, `timer ${delay} exists`)
      timers.delete(timer[0])
      timer[1].callback()
      await flush()
    },
  }
}

const parseNumber = (raw: string): number | null => {
  const value = /^data: (\d+)$/.exec(raw)?.[1]
  return value === undefined ? null : Number(value)
}

test('SSE: 网络和 HTTP 失败递增退避到 5s；dispose 清除重试', async () => {
  let calls = 0
  const statuses: StateStreamStatus[] = []
  const fake = clock(async () => {
    calls += 1
    if (calls % 2) throw new TypeError('network failure')
    return new Response('unavailable', { status: 503 })
  })
  const stop = subscribeStateStream(
    { url: 'https://host.test/state', parseEvent: parseNumber, onState() {}, onStatus: (s) => statuses.push(s) },
    fake.runtime,
  )
  await flush()
  for (const delay of [500, 1000, 2000, 4000, 5000, 5000]) await fake.fire(delay)
  assert.equal(calls, 7)
  assert.deepEqual(statuses, ['connecting', 'reconnecting'])
  const lateRetry = [...fake.timers.values()][0]!.callback
  stop()
  assert.equal(fake.timers.size, 0)
  lateRetry()
  await flush()
  assert.equal(calls, 7)
})

test('SSE: 收到新快照后重置退避，read 异常同样重连', async () => {
  let calls = 0
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const values: number[] = []
  const statuses: StateStreamStatus[] = []
  const fake = clock(async () => {
    calls += 1
    if (calls === 1) throw new TypeError('offline')
    return new Response(
      new ReadableStream({
        start(controller) {
          stream = controller
          controller.enqueue(encoder.encode('data: 2\n\n'))
        },
      }),
    )
  })
  const stop = subscribeStateStream(
    { url: '/state', parseEvent: parseNumber, onState: (n) => values.push(n), onStatus: (s) => statuses.push(s) },
    fake.runtime,
  )
  await flush()
  await fake.fire(500)
  assert.deepEqual(values, [2])
  stream!.error(new TypeError('read failed'))
  await flush()
  await fake.fire(500)
  assert.equal(calls, 3)
  assert.deepEqual(statuses, ['connecting', 'reconnecting', 'connected', 'reconnecting', 'connected'])
  stop()
  await flush()
  assert.equal(fake.timers.size, 0)
})

test('SSE: 首个有效快照前不解锁；10s 超时取消 reader 后重连', async () => {
  let cancellations = 0
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const statuses: StateStreamStatus[] = []
  const fake = clock(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            stream = controller
            controller.enqueue(encoder.encode(': heartbeat\n\n'))
          },
          cancel() {
            cancellations += 1
          },
        }),
      ),
  )
  const stop = subscribeStateStream(
    { url: '/state', parseEvent: parseNumber, onState() {}, onStatus: (s) => statuses.push(s) },
    fake.runtime,
  )
  await flush()
  assert.deepEqual(statuses, ['connecting'])
  await fake.fire(10000)
  assert.equal(cancellations, 1)
  assert.deepEqual(statuses, ['connecting', 'reconnecting'])
  await fake.fire(500)
  stream!.enqueue(encoder.encode('data: 3\n\n'))
  await flush()
  assert.deepEqual(statuses, ['connecting', 'reconnecting', 'connected'])
  assert.equal(fake.timers.size, 0, 'healthy idle streams have no snapshot deadline')
  stop()
  await flush()
})

test('SSE: dispose 取消活动 reader，阻止后续快照与连接', async () => {
  let cancellations = 0
  let signal: AbortSignal | null | undefined
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const values: number[] = []
  const fake = clock(async (_url, init) => {
    signal = init.signal
    return new Response(
      new ReadableStream({
        start(c) {
          stream = c
          c.enqueue(encoder.encode('data: 1\n\n'))
        },
        cancel() {
          cancellations += 1
        },
      }),
    )
  })
  const stop = subscribeStateStream(
    { url: '/state', parseEvent: parseNumber, onState: (n) => values.push(n) },
    fake.runtime,
  )
  await flush()
  stop()
  stop()
  await flush()
  assert.equal(signal?.aborted, true)
  assert.equal(cancellations, 1)
  assert.equal(fake.timers.size, 0)
  assert.throws(() => stream!.enqueue(encoder.encode('data: 2\n\n')))
  assert.deepEqual(values, [1])
})

test('SSE: dispose 后迟到的 fetch 响应关闭 body，不通知和重试', async () => {
  let resolve: ((response: Response) => void) | undefined
  let cancelled = 0
  let notifications = 0
  const fake = clock(
    () =>
      new Promise<Response>((done) => {
        resolve = done
      }),
  )
  const stop = subscribeStateStream(
    {
      url: '/state',
      parseEvent: parseNumber,
      onState: () => {
        notifications += 1
      },
    },
    fake.runtime,
  )
  stop()
  resolve!(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled += 1
        },
      }),
    ),
  )
  await flush()
  assert.equal(cancelled, 1)
  assert.equal(notifications, 0)
  assert.equal(fake.timers.size, 0)
})

test('SSE: 不把旧连接的半个事件拼到新连接；支持跨 chunk 的 CRLF', async () => {
  let calls = 0
  const values: number[] = []
  const fake = clock(async () => {
    calls += 1
    return new Response(
      new ReadableStream({
        start(c) {
          if (calls === 1) {
            c.enqueue(encoder.encode('data: 9'))
            c.close()
            return
          }
          for (const chunk of ['data: 2\r', '\n\r', '\ndata: 3\n\n']) c.enqueue(encoder.encode(chunk))
        },
      }),
    )
  })
  const stop = subscribeStateStream(
    { url: '/state', parseEvent: parseNumber, onState: (n) => values.push(n) },
    fake.runtime,
  )
  await flush()
  await fake.fire(500)
  assert.deepEqual(values, [2, 3])
  stop()
  await flush()
})

test('SSE: 坏事件不会解除连接门禁；有效新实例快照可以降低 revision', async (t) => {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const states: string[] = []
  const statuses: StateStreamStatus[] = []
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            stream = c
            c.enqueue(encoder.encode('data: {}\n\ndata: null\n\ndata: broken\n\n'))
          },
        }),
      ),
  )
  const stop = subscribeCompanionState(
    'https://host.test',
    (s) => states.push(`${s.instanceId}:${s.revision}`),
    undefined,
    (s) => statuses.push(s),
  )
  t.after(stop)
  await flush()
  assert.deepEqual(statuses, ['connecting'])
  stream!.enqueue(event(9))
  stream!.enqueue(
    encoder.encode(`data: ${JSON.stringify({ status: 'ready', instanceId: 'new-host', revision: 1 })}\n\n`),
  )
  await flush()
  assert.deepEqual(states, ['stream-test:9', 'new-host:1'])
  assert.deepEqual(statuses, ['connecting', 'connected'])
})
