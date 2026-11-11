const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('../ui/node_modules/@babel/core')
const { parse } = require('../ui/node_modules/@vue/compiler-sfc')

const root = path.resolve(__dirname, '../ui/src')
const ingressApi = '/apis/networking.k8s.io/v1/namespaces/tenant/ingresses'
const profileApi = '/panel-api/v1/dns-profiles'
const copy = value => JSON.parse(JSON.stringify(value))

function ingress(name = 'primary', host = 'site.example.com', auto = false) {
  const value = {
    apiVersion: 'networking.k8s.io/v1', kind: 'Ingress',
    metadata: { name, namespace: 'tenant', uid: `${name}-uid`, resourceVersion: '7',
      labels: { owner: 'keep' }, annotations: {
        'kubernetes.io/ingress.class': 'higress', 'w7.cc/site-domain': 'site',
        'custom.example.com/keep': 'original',
      } },
    spec: { ingressClassName: 'higress', rules: [{ host, http: { paths: [{ path: '/', pathType: 'Prefix',
      backend: { service: { name: 'site', port: { number: 8080 } } } }] } }] },
  }
  if (auto) {
    Object.assign(value.metadata.annotations, {
      'cert-manager.io/cluster-issuer': 'w7-letsencrypt-prod',
      'cert-manager.io/renew-before': '30m', 'w7.cc/ssl-redirect': 'false',
    })
    value.spec.tls = [{ hosts: [host], secretName: `${name}-existing-tls` }]
  }
  return value
}

function harness({ resources = [ingress(), ingress('alias', 'alias.example.com')], profiles = [], onGet, onPut, onPost } = {}) {
  const stored = new Map(resources.map(resource => [resource.metadata.name, copy(resource)]))
  const calls = [], messages = []
  const api = {
    async get(url) {
      calls.push({ method: 'GET', url })
      if (onGet) { const result = await onGet(url); if (result !== undefined) return result }
      if (url === profileApi) return { data: copy(profiles) }
      if (url === ingressApi) return { data: { items: [...stored.values()].map(copy) } }
      if (url.startsWith(`${ingressApi}/`)) {
        const value = stored.get(decodeURIComponent(url.slice(ingressApi.length + 1)))
        if (!value) throw new Error('Ingress not found')
        return { data: copy(value) }
      }
      throw new Error(`Unexpected GET: ${url}`)
    },
    async put(url, body) {
      calls.push({ method: 'PUT', url, body: copy(body) })
      if (onPut) { const result = await onPut(url, body); if (result !== undefined) return result }
      assert.equal(url, `${ingressApi}/${encodeURIComponent(body.metadata.name)}`)
      const saved = copy(body)
      saved.metadata.resourceVersion = String(Number(saved.metadata.resourceVersion) + 1)
      stored.set(saved.metadata.name, saved)
      return { data: copy(saved) }
    },
    async post(url, body) {
      calls.push({ method: 'POST', url, body: copy(body) })
      if (onPost) { const result = await onPost(url, body); if (result !== undefined) return result }
      const profile = url.match(/^\/panel-api\/v1\/dns-profiles\/([^/]+)\/grant$/)?.[1]
      assert(profile, `Unexpected POST: ${url}`)
      return { data: { 'w7.cc/dns-profile': decodeURIComponent(profile), 'w7.cc/dns-grant': 'test-grant',
        'cert-manager.io/cluster-issuer': `w7-dns-${decodeURIComponent(profile)}` } }
    },
    async delete(url) { throw new Error(`Unexpected DELETE: ${url}`) },
    async exec() { throw new Error('HTTPS toggles must not execute container commands') },
  }
  const cache = new Map()
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const source = fs.readFileSync(filename, 'utf8')
    const script = filename.endsWith('.vue') ? parse(source, { filename }).descriptor.script.content : source
    const code = babel.transformSync(script, { configFile: false,
      plugins: [require('../ui/node_modules/@babel/plugin-transform-modules-commonjs')] }).code
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(code, { exports, URL, setTimeout, window: {}, require(target) {
      if (target === '@/utils/panel' || target === './panel') return { __esModule: true, default: api }
      if (target === '@/utils/site-context') return { loadSiteContext() { throw new Error('Inline HTTPS does not need application discovery') } }
      const resolved = target.startsWith('@/') ? path.join(root, target.slice(2)) : path.resolve(path.dirname(filename), target)
      return load(path.extname(resolved) ? resolved : `${resolved}.js`)
    } }, { filename })
    return exports
  }
  const component = load(path.join(root, 'components/site/DomainConfig.vue')).default
  const ctx = { ...component.data(), context: { namespace: 'tenant', group: 'site', hostname: 'site.example.com',
    application: { metadata: { name: 'site' } }, tool: { metadata: { name: 'site-tool' } } },
    ingresses: resources.map(copy), $message: { success: message => messages.push(message), error: message => messages.push(message) } }
  for (const [name, method] of Object.entries(component.methods)) ctx[name] = method.bind(ctx)
  for (const [name, computed] of Object.entries(component.computed)) Object.defineProperty(ctx, name, { get: computed.bind(ctx) })
  return { ctx, calls, messages, stored }
}

