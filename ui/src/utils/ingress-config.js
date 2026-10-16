export const INGRESS_BACKENDS = 'w7.cc/ingress-backends'

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const serviceName = value => typeof value === 'string' && value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value)
const validBackend = backend => {
  if (!isObject(backend) || !serviceName(backend.name) || !isObject(backend.port) || Object.keys(backend.port).length !== 1) return false
  const { number, name } = backend.port
  return Number.isInteger(number) && number >= 1 && number <= 65535 || serviceName(name) && name.length <= 15 && /[a-z]/.test(name)
}

// Store only explicit Service replacements; the chart still supplies hosts, paths and other settings.
export function ingressBackendPatch(ingress, sourceServices, target) {
  if (!validBackend(target)) throw new Error('Ingress 转发目标的 Service 名称或端口不正确')
  const patch = [{ op: 'test', path: '/metadata/resourceVersion', value: ingress.metadata.resourceVersion }]
  let matched = false
  for (const [ruleIndex, rule] of (ingress.spec?.rules || []).entries()) {
    for (const [pathIndex, path] of (rule.http?.paths || []).entries()) {
      const current = path.backend?.service
      if (!sourceServices.includes(current?.name)) continue
      matched = true
      if (JSON.stringify(current) !== JSON.stringify(target)) patch.push({ op: 'replace', path: `/spec/rules/${ruleIndex}/http/paths/${pathIndex}/backend/service`, value: target })
    }
  }
  if (!matched) return null
  let backends = {}
  const raw = ingress.metadata.annotations?.[INGRESS_BACKENDS]
  if (raw) {
    try { backends = JSON.parse(raw) } catch { throw new Error('Ingress 转发保留标记不是有效的 JSON，请检查后重试') }
    if (!isObject(backends) || !Object.entries(backends).every(([source, backend]) => serviceName(source) && validBackend(backend))) {
      throw new Error('Ingress 转发保留标记结构不正确，请检查后重试')
    }
  }
  backends = { ...backends }
  for (const source of sourceServices) {
    if (!serviceName(source)) throw new Error('Ingress 转发来源的 Service 名称不正确')
    backends[source] = target
  }
  patch.push({ op: 'add', path: '/metadata/annotations', value: { ...ingress.metadata.annotations, [INGRESS_BACKENDS]: JSON.stringify(backends) } })
  return patch
}
