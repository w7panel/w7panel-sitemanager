const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const babel = require('../ui/node_modules/@babel/core')
const { parse } = require('../ui/node_modules/@vue/compiler-sfc')
const root = path.resolve(__dirname, '../ui/src')
const copy = value => JSON.parse(JSON.stringify(value))

function loader(api, overrides = {}, globals = {}) {
  const cache = new Map()
  function load(relative) {
    const filename = path.resolve(root, relative)
    if (cache.has(filename)) return cache.get(filename)
    const source = fs.readFileSync(filename, 'utf8')
    const script = filename.endsWith('.vue') ? parse(source, { filename }).descriptor.script.content : source
    const exports = {}
    cache.set(filename, exports)
    const code = babel.transformSync(script, { configFile: false,
      plugins: [require('../ui/node_modules/@babel/plugin-transform-modules-commonjs')] }).code
    vm.runInNewContext(code, { exports, URL, Date, setTimeout: globals.setTimeout || setTimeout, window: { $wujie: { props: { group: 'site', namespace: 'tenant' } } }, require(target) {
      if (overrides[target]) return overrides[target]
      if (target === './panel' || target === '@/utils/panel') return { __esModule: true, default: api }
      const resolved = target.startsWith('@/') ? path.join(root, target.slice(2)) : path.resolve(path.dirname(filename), target)
      return load(path.relative(root, path.extname(resolved) ? resolved : `${resolved}.js`))
    } }, { filename })
    return exports
  }
  return load
}

function alias(host = 'old.example.com', auto = false) {
  const value = { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress',
    metadata: { name: 'alias', uid: 'alias-uid', namespace: 'tenant', resourceVersion: '7', annotations: { 'w7.cc/site-domain': 'site', custom: 'keep' } },
    spec: { ingressClassName: 'nginx', rules: [{ host, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'site', port: { number: 80 } } } }] } }] } }
  if (auto) {
    value.metadata.annotations['cert-manager.io/cluster-issuer'] = 'w7-letsencrypt-prod'
    value.spec.tls = [{ hosts: [host], secretName: 'shared-old-secret' }]
  }
  return value
}

function domains({ ingress = alias(), others = [], whiteList = [], profiles = [], write = 'ok', readAfterFailure = true, gateway = false, gatewayFailure = '', sourceWrite = 'ok' } = {}) {
  let current = copy(ingress), writes = 0, sourceFailure = sourceWrite
  const resources = new Map(ingress ? [[ingress.metadata.name, copy(ingress)]] : [])
  const appGroup = { apiVersion: 'w7panel.w7.com/v1alpha1', kind: 'AppGroup', metadata: { name: 'site', namespace: 'tenant', uid: 'group-uid', resourceVersion: 'g1', annotations: { 'w7.cc/default-domain': 'https://primary.example.com:8443/original?query=keep#anchor', custom: 'keep' } } }
  const calls = [], gatewayCalls = []
  const base = '/apis/networking.k8s.io/v1/namespaces/tenant/ingresses'
  const context = { group: 'site', namespace: 'tenant', hostname: 'primary.example.com', gatewayEnabled: gateway,
    application: { metadata: { name: 'site' } }, tool: { metadata: { name: 'site-tool' } }, appGroup: copy(appGroup), service: { metadata: { name: 'site' }, spec: { ports: [{ port: 80, protocol: 'TCP' }] } } }
  const api = {
    async get(url) {
      calls.push({ method: 'GET', url })
      if (url.startsWith(base + '/')) {
        if (writes && !readAfterFailure) throw new Error('read unavailable')
        const item = resources.get(decodeURIComponent(url.slice(base.length + 1)))
        if (!item) throw { response: { status: 404 } }
        return { data: copy(item) }
      }
      if (url === base) return { data: { items: [...Array.from(resources.values()).map(copy), ...others.map(copy)] } }
      if (url === '/panel-api/v1/auth/domain-white-list') return { data: { code: 200, data: whiteList } }
      if (url === '/panel-api/v1/dns-profiles') return { data: profiles }
      if (url.startsWith(base + '/')) throw { response: { status: 404 } }
      throw new Error('Unexpected GET ' + url)
    },
    async put(url, body) {
      writes++
      calls.push({ method: 'PUT', url, body: copy(body) })
      const failure = body.metadata.name === ingress?.metadata?.name && calls.some(call => call.method === 'POST' && call.url === base) ? sourceFailure : write
      if (failure !== 'reject') { current = { ...copy(body), metadata: { ...body.metadata, resourceVersion: '8' } }; resources.set(body.metadata.name, copy(current)) }
      if (failure !== 'ok') throw new Error('connection lost')
      return { data: copy(current) }
    },
    async post(url, body) {
      calls.push({ method: 'POST', url, body: copy(body) })
      if (url === base) {
        writes++; if (write !== 'reject') { current = { ...copy(body), metadata: { ...body.metadata, uid: 'created-uid', resourceVersion: '1' } }; resources.set(body.metadata.name, copy(current)) }
        if (write !== 'ok') throw new Error('connection lost')
        return { data: copy(current) }
      }
      return { data: { 'w7.cc/dns-profile': 'new-profile', 'w7.cc/dns-grant': 'new-host-grant', 'cert-manager.io/cluster-issuer': 'w7-dns-new-profile' } }
    }
  }
  const load = loader(api, { '@/utils/site-context': { loadSiteContext: async () => context } })
  load('utils/site-domain.js').nginxDomainChange = async (_, host, add = true) => {
    gatewayCalls.push({ host, add })
    if (gatewayFailure === (add ? 'add' : 'remove')) throw new Error('gateway failed')
    return gateway ? async () => { gatewayCalls.push({ undo: true }) } : null
  }
  const actions = load('utils/site-domain-edit.js')
  return { ...actions, context, api, calls, gatewayCalls, load, current: () => current, setCurrent: value => { current = copy(value); resources.set(value.metadata.name, copy(value)) }, ingresses: () => Array.from(resources.values()).map(copy), setSourceFailure: value => { sourceFailure = value } }
}