test('enabling inline HTTPS updates the selected domain while preserving routing and other resources', async () => {
  const { ctx, calls, stored } = harness()
  const before = copy(ctx.ingresses), row = ctx.rows[0]
  await ctx.toggleHttps(row, true)
  assert.deepEqual(calls.map(call => `${call.method} ${call.url}`), [`GET ${ingressApi}/primary`, `PUT ${ingressApi}/primary`])
  const saved = stored.get('primary')
  assert.deepEqual(saved.spec.rules, before[0].spec.rules)
  assert.deepEqual(saved.spec.tls, [{ hosts: ['site.example.com'], secretName: 'primary-tls' }])
  assert.equal(saved.spec.ingressClassName, 'higress')
  assert.equal(saved.metadata.annotations['cert-manager.io/cluster-issuer'], 'w7-letsencrypt-prod')
  assert.equal(saved.metadata.annotations['custom.example.com/keep'], 'original')
  assert.deepEqual(saved.metadata.labels, before[0].metadata.labels)
  assert.deepEqual(stored.get('alias'), before[1])
  assert.equal(ctx.rows[0].auto, true)
  assert.equal(ctx.rows[0].https, true)
  assert.equal(ctx.busy, false)
})

test('disabling inline HTTPS removes certificate configuration without changing domain routing', async () => {
  const value = ingress('primary', 'site.example.com', true)
  Object.assign(value.metadata.annotations, { 'w7.cc/dns-profile': 'old', 'w7.cc/dns-grant': 'old-grant' })
  const { ctx, calls, stored } = harness({ resources: [value] })
  await ctx.toggleHttps(ctx.rows[0], false)
  const saved = stored.get('primary')
  assert.equal(saved.spec.tls, undefined)
  assert.deepEqual(saved.spec.rules, value.spec.rules)
  for (const key of ['cert-manager.io/cluster-issuer', 'cert-manager.io/renew-before', 'w7.cc/ssl-redirect', 'w7.cc/dns-profile', 'w7.cc/dns-grant'])
    assert.equal(saved.metadata.annotations[key], undefined)
  assert.equal(saved.metadata.annotations['custom.example.com/keep'], 'original')
  assert.equal(ctx.rows[0].auto, false)
  assert(!calls.some(call => call.method === 'POST'))
})

test('an inline toggle keeps a partially completed new-domain form intact', async () => {
  const { ctx } = harness()
  const draft = { host: 'new.example.com', autoHttps: true, ingressClass: 'higress', profileId: 'draft-profile', backendPort: 8080 }
  ctx.form = draft
  await ctx.toggleHttps(ctx.rows[0], true)
  assert.equal(ctx.form, draft)
  assert.deepEqual(ctx.form, { host: 'new.example.com', autoHttps: true, ingressClass: 'higress', profileId: 'draft-profile', backendPort: 8080 })
  assert.equal(ctx.hasDraft(), true)
})

test('failed writes retain the confirmed checkbox state and the new-domain draft', async () => {
  const { ctx, stored } = harness({ onPut() { throw { response: { data: { message: 'permission denied' } } } } })
  const before = copy(ctx.ingresses), draft = { host: 'new.example.com', autoHttps: false }
  ctx.form = draft
  await ctx.toggleHttps(ctx.rows[0], true)
  assert.deepEqual(copy(ctx.ingresses), before)
  assert.deepEqual(stored.get('primary'), before[0])
  assert.equal(ctx.rows[0].auto, false)
  assert.equal(ctx.error, 'permission denied')
  assert.equal(ctx.form, draft)
  assert.equal(ctx.busy, false)
})

