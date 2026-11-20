const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('../ui/node_modules/@babel/core')
const { parse } = require('../ui/node_modules/@vue/compiler-sfc')
const { compile } = require('../ui/node_modules/@vue/compiler-dom')
const Vue = require('../ui/node_modules/vue')
const root = path.resolve(__dirname, '../ui/src')
const copy = value => JSON.parse(JSON.stringify(value))
const ingressUrl = '/apis/networking.k8s.io/v1/namespaces/tenant/ingresses'
const profileUrl = '/panel-api/v1/dns-profiles'
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const settle = async () => { await Vue.nextTick(); await new Promise(resolve => setImmediate(resolve)); await Vue.nextTick() }

function ingress(name = 'primary', host = 'site.example.com', auto = false) {
  return { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress',
    metadata: { name, namespace: 'tenant', uid: `${name}-uid`, resourceVersion: '1', annotations: {
      'w7.cc/site-domain': 'site', ...(auto ? { 'cert-manager.io/cluster-issuer': 'w7-letsencrypt-prod' } : {}),
    } },
    spec: { rules: [{ host, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'site', port: { number: 8080 } } } }] } }],
      ...(auto ? { tls: [{ hosts: [host], secretName: `${name}-tls` }] } : {}) } }
}
function node(tag = '', text = '') { return { tag, text, parent: null, children: [], props: {} } }
const renderer = Vue.createRenderer({
  createElement: tag => node(tag), createText: text => node('', text), createComment: text => node('', text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at < 0) parent.children.push(child); else parent.children.splice(at, 0, child)
  },
  remove(child) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null },
  parentNode: child => child.parent,
  nextSibling(child) { const siblings = child.parent?.children || []; return siblings[siblings.indexOf(child) + 1] || null },
  setText: (target, text) => { target.text = text },
  setElementText(target, text) { target.text = text; target.children = [] },
  patchProp: (target, key, previous, value) => { target.props[key] = value },
})
function findAll(target, predicate) { return [...(predicate(target) ? [target] : []), ...target.children.flatMap(child => findAll(child, predicate))] }
const textOf = target => target.text + target.children.map(textOf).join('')
const valueOf = target => target.props.modelValue ?? target.props['model-value']
function keyup(target, key) { for (const listener of [target.props.onKeyup].flat().filter(Boolean)) listener({ key }) }