test('renaming a custom domain preserves its route, labels and annotations, and replaces only its hostname', async () => {
  const original = alias(), state = domains()
  const result = await state.renameSiteDomain(state.context, original, ' NEW.Example.com. ')
  assert.equal(result.ingress.spec.rules[0].host, 'new.example.com')
  assert.deepEqual(copy(result.ingress.spec.rules[0].http), original.spec.rules[0].http)
  assert.deepEqual(copy(result.ingress.metadata.annotations), original.metadata.annotations)
  assert.equal(result.ingress.spec.ingressClassName, 'nginx')
  assert.equal(result.ingress.metadata.uid, original.metadata.uid)
  assert.equal(state.calls.filter(call => call.method === 'PUT').length, 1)
})

test('complex/manual-certificate routes keep their existing configuration when edited', async () => {
  for (const original of [(() => { const value = alias(); value.spec.rules[0].http.paths.push({ path: '/api' }); return value })(),
    (() => { const value = alias(); value.spec.tls = [{ hosts: ['old.example.com'], secretName: 'manual' }]; return value })()]) {
    const state = domains({ ingress: original })
    assert.equal(state.canEditDomain(state.context, original, original.spec.rules[0].host), true)
    const result = await state.renameSiteDomain(state.context, original, 'new.example.com')
    assert.equal(result.ingress.spec.rules[0].host, 'new.example.com')
    assert.deepEqual(copy(result.ingress.spec.rules[0].http), original.spec.rules[0].http)
    if (original.spec.tls) {
      assert.equal(result.ingress.spec.tls[0].secretName, 'manual')
      assert.deepEqual(copy(result.ingress.spec.tls[0].hosts), ['new.example.com'])
    }
  }
})

test('multi-rule ingress editing changes the selected domain without replacing other routes, backends, or certificates', async () => {
  const original = alias('unrelated.example.com')
  original.spec.defaultBackend = { service: { name: 'fallback', port: { number: 9090 } } }
  const target = copy(original.spec.rules[0]); target.host = 'old.example.com'
  target.http.paths.push({ path: '/api', pathType: 'Prefix', backend: { service: { name: 'api', port: { number: 8081 } } } })
  original.spec.rules.push(target)
  original.spec.tls = [{ hosts: ['unrelated.example.com'], secretName: 'unrelated-tls' }, { hosts: ['old.example.com', 'shared.example.com'], secretName: 'manual' }]
  const state = domains({ ingress: original })
  assert.equal(state.canEditDomain(state.context, original, 'old.example.com'), true)
  const saved = (await state.renameSiteDomain(state.context, original, 'new.example.com', '', 'old.example.com')).ingress
  assert.deepEqual(copy(saved.spec.rules[0]), original.spec.rules[0])
  assert.deepEqual(copy(saved.spec.rules[1].http), target.http)
  assert.deepEqual(copy(saved.spec.defaultBackend), original.spec.defaultBackend)
  assert.deepEqual(copy(saved.spec.tls[0]), original.spec.tls[0])
  assert.deepEqual(copy(saved.spec.tls[1]), { hosts: ['new.example.com', 'shared.example.com'], secretName: 'manual' })
})

test('a domain cannot edit another site or a replaced resource through its inline editor', async () => {
  for (const changed of [
    value => { value.metadata.namespace = 'other' },
    value => { value.metadata.annotations['w7.cc/site-domain'] = 'other' },
    value => { value.spec.rules[0].http.paths[0].backend.service.name = 'another-site' },
    value => { delete value.metadata.uid },
  ]) {
    const original = alias(); changed(original)
    const state = domains({ ingress: original })
    assert.equal(state.canEditDomain(state.context, original, 'old.example.com'), false)
    await assert.rejects(state.renameSiteDomain(state.context, original, 'new.example.com'), /当前站点|刷新/)
    assert.equal(state.calls.length, 0)
  }
})

test('automatic multi-domain certificates retain unrelated TLS and replace only the changed certificate Secret', async () => {
  const original = alias('old.example.com', true)
  original.spec.rules.push({ ...copy(original.spec.rules[0]), host: 'other.example.com' })
  original.spec.tls.push({ hosts: ['other.example.com'], secretName: 'other-certificate' })
  const state = domains({ ingress: original })
  const saved = (await state.renameSiteDomain(state.context, original, 'new.example.com')).ingress
  assert.deepEqual(copy(saved.spec.tls[0].hosts), ['new.example.com'])
  assert.notEqual(saved.spec.tls[0].secretName, original.spec.tls[0].secretName)
  assert.deepEqual(copy(saved.spec.tls[1]), original.spec.tls[1])
  assert.deepEqual(copy(saved.spec.rules[1]), original.spec.rules[1])
})

test('primary domains stay read-only and cannot issue any API or gateway request', async () => {
  for (const original of [alias('primary.example.com'), alias('PRIMARY.EXAMPLE.COM.'), null]) {
    const state = domains({ ingress: original, gateway: true })
    const host = original?.spec.rules[0].host || state.context.hostname
    assert.equal(state.canEditDomain(state.context, original, host), false)
    await assert.rejects(state.renameSiteDomain(state.context, original, 'new.example.com', '', host), /主域名不支持修改/)
    assert.equal(state.calls.length, 0)
    assert.equal(state.gatewayCalls.length, 0)
  }
})

test('an alias cannot be renamed to the primary hostname or resume a primary edit', async () => {
  const state = domains({ gateway: true })
  await assert.rejects(state.renameSiteDomain(state.context, alias(), 'PRIMARY.EXAMPLE.COM.'), /主域名不支持修改/)
  for (const [oldHost, host] of [['primary.example.com', 'new.example.com'], ['old.example.com', 'primary.example.com']]) {
    const pending = { namespace: 'tenant', group: 'site', body: alias(), oldHost, host }
    await assert.rejects(state.verifySiteDomainRename(state.context, pending), /主域名不支持修改/)
  }
  assert.equal(state.canEditDomain(state.context, null, 'old.example.com'), false)
  assert.equal(state.calls.length, 0)
  assert.equal(state.gatewayCalls.length, 0)
})

function sharedAutomaticIngress({ sharedTls = false, onlyTargetRule = false, dns = true } = {}) {
  const original = alias(dns ? '*.old.example.com' : 'old.example.com', true)
  const other = copy(original.spec.rules[0]); other.host = dns ? '*.other.example.net' : 'other.example.com'
  if (!onlyTargetRule) original.spec.rules.push(other)
  if (sharedTls) original.spec.tls[0].hosts.push(other.host)
  else original.spec.tls.push({ hosts: [other.host], secretName: 'unrelated-certificate' })
  if (dns) Object.assign(original.metadata.annotations, { 'cert-manager.io/cluster-issuer': 'w7-dns-old-profile', 'w7.cc/dns-profile': 'old-profile', 'w7.cc/dns-grant': 'old-grant' })
  return original
}