test('the native checkbox is restored during saving and a failed toggle can be retried', async () => {
  let release, fail = true
  const hold = new Promise(resolve => { release = resolve })
  const { ctx, calls } = harness({ async onPut() { await hold; if (fail) throw new Error('temporary failure') } })
  const input = { type: 'checkbox', checked: true }
  const request = ctx.toggleHttps(ctx.rows[0], true, { target: input })
  assert.equal(input.checked, false, 'keep the native input aligned with the confirmed model while saving')
  assert.equal(ctx.rows[0].auto, false)
  assert.equal(ctx.busy, true)
  release()
  await request
  assert.equal(input.checked, false)
  assert.equal(ctx.rows[0].auto, false)
  fail = false
  input.checked = true // the user clicks the same unchecked control again
  await ctx.toggleHttps(ctx.rows[0], input.checked, { target: input })
  assert.equal(ctx.rows[0].auto, true)
  assert.equal(ctx.error, '')
  assert.equal(calls.filter(call => call.method === 'PUT').length, 2)
})

test('changed resource versions and recreated Ingresses are never overwritten', async t => {
  for (const change of [{ resourceVersion: '8' }, { uid: 'replacement-uid' }]) await t.test(Object.keys(change)[0], async () => {
    const value = ingress()
    const { ctx, calls } = harness({ onGet(url) { if (url === `${ingressApi}/primary`) return { data: {
      ...copy(value), metadata: { ...value.metadata, ...change },
    } } } })
    await ctx.toggleHttps(ctx.rows[0], true)
    assert(!calls.some(call => call.method !== 'GET'))
    assert.equal(ctx.rows[0].auto, false)
    assert.match(ctx.error, /修改|刷新/)
    assert.equal(ctx.busy, false)
  })
})

test('a pending request blocks duplicate toggles and is visible to the leave guard immediately', async () => {
  let release
  const hold = new Promise(resolve => { release = resolve })
  const { ctx, calls } = harness({ async onGet(url) { if (url === `${ingressApi}/primary`) await hold } })
  const first = ctx.toggleHttps(ctx.rows[0], true)
  assert.equal(ctx.busy, true)
  assert.equal(ctx.hasDraft(), true)
  await ctx.toggleHttps(ctx.rows[1], true)
  assert.equal(calls.length, 1)
  assert.equal(ctx.rows[0].auto, false)
  release()
  await first
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1)
  assert.equal(ctx.busy, false)
  assert.equal(ctx.hasDraft(), false)
})

test('complex routing, manual certificates and the fallback domain cannot be changed inline', async () => {
  const complex = ingress('complex', 'complex.example.com')
  complex.spec.rules[0].http.paths.push({ path: '/api', pathType: 'Prefix', backend: { service: { name: 'other', port: { number: 80 } } } })
  const manual = ingress('manual', 'manual.example.com')
  manual.spec.tls = [{ hosts: ['manual.example.com'], secretName: 'manual-secret' }]
  const { ctx, calls } = harness({ resources: [complex, manual] })
  for (const row of ctx.rows) {
    assert(!row.editable)
    await ctx.toggleHttps(row, true)
  }
  assert.equal(calls.length, 0)
})

test('busy, loading, unchanged, pending-profile and delete-confirmation controls make no requests', async () => {
  for (const state of [{ busy: true }, { loading: true }, { httpsDraft: { key: 'pending' } }, { removeRow: { key: 'deleting' } }, {}]) {
    const { ctx, calls } = harness()
    const row = ctx.rows[0]
    Object.assign(ctx, state)
    await ctx.toggleHttps(row, Object.keys(state).length ? true : false)
    assert.equal(calls.length, 0)
  }
})

test('a delete confirmation blocks wildcard profile loading and preserves the current native checkbox', async () => {
  const value = ingress('wildcard', '*.example.com')
  const { ctx, calls } = harness({ resources: [value] })
  const row = ctx.rows.find(row => row.host === '*.example.com')
  ctx.removeRow = row
  const input = { type: 'checkbox', checked: true }
  await ctx.toggleHttps(row, true, { target: input })
  assert.equal(input.checked, false)
  assert.equal(ctx.httpsDraft, null)
  assert.equal(ctx.removeRow, row)
  assert.equal(calls.length, 0)
})

test('an existing wildcard DNS profile is granted before the Ingress is updated', async () => {
  const value = ingress('wildcard', '*.example.com')
  value.metadata.annotations['w7.cc/dns-profile'] = 'known-profile'
  const { ctx, calls, stored } = harness({ resources: [value] })
  await ctx.toggleHttps(ctx.rows.find(row => row.host === '*.example.com'), true)
  assert.deepEqual(calls.map(call => `${call.method} ${call.url}`), [
    `GET ${ingressApi}/wildcard`, `POST ${profileApi}/known-profile/grant`, `PUT ${ingressApi}/wildcard`,
  ])
  assert.deepEqual(calls.find(call => call.method === 'POST').body, { namespace: 'tenant', name: 'wildcard', host: '*.example.com' })
  assert.equal(stored.get('wildcard').metadata.annotations['w7.cc/dns-grant'], 'test-grant')
  assert.equal(stored.get('wildcard').metadata.annotations['cert-manager.io/cluster-issuer'], 'w7-dns-known-profile')
})

