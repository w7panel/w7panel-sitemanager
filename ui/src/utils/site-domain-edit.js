import panelAxios from './panel'
import { normalizeDomain, ingressApi, domainHttpsState, setAutoHttps, nginxDomainChange, SITE_DOMAIN } from './site-domain'

const clone = value => JSON.parse(JSON.stringify(value))
const dnsName = value => String(value || '').toLowerCase().replace(/\.$/, '')
const detail = error => error.response?.data?.message || error.message || '域名更新失败'

export function canEditDomain(context, ingress, host) {
  if (dnsName(host) === dnsName(context.hostname) || !ingress?.metadata?.uid || !ingress.metadata.resourceVersion) return false
  const state = domainHttpsState(ingress, host)
  const owner = ingress.metadata.annotations?.[SITE_DOMAIN]
  const backend = ingress.spec?.rules?.[0]?.http?.paths?.[0]?.backend?.service?.name
  return state.editable && !ingress.spec.defaultBackend && (!owner || owner === context.group)
    && [context.application?.metadata?.name, context.tool?.metadata?.name].filter(Boolean).includes(backend)
}

export function matchingDnsProfiles(profiles, host) {
  const name = dnsName(host).replace(/^\*\./, '')
  return profiles.filter(profile => {
    const zone = dnsName(profile.zone)
    return zone && (name === zone || name.endsWith('.' + zone))
  })
}

export function checkDomainRange(host, whiteList) {
  const rules = whiteList.filter(item => !item.disabled)
  if (whiteList.length && !rules.some(item => host.endsWith('.' + dnsName(item.domain))))
    throw new Error('该域名不在当前可绑定范围内')
}

// A renamed automatic certificate gets its own Secret, even if the old Secret was shared.
function certificateSecret(ingress) {
  return `${ingress.metadata.name.slice(0, 210).replace(/[.-]+$/, '')}-tls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function renameSiteDomain(context, original, value, profileId = '') {
  const oldHost = original?.spec?.rules?.[0]?.host, host = normalizeDomain(value)
  if (!canEditDomain(context, original, oldHost)) throw new Error('主域名不可编辑；复杂路由或手工证书请在面板域名管理中调整')
  if (host === dnsName(context.hostname)) throw new Error('主域名不可编辑，不能替换为主域名')
  if (host === oldHost) return { ingress: original, warning: '', unchanged: true }
  const base = ingressApi(context.namespace), url = `${base}/${encodeURIComponent(original.metadata.name)}`
  const current = (await panelAxios.get(url)).data
  if (current?.metadata?.uid !== original.metadata.uid || current.metadata.resourceVersion !== original.metadata.resourceVersion)
    throw new Error('域名已被其他操作修改，请刷新后重试')
  if (!canEditDomain(context, current, oldHost)) throw new Error('当前域名不支持编辑，请刷新检查')
  const response = (await panelAxios.get('/panel-api/v1/auth/domain-white-list')).data
  const whiteList = response?.code === 200 ? response.data : response
  if (!Array.isArray(whiteList)) throw new Error('域名范围读取失败，请刷新重试')
  checkDomainRange(host, whiteList)
  const all = (await panelAxios.get(base)).data?.items
  if (!Array.isArray(all)) throw new Error('域名列表读取失败，请重试')
  if (all.some(item => item.spec?.rules?.some(rule => dnsName(rule.host) === host))) throw new Error('该域名已经存在，请使用其他域名')
  const auto = domainHttpsState(current, oldHost).auto
  const body = setAutoHttps(current, false)
  body.spec.rules[0].host = host
  if (auto) {
    Object.assign(body, setAutoHttps(body, true))
    body.spec.tls[0].secretName = certificateSecret(body)
    if (host.startsWith('*.')) {
      const profiles = (await panelAxios.get('/panel-api/v1/dns-profiles')).data
      if (!Array.isArray(profiles) || !matchingDnsProfiles(profiles, host).some(profile => profile.id === profileId))
        throw new Error('请选择属于新泛域名的已验证 DNS 配置')
      const grant = (await panelAxios.post(`/panel-api/v1/dns-profiles/${encodeURIComponent(profileId)}/grant`, {
        namespace: context.namespace, name: body.metadata.name, host
      })).data
      if (!grant?.['w7.cc/dns-grant'] || grant['w7.cc/dns-profile'] !== profileId || !grant['cert-manager.io/cluster-issuer']?.startsWith('w7-dns-'))
        throw new Error('DNS 签发授权失败')
      Object.assign(body.metadata.annotations, grant)
    }
  }
  let undoNginx = null, saved
  try {
    undoNginx = await nginxDomainChange(context, host)
    saved = (await panelAxios.put(url, body)).data
    if (saved?.metadata?.uid !== body.metadata.uid || saved.spec?.rules?.[0]?.host !== host)
      throw new Error('域名更新响应不完整')
  } catch (error) {
    // A lost response may follow a successful write. Never remove the new alias until verified.
    let observed
    try { observed = (await panelAxios.get(url)).data }
    catch { throw Object.assign(new Error(`${detail(error)}；提交状态未确认，请刷新检查，勿重复保存`), { uncertain: true }) }
    if (observed?.metadata?.uid === body.metadata.uid && observed.spec?.rules?.[0]?.host === host) saved = observed
    else {
      if (undoNginx) {
        try {
          const references = (await panelAxios.get(base)).data?.items
          if (!Array.isArray(references) || references.some(item => item.spec?.rules?.some(rule => dnsName(rule.host) === host)))
            throw new Error('new domain is referenced')
          await undoNginx()
        } catch { throw Object.assign(new Error(`${detail(error)}；网关配置可能已更新，请检查后重试`), { uncertain: true }) }
      }
      throw error
    }
  }
  let warning = ''
  if (context.gatewayEnabled) {
    try {
      const references = (await panelAxios.get(base)).data?.items
      if (!Array.isArray(references)) throw new Error('域名列表读取失败')
      if (!references.some(item => item.spec?.rules?.some(rule => dnsName(rule.host) === dnsName(oldHost))))
        await nginxDomainChange(context, oldHost, false)
    } catch { warning = '新域名已保存，旧域名的网关别名未清理，请在网关配置中检查。' }
  }
  return { ingress: clone(saved), warning, unchanged: false }
}
