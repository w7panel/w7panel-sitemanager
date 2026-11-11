import panelAxios from './panel'
import { requiresFastcgi } from './site-http'
import { normalizeDomain } from './site-hostname'
import { updateNginxDomain } from './nginx-domain'
export { normalizeDomain } from './site-hostname'
export { updateNginxDomain } from './nginx-domain'
import { requireNginxConfigFileCommand, saveNginxConfigCommand, checkNginxValidation } from './nginx-config'

export const SITE_DOMAIN = 'w7.cc/site-domain'
const clone = value => JSON.parse(JSON.stringify(value))
export const ingressApi = namespace => `/apis/networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/ingresses`

const dnsName = value => typeof value === 'string' ? value.toLowerCase().replace(/\.$/, '') : ''
function tlsHostMatches(pattern, host) {
  pattern = dnsName(pattern); host = dnsName(host)
  if (!pattern || !host) return false
  if (pattern === host) return true
  const suffix = pattern.slice(1)
  if (!pattern.startsWith('*.') || !host.endsWith(suffix)) return false
  const label = host.slice(0, -suffix.length)
  return !!label && !label.includes('.')
}

export function domainHttpsState(ingress, host) {
  const rules = ingress.spec?.rules || [], paths = rules[0]?.http?.paths || []
  const simple = !!host && rules.length === 1 && rules[0].host === host && paths.length === 1 && paths[0].path === '/'
  const issuer = ingress.metadata?.annotations?.['cert-manager.io/cluster-issuer'] || ''
  const auto = issuer === 'w7-letsencrypt-prod' || issuer.startsWith('w7-dns-')
  const tls = ingress.spec?.tls || []
  const https = tls.some(item => !item.hosts?.length || item.hosts.some(pattern => tlsHostMatches(pattern, host)))
  // Only the single-domain automatic certificate shape is safe to replace or remove.
  // Any existing manual TLS, extra entries or additional hosts may share a secret.
  const simpleTls = !tls.length || (auto && tls.length === 1 && tls[0].hosts?.length === 1
    && dnsName(tls[0].hosts[0]) === dnsName(host))
  return { auto, https, simple, editable: simple && simpleTls }
}

export function domainBackend(context, selectedPort) {
  if (context.gatewayEnabled) {
    const config = context.gateway
    const service = context.tool?.metadata?.name
    const number = config?.toolPort || 80
    if (!service) throw new Error('未找到网关服务')
    return { name: service, port: { number } }
  }
  if (requiresFastcgi(context.application)) throw new Error('当前 PHP-FPM 环境需要网关才能接收 HTTP 请求，请先开启网关')
  const ports = (context.service?.spec?.ports || []).filter(item => (item.protocol || 'TCP') === 'TCP')
  const port = selectedPort ? ports.find(item => item.port === Number(selectedPort)) : ports.length === 1 ? ports[0] : null
  if (!port) throw new Error(ports.length ? '请选择应用提供 HTTP 服务的转发端口' : '应用没有可用的 HTTP 服务端口，请先配置端口或开启网关')
  return { name: context.service.metadata.name, port: { number: port.port } }
}

export function domainIngress(context, { host, autoHttps, ingressClass, backendPort, dnsAnnotations = {} }, name) {
  const domain = normalizeDomain(host)
  if (!context.appGroup?.metadata?.uid) throw new Error('应用信息不完整，请刷新后重试')
  const backend = domainBackend(context, backendPort)
  const body = { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress',
    metadata: { name, namespace: context.namespace,
      labels: { 'w7.cc/group-name': context.group, group: context.group, app: context.application.metadata.name },
      annotations: { [SITE_DOMAIN]: context.group, 'kubernetes.io/ingress.class': ingressClass },
      ownerReferences: [{ apiVersion: context.appGroup.apiVersion, kind: context.appGroup.kind || 'AppGroup', name: context.group, uid: context.appGroup.metadata.uid }] },
    spec: { rules: [{ host: domain, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: backend } }] } }] } }
  return setAutoHttps(body, autoHttps, dnsAnnotations)
}

export function setAutoHttps(ingress, enabled, dnsAnnotations = {}) {
  if (!domainHttpsState(ingress, ingress.spec?.rules?.[0]?.host).editable)
    throw new Error('当前域名包含手工证书或复杂证书、路由配置，请在面板域名管理中调整')
  const body = clone(ingress), annotations = body.metadata.annotations || (body.metadata.annotations = {})
  if (enabled) {
    annotations['cert-manager.io/cluster-issuer'] = 'w7-letsencrypt-prod'
    annotations['cert-manager.io/renew-before'] = '30m'
    annotations['w7.cc/ssl-redirect'] = 'false'
    Object.assign(annotations, dnsAnnotations)
    body.spec.tls = [{ hosts: [body.spec.rules[0].host], secretName: body.spec.tls?.[0]?.secretName || `${body.metadata.name}-tls` }]
  } else {
    for (const key of ['cert-manager.io/cluster-issuer', 'cert-manager.io/renew-before', 'w7.cc/ssl-redirect', 'w7.cc/dns-profile', 'w7.cc/dns-grant']) delete annotations[key]
    delete body.spec.tls
  }
  return body
}

export async function nginxDomainChange(context, host, add = true) {
  if (!context.gatewayEnabled) return null
  const tool = context.tool
  const container = tool?.spec?.template?.spec?.containers?.find(item => item.name === context.gateway?.variants?.enabled?.name)
    || tool?.spec?.template?.spec?.containers?.[0]
  if (!container) throw new Error('未找到网关容器')
  const selector = Object.entries(tool.spec.selector.matchLabels).map(([key, value]) => `${key}=${value}`).join(',')
  const pods = (await panelAxios.get(`/api/v1/namespaces/${context.namespace}/pods`, { params: { labelSelector: selector } })).data?.items || []
  const pod = pods.find(item => !item.metadata.deletionTimestamp && item.status?.phase === 'Running'
    && item.status.containerStatuses?.some(status => status.name === container.name && status.state?.running))
  if (!pod) throw new Error('网关容器尚未运行，请恢复后重试')
  const filename = `${context.hostname}.conf`
  const original = String((await panelAxios.exec(container.name, pod.metadata.name, `${requireNginxConfigFileCommand(filename)}\ncat "$CONF_FILE"`)).data ?? '')
  const content = updateNginxDomain(original, context.hostname, host, add)
  if (content === original) return null
  async function apply(value) {
    const response = await panelAxios.exec(container.name, pod.metadata.name, saveNginxConfigCommand(value, filename))
    checkNginxValidation(response.data)
    await panelAxios.exec(container.name, pod.metadata.name, 'nginx -s reload')
  }
  try { await apply(content) }
  catch (error) {
    try { await apply(original) } catch { throw new Error('网关更新未完成且原配置恢复失败，请检查网关配置后重试') }
    throw error
  }
  return () => apply(original)
}