test('one matching DNS zone can enable wildcard HTTPS without asking for unrelated profiles', async () => {
  const value = ingress('wildcard', '*.deep.example.com')
  const { ctx, calls, stored } = harness({ resources: [value], profiles: [
    { id: 'outside', zone: 'notexample.com' }, { id: 'match', zone: 'example.com' }, { id: 'unrelated', zone: 'other.test' },
  ] })
  await ctx.toggleHttps(ctx.rows.find(row => row.host === value.spec.rules[0].host), true)
  assert.equal(ctx.httpsDraft, null)
  assert.equal(stored.get('wildcard').metadata.annotations['w7.cc/dns-profile'], 'match')
  assert(calls.some(call => call.url === `${profileApi}/match/grant`))
  assert(!calls.some(call => call.url.includes('/outside/') || call.url.includes('/unrelated/')))
})

test('multiple matching DNS profiles require confirmation and preserve a new-domain draft', async () => {
  const value = ingress('wildcard', '*.sub.example.com')
  const { ctx, calls, stored } = harness({ resources: [value], profiles: [
    { id: 'parent', zone: 'example.com' }, { id: 'child', zone: 'sub.example.com' }, { id: 'outside', zone: 'other.test' },
  ] })
  const newDomain = { host: 'new.example.com', autoHttps: true }
  ctx.form = newDomain
  await ctx.toggleHttps(ctx.rows.find(row => row.host === value.spec.rules[0].host), true)
  const pending = ctx.httpsDraft
  assert(pending)
  assert.deepEqual(copy(pending.profiles).map(profile => profile.id), ['parent', 'child'])
  assert.equal(pending.profileId, '')
  assert.equal(ctx.hasDraft(), true)
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0)
  pending.profileId = 'child'
  await ctx.confirmHttps()
  assert.equal(ctx.httpsDraft, null)
  assert.equal(ctx.form, newDomain)
  assert.equal(stored.get('wildcard').metadata.annotations['w7.cc/dns-profile'], 'child')
  assert(calls.some(call => call.method === 'POST' && call.url === `${profileApi}/child/grant`))
})

test('a wildcard without a verified DNS profile remains unchanged and cannot be confirmed', async () => {
  const value = ingress('wildcard', '*.example.com')
  const { ctx, calls, stored } = harness({ resources: [value], profiles: [{ id: 'outside', zone: 'notexample.com' }] })
  await ctx.toggleHttps(ctx.rows.find(row => row.host === value.spec.rules[0].host), true)
  assert.deepEqual(copy(ctx.httpsDraft.profiles), [])
  await ctx.confirmHttps()
  assert(!calls.some(call => call.method === 'PUT' || call.method === 'POST'))
  assert.deepEqual(stored.get('wildcard'), value)
  assert.equal(ctx.hasDraft(), true)
  assert.equal(ctx.busy, false)
})

test('failed DNS grants never enable wildcard TLS or discard the profile selection', async () => {
  const value = ingress('wildcard', '*.example.com')
  const { ctx, calls, stored } = harness({ resources: [value], profiles: [
    { id: 'first', zone: 'example.com' }, { id: 'second', zone: 'example.com' },
  ], onPost() { return { data: {} } } })
  await ctx.toggleHttps(ctx.rows.find(row => row.host === value.spec.rules[0].host), true)
  ctx.httpsDraft.profileId = 'first'
  const pending = ctx.httpsDraft
  await ctx.confirmHttps()
  assert(!calls.some(call => call.method === 'PUT'))
  assert.deepEqual(stored.get('wildcard'), value)
  assert.equal(ctx.httpsDraft, pending)
  assert.match(ctx.error, /DNS|授权/)
  assert.equal(ctx.busy, false)
})

test('manual TLS is protected even when its hosts are omitted, wildcarded or unrelated', async t => {
  for (const [label, tls, https] of [
    ['omitted hosts', [{ secretName: 'shared-manual-secret' }], true],
    ['empty hosts', [{ hosts: [], secretName: 'shared-manual-secret' }], true],
    ['wildcard host', [{ hosts: ['*.example.com'], secretName: 'shared-manual-secret' }], true],
    ['another host', [{ hosts: ['other.example.com'], secretName: 'shared-manual-secret' }], false],
    ['mixed entries', [{ hosts: ['site.example.com'], secretName: 'site-manual-secret' },
      { hosts: ['other.example.com'], secretName: 'shared-manual-secret' }], true],
  ]) await t.test(label, async () => {
    const value = ingress()
    value.spec.tls = tls
    const { ctx, calls, stored } = harness({ resources: [value] })
    const row = ctx.rows[0]
    assert.equal(row.https, https)
    assert.equal(row.auto, false)
    assert.equal(row.editable, false)
    await ctx.toggleHttps(row, true)
    assert.equal(calls.length, 0)
    assert.deepEqual(stored.get(value.metadata.name), value)
  })
})

