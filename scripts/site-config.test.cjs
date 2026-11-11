const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('../ui/node_modules/@babel/core')
const root = path.resolve(__dirname, '../ui/src')
const cache = new Map()
function load(name, mocks = {}) {
  if (mocks[name]) return mocks[name]
  const filename = path.resolve(root, name)
  if (cache.has(filename)) return cache.get(filename)
  const source = fs.readFileSync(filename, 'utf8')
  const exports = {}
  cache.set(filename, exports)
  const code = babel.transformSync(source, { configFile: false, plugins: [require('../ui/node_modules/@babel/plugin-transform-modules-commonjs')] }).code
  vm.runInNewContext(code, { exports, URL, window: {}, setTimeout, require: target => target === './panel' ? { default: {} } : load(path.relative(root, path.resolve(path.dirname(filename), target + '.js')), mocks) })
  return exports
}
const { resolveSiteRoute } = load('utils/site-route.js')
const { siteIdentity, resolveSiteDirectory } = load('utils/site-context.js')
const { normalizeDomain, updateNginxDomain, domainBackend, domainIngress, setAutoHttps } = load('utils/site-domain.js')
const { gatewayConfig, gatewayIngressPatches } = load('utils/gateway-config.js')
const { requiresFastcgi } = load('utils/site-http.js')
const { startupDraft, resolveStartup } = load('utils/runtime-config.js')
const group = { apiVersion: 'w7panel.w7.com/v1alpha1', metadata: { uid: 'group-uid', annotations: { 'w7.cc/default-domain': 'https://site.example.com' } } }
const app = () => ({ metadata: { name: 'site', namespace: 'tenant' }, spec: { template: { spec: { containers: [
  { name: 'sidecar', image: 'helper', volumeMounts: [] }, { name: 'web', image: 'node:22', volumeMounts: [{ name: 'data', subPath: 'nginx-web-dir/site.example.com', mountPath: '/www/wwwroot' }] }
], volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'site-data' } }] } } } })
test('legacy and current routes resolve to the same site workspace', () => {
  for (const [input, expected] of [['#/', '/site/basic'], ['#/version', '/site/basic'], ['/nginx', '/site/gateway'], ['https://host/tool/#/files', '/site/files'], ['#/site/files', '/site/files'], ['/environment', '/environment']]) assert.equal(resolveSiteRoute(input), expected)
})
test('namespace and MicroApp menu identity are supplied separately from the tool workload', () => {
  const identity = siteIdentity({ appgroup: 'site', namespace: 'tenant', app_name: 'tool-workload', microappName: 'tool-menu' })
  assert.equal(identity.namespace, 'tenant'); assert.equal(identity.toolName, 'tool-workload'); assert.equal(identity.microAppName, 'tool-menu')
})
test('site directory selects the matching PVC mount in the actual application container', () => {
  const directory = resolveSiteDirectory(app(), group)
  assert.equal(directory.containerName, 'web'); assert.equal(directory.path, '/www/wwwroot')
})
test('ambiguous, missing and dynamic mounts do not open an entire PVC', () => {
  const value = app(); value.spec.template.spec.containers.push(value.spec.template.spec.containers[1])
  assert.throws(() => resolveSiteDirectory(value, group), /多个容器/)
  const dynamic = app(); dynamic.spec.template.spec.containers[1].volumeMounts[0].subPathExpr = '$(SITE)'
  assert.throws(() => resolveSiteDirectory(dynamic, group), /未找到/)
})
test('domains reject protocols, paths, ports and malformed wildcard names', () => {
  assert.equal(normalizeDomain(' *.Example.com. '), '*.example.com')
  for (const value of ['https://a.com', 'a.com:80', 'a.com/path', '127.0.0.1', '*.*.com', '-a.com']) assert.throws(() => normalizeDomain(value))
})
test('adding nginx alias preserves comments, nested blocks, quoted strings and variables', () => {
  const source = '# keep\nhttp { server { server_name "site.example.com" # keep inline\n; location / { return 200 "${name} # {};"; } } server { server_name other.com; } }'
  const actual = updateNginxDomain(source, 'site.example.com', 'alias.example.com')
  assert.equal(actual, source.replace('\n; location', '\n alias.example.com; location'))
  assert.equal(updateNginxDomain(actual, 'site.example.com', 'alias.example.com'), actual)
  assert.ok(updateNginxDomain(actual, 'site.example.com', 'alias.example.com', false).includes('# keep inline'))
})
test('ambiguous nginx servers fail before changing content', () => {
  assert.throws(() => updateNginxDomain('server { server_name site.example.com; } server { server_name site.example.com; }', 'site.example.com', 'alias.com'), /唯一定位/)
  assert.throws(() => updateNginxDomain('server { server_name site.example.com; }', 'site.example.com', 'site.example.com', false), /默认域名/)
})
test('HTTP backends require an explicit port on multi-port services', () => {
  const context = { application: app(), service: { metadata: { name: 'site' }, spec: { ports: [{ port: 80 }, { port: 3000 }] } } }
  assert.throws(() => domainBackend(context), /请选择/)
  assert.equal(domainBackend(context, 3000).port.number, 3000)
  assert.throws(() => domainBackend(context, 4000), /请选择/)
})
test('FastCGI applications cannot disable the HTTP gateway', () => {
  const application = app(); application.spec.template.spec.containers[1].image = 'php:8.3-fpm'
  assert.equal(requiresFastcgi(application), true)
  assert.throws(() => gatewayIngressPatches([], { applicationPort: 9000, requiresFastcgi: true }, false), /PHP-FPM/)
  application.spec.template.spec.containers[1].command = ['php', '-S', '0.0.0.0:8080']
  assert.equal(requiresFastcgi(application), false)
})
test('domain creation uses the gateway, namespace and AppGroup ownership', () => {
  const value = domainIngress({ application: app(), appGroup: group, group: 'site', namespace: 'tenant', tool: { metadata: { name: 'site-tool' } }, gatewayEnabled: true, gateway: { toolPort: 8080 } }, { host: 'alias.example.com', autoHttps: true, ingressClass: 'nginx' }, 'alias')
  assert.equal(value.metadata.namespace, 'tenant'); assert.equal(value.metadata.ownerReferences[0].uid, 'group-uid')
  assert.equal(value.spec.rules[0].http.paths[0].backend.service.port.number, 8080)
  assert.equal(value.spec.tls[0].secretName, 'alias-tls')
  assert.equal(setAutoHttps(value, false).spec.tls, undefined)
})
test('unchanged startup form preserves exact argv including image default args', () => {
  const container = { command: ['/entrypoint', '--message', 'a b'], args: ['--flag'] }
  assert.equal(JSON.stringify(resolveStartup(startupDraft(container))), JSON.stringify(container))
  const argsOnly = { command: [], args: ['node', 'app.js'] }
  assert.equal(JSON.stringify(resolveStartup(startupDraft(argsOnly))), JSON.stringify(argsOnly))
})
test('Kubernetes requests and exec use the panel namespace', async () => {
  const exports = {}, calls = []; let intercept
  const client = { interceptors: { request: { use(fn) { intercept = fn } } }, post(url, data) { calls.push({ url, data }); return Promise.resolve({}) } }
  const source = fs.readFileSync(path.join(root, 'utils/panel.js'), 'utf8')
  const code = babel.transformSync(source, { configFile: false, plugins: [require('../ui/node_modules/@babel/plugin-transform-modules-commonjs')] }).code
  vm.runInNewContext(code, { exports, window: { $wujie: { props: { namespace: 'tenant', paneltoken: 'token' } } }, localStorage: { getItem: () => '' }, require: () => ({ __esModule: true, default: { create: () => client } }) })
  assert.equal(intercept({ url: '/apis/apps/v1/namespaces/default/deployments/site' }).url, '/k8s-proxy/apis/apps/v1/namespaces/tenant/deployments/site')
  assert.equal(intercept({ url: '/apis/cert-manager.io/v1/namespaces/tenant/certificates' }).url, '/k8s-proxy/apis/cert-manager.io/v1/namespaces/tenant/certificates')
  await exports.default.exec('web', 'site-pod', 'pwd'); assert.equal(calls[0].data.namespace, 'tenant')
})
test('enabling a gateway includes aliases created while it was disabled', () => {
  const { withIngressDomains } = load('utils/nginx-domain.js')
  const config = 'server { server_name site.example.com; location / { proxy_pass http://site; } }'
  const ingresses = [{ spec: { rules: [{ host: 'alias.example.com', http: { paths: [{ backend: { service: { name: 'site' } } }] } }, { host: 'unrelated.com', http: { paths: [{ backend: { service: { name: 'other' } } }] } }] } }]
  const updated = withIngressDomains(config, 'site.example.com', ingresses, { applicationService: 'site', toolService: 'tool' })
  assert.match(updated, /server_name site.example.com alias.example.com;/); assert.ok(!updated.includes('unrelated.com'))
})
test('PHP HTTP startup uses an HTTP upstream when preparing gateway configuration', () => {
  const { defaultGatewayNginxConfig } = load('utils/nginx-config.js')
  const application = app(); application.spec.template.spec.containers[1] = { name: 'web', image: 'php:8.3', command: ['php', '-S', '0.0.0.0:8080'] }
  const config = defaultGatewayNginxConfig(application, { applicationService: 'site', applicationPort: 80 }, 'site.example.com')
  assert.match(config, /proxy_pass http:\/\/site.tenant.svc.cluster.local:80/); assert.ok(!config.includes('fastcgi_pass'))
})
test('file entry uses the existing native toFile event with the application directory', async () => {
  const { openSiteFiles } = load('utils/site-files.js')
  const application = app(); application.spec.template.spec.containers.reverse()
  const context = { group: 'site', application, microAppName: 'site-tool-menu', toolName: 'site-tool-workload', directory: { containerName: 'web', path: '/www/wwwroot/framework/table' } }
  const events = []
  await openSiteFiles(context, { bus: { $emit: (name, data) => events.push({ name, data }) } })
  assert.equal(events.length, 1); assert.equal(events[0].name, 'toFile')
  assert.equal(events[0].data.appgroup, 'site'); assert.equal(events[0].data.appname, 'site'); assert.equal(events[0].data.kind, 'deployments')
  assert.equal(events[0].data.path, '%252Fwww%252Fwwwroot%252Fframework%252Ftable')
  assert.equal(events[0].data.sourceMicroApp, 'site-tool-menu'); assert.equal(events[0].data.sourceMenuDo, '__panel_site_files__')
})
test('native toFile contract preserves Chinese, spaces, reserved characters and literal percent escapes', async () => {
  const { openSiteFiles } = load('utils/site-files.js')
  const application = app(); application.spec.template.spec.containers.reverse()
  for (const path of ['/www/wwwroot/framework/table', '/www/中文 目录', '/www/a&b%file', '/www/literal%2Fsegment']) {
    let target
    await openSiteFiles({ group: 'site', application, directory: { containerName: 'web', path } }, { bus: { $emit: (name, data) => {
      target = `/app/appgroup/${data.appgroup}/${data.kind}/${data.appname}/files#path=${data.path}`
    } } })
    // The existing panel router decodes the string route hash once. Its
    // files.vue then extracts and decodes path; reserved '&' must stay encoded.
    const routeHash = decodeURIComponent(new URL(target, 'http://panel.test').hash)
    const encoded = routeHash.match(/path=([^&]+)/)[1]
    assert.equal(decodeURIComponent(encoded), path)
  }
})
test('invalid directory, unsupported container and missing host do not navigate', async () => {
  const { openSiteFiles } = load('utils/site-files.js')
  const application = app(); let navigated = false
  const bridge = { bus: { $emit: () => { navigated = true } } }
  await assert.rejects(openSiteFiles({ group: 'site', application, directoryError: '目录缺失' }, bridge), /目录缺失/)
  await assert.rejects(openSiteFiles({ group: 'site', application, directory: { containerName: 'web', path: '/www' } }, bridge), /首个容器/)
  application.spec.template.spec.containers.reverse()
  await assert.rejects(openSiteFiles({ group: 'site', application, directory: { containerName: 'web', path: '/www' } }, {}), /从面板打开/)
  assert.equal(navigated, false)
})
