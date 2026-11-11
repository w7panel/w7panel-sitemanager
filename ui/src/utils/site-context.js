import panelAxios from './panel'
import { gatewayConfig, GATEWAY_CONFIG, GATEWAY_CONTAINERS } from './gateway-config'

export function siteIdentity(props = window.$wujie?.props || {}) {
  return { group: props.group || props.appgroup || '', toolName: props.app_name || props.microappName || '', microAppName: props.microappName || '', namespace: props.namespace || 'default' }
}

export function defaultHostname(appGroup) {
  const address = appGroup?.metadata?.annotations?.['w7.cc/default-domain']
  if (!address) throw new Error('应用尚未配置默认域名')
  const url = new URL(address)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('应用默认域名格式不正确')
  return url.hostname
}

export function resolveSiteDirectory(application, appGroup) {
  const hostname = defaultHostname(appGroup)
  const spec = application?.spec?.template?.spec || {}
  const candidates = []
  for (const container of spec.containers || []) {
    for (const mount of container.volumeMounts || []) {
      const volume = (spec.volumes || []).find(item => item.name === mount.name)
      if (!volume?.persistentVolumeClaim?.claimName || mount.subPathExpr || !mount.mountPath?.startsWith('/')) continue
      const subPath = (mount.subPath || '').replace(/^\/+|\/+$/g, '')
      if (subPath.split('/').includes('..')) continue
      if (subPath !== `nginx-web-dir/${hostname}`) continue
      candidates.push({ containerName: container.name, path: mount.mountPath.replace(/\/+$/, '') || '/',
        pvcName: volume.persistentVolumeClaim.claimName, subPath })
    }
  }
  if (candidates.length !== 1) throw new Error(candidates.length ? '站点目录对应多个容器，暂时无法唯一定位' : '未找到当前站点的持久化目录挂载')
  return candidates[0]
}

export async function loadSiteContext() {
  const identity = siteIdentity()
  if (!identity.group) throw new Error('未获取到当前应用')
  const ns = encodeURIComponent(identity.namespace)
  const appGroup = (await panelAxios.get(`/apis/w7panel.w7.com/v1alpha1/namespaces/${ns}/appgroups/${encodeURIComponent(identity.group)}`)).data
  const workloadName = (appGroup.status?.items || []).find(item => item.kind === 'Deployment' && item.name === identity.group)?.name
  if (!workloadName) throw new Error('未找到站点主应用')
  const application = (await panelAxios.get(`/apis/apps/v1/namespaces/${ns}/deployments/${encodeURIComponent(workloadName)}`)).data
  let directory = null, directoryError = '', tool = null, gatewayError = '', service = null
  try { directory = resolveSiteDirectory(application, appGroup) } catch (error) { directoryError = error.message }
  try { service = (await panelAxios.get(`/api/v1/namespaces/${ns}/services/${encodeURIComponent(workloadName)}`)).data }
  catch (error) { if (error.response?.status !== 404) throw error }
  if (identity.toolName) {
    try { tool = (await panelAxios.get(`/apis/apps/v1/namespaces/${ns}/deployments/${encodeURIComponent(identity.toolName)}`)).data }
    catch (error) { if (error.response?.status !== 404) gatewayError = error.response?.data?.message || error.message }
  }
  let gateway = null
  const declared = !!(tool?.metadata?.annotations?.[GATEWAY_CONFIG] && tool?.metadata?.annotations?.[GATEWAY_CONTAINERS])
  if (declared) {
    try { gateway = gatewayConfig(application, tool, service) } catch (error) { gatewayError = error.message }
  }
  const legacyEnabled = !!tool && !/(^|\/)pause(?::|@|$)/.test(tool.spec?.template?.spec?.containers?.[0]?.image || '')
  return { ...identity, appGroup, application, service, tool, directory, directoryError, gateway, gatewayError,
    hostname: defaultHostname(appGroup), gatewayAvailable: declared || legacyEnabled || !!gatewayError,
    gatewayEnabled: gateway?.enabled ?? legacyEnabled }
}