test('renaming a wildcard in a shared ingress isolates its issuer, DNS grant, rules, and certificate', async () => {
  const original = sharedAutomaticIngress(), state = domains({ ingress: original, profiles: [{ id: 'new-profile', zone: 'new.example.com' }] })
  const result = await state.renameSiteDomain(state.context, original, '*.new.example.com', 'new-profile')
  const other = result.ingresses.find(item => item.metadata.name === original.metadata.name), renamed = result.ingress
  assert.notEqual(renamed.metadata.name, original.metadata.name)
  assert.deepEqual(copy(other.spec.rules), [original.spec.rules[1]])
  assert.deepEqual(copy(other.spec.tls), [original.spec.tls[1]])
  assert.deepEqual(copy(other.metadata.annotations), original.metadata.annotations)
  assert.deepEqual(copy(renamed.spec.rules[0].http), original.spec.rules[0].http)
  assert.deepEqual(copy(renamed.spec.tls[0].hosts), ['*.new.example.com'])
  assert.equal(renamed.metadata.annotations['cert-manager.io/cluster-issuer'], 'w7-dns-new-profile')
  assert.equal(renamed.metadata.annotations['w7.cc/dns-grant'], 'new-host-grant')
  const grant = state.calls.find(call => call.method === 'POST' && call.url.includes('/grant'))
  assert.equal(grant.body.name, renamed.metadata.name, 'DNS grants are bound to the new Ingress name')
})

test('a shared wildcard rename isolates DNS authorization even when the selected profile stays the same', async () => {
  const original = sharedAutomaticIngress()
  Object.assign(original.metadata.annotations, { 'cert-manager.io/cluster-issuer': 'w7-dns-new-profile', 'w7.cc/dns-profile': 'new-profile' })
  const state = domains({ ingress: original, profiles: [{ id: 'new-profile', zone: 'example.com' }] })
  const result = await state.renameSiteDomain(state.context, original, '*.new.example.com', 'new-profile')
  assert.notEqual(result.ingress.metadata.name, original.metadata.name)
  const remaining = result.ingresses.find(item => item.metadata.name === original.metadata.name)
  assert.equal(remaining.metadata.annotations['w7.cc/dns-grant'], 'old-grant')
  assert.equal(remaining.spec.tls[0].secretName, 'unrelated-certificate')
})

test('ordinary-to-wildcard edits split a shared TLS host list without changing the remaining Secret or issuer', async () => {
  const original = sharedAutomaticIngress({ sharedTls: true, dns: false })
  const state = domains({ ingress: original, profiles: [{ id: 'new-profile', zone: 'new.example.com' }] })
  const result = await state.renameSiteDomain(state.context, original, '*.new.example.com', 'new-profile')
  const remaining = result.ingresses.find(item => item.metadata.name === original.metadata.name)
  assert.deepEqual(copy(remaining.spec.tls[0]), { hosts: ['other.example.com'], secretName: 'shared-old-secret' })
  assert.equal(remaining.metadata.annotations['cert-manager.io/cluster-issuer'], 'w7-letsencrypt-prod')
  assert.deepEqual(copy(result.ingress.spec.tls[0].hosts), ['*.new.example.com'])
  assert.notEqual(result.ingress.spec.tls[0].secretName, 'shared-old-secret')
})

test('renaming a custom domain cannot replace the shared primary-domain automatic certificate or DNS authorization', async () => {
  for (const dns of [false, true]) {
    const original = sharedAutomaticIngress({ sharedTls: true, dns })
    original.spec.rules[1].host = 'primary.example.com'
    original.spec.tls[0].hosts[1] = 'primary.example.com'
    const state = domains({ ingress: original })
    const result = await state.renameSiteDomain(state.context, original, 'new.example.com')
    const remaining = result.ingresses.find(item => item.metadata.name === original.metadata.name)
    assert.deepEqual(copy(remaining.spec.rules), [original.spec.rules[1]])
    assert.deepEqual(copy(remaining.spec.tls), [{ hosts: ['primary.example.com'], secretName: 'shared-old-secret' }])
    assert.deepEqual(copy(remaining.metadata.annotations), original.metadata.annotations)
    assert.deepEqual(copy(result.ingress.spec.tls[0].hosts), ['new.example.com'])
    assert.notEqual(result.ingress.spec.tls[0].secretName, 'shared-old-secret')
    assert.equal(result.appGroup, undefined)
    assert(!state.calls.some(call => call.url.includes('/appgroups/')))
  }
})

test('renaming a custom domain retains a shared primary-domain manual certificate reference', async () => {
  const original = sharedAutomaticIngress({ sharedTls: true, dns: false })
  delete original.metadata.annotations['cert-manager.io/cluster-issuer']
  original.spec.rules[1].host = 'primary.example.com'
  original.spec.tls[0].hosts[1] = 'primary.example.com'
  const state = domains({ ingress: original })
  const result = await state.renameSiteDomain(state.context, original, 'new.example.com')
  assert.equal(result.ingress.metadata.name, original.metadata.name)
  assert.deepEqual(copy(result.ingress.spec.rules[1]), original.spec.rules[1])
  assert.deepEqual(copy(result.ingress.spec.tls), [{ hosts: ['new.example.com', 'primary.example.com'], secretName: 'shared-old-secret' }])
  assert.deepEqual(copy(result.ingress.metadata.annotations), original.metadata.annotations)
  assert.match(result.warning, /手工证书/)
  assert(!state.calls.some(call => call.method === 'POST' || call.url.includes('/appgroups/')))
})

test('wildcard-to-ordinary edits preserve other wildcard issuers and issue the selected domain separately', async () => {
  const original = sharedAutomaticIngress(), state = domains({ ingress: original })
  const result = await state.renameSiteDomain(state.context, original, 'new.example.com')
  assert.equal(result.ingress.metadata.annotations['cert-manager.io/cluster-issuer'], 'w7-letsencrypt-prod')
  assert.equal(result.ingress.metadata.annotations['w7.cc/dns-profile'], undefined)
  const remaining = result.ingresses.find(item => item.metadata.name === original.metadata.name)
  assert.deepEqual(copy(remaining.metadata.annotations), original.metadata.annotations)
  assert.deepEqual(copy(remaining.spec.tls), [original.spec.tls[1]])
})