test('TLS wildcard display matches one label and does not cover the zone or deeper subdomains', () => {
  for (const [host, expected] of [
    ['site.example.com', true], ['example.com', false], ['deep.site.example.com', false],
    ['otherexample.com', false], ['*.example.com', true],
  ]) {
    const value = ingress('wildcard-display', host)
    value.spec.tls = [{ hosts: ['*.example.com'], secretName: 'shared-manual-secret' }]
    const { ctx } = harness({ resources: [value] })
    const row = ctx.rows.find(item => item.host === host)
    assert.equal(row.https, expected, host)
    assert.equal(row.editable, false, host)
  }
})

test('automatic certificates with multiple TLS entries or additional hosts cannot be changed inline', async t => {
  for (const [label, tls] of [
    ['multiple entries', [{ hosts: ['site.example.com'], secretName: 'primary-existing-tls' },
      { hosts: ['other.example.com'], secretName: 'shared-secret' }]],
    ['additional hosts', [{ hosts: ['site.example.com', 'other.example.com'], secretName: 'shared-secret' }]],
    ['wildcard certificate', [{ hosts: ['*.example.com'], secretName: 'shared-secret' }]],
    ['unspecified hosts', [{ secretName: 'shared-secret' }]],
  ]) await t.test(label, async () => {
    const value = ingress('primary', 'site.example.com', true)
    value.spec.tls = tls
    const { ctx, calls, stored } = harness({ resources: [value] })
    const row = ctx.rows[0]
    assert.equal(row.https, true)
    assert.equal(row.auto, true)
    assert.equal(row.editable, false)
    await ctx.toggleHttps(row, false)
    assert.equal(calls.length, 0)
    assert.deepEqual(stored.get(value.metadata.name), value)
  })
})

test('the save operation rejects protected TLS even if an inline draft bypasses the disabled control', async t => {
  const manual = ingress()
  manual.spec.tls = [{ secretName: 'shared-manual-secret' }]
  const multiple = ingress('primary', 'site.example.com', true)
  multiple.spec.tls.push({ hosts: ['other.example.com'], secretName: 'shared-secret' })
  const complex = ingress()
  complex.spec.rules[0].http.paths.push({ path: '/api', backend: { service: { name: 'site', port: { number: 8080 } } } })
  for (const [label, value, enabled] of [['manual', manual, true], ['multiple TLS entries', multiple, false], ['complex routes', complex, true]]) {
    await t.test(label, async () => {
      const { ctx, calls, stored } = harness({ resources: [value] })
      const result = await ctx.updateHttps({ ingress: value, host: 'site.example.com', autoHttps: enabled })
      assert.equal(result, false)
      assert.deepEqual(calls.map(call => call.method), ['GET'])
      assert.deepEqual(stored.get(value.metadata.name), value)
      assert.match(ctx.error, /证书|路由/)
      assert.equal(ctx.busy, false)
    })
  }
})

test('a single-domain automatic wildcard certificate can still be switched off and on', async () => {
  const value = ingress('wildcard', '*.example.com', true)
  Object.assign(value.metadata.annotations, {
    'cert-manager.io/cluster-issuer': 'w7-dns-profile', 'w7.cc/dns-profile': 'profile', 'w7.cc/dns-grant': 'previous-grant',
  })
  const { ctx, stored } = harness({ resources: [value], profiles: [{ id: 'profile', zone: 'example.com' }] })
  const row = () => ctx.rows.find(item => item.host === '*.example.com')
  assert.equal(row().editable, true)
  await ctx.toggleHttps(row(), false)
  assert.equal(stored.get('wildcard').spec.tls, undefined)
  assert.equal(row().editable, true)
  await ctx.toggleHttps(row(), true)
  assert.equal(row().auto, true)
  assert.equal(row().https, true)
  assert.deepEqual(stored.get('wildcard').spec.rules, value.spec.rules)
  assert.equal(stored.get('wildcard').metadata.annotations['cert-manager.io/cluster-issuer'], 'w7-dns-profile')
})