async function harness({ resources = [ingress(), ingress('alias', 'alias.example.com')], profiles = [], onProfiles, onRename, onVerify } = {}) {
  const requests = [], renamed = [], verified = [], messages = [], refreshed = []
  const context = Vue.reactive({ group: 'site', namespace: 'tenant', hostname: 'site.example.com', gatewayEnabled: false,
    appGroup: { metadata: { name: 'site', uid: 'group-uid', resourceVersion: '1', annotations: { 'w7.cc/default-domain': 'https://site.example.com/' } } },
    application: { metadata: { name: 'site' } }, service: { metadata: { name: 'site' }, spec: { ports: [{ port: 8080, protocol: 'TCP' }] } },
    directory: { containerName: 'web', path: '/www/wwwroot' } })
  const api = { async get(url) {
    requests.push(url)
    if (url === ingressUrl) return { data: { items: copy(resources) } }
    if (url === profileUrl) return onProfiles ? onProfiles() : { data: copy(profiles) }
    if (url === '/panel-api/v1/auth/domain-white-list') return { data: [] }
    if (url === '/apis/networking.k8s.io/v1/ingressclasses') return { data: { items: [{ metadata: { name: 'higress' } }] } }
    throw new Error(`Unexpected request: ${url}`)
  } }
  const cache = new Map()
  function load(relative) {
    const filename = path.resolve(root, relative)
    if (cache.has(filename)) return cache.get(filename)
    const source = fs.readFileSync(filename, 'utf8')
    const descriptor = filename.endsWith('.vue') ? parse(source, { filename }).descriptor : null
    const exports = {}; cache.set(filename, exports)
    const code = babel.transformSync(descriptor ? descriptor.script.content : source, { configFile: false,
      plugins: [require('../ui/node_modules/@babel/plugin-transform-modules-commonjs')] }).code
    vm.runInNewContext(code, { exports, URL, setTimeout, window: {}, require(target) {
      if (target === '@/utils/panel' || target === './panel') return { __esModule: true, default: api }
      if (target === '@/utils/site-context' || target === './site-context') return {
        loadSiteContext: async () => context,
      }
      if (target === './DomainParseAlert.vue') return { __esModule: true, default: { render: () => null } }
      if (target === '@/utils/site-domain-edit') return {
        canEditDomain: (ctx, value, host) => !!value?.metadata?.uid && value.spec.rules.some(rule => rule.host === host),
        matchingDnsProfiles: (items, host) => items.filter(item => host.replace(/^\*\./, '').endsWith(item.zone)),
        async renameSiteDomain(...args) {
          renamed.push(args)
          if (onRename) return onRename(...args)
          const body = copy(args[1]); body.spec.rules.find(rule => rule.host === args[4]).host = args[2]
          return { ingress: body, unchanged: false }
        },
        async verifySiteDomainRename(...args) { verified.push(args); if (onVerify) return onVerify(...args); throw new Error('No verified result') },
      }
      if (target === 'element-plus') return { ElMessageBox: { confirm: async () => {} } }
      const resolved = target.startsWith('@/') ? path.join(root, target.slice(2)) : path.resolve(path.dirname(filename), target)
      return load(path.relative(root, path.extname(resolved) ? resolved : `${resolved}.js`))
    } }, { filename })
    if (descriptor) exports.default.render = new Function('Vue', compile(descriptor.template.content, { mode: 'function', prefixIdentifiers: true }).code)({ ...Vue, vModelRadio: {}, vModelText: {} })
    return exports
  }
  const Domain = load('components/site/DomainConfig.vue').default
  const container = node('root'), app = renderer.createApp(Domain, { context, onRefresh: value => refreshed.push(value) })
  app.config.warnHandler = () => {}
  app.directive('loading', {})
  app.config.globalProperties.$message = Object.fromEntries(['success', 'error', 'info', 'warning'].map(name => [name, text => messages.push({ name, text })]))
  for (const name of ['el-input', 'el-button', 'el-select', 'el-option', 'el-checkbox', 'el-alert', 'el-form', 'el-form-item', 'router-link']) app.component(name, {
    inheritAttrs: false, render() { return Vue.h(name, this.$attrs, this.$slots.default?.()) },
  })
  const parent = app.mount(container); await settle()
  const ctx = parent
  assert.equal(ctx.loading, false)
  const inputs = () => findAll(container, target => target.tag === 'el-input' && typeof target.props['aria-label'] === 'string' && target.props['aria-label'].startsWith('域名 '))
  const input = host => { const found = inputs().find(target => target.props['aria-label'] === `域名 ${host}`); assert(found, `domain input ${host} must be rendered`); return found }
  const type = async (host, value) => { const inputNode = input(host); assert.equal(!!inputNode.props.disabled, false); const pending = inputNode.props['onUpdate:modelValue'](value); await Vue.nextTick(); return pending }
  return { app, ctx, parent, context, container, inputs, input, type, requests, renamed, verified, messages, refreshed }
}

test('additional domains are inline inputs from first render including the primary domain', async t => {
  const shared = ingress('shared', 'first.example.com'); shared.spec.rules.push(copy(ingress('x', 'second.example.com').spec.rules[0]))
  const state = await harness({ resources: [shared, ingress()] }); t.after(() => state.app.unmount())
  assert.deepEqual(state.inputs().map(valueOf), ['site.example.com', 'first.example.com', 'second.example.com'])
  assert.equal(state.input('site.example.com').props.disabled, false)
  assert.equal(state.input('first.example.com').props.disabled, false)
  assert.equal(state.input('second.example.com').props.disabled, false)
  assert.equal(findAll(state.container, target => target.tag === 'el-button' && textOf(target) === '编辑').length, 0)
  assert.equal(findAll(state.container, target => /(?:^|\s)domain-edit(?:\s|$)/.test(target.props.class || '')).length, 0)
  await state.type('second.example.com', 'changed.example.com')
  assert.equal(state.ctx.editDraft.oldHost, 'second.example.com'); assert.equal(state.ctx.editDraft.host, 'changed.example.com')
  assert.equal(state.inputs().length, 3, 'editing reuses the original input rather than adding another form')
  await state.ctx.saveEdit(); await settle()
  assert.equal(state.renamed.length, 1); assert.equal(state.renamed[0][4], 'second.example.com')
  assert.equal(state.ctx.rows.find(row => row.host === 'first.example.com').host, 'first.example.com')
  assert(state.ctx.rows.some(row => row.host === 'changed.example.com'))
})