test('checking a split-domain cleanup failure resumes the source update without creating another new route', async () => {
  const original = sharedAutomaticIngress(), state = domains({ ingress: original, profiles: [{ id: 'new-profile', zone: 'new.example.com' }], sourceWrite: 'reject' })
  let pending
  await assert.rejects(state.renameSiteDomain(state.context, original, '*.new.example.com', 'new-profile'), error => { pending = error.pending; return error.uncertain && /原域名清理/.test(error.message) })
  assert.equal(state.ingresses().length, 2)
  state.setSourceFailure('ok')
  const result = await state.verifySiteDomainRename(state.context, pending)
  assert.equal(result.applied, true)
  assert.equal(state.calls.filter(call => call.method === 'POST' && call.url.endsWith('/ingresses')).length, 1)
  assert.deepEqual(copy(result.ingresses.find(item => item.metadata.name === original.metadata.name).spec.rules), [original.spec.rules[1]])
})

test('a sole old route supporting other certificate hosts is retained as an explicit alias during isolation', async () => {
  const original = sharedAutomaticIngress({ sharedTls: true, onlyTargetRule: true, dns: false })
  const state = domains({ ingress: original, profiles: [{ id: 'new-profile', zone: 'new.example.com' }] })
  const result = await state.renameSiteDomain(state.context, original, '*.new.example.com', 'new-profile')
  const retained = result.ingresses.find(item => item.metadata.name === original.metadata.name)
  assert.deepEqual(copy(retained), original)
  assert.match(result.warning, /保留旧域名别名/)
  assert.equal(result.ingress.spec.rules[0].host, '*.new.example.com')
})

function derivedDomains({ auto = false, pathRoute = false, patchMode = 'ok', syncing = false } = {}) {
  const root = alias('root.example.com'), child = alias('old.example.com', auto)
  root.metadata.name = 'root'; root.metadata.uid = 'root-uid'; root.metadata.resourceVersion = 'r1'
  root.metadata.annotations['w7.cc/child-hosts'] = JSON.stringify([
    { name: 'fixed', host: 'old.example.com', autoSsl: auto, sslRedirect: true, custom: { keep: true } },
    { name: 'other', host: 'other.example.com', autoSsl: false, sslRedirect: false, extra: 'keep' }
  ])
  child.metadata.name = pathRoute ? 'root-path-fixed' : 'root-fixed'
  child.metadata.labels = { 'w7.cc/ingress-rootname': 'root', 'w7.cc/hide': 'true', ...(pathRoute ? { parents: 'root-fixed' } : {}) }
  let currentRoot = copy(root), currentChild = copy(child), wait = syncing, rootWrites = 0
  const group = { apiVersion: 'w7panel.w7.com/v1alpha1', kind: 'AppGroup', metadata: { name: 'site', uid: 'group-uid', resourceVersion: 'g1', annotations: { 'w7.cc/default-domain': 'https://primary.example.com:8443/path?keep=1' } } }
  const context = { group: 'site', namespace: 'tenant', hostname: 'primary.example.com', appGroup: copy(group),
    gatewayEnabled: false, application: { metadata: { name: 'site' } }, tool: { metadata: { name: 'site-tool' } } }
  const base = '/apis/networking.k8s.io/v1/namespaces/tenant/ingresses', calls = []
  function synchronize() {
    if (wait || !rootWrites || patchMode === 'reject') return
    const entry = JSON.parse(currentRoot.metadata.annotations['w7.cc/child-hosts'])[0]
    currentChild = copy(child); currentChild.metadata.uid = 'recreated-child-uid'; currentChild.metadata.resourceVersion = '8'
    currentChild.spec.rules[0].host = entry.host
    currentChild.spec.tls = [{ hosts: [entry.host], secretName: 'generated-new-secret' }]
    if (entry.autoSsl) currentChild.metadata.annotations['cert-manager.io/cluster-issuer'] = entry.host.startsWith('*.') ? 'w7-dns-' + entry.dnsProfileId : 'w7-letsencrypt-prod'
  }
  const api = {
    async get(url) {
      calls.push({ method: 'GET', url })
      if (url === base) return { data: { items: [copy(currentChild), copy(currentRoot)] } }
      if (url === `${base}/root`) return { data: copy(currentRoot) }
      if (url === `${base}/${child.metadata.name}`) { synchronize(); return { data: copy(currentChild) } }
      if (url === '/panel-api/v1/auth/domain-white-list') return { data: [] }
      if (url === '/panel-api/v1/dns-profiles') return { data: [{ id: 'new-profile', zone: 'new.example.com' }] }
      throw new Error('unexpected GET ' + url)
    },
    async patch(url, patch, options) {
      calls.push({ method: 'PATCH', url, patch: copy(patch) })
      assert.equal(options.headers['Content-Type'], 'application/json-patch+json')
      assert.equal(url, `${base}/root`)
      const target = currentRoot
      for (const op of patch.filter(item => item.op === 'test')) assert.equal(op.value, op.path.endsWith('/uid') ? target.metadata.uid : target.metadata.resourceVersion)
      rootWrites++
      if (patchMode !== 'reject') {
        for (const op of patch.filter(item => item.op !== 'test')) target.metadata.annotations[op.path.split('/').pop().replace(/~1/g, '/')] = op.value
        target.metadata.resourceVersion = 'r2'
      }
      if (patchMode !== 'ok') throw new Error('parent response lost')
      return { data: copy(target) }
    },
    async post(url, body) {
      calls.push({ method: 'POST', url, body: copy(body) })
      assert(url.endsWith('/grant'), 'derived domains must never be created directly')
      return { data: { 'w7.cc/dns-profile': 'new-profile', 'w7.cc/dns-grant': 'new-parent-grant', 'cert-manager.io/cluster-issuer': 'w7-dns-new-profile' } }
    },
    async put() { throw new Error('derived domains must never be written directly') }
  }
  const load = loader(api, {}, { setTimeout: callback => callback() })
  load('utils/site-domain.js').nginxDomainChange = async () => null
  return { ...load('utils/site-domain-edit.js'), context, child, root, calls, currentRoot: () => copy(currentRoot),
    setRoot: value => { currentRoot = copy(value) },
    setSyncing: value => { wait = value }, replaceRoot: () => { currentRoot.metadata.uid = 'replacement-root' } }
}

