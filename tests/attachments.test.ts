import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  ATTACHMENT_LIMITS,
  attachmentTempName,
  clearAttachmentTempDir,
  decodeBase64Strict,
  detectImageMime,
  prepareAttachmentTempDir,
  removeAttachmentTempFile,
  sanitizeDisplayName,
  validateAttachmentAdd,
  writeAttachmentTempFile,
} from '../src/host/attachments.ts'

// --- fixtures -----------------------------------------------------------------

const PNG_MAGIC = Buffer.from('89504e470d0a1a0a', 'hex')
const JPEG_MAGIC = Buffer.from('ffd8ffe000104a464946', 'hex')
const GIF89_MAGIC = Buffer.from('474946383961', 'hex')
const WEBP_MAGIC = Buffer.concat([Buffer.from('RIFF'), Buffer.from('00000000', 'hex'), Buffer.from('WEBP')])

const MAGIC = {
  'image/png': PNG_MAGIC,
  'image/jpeg': JPEG_MAGIC,
  'image/webp': WEBP_MAGIC,
  'image/gif': GIF89_MAGIC,
} as const

/** An image of `size` bytes that starts with the real magic of `mime`. */
function image(mime: keyof typeof MAGIC, size = 32): Buffer {
  const magic = MAGIC[mime]
  return Buffer.concat([magic, Buffer.alloc(Math.max(0, size - magic.length), 7)])
}

/** One valid `add` body for the given mime. */
function body(mime: keyof typeof MAGIC, size = 32, name = 'a.png') {
  return { name, mimeType: mime, dataBase64: image(mime, size).toString('base64') }
}

const draft = (count = 0, totalBytes = 0) => ({ count, totalBytes })
/** Small limits, so the boundary cases stay fast — production values are asserted separately. */
const LIMITS = { maxBytes: 64, maxTotalBytes: 128, maxCount: 2 }

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsc-attachments-test-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// --- 1. magic bytes -----------------------------------------------------------

test('18A magic: 四种允许的图片格式都能识别', () => {
  assert.equal(detectImageMime(image('image/png')), 'image/png')
  assert.equal(detectImageMime(image('image/jpeg')), 'image/jpeg')
  assert.equal(detectImageMime(image('image/webp')), 'image/webp')
  assert.equal(detectImageMime(image('image/gif')), 'image/gif')
  assert.equal(detectImageMime(Buffer.from('474946383761', 'hex')), 'image/gif', 'GIF87a 同样接受')
})

test('18A magic: 非图片 / 截断的头部都不算图片', () => {
  assert.equal(detectImageMime(Buffer.from('hello world')), null)
  assert.equal(detectImageMime(Buffer.alloc(0)), null)
  assert.equal(detectImageMime(PNG_MAGIC.subarray(0, 4)), null, '只有半个 magic 不算')
  // BMP / SVG 不在白名单里（设计只允许 png/jpeg/webp/gif）。
  assert.equal(detectImageMime(Buffer.from('424d1a000000', 'hex')), null)
  assert.equal(detectImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)
})

// --- 2. strict base64 ---------------------------------------------------------

test('18A base64: 合法输入解出真实字节', () => {
  const result = decodeBase64Strict(image('image/png').toString('base64'))
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.bytes.length, 32)
})

test('18A base64: 非法字符 / 空白 / data URL / 非字符串全部拒绝', () => {
  assert.equal(decodeBase64Strict('AAAA*AAA').ok, false, '非法字符')
  assert.equal(decodeBase64Strict('AA AA').ok, false, '空格')
  assert.equal(decodeBase64Strict('AAAA\n').ok, false, '换行')
  assert.equal(decodeBase64Strict('data:image/png;base64,AAAA').ok, false, 'data URL 前缀')
  assert.equal(decodeBase64Strict('').ok, false, '空字符串')
  assert.equal(decodeBase64Strict(null).ok, false, '非字符串')
  assert.equal(decodeBase64Strict(1234).ok, false, '非字符串')
  assert.equal(decodeBase64Strict({ dataBase64: 'AAAA' }).ok, false, '对象')
})