test('cancel restores the original inline alias value and releases the other editable inputs', async t => {
  const state = await harness({ resources: [ingress(), ingress('alias', 'alias.example.com'), ingress('other', 'other.example.com')] }); t.after(() => state.app.unmount())
  await state.type('alias.example.com', 'draft.example.com')
  assert.equal(valueOf(state.input('alias.example.com')), 'draft.example.com')
  assert.equal(state.input('other.example.com').props.disabled, true)
  keyup(state.input('alias.example.com'), 'Escape'); await settle()
  assert.equal(state.ctx.editDraft, null)
  assert.equal(valueOf(state.input('alias.example.com')), 'alias.example.com')
  assert.equal(state.input('alias.example.com').props.disabled, false)
  assert.equal(state.input('other.example.com').props.disabled, false)
  assert.equal(state.input('site.example.com').props.disabled, false)
  assert.equal(state.renamed.length, 0)
})

test('save failure keeps the same inline input and draft for correction or retry', async t => {
  const state = await harness({ onRename: async () => { throw new Error('保存连接失败') } }); t.after(() => state.app.unmount())
  await state.type('alias.example.com', 'new.example.com')
  keyup(state.input('alias.example.com'), 'Enter'); await settle()
  assert.match(state.ctx.error, /连接失败/)
  assert.equal(state.ctx.editDraft.host, 'new.example.com')
  assert.equal(valueOf(state.input('alias.example.com')), 'new.example.com')
  assert.equal(state.ctx.busy, false)
  assert.equal(state.ctx.hasDraft(), true)
})

test('the primary domain can be edited and submitted using its original selected host', async t => {
  const state = await harness(); t.after(() => state.app.unmount())
  await state.type('site.example.com', 'new.example.com')
  await state.ctx.saveEdit(); await settle()
  assert.equal(state.renamed.length, 1)
  assert.equal(state.renamed[0][2], 'new.example.com')
  assert.equal(state.renamed[0][4], 'site.example.com')
})

test('a synthetic primary domain without an Ingress remains read-only and does not request creation options', async t => {
  const state = await harness({ resources: [] }); t.after(() => state.app.unmount())
  const requests = state.requests.length
  const primary = state.ctx.rows[0]
  assert.equal(primary.key, 'default'); assert.equal(state.input(primary.host).props.disabled, true)
  await state.input(primary.host).props['onUpdate:modelValue']('forged.example.com')
  await state.ctx.edit(primary, 'forged.example.com'); await state.ctx.saveEdit(); await settle()
  assert.equal(state.ctx.editDraft, null)
  assert.equal(state.requests.length, requests)
  assert.equal(state.renamed.length, 0)
  assert.deepEqual(Array.from(state.ctx.rows, row => row.host), ['site.example.com'])
})

test('DNS loading allows continued typing, and a canceled response cannot overwrite the next row draft', async t => {
  const first = deferred(), second = deferred(); let loads = 0
  const state = await harness({ resources: [ingress(), ingress('alias', 'alias.example.com', true), ingress('second', 'second.example.com', true)],
    onProfiles: () => (++loads === 1 ? first.promise : second.promise) }); t.after(() => state.app.unmount())
  const start = state.input('alias.example.com').props['onUpdate:modelValue']('draft.example.com'); await Vue.nextTick()
  assert.equal(state.ctx.editLoading, true); assert.equal(!!state.input('alias.example.com').props.disabled, false)
  await state.type('alias.example.com', 'latest.example.com'); assert.equal(state.ctx.editDraft.host, 'latest.example.com')
  state.ctx.cancelEdit(); await settle()
  const next = state.input('second.example.com').props['onUpdate:modelValue']('*.second.example.com'); await Vue.nextTick()
  const nextDraft = state.ctx.editDraft
  second.resolve({ data: [{ id: 'second-profile', zone: 'second.example.com' }] }); await next; await settle()
  assert.equal(nextDraft.profileId, 'second-profile')
  first.resolve({ data: [{ id: 'first-profile', zone: 'example.com' }] }); await start; await settle()
  assert.equal(state.ctx.editDraft, nextDraft); assert.equal(state.ctx.editDraft.host, '*.second.example.com')
  assert.equal(nextDraft.profileId, 'second-profile')
  assert.deepEqual(Array.from(state.ctx.editProfiles, profile => profile.id), ['second-profile'], 'a stale profile response must not replace the active row DNS choices')
})