test('editing a generated domain persists its fixed child entry in the parent while preserving siblings and route settings', async () => {
  const state = derivedDomains()
  const result = await state.renameSiteDomain(state.context, state.child, 'new.example.com')
  assert.equal(result.ingress.metadata.uid, 'recreated-child-uid', 'the controller recreates the same child name with a new UID')
  assert.equal(result.ingress.spec.rules[0].host, 'new.example.com')
  const before = JSON.parse(state.root.metadata.annotations['w7.cc/child-hosts']), after = JSON.parse(state.currentRoot().metadata.annotations['w7.cc/child-hosts'])
  assert.deepEqual(after[0], { ...before[0], host: 'new.example.com' })
  assert.deepEqual(after[1], before[1])
  assert.deepEqual(copy(state.currentRoot().spec), state.root.spec)
  const writes = state.calls.filter(call => call.method === 'PATCH')
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].patch.map(op => op.path), ['/metadata/uid', '/metadata/resourceVersion', '/metadata/annotations/w7.cc~1child-hosts'])
})

test('a generated alias can edit its binding under a read-only primary-domain root', async () => {
  const state = derivedDomains(), root = state.currentRoot()
  root.spec.rules[0].host = 'primary.example.com'
  delete root.metadata.annotations['w7.cc/site-domain']
  state.setRoot(root)
  const result = await state.renameSiteDomain(state.context, state.child, 'new.example.com')
  assert.equal(result.ingress.spec.rules[0].host, 'new.example.com')
  assert.deepEqual(state.currentRoot().spec, root.spec)
})

test('a generated alias cannot modify a parent that has switched its owner or backend to another site', async () => {
  for (const change of [
    root => { root.metadata.annotations['w7.cc/site-domain'] = 'another-site' },
    root => { root.spec.rules[0].http.paths[0].backend.service.name = 'another-site' }
  ]) {
    const state = derivedDomains(), root = state.currentRoot()
    change(root); state.setRoot(root)
    await assert.rejects(state.renameSiteDomain(state.context, state.child, 'new.example.com'), /分组已不属于当前站点/)
    assert(!state.calls.some(call => ['PATCH', 'PUT', 'POST'].includes(call.method)))
  }
})

test('checking a generated alias stops when its parent switches sites without repeating any write', async () => {
  for (const change of [
    root => { root.metadata.annotations['w7.cc/site-domain'] = 'another-site' },
    root => { root.spec.rules[0].http.paths[0].backend.service.name = 'another-site' }
  ]) {
    const state = derivedDomains({ syncing: true })
    let pending
    await assert.rejects(state.renameSiteDomain(state.context, state.child, 'new.example.com'), error => { pending = error.pending; return error.uncertain })
    const root = state.currentRoot(); change(root); state.setRoot(root)
    const previous = state.calls.length
    await assert.rejects(state.verifySiteDomainRename(state.context, pending), /分组已不属于当前站点/)
    assert.deepEqual(state.calls.slice(previous), [{ method: 'GET', url: '/apis/networking.k8s.io/v1/namespaces/tenant/ingresses/root' }])
    assert.equal(state.calls.filter(call => ['PATCH', 'PUT', 'POST'].includes(call.method)).length, 1)
  }
})

test('a generated wildcard gets a fixed-name DNS grant and preserves its automatic HTTPS and redirect settings', async () => {
  const state = derivedDomains({ auto: true })
  const result = await state.renameSiteDomain(state.context, state.child, '*.new.example.com', 'new-profile')
  const entry = JSON.parse(state.currentRoot().metadata.annotations['w7.cc/child-hosts'])[0]
  assert.equal(entry.name, 'fixed'); assert.equal(entry.autoSsl, true); assert.equal(entry.sslRedirect, true)
  assert.equal(entry.dnsProfileId, 'new-profile'); assert.equal(entry.dnsGrant, 'new-parent-grant')
  assert.equal(state.calls.find(call => call.method === 'POST').body.name, 'root-fixed')
  assert.equal(result.ingress.metadata.annotations['cert-manager.io/cluster-issuer'], 'w7-dns-new-profile')
})

test('generated path routes edit the root binding and authorize its fixed root child rather than the path clone', async () => {
  const state = derivedDomains({ auto: true, pathRoute: true })
  const result = await state.renameSiteDomain(state.context, state.child, '*.new.example.com', 'new-profile')
  assert.equal(state.calls.find(call => call.method === 'POST').body.name, 'root-fixed')
  assert.equal(result.ingress.metadata.name, 'root-path-fixed')
  assert.equal(result.ingress.metadata.labels.parents, 'root-fixed')
})

test('a delayed generated domain remains pending and checking it never resubmits the parent patch', async () => {
  const state = derivedDomains({ patchMode: 'accepted-response-lost', syncing: true })
  let pending
  await assert.rejects(state.renameSiteDomain(state.context, state.child, 'new.example.com'), error => { pending = error.pending; return error.uncertain && /等待域名入口同步/.test(error.message) })
  await assert.rejects(state.verifySiteDomainRename(state.context, pending), error => error.uncertain && /等待域名入口同步/.test(error.message))
  assert.equal(state.calls.filter(call => call.method === 'PATCH').length, 1)
  state.setSyncing(false)
  const result = await state.verifySiteDomainRename(state.context, pending)
  assert.equal(result.applied, true); assert.equal(result.ingress.metadata.uid, 'recreated-child-uid')
  assert.equal(state.calls.filter(call => call.method === 'PATCH').length, 1)
  state.replaceRoot()
  await assert.rejects(state.verifySiteDomainRename(state.context, pending), /分组.*替换/)
})

test('a rejected generated-domain parent patch can be confirmed absent without another write', async () => {
  const state = derivedDomains({ patchMode: 'reject' })
  let pending
  await assert.rejects(state.renameSiteDomain(state.context, state.child, 'new.example.com'), error => { pending = error.pending; return error.uncertain })
  const result = await state.verifySiteDomainRename(state.context, pending)
  assert.equal(result.applied, false); assert.equal(result.ingress.spec.rules[0].host, 'old.example.com')
  assert.equal(state.calls.filter(call => call.method === 'PATCH').length, 1)
})

