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

function loader(api, overrides = {}) {
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
    vm.runInNewContext(code, { exports, URL, Date, setTimeout, window: { $wujie: { props: { group: 'site', namespace: 'tenant' } } }, require(target) {
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

function domains({ ingress = alias(), others = [], whiteList = [], profiles = [], write = 'ok', readAfterFailure = true, gateway = false, gatewayFailure = '' } = {}) {
  let current = copy(ingress), writes = 0
  const calls = [], gatewayCalls = []
  const base = '/apis/networking.k8s.io/v1/namespaces/tenant/ingresses'
  const context = { group: 'site', namespace: 'tenant', hostname: 'primary.example.com', gatewayEnabled: gateway,
    application: { metadata: { name: 'site' } }, tool: { metadata: { name: 'site-tool' } } }
  const api = {
    async get(url) {
      calls.push({ method: 'GET', url })
      if (url === base + '/alias') {
        if (writes && !readAfterFailure) throw new Error('read unavailable')
        return { data: copy(current) }
      }
      if (url === base) return { data: { items: [copy(current), ...others.map(copy)] } }
      if (url === '/panel-api/v1/auth/domain-white-list') return { data: { code: 200, data: whiteList } }
      if (url === '/panel-api/v1/dns-profiles') return { data: profiles }
      throw new Error('Unexpected GET ' + url)
    },
    async put(url, body) {
      writes++
      calls.push({ method: 'PUT', url, body: copy(body) })
      if (write !== 'reject') current = { ...copy(body), metadata: { ...body.metadata, resourceVersion: '8' } }
      if (write !== 'ok') throw new Error('connection lost')
      return { data: copy(current) }
    },
    async post(url, body) {
      calls.push({ method: 'POST', url, body: copy(body) })
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
  return { ...actions, context, api, calls, gatewayCalls, load, current: () => current, setCurrent: value => { current = copy(value) } }
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

test('primary domains and complex/manual-certificate routes cannot be edited even through direct method calls', async () => {
  const state = domains()
  for (const original of [alias('primary.example.com'), (() => { const value = alias(); value.spec.rules[0].http.paths.push({ path: '/api' }); return value })(),
    (() => { const value = alias(); value.spec.tls = [{ hosts: ['old.example.com'], secretName: 'manual' }]; return value })()]) {
    assert.equal(state.canEditDomain(state.context, original, original.spec.rules[0].host), false)
    await assert.rejects(state.renameSiteDomain(state.context, original, 'new.example.com'), /主域名|复杂|手工/)
  }
  assert.equal(state.calls.length, 0)
  await assert.rejects(state.renameSiteDomain(state.context, alias(), 'primary.example.com'), /主域名/)
})

test('the row editor protects the primary hostname and exposes custom edits to the leave guard', async () => {
  const state = domains(), component = state.load('components/site/DomainConfig.vue').default
  const ctx = { ...component.data(), context: state.context, locked: false }
  for (const [name, method] of Object.entries(component.methods)) ctx[name] = method.bind(ctx)
  const primary = alias('primary.example.com')
  await ctx.edit({ host: 'primary.example.com', canEdit: true, ingress: primary })
  assert.equal(ctx.editDraft, null)
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
  assert.match(state.ctx.restartStatus, /重启成功/)
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
  assert.match(state.ctx.restartStatus, /成功/)
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
  assert.match(state.ctx.restartStatus, /成功/)
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
