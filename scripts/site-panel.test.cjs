const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('../ui/node_modules/@babel/core')
const { parse } = require('../ui/node_modules/@vue/compiler-sfc')

function harness(getSitePanelUrl) {
  const filename = path.resolve(__dirname, '../ui/src/views/site-panel.vue')
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
  const code = babel.transformSync(descriptor.script.content, { configFile: false,
    plugins: [require('../ui/node_modules/@babel/plugin-transform-modules-commonjs')] }).code
  const exports = {}, messages = []
  vm.runInNewContext(code, { exports, URL, URLSearchParams, window: { $wujie: { props: { getSitePanelUrl } } } }, { filename })
  const component = exports.default
  const ctx = { ...component.data(), view: 'files', $refs: {}, $message: { error: message => messages.push(message) } }
  for (const [name, method] of Object.entries(component.methods)) ctx[name] = method.bind(ctx)
  return { ctx, messages }
}

test('all three embedded tabs request the native host page without navigating the outer page', () => {
  const views = [], { ctx } = harness(view => { views.push(view); return `https://panel.test/embed/${view}#paneltoken=frame-token` })
  for (const view of ['files', 'terminal', 'logs']) {
    ctx.view = view
    ctx.load()
    assert.equal(ctx.src, `https://panel.test/embed/${view}#paneltoken=frame-token`)
    assert.equal(ctx.error, '')
  }
  assert.deepEqual(views, ['files', 'terminal', 'logs'])
})

test('missing or blank frame credentials prevent iframe creation for every tool tab', () => {
  for (const suffix of ['', '#paneltoken=', '#paneltoken=%20%09%0A', '#other=token', '?paneltoken=legacy-token']) {
    const { ctx } = harness(view => `https://panel.test/embed/${view}${suffix}`)
    for (const view of ['files', 'terminal', 'logs']) {
      ctx.view = view
      ctx.load()
      assert.equal(ctx.src, '')
      assert.equal(ctx.loading, false)
      assert.match(ctx.error, /登录凭据缺失/)
    }
  }
})

test('a failed credential check clears the previous frame and allows an explicit retry', () => {
  let token = 'child-token'
  const { ctx } = harness(view => `https://panel.test/embed/${view}#paneltoken=${token}`)
  ctx.load()
  assert.notEqual(ctx.src, '')
  token = ''
  ctx.load()
  assert.equal(ctx.src, '')
  assert.match(ctx.error, /登录凭据缺失/)
  token = 'renewed-child-token'
  ctx.load()
  assert.equal(new URLSearchParams(new URL(ctx.src).hash.slice(1)).get('paneltoken'), token)
  assert.equal(ctx.error, '')
})

test('an older host gives an upgrade message without a broken iframe', () => {
  const { ctx } = harness()
  ctx.load()
  assert.equal(ctx.src, '')
  assert.equal(ctx.loading, false)
  assert.match(ctx.error, /升级面板/)
})

test('file tab delegates cancellation to the native editor before unmounting it', async () => {
  const { ctx } = harness()
  let resolveLeave
  ctx.$refs.frame = { contentWindow: { __W7_SITE_PANEL__: { canLeave: () => new Promise(resolve => { resolveLeave = resolve }) } } }
  let settled = false
  const leaving = ctx.canLeave().then(result => { settled = true; return result })
  await Promise.resolve()
  assert.equal(settled, false)
  resolveLeave(false)
  assert.equal(await leaving, false)
  ctx.$refs.frame.contentWindow.__W7_SITE_PANEL__.canLeave = async () => true
  assert.equal(await ctx.canLeave(), true)
})

test('an inaccessible file frame blocks leaving instead of silently discarding edits', async () => {
  const { ctx, messages } = harness()
  ctx.$refs.frame = Object.defineProperty({}, 'contentWindow', { get() { throw new Error('inaccessible') } })
  assert.equal(await ctx.canLeave(), false)
  assert.equal(messages.length, 1)
  ctx.view = 'terminal'
  assert.equal(await ctx.canLeave(), true)
})