test('an isolated domain drops copied child-tree configuration and Ingress ownership while retaining application metadata', async () => {
  const original = sharedAutomaticIngress()
  original.metadata.annotations['w7.cc/child-hosts'] = JSON.stringify([{ name: 'unrelated-child', host: 'keep.example.com' }])
  original.metadata.labels = { parents: 'source-parent', parentsPath: 'path-hash', 'w7.cc/hide': 'true', custom: 'keep' }
  original.metadata.ownerReferences = [{ apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', name: 'old-owner', uid: 'old-owner-uid' }]
  original.spec.defaultBackend = { service: { name: 'fallback', port: { number: 90 } } }
  const state = domains({ ingress: original, profiles: [{ id: 'new-profile', zone: 'new.example.com' }] })
  const result = await state.renameSiteDomain(state.context, original, '*.new.example.com', 'new-profile')
  assert.deepEqual(copy(result.ingress.metadata.labels), { custom: 'keep' })
  assert.equal(result.ingress.metadata.annotations['w7.cc/child-hosts'], undefined)
  assert(!result.ingress.metadata.ownerReferences.some(owner => owner.kind === 'Ingress'))
  assert(result.ingress.metadata.ownerReferences.some(owner => owner.uid === state.context.appGroup.metadata.uid))
  assert.equal(result.ingress.spec.defaultBackend, undefined)
  const retained = result.ingresses.find(item => item.metadata.name === original.metadata.name)
  assert.equal(retained.metadata.annotations['w7.cc/child-hosts'], original.metadata.annotations['w7.cc/child-hosts'])
  assert.deepEqual(copy(retained.spec.defaultBackend), original.spec.defaultBackend)
})

test('the row editor rejects the primary hostname and exposes custom-domain edits to the leave guard', async () => {
  const state = domains(), component = state.load('components/site/DomainConfig.vue').default
  const ctx = { ...component.data(), context: state.context, locked: false }
  for (const [name, method] of Object.entries(component.methods)) ctx[name] = method.bind(ctx)
  for (const [name, computed] of Object.entries(component.computed)) Object.defineProperty(ctx, name, { get: computed.bind(ctx) })
  const primary = alias('primary.example.com')
  await ctx.edit({ key: 'primary/primary.example.com', host: 'primary.example.com', canEdit: true, ingress: primary })
  assert.equal(ctx.editDraft, null)
  assert.equal(ctx.hasDraft(), false)
  await ctx.edit({ key: 'alias/old.example.com', host: 'old.example.com', canEdit: true, ingress: alias(), auto: false })
  assert.equal(ctx.editDraft.host, 'old.example.com')
  assert.equal(ctx.hasDraft(), true)
})

test('domain validation, duplicate names and whitelist boundaries fail before any write', async () => {
  const duplicates = domains({ others: [alias('new.example.com')] })
  await assert.rejects(duplicates.renameSiteDomain(duplicates.context, alias(), 'new.example.com'), /已经存在/)
  const restricted = domains({ whiteList: [{ domain: 'allowed.com' }] })
  await assert.rejects(restricted.renameSiteDomain(restricted.context, alias(), 'notallowed.com'), /范围/)
  const disabled = domains({ whiteList: [{ domain: 'example.com', disabled: true }] })
  await assert.rejects(disabled.renameSiteDomain(disabled.context, alias(), 'new.example.com'), /范围/)
  await assert.rejects(restricted.renameSiteDomain(restricted.context, alias(), 'http://new.example.com'), /有效域名/)
  assert(![...duplicates.calls, ...restricted.calls, ...disabled.calls].some(call => call.method === 'PUT'))
})

test('recreated resources and changed resource versions cannot be renamed', async () => {
  for (const metadata of [{ uid: 'new-owner' }, { resourceVersion: '9' }]) {
    const state = domains(), current = alias()
    Object.assign(current.metadata, metadata); state.setCurrent(current)
    await assert.rejects(state.renameSiteDomain(state.context, alias(), 'new.example.com'), /其他操作修改/)
    assert(!state.calls.some(call => call.method === 'PUT'))
  }
})

test('automatic TLS follows the new host using a new Secret without changing shared certificate data', async () => {
  const original = alias('old.example.com', true), state = domains({ ingress: original })
  const saved = (await state.renameSiteDomain(state.context, original, 'new.example.com')).ingress
  assert.deepEqual(copy(saved.spec.tls[0].hosts), ['new.example.com'])
  assert.notEqual(saved.spec.tls[0].secretName, 'shared-old-secret')
  assert.equal(saved.metadata.annotations['cert-manager.io/cluster-issuer'], 'w7-letsencrypt-prod')
  assert(!state.calls.some(call => /secrets|certificates/.test(call.url)))
})

test('wildcard rename gets a host-specific grant from a matching profile and drops the old grant', async () => {
  const original = alias('*.old.example.com', true)
  Object.assign(original.metadata.annotations, { 'w7.cc/dns-profile': 'old-profile', 'w7.cc/dns-grant': 'old-host-grant', 'cert-manager.io/cluster-issuer': 'w7-dns-old-profile' })
  const state = domains({ ingress: original, profiles: [{ id: 'new-profile', zone: 'new.example.com' }] })
  await assert.rejects(state.renameSiteDomain(state.context, original, '*.new.example.com', 'old-profile'), /新泛域名/)
  const saved = (await state.renameSiteDomain(state.context, original, '*.new.example.com', 'new-profile')).ingress
  assert.equal(saved.metadata.annotations['w7.cc/dns-grant'], 'new-host-grant')
  assert.equal(saved.metadata.annotations['cert-manager.io/cluster-issuer'], 'w7-dns-new-profile')
  assert.deepEqual(state.calls.find(call => call.method === 'POST').body, { namespace: 'tenant', name: 'alias', host: '*.new.example.com' })
  const regular = (await domains({ ingress: original }).renameSiteDomain(state.context, original, 'regular.example.com')).ingress
  assert.equal(regular.metadata.annotations['w7.cc/dns-grant'], undefined)
  assert.equal(regular.metadata.annotations['cert-manager.io/cluster-issuer'], 'w7-letsencrypt-prod')
})

test('a failed DNS grant cannot write the renamed wildcard or prepare a gateway alias', async () => {
  const original = alias('*.old.example.com', true)
  const state = domains({ ingress: original, gateway: true, profiles: [{ id: 'new-profile', zone: 'example.com' }] })
  state.api.post = async () => ({ data: {} })
  await assert.rejects(state.renameSiteDomain(state.context, original, '*.new.example.com', 'new-profile'), /签发授权失败/)
  assert.equal(state.gatewayCalls.length, 0)
  assert(!state.calls.some(call => call.method === 'PUT'))
})

test('gateway updates add the new host before replacing Ingress and remove only an unreferenced old host', async () => {
  const state = domains({ gateway: true })
  const result = await state.renameSiteDomain(state.context, alias(), 'new.example.com')
  assert.equal(result.warning, '')
  assert.deepEqual(state.gatewayCalls, [{ host: 'new.example.com', add: true }, { host: 'old.example.com', add: false }])
  const shared = domains({ gateway: true, others: [alias('old.example.com')] })
  await shared.renameSiteDomain(shared.context, alias(), 'new.example.com')
  assert.equal(shared.gatewayCalls.length, 1)
})

test('a rejected Ingress write rolls back the prepared gateway; a lost accepted response is recovered', async () => {
  const rejected = domains({ gateway: true, write: 'reject' })
  await assert.rejects(rejected.renameSiteDomain(rejected.context, alias(), 'new.example.com'), /connection lost/)
  assert(rejected.gatewayCalls.some(call => call.undo))
  const accepted = domains({ gateway: true, write: 'accepted-response-lost' })
  const result = await accepted.renameSiteDomain(accepted.context, alias(), 'new.example.com')
  assert.equal(result.ingress.spec.rules[0].host, 'new.example.com')
  assert(!accepted.gatewayCalls.some(call => call.undo))
})

test('an unreadable submit result preserves the gateway and blocks blind retries; cleanup failure is reported as saved', async () => {
  const uncertain = domains({ gateway: true, write: 'accepted-response-lost', readAfterFailure: false })
  await assert.rejects(uncertain.renameSiteDomain(uncertain.context, alias(), 'new.example.com'), error => error.uncertain && /未确认/.test(error.message))
  assert(!uncertain.gatewayCalls.some(call => call.undo))
  const cleanup = domains({ gateway: true, gatewayFailure: 'remove' })
  const result = await cleanup.renameSiteDomain(cleanup.context, alias(), 'new.example.com')
  assert.equal(result.ingress.spec.rules[0].host, 'new.example.com')
  assert.match(result.warning, /已保存.*未清理/)
})

function runtime({ fail = '', confirm = true } = {}) {
  const calls = [], confirmations = [], messages = []
  let current = { metadata: { name: 'site', uid: 'site-uid', resourceVersion: '1', generation: 1 }, spec: { replicas: 1,
    template: { metadata: { labels: { app: 'keep' }, annotations: { custom: 'keep' } }, spec: { containers: [{ name: 'web', image: 'node:22', command: ['node'], args: ['server.js'] }, { name: 'sidecar', image: 'helper' }] } } },
    status: { observedGeneration: 1, replicas: 1, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1 } }
  let failure = fail, holdRead = null, readsAfterPatch = 0
  const api = {
    async get(url) {
      calls.push({ method: 'GET', url })
      if (holdRead) await holdRead
      if (calls.some(call => call.method === 'PATCH')) {
        readsAfterPatch++
        if (failure === 'unknown') throw new Error('network unavailable')
        if (failure === 'poll-network' && readsAfterPatch === 1) throw new Error('network unavailable')
      }
      const value = copy(current)
      if (failure === 'conflict') value.metadata.resourceVersion = '99'
      if (failure === 'recreated') value.metadata.uid = 'replacement'
      if (failure === 'rollout') value.status.conditions = [{ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded', message: 'image failed' }]
      return { data: value }
    },
    async patch(url, patch) {
      calls.push({ method: 'PATCH', url, patch: copy(patch) })
      if (failure !== 'unknown') {
        for (const item of patch) if (item.op === 'add') {
          assert.equal(item.path, '/spec/template/metadata/annotations')
          current.spec.template.metadata.annotations = copy(item.value)
        }
        current.metadata.resourceVersion = '2'; current.metadata.generation = 2; current.status.observedGeneration = 2
      }
      if (failure === 'lost-response' || failure === 'unknown') throw new Error('response lost')
      return { data: copy(current) }
    }
  }
  const load = loader(api, { 'element-plus': { ElMessageBox: { async confirm(message, title) {
    confirmations.push({ message, title }); const allowed = typeof confirm === 'function' ? await confirm() : confirm
    if (!allowed) throw new Error('cancel')
  } } } })
  const component = load('views/runtime-config.vue').default
  const drafts = { form: { host: 'draft.example.com' }, editDraft: null, busy: false, hasDraft() { return !!this.form } }
  const ctx = { ...component.data(), deployment: copy(current), context: {}, workloadName: 'site', loading: false,
    startup: { text: 'unsaved command', mode: 'custom' }, ports: [{ containerPort: '9000' }], selectedVersion: '24', initialDraft: 'saved',
    $refs: { domains: drafts }, $message: Object.fromEntries(['success', 'error', 'info'].map(level => [level, message => messages.push({ level, message })])) }
  for (const [name, fn] of Object.entries(component.methods)) ctx[name] = fn.bind(ctx)
  for (const [name, fn] of Object.entries(component.computed)) Object.defineProperty(ctx, name, { get: fn.bind(ctx) })
  return { ctx, calls, confirmations, messages, load, current: () => current,
    setFailure: value => { failure = value }, holdRead: value => { holdRead = value } }
}

test('restart patches only the main Pod template annotations and preserves every unsaved draft', async () => {
  const state = runtime(), before = copy(state.current()), draft = state.ctx.runtimeDraft, domainDraft = state.ctx.$refs.domains.form
  await state.ctx.restartApplication()
  const patch = state.calls.find(call => call.method === 'PATCH').patch
  assert.deepEqual(patch.filter(item => item.op === 'test').map(item => item.path), ['/metadata/uid', '/metadata/resourceVersion'])
  assert.deepEqual(patch.filter(item => item.op === 'add').map(item => item.path), ['/spec/template/metadata/annotations'])
  assert.deepEqual(state.current().spec.template.spec, before.spec.template.spec)
  assert.deepEqual(state.current().spec.template.metadata.labels, before.spec.template.metadata.labels)
  assert.equal(state.current().spec.template.metadata.annotations.custom, 'keep')
  assert.equal(state.ctx.runtimeDraft, draft)
  assert.equal(state.ctx.$refs.domains.form, domainDraft)
  assert.equal(state.ctx.restartOperation, null)
  assert.equal(state.ctx.restartStatus, '')
  assert.deepEqual(state.messages, [{ level: 'success', message: '应用重启成功' }])
  assert.match(state.confirmations[0].message, /未保存.*不会提交.*保留/)
})

test('cancel, stopped and paused deployments do not submit restart requests', async () => {
  const cancel = runtime({ confirm: false })
  await cancel.ctx.restartApplication()
  assert.equal(cancel.calls.length, 0)
  for (const spec of [{ replicas: 0 }, { paused: true }]) {
    const state = runtime(); Object.assign(state.ctx.deployment.spec, spec)
    await state.ctx.restartApplication()
    assert.equal(state.calls.length, 0)
    assert.equal(state.confirmations.length, 0)
  }
})

test('confirmation and in-flight submission prevent duplicate restarts and runtime writes', async () => {
  let release
  const state = runtime({ confirm: () => new Promise(resolve => { release = resolve }) })
  const first = state.ctx.restartApplication()
  assert(state.ctx.restartConfirming)
  await state.ctx.restartApplication()
  await state.ctx.saveRuntime()
  assert.equal(state.confirmations.length, 1)
  assert.equal(state.calls.length, 0)
  release(true); await first
  assert.equal(state.calls.filter(call => call.method === 'PATCH').length, 1)
})

test('restart rejects concurrent changes and a recreated workload before patching', async () => {
  for (const fail of ['conflict', 'recreated']) {
    const state = runtime({ fail })
    await state.ctx.restartApplication()
    assert(!state.calls.some(call => call.method === 'PATCH'))
    assert.match(state.ctx.restartError, /其他操作更新/)
  }
})

test('restart recovers an accepted request with a lost response without issuing another patch', async () => {
  const state = runtime({ fail: 'lost-response' })
  await state.ctx.restartApplication()
  assert.equal(state.ctx.restartStatus, '')
  assert.equal(state.calls.filter(call => call.method === 'PATCH').length, 1)
})

test('unknown restart submission must be checked before retry; a confirmed absent marker requires refresh', async () => {
  const state = runtime({ fail: 'unknown' })
  await state.ctx.restartApplication()
  assert(state.ctx.restartOperation)
  assert.match(state.ctx.restartError, /未确认/)
  await state.ctx.restartApplication()
  await state.ctx.saveRuntime()
  assert.equal(state.calls.filter(call => call.method === 'PATCH').length, 1)
  state.setFailure('')
  await state.ctx.checkRestart()
  assert.equal(state.ctx.restartOperation, null)
  assert.match(state.ctx.saveError, /未发现.*刷新/)
})

test('polling network failures retain the operation and checking it later never creates a second restart', async () => {
  const state = runtime({ fail: 'poll-network' })
  await state.ctx.restartApplication()
  assert(state.ctx.restartOperation)
  await state.ctx.checkRestart()
  assert.equal(state.ctx.restartOperation, null)
  assert.equal(state.ctx.restartStatus, '')
  assert.equal(state.calls.filter(call => call.method === 'PATCH').length, 1)
})

test('a confirmed failed rollout reports failure and permits a new explicit restart', async () => {
  const state = runtime({ fail: 'rollout' })
  await state.ctx.restartApplication()
  assert.match(state.ctx.restartError, /image failed/)
  assert.equal(state.ctx.restartOperation, null)
  state.setFailure('')
  await state.ctx.restartApplication()
  assert.equal(state.calls.filter(call => call.method === 'PATCH').length, 2)
})

test('old observed generations cannot satisfy readiness; timeout and replacement are reported', async () => {
  const state = runtime(), { restartState, waitForRestart } = state.load('utils/site-restart.js')
  const deployment = copy(state.current()), operation = { uid: 'site-uid', id: 'test-op', generation: 2 }
  deployment.spec.template.metadata.annotations['w7.cc/site-restart-id'] = 'test-op'
  deployment.metadata.generation = 2
  assert.equal(restartState(deployment, operation), false)
  await assert.rejects(waitForRestart({ get: async () => ({ data: deployment }) }, '/test', operation, { timeoutMs: 0 }), /未就绪/)
  deployment.metadata.generation = 3
  assert.throws(() => restartState(deployment, operation), /其他操作修改/)
})

test('gateway file writes preserve literal content, reject changed files and restore failed validation', t => {
  const { saveNginxConfigCommand } = loader({})('utils/nginx-config.js')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'site-nginx-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'nginx'), '#!/bin/sh\n[ "$NGINX_FAIL" != 1 ]\n', { mode: 0o755 })
  const filename = path.join(directory, 'primary.conf'), original = 'server { # original\n}\n'
  fs.writeFileSync(filename, original)
  const content = "server { # '$HOME' `id` $(id)\n}\n"
  function run(expected, fail = false) {
    const command = saveNginxConfigCommand(content, 'primary.conf', { expectedContent: expected })
      .replace("CONF_DIR='/www/server/nginx/conf.d'", `CONF_DIR='${directory}'`)
    return spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', env: { ...process.env, PATH: directory + ':' + process.env.PATH, NGINX_FAIL: fail ? '1' : '' } })
  }
  assert.equal(run(original).status, 0)
  assert.equal(fs.readFileSync(filename, 'utf8'), content)
  fs.writeFileSync(filename, 'concurrent edit')
  assert.notEqual(run(original).status, 0)
  assert.equal(fs.readFileSync(filename, 'utf8'), 'concurrent edit')
  fs.writeFileSync(filename, original)
  const result = run(original, true)
  assert.match(result.stdout, /W7_NGINX_VALIDATION_FAILED/)
  assert.equal(fs.readFileSync(filename, 'utf8'), original)
})