test('18A base64: 非法 padding 拒绝', () => {
  assert.equal(decodeBase64Strict('AAA').ok, false, '长度不是 4 的倍数')
  assert.equal(decodeBase64Strict('A===').ok, false, '过多 padding')
  assert.equal(decodeBase64Strict('AA=A').ok, false, 'padding 出现在中间')
  assert.equal(decodeBase64Strict('AAAA=').ok, false, '长度 5')
})

test('18A base64: 非规范（尾部 bit 非零）的输入拒绝，绝不“勉强解出来”', () => {
  // Both decode to the same single byte, but only "AA==" is the canonical form.
  assert.equal(decodeBase64Strict('AA==').ok, true)
  assert.equal(decodeBase64Strict('AB==').ok, false)
  assert.equal(decodeBase64Strict('AAA=').ok, true)
  assert.equal(decodeBase64Strict('AAB=').ok, false)
})

// --- 3. add validation --------------------------------------------------------

test('18A add: 合法图片通过，并回填真实字节数与 magic MIME', () => {
  const result = validateAttachmentAdd(body('image/png', 40, '照片.png'), draft())
  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.name, '照片.png')
  assert.equal(result.mimeType, 'image/png')
  assert.equal(result.bytes.length, 40, 'bytes 由 magic 后的真实数据算出，不信任 Client 上报')
})

test('18A add: MIME spoof（声明的 MIME 与 magic 不一致）拒绝', () => {
  const declared = { ...body('image/gif'), mimeType: 'image/png' as const }
  const result = validateAttachmentAdd(declared, draft())

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /does not match/)
})

test('18A add: 白名单之外的 MIME 拒绝', () => {
  for (const mimeType of ['image/svg+xml', 'image/bmp', 'application/pdf', 'text/plain', 'image/png2']) {
    const result = validateAttachmentAdd({ ...body('image/png'), mimeType }, draft())
    assert.equal(result.ok, false, `${mimeType} 必须被拒绝`)
  }
  assert.equal(validateAttachmentAdd({ ...body('image/png'), mimeType: undefined }, draft()).ok, false)
  assert.equal(validateAttachmentAdd({ ...body('image/png'), mimeType: 42 }, draft()).ok, false)
})

test('18A add: 非图片内容（即使 base64 合法）拒绝', () => {
  const result = validateAttachmentAdd(
    { name: 'fake.png', mimeType: 'image/png', dataBase64: Buffer.from('not an image at all').toString('base64') },
    draft(),
  )

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /unsupported image/)
})

test('18A add: filename 缺失或不可用时拒绝', () => {
  assert.equal(validateAttachmentAdd({ ...body('image/png'), name: undefined }, draft()).ok, false)
  assert.equal(validateAttachmentAdd({ ...body('image/png'), name: 42 }, draft()).ok, false)
  assert.equal(validateAttachmentAdd({ ...body('image/png'), name: '   ' }, draft()).ok, false)
  assert.equal(validateAttachmentAdd({ ...body('image/png'), name: '' }, draft()).ok, false)
})

test('18A add: 单张超限 / 总量超限 / 数量超限分别拒绝，且边界值通过', () => {
  // 单张：64 字节上限，64 通过、65 拒绝。
  assert.equal(validateAttachmentAdd(body('image/png', 64), draft(), LIMITS).ok, true)
  const tooBig = validateAttachmentAdd(body('image/png', 65), draft(), LIMITS)
  assert.equal(tooBig.ok, false)
  if (!tooBig.ok) assert.match(tooBig.error, /too large/)

  // 总量：128 字节上限（已有 100）。
  assert.equal(validateAttachmentAdd(body('image/png', 28), draft(1, 100), LIMITS).ok, true)
  const tooMuch = validateAttachmentAdd(body('image/png', 29), draft(1, 100), LIMITS)
  assert.equal(tooMuch.ok, false)
  if (!tooMuch.ok) assert.match(tooMuch.error, /draft is too large/)

  // 数量：2 张上限。
  const alreadyTwo = validateAttachmentAdd(body('image/png'), draft(2, 64), LIMITS)
  assert.equal(alreadyTwo.ok, false)
  if (!alreadyTwo.ok) assert.match(alreadyTwo.error, /too many attachments/)
})

test('18A add: 生产限额就是设计里的 20 MiB / 40 MiB / 5 张', () => {
  assert.equal(ATTACHMENT_LIMITS.maxBytes, 20 * 1024 * 1024)
  assert.equal(ATTACHMENT_LIMITS.maxTotalBytes, 40 * 1024 * 1024)
  assert.equal(ATTACHMENT_LIMITS.maxCount, 5)
})

