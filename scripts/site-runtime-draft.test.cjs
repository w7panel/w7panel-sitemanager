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
const deploymentApi = '/apis/apps/v1/namespaces/default/deployments/site'
const copy = value => JSON.parse(JSON.stringify(value))

function node(tag = '', text = '') {
  return { tag, tagName: tag.toUpperCase(), text, parent: null, children: [], props: {},
    addEventListener() {}, removeEventListener() {}, getAttribute() { return null },
    getRootNode() { return { activeElement: null } } }
}

// Fragments must have real parent/sibling relationships when v-if removes them.
const renderer = Vue.createRenderer({
  createElement: tag => node(tag), createText: text => node('', text), createComment: text => node('', text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child)
    else parent.children.splice(index, 0, child)
  },
  remove(child) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  },
  parentNode: child => child.parent,
  nextSibling(child) {
    const siblings = child.parent?.children || []
    return siblings[siblings.indexOf(child) + 1] || null
  },
  setText: (target, text) => { target.text = text },
  setElementText(target, text) { target.text = text; target.children = [] },
  patchProp: (target, key, previous, value) => { target.props[key] = value },
})

async function settle() {
  await Vue.nextTick()
  await new Promise(resolve => setImmediate(resolve))
  await Vue.nextTick()
}

async function harness() {
  const calls = [], confirmations = [], messages = []
  let failure = '', leaveDecision = false
  let deployment = {
    apiVersion: 'apps/v1', kind: 'Deployment',
    metadata: { name: 'site', namespace: 'tenant', uid: 'site-uid', resourceVersion: '1', generation: 1, annotations: {} },
    spec: { replicas: 1, selector: { matchLabels: { app: 'site' } },
      template: { metadata: { annotations: {} }, spec: { containers: [
        { name: 'web', image: 'node:22', command: ['node', 'server.js'], ports: [{ name: 'http', containerPort: 8080 }] },
      ] } } },
    status: { observedGeneration: 1, replicas: 1, updatedReplicas: 1, readyReplicas: 1, availableReplicas: 1 },
  }
  const appGroup = { apiVersion: 'w7panel.w7.com/v1alpha1', kind: 'AppGroup',
    metadata: { name: 'site', uid: 'group-uid', annotations: {} }, spec: { title: 'Site' },
    status: { items: [{ kind: 'Deployment', name: 'site' }] } }
  const service = { metadata: { name: 'site', namespace: 'tenant', resourceVersion: '1' },
    spec: { ports: [{ name: 'http', protocol: 'TCP', port: 80, targetPort: 'http' }] } }
  const api = {
    async get(url) {
      calls.push({ method: 'GET', url })
      if (url.endsWith('/appgroups/site')) {
        if (failure === 'automatic-refresh' && calls.some(call => call.method === 'PATCH')) throw new Error('automatic refresh connection failed')
        return { data: copy(appGroup) }
      }
      if (url === deploymentApi) {
        if (failure === 'network') throw new Error('connection failed')
        const current = copy(deployment)
        if (failure === 'conflict') current.metadata.resourceVersion = String(Number(current.metadata.resourceVersion) + 1)
        if (failure === 'rollout' && calls.some(call => call.method === 'PATCH')) {
          current.status.conditions = [{ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded', message: 'rollout failed' }]
        }
        return { data: current }
      }
      if (url.endsWith('/services/site')) return { data: copy(service) }
      if (url.endsWith('/ingresses')) return { data: { items: [] } }
      throw new Error(`Unexpected GET: ${url}`)
    },
    async patch(url, operations) {
      calls.push({ method: 'PATCH', url, operations: copy(operations) })
      assert.equal(url, deploymentApi)
      for (const operation of operations) {
        const parts = operation.path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
        const key = parts.pop()
        let target = deployment
        for (const part of parts) target = target[part] || (target[part] = {})
        if (operation.op === 'test') assert.equal(target[key], operation.value)
        else { assert.equal(operation.op, 'add'); target[key] = copy(operation.value) }
      }
      deployment.metadata.resourceVersion = String(Number(deployment.metadata.resourceVersion) + 1)
      deployment.metadata.generation += 1
      deployment.status.observedGeneration = deployment.metadata.generation
      return { data: copy(deployment) }
    },
    async post(url) { throw new Error(`Unexpected POST: ${url}`) },
    async put(url) { throw new Error(`Unexpected PUT: ${url}`) },
    async delete(url) { throw new Error(`Unexpected DELETE: ${url}`) },
    async exec() { throw new Error('Runtime draft checks must not execute container commands') },
  }
  const cache = new Map()
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const source = fs.readFileSync(filename, 'utf8')
    const descriptor = filename.endsWith('.vue') ? parse(source, { filename }).descriptor : null
    const script = descriptor ? descriptor.script.content : source
    const exports = {}
    cache.set(filename, exports)
    const code = babel.transformSync(script, { configFile: false,
      plugins: [require('../ui/node_modules/@babel/plugin-transform-modules-commonjs')] }).code
    vm.runInNewContext(code, { exports, URL, setTimeout,
      window: { $wujie: { props: { group: 'site', namespace: 'tenant' } } },
      require(target) {
        if (target === '@/utils/panel' || target === './panel') return { __esModule: true, default: api }
        if (target === 'element-plus') return { ElMessageBox: { async confirm(message, title) {
          confirmations.push({ message, title })
          if (title === '未保存的配置') {
            const allowed = typeof leaveDecision === 'function' ? await leaveDecision() : leaveDecision
            if (!allowed) throw new Error('cancel')
          }
        } } }
        if (target === '@/utils/site-context') return { loadSiteContext() { throw new Error('Runtime draft checks must not save a domain') } }
        const resolved = target.startsWith('@/') ? path.join(root, target.slice(2)) : path.resolve(path.dirname(filename), target)
        return load(path.extname(resolved) ? resolved : `${resolved}.js`)
      },
    }, { filename })
    if (filename.endsWith('/DomainConfig.vue')) {
      // Keep the actual draft state, mounted loader and hasDraft implementation.
      exports.default.render = () => null
    }
    if (filename.endsWith('/runtime-config.vue')) {
      // Render the full production template so error-driven child teardown is exercised.
      exports.default.render = new Function('Vue', compile(descriptor.template.content, {
        mode: 'function', prefixIdentifiers: true, isCustomElement: tag => tag.startsWith('el-'),
      // Native control directives need a DOM; drafts are changed through Vue state here.
      }).code)({ ...Vue, vModelRadio: {}, vModelText: {} })
    }
    return exports
  }
  const Runtime = load(path.join(root, 'views/runtime-config.vue')).default
  const container = node('root')
  const app = renderer.createApp(Runtime, { context: { group: 'site', namespace: 'tenant', hostname: 'site.example.com',
    appGroup: copy(appGroup), application: copy(deployment), service: copy(service), directory: { containerName: 'web', path: '/www/wwwroot' } } })
  app.directive('loading', {})
  app.config.globalProperties.$message = Object.fromEntries(['error', 'success', 'info', 'warning']
    .map(level => [level, text => messages.push({ level, text })]))
  const ctx = app.mount(container)
  await settle()
  assert.equal(ctx.loading, false)
  assert.equal(ctx.loadError, '')
  assert(ctx.$refs.domains)
  function findRetry(target = container) {
    if (target.tag === 'el-button' && target.text === '重试') return target
    return target.children.map(child => findRetry(child)).find(Boolean)
  }
  return { app, ctx, calls, confirmations, messages,
    setFailure: value => { failure = value }, setLeaveDecision: value => { leaveDecision = value },
    retry() { const button = findRetry(); assert(button, 'the production error alert must expose retry'); return button.props.onClick() },
  }
}

for (const kind of ['form', 'httpsDraft']) {
  for (const failure of ['conflict', 'network', 'rollout']) {
    test(`${kind} survives ${failure} during runtime save and is discarded only after confirmed refresh`, async t => {
      const state = await harness()
      t.after(() => state.app.unmount())
      const { ctx, calls, confirmations } = state
      const domains = ctx.$refs.domains
      domains[kind] = kind === 'form' ? { host: 'draft.example.com', autoHttps: false }
        : { host: '*.example.com', profileId: 'pending-profile' }
      const draft = domains[kind]
      ctx.startup.text = 'node server.js --changed'
      state.setFailure(failure)
      await ctx.saveRuntime()
      await settle()
      assert(ctx.$refs.domains === domains, 'runtime save errors must retain the mounted domain editor')
      assert.equal(domains[kind], draft)
      assert.equal(ctx.loadError, '')
      assert.match(ctx.saveError, failure === 'conflict' ? /其他操作更新/ : failure === 'network' ? /connection failed/ : /rollout failed/)
      assert.equal(ctx.saving, false)
      assert.equal(calls.filter(call => call.method === 'PATCH').length, failure === 'rollout' ? 1 : 0)

      state.setLeaveDecision(false)
      assert.equal(await ctx.canLeave(), false)
      const readsBeforeCancel = calls.length
      await state.retry()
      await settle()
      assert.equal(calls.length, readsBeforeCancel, 'canceling the production retry must not refresh or clear drafts')
      assert.equal(ctx.$refs.domains, domains)
      assert.equal(domains[kind], draft)

      const confirmationsBeforeRetry = confirmations.length
      await ctx.saveRuntime()
      assert.equal(calls.length, readsBeforeCancel, 'uncertain saves require a successful refresh before another submission')
      assert.equal(confirmations.length, confirmationsBeforeRetry)

      let confirmLeave
      state.setLeaveDecision(() => new Promise(resolve => { confirmLeave = resolve }))
      const refresh = state.retry()
      assert.equal(ctx.$refs.domains, domains)
      assert.equal(domains[kind], draft, 'drafts must remain while refresh confirmation is pending')
      assert.equal(calls.length, readsBeforeCancel)
      state.setFailure('')
      confirmLeave(true)
      await refresh
      await settle()
      assert.equal(ctx.$refs.domains, domains)
      assert.equal(domains.form, null)
      assert.equal(domains.httpsDraft, null)
      assert.equal(ctx.loadError, '')
      assert.equal(ctx.saveError, '')
      assert.equal(ctx.runtimeDirty, false)

      const patchesBeforeSave = calls.filter(call => call.method === 'PATCH').length
      ctx.startup.text = 'node server.js --after-refresh'
      await ctx.saveRuntime()
      await settle()
      assert.equal(calls.filter(call => call.method === 'PATCH').length, patchesBeforeSave + 1)
      assert.equal(ctx.saveError, '')
      assert.equal(ctx.loadError, '')
    })
  }
}

test('an unsuccessful confirmed refresh retains the save error until application loading succeeds', async t => {
  const state = await harness()
  t.after(() => state.app.unmount())
  state.ctx.startup.text = 'node server.js --changed'
  state.setFailure('network')
  await state.ctx.saveRuntime()
  const saveError = state.ctx.saveError
  assert(saveError)
  state.setLeaveDecision(true)
  await state.retry()
  await settle()
  assert.match(state.ctx.loadError, /connection failed/)
  assert.equal(state.ctx.saveError, saveError)
  state.setFailure('')
  await state.retry()
  await settle()
  assert.equal(state.ctx.loadError, '')
  assert.equal(state.ctx.saveError, '')
  assert(state.ctx.$refs.domains)
})

for (const kind of ['form', 'httpsDraft']) {
  test(`${kind} survives automatic refresh failure after runtime changes have been applied`, async t => {
    const state = await harness()
    t.after(() => state.app.unmount())
    const { ctx, calls } = state
    const domains = ctx.$refs.domains
    domains[kind] = { host: kind === 'form' ? 'draft.example.com' : '*.example.com' }
    const draft = domains[kind]
    ctx.startup.text = 'node server.js --changed'
    state.setFailure('automatic-refresh')
    await ctx.saveRuntime()
    await settle()
    assert.equal(calls.filter(call => call.method === 'PATCH').length, 1, 'the rollout must succeed before the automatic refresh fails')
    assert(ctx.$refs.domains === domains, 'automatic refresh errors must retain the mounted domain editor')
    assert.equal(domains[kind], draft)
    assert.equal(ctx.loadError, '')
    assert.match(ctx.saveError, /已应用.*刷新失败.*automatic refresh connection failed/)
    assert.equal(ctx.saving, false)
    const callsAfterFailure = calls.length
    await ctx.saveRuntime()
    assert.equal(calls.length, callsAfterFailure, 'a failed automatic refresh must also block duplicate saves')
    state.setLeaveDecision(false)
    await state.retry()
    await settle()
    assert.equal(calls.length, callsAfterFailure)
    assert.equal(domains[kind], draft)
    state.setLeaveDecision(true)
    state.setFailure('')
    await state.retry()
    await settle()
    assert.equal(domains.form, null)
    assert.equal(domains.httpsDraft, null)
    assert.equal(ctx.loadError, '')
    assert.equal(ctx.saveError, '')
    assert.equal(ctx.runtimeDirty, false)
  })
}