test('uncertain submission stays inline and verification applies the result without a duplicate rename', async t => {
  const pending = { id: 'pending-write' }
  const state = await harness({ onRename: async () => { throw Object.assign(new Error('提交状态未确认'), { uncertain: true, pending }) },
    onVerify: async () => { const saved = ingress('alias', 'verified.example.com'); return { applied: true, ingress: saved } } }); t.after(() => state.app.unmount())
  await state.type('alias.example.com', 'verified.example.com'); await state.ctx.saveEdit(); await settle()
  assert.equal(state.ctx.editDraft.uncertain, true); assert.equal(state.input('alias.example.com').props.disabled, true)
  await state.ctx.saveEdit(); assert.equal(state.renamed.length, 1)
  await state.ctx.verifyEdit(); await settle()
  assert.equal(state.verified.length, 1); assert.deepEqual(copy(state.verified[0][1]), pending)
  assert.equal(state.ctx.editDraft, null); assert(state.ctx.rows.some(row => row.host === 'verified.example.com'))
})

test('verification that finds no submission retains the inline draft and enables a deliberate retry', async t => {
  const state = await harness({ onRename: async () => { throw Object.assign(new Error('提交状态未确认'), { uncertain: true, pending: { id: 'pending' } }) },
    onVerify: async () => ({ applied: false }) }); t.after(() => state.app.unmount())
  await state.type('alias.example.com', 'new.example.com'); await state.ctx.saveEdit(); await settle()
  await state.ctx.verifyEdit(); await settle()
  assert.equal(state.ctx.editDraft.uncertain, false); assert.equal(state.ctx.editDraft.pending, null)
  assert.equal(state.ctx.editDraft.host, 'new.example.com'); assert.equal(valueOf(state.input('alias.example.com')), 'new.example.com')
  assert.equal(state.input('alias.example.com').props.disabled, false); assert.match(state.ctx.error, /未生效.*草稿已保留/)
  assert.equal(state.renamed.length, 1, 'verification must not repeat the write automatically')
})

test('a confirmed unapplied edit adopts the observed resource version before the user retries', async t => {
  let writes = 0
  const observed = ingress('alias', 'alias.example.com'); observed.metadata.resourceVersion = 'newer-version'
  const state = await harness({ onRename: async (_, original, host) => {
    if (++writes === 1) throw Object.assign(new Error('提交状态未确认'), { uncertain: true, pending: { id: 'pending' } })
    assert.equal(original.metadata.resourceVersion, 'newer-version')
    const saved = copy(original); saved.spec.rules[0].host = host
    return { ingress: saved }
  }, onVerify: async () => ({ applied: false, ingress: observed }) }); t.after(() => state.app.unmount())
  await state.type('alias.example.com', 'new.example.com'); await state.ctx.saveEdit()
  await state.ctx.verifyEdit()
  assert.equal(state.ctx.editDraft.ingress.metadata.resourceVersion, 'newer-version')
  assert.equal(state.ctx.editDraft.host, 'new.example.com')
  await state.ctx.saveEdit(); await settle()
  assert.equal(state.ctx.editDraft, null)
  assert(state.ctx.rows.some(row => row.host === 'new.example.com'))
})

test('an isolated certificate update merges both saved routes without restoring the old domain or dropping other rows', async t => {
  const shared = ingress('shared', 'alias.example.com', true)
  const other = copy(shared.spec.rules[0]); other.host = 'other.example.com'; shared.spec.rules.push(other)
  const state = await harness({ resources: [ingress('primary', 'site.example.com'), shared], onRename: async (_, original, host) => {
    const remaining = copy(original); remaining.spec.rules = [other]
    const selected = ingress('isolated', host, true)
    return { ingress: selected, ingresses: [remaining, selected], warning: '' }
  } }); t.after(() => state.app.unmount())
  await state.type('alias.example.com', 'renamed.example.com'); await state.ctx.saveEdit(); await settle()
  assert.deepEqual(Array.from(state.ctx.rows, row => row.host).sort(), ['site.example.com', 'other.example.com', 'renamed.example.com'].sort())
  assert.equal(state.ctx.ingresses.length, 3)
  assert.equal(state.ctx.editDraft, null)
})