// --- 4. display name ----------------------------------------------------------

test('18A name: 展示名去掉控制字符并限长，但保留用户可读的名字', () => {
  assert.equal(sanitizeDisplayName('a\u0000b\u001fc.png'), 'abc.png')
  assert.equal(sanitizeDisplayName('  照片.png  '), '照片.png')
  assert.equal(sanitizeDisplayName('x'.repeat(500)).length, 200)
})

test('18A name: path traversal 文件名无法影响临时文件路径', async () => {
  await withTempDir(async (dir) => {
    const evil = '../../../../etc/passwd.png'
    const validation = validateAttachmentAdd({ ...body('image/png', 32, evil) }, draft(), LIMITS)
    assert.equal(validation.ok, true)
    if (!validation.ok) return

    const path = await writeAttachmentTempFile(dir, validation.bytes, validation.mimeType)

    assert.equal(path.startsWith(dir), true, '临时文件必须在专属目录内')
    assert.equal(path.includes('..'), false)
    assert.equal(path.includes('passwd'), false, '绝不使用用户文件名拼路径')
    const entries = await readdir(dir)
    assert.deepEqual(entries, [path.slice(dir.length + 1)])
  })
})

// --- 5. temp files ------------------------------------------------------------

test('18A temp: 文件名随机、扩展名只由 magic MIME 决定', async () => {
  await withTempDir(async (dir) => {
    const first = await writeAttachmentTempFile(dir, image('image/png'), 'image/png')
    const second = await writeAttachmentTempFile(dir, image('image/png'), 'image/png')

    assert.notEqual(first, second, '每次都是新随机名')
    assert.match(first.slice(dir.length + 1), /^att-[0-9a-f-]{36}\.png$/)
    assert.equal(await stat(first).then((s) => s.size), 32)
  })
})

test('18A temp: 扩展名与 MIME 一一对应', () => {
  assert.match(attachmentTempName('image/png'), /^att-[0-9a-f-]{36}\.png$/)
  assert.match(attachmentTempName('image/jpeg'), /^att-[0-9a-f-]{36}\.jpg$/)
  assert.match(attachmentTempName('image/webp'), /^att-[0-9a-f-]{36}\.webp$/)
  assert.match(attachmentTempName('image/gif'), /^att-[0-9a-f-]{36}\.gif$/)
})

test('18A cleanup: 删除单个临时文件是幂等的（重复删除不抛错）', async () => {
  await withTempDir(async (dir) => {
    const path = await writeAttachmentTempFile(dir, image('image/png'), 'image/png')

    await removeAttachmentTempFile(path)
    await removeAttachmentTempFile(path) // 已经不存在 → 仍然是成功
    await removeAttachmentTempFile(join(dir, 'never-existed.png'))

    assert.deepEqual(await readdir(dir), [])
  })
})

test('18A cleanup: 清空目录幂等，且绝不动目录之外的任何文件', async () => {
  await withTempDir(async (parent) => {
    const dir = join(parent, 'uploads')
    const sibling = join(parent, 'keep-me.txt')
    await writeFile(sibling, 'other resource')
    await prepareAttachmentTempDir(dir)
    await writeAttachmentTempFile(dir, image('image/png'), 'image/png')
    await writeAttachmentTempFile(dir, image('image/gif'), 'image/gif')

    await clearAttachmentTempDir(dir)
    await clearAttachmentTempDir(dir) // 幂等

    assert.deepEqual(await readdir(dir), [])
    assert.equal(await stat(sibling).then((s) => s.isFile()), true, '目录外的文件不受影响')
  })
})

test('18A cleanup: 启动时创建目录并清掉上次异常退出的遗留文件', async () => {
  await withTempDir(async (parent) => {
    const dir = join(parent, 'uploads')
    await prepareAttachmentTempDir(dir)
    const leftover = await writeAttachmentTempFile(dir, image('image/png'), 'image/png')

    await prepareAttachmentTempDir(dir) // 再次启动

    assert.equal(
      await stat(leftover).then(
        () => true,
        () => false,
      ),
      false,
      '遗留文件被清理',
    )
    assert.deepEqual(await readdir(dir), [])
  })
})
