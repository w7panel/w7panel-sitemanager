import panelAxios from './panel'
import { normalizeDomain, ingressApi, domainHttpsState, nginxDomainChange, SITE_DOMAIN } from './site-domain'

const clone = value => JSON.parse(JSON.stringify(value))
const dnsName = value => String(value || '').toLowerCase().replace(/\.$/, '')
const detail = error => error.response?.data?.message || error.message || '域名更新失败'
const PATCH = { headers: { 'Content-Type': 'application/json-patch+json' } }

export function canEditDomain(context, ingress, host) {
  if (!dnsName(host) || !ingress) return false
  if (!ingress.metadata?.uid || !ingress.metadata.resourceVersion
    || (ingress.metadata.namespace && ingress.metadata.namespace !== context.namespace)) return false
  const owner = ingress.metadata.annotations?.[SITE_DOMAIN]
  if (owner && owner !== context.group) return false
  const services = [context.application?.metadata?.name, context.tool?.metadata?.name].filter(Boolean)
  const rules = (ingress.spec?.rules || []).filter(rule => dnsName(rule.host) === dnsName(host))
  return !!rules.length && rules.every(rule => rule.http?.paths?.some(path => services.includes(path.backend?.service?.name)))
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

function certificateSecret(ingress) {
  return `${ingress.metadata.name.slice(0, 210).replace(/[.-]+$/, '')}-tls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function acceptedIngress(value, pending) {
  if (!value?.metadata?.uid || value.metadata.name !== pending.body.metadata.name) return false
  if (pending.derived) {
    const labels = value.metadata.labels || {}
    if (labels['w7.cc/ingress-rootname'] !== pending.derived.rootName
      || (value.metadata.name !== pending.derived.grantName && labels.parents !== pending.derived.grantName)) return false
  } else if ((pending.originalUid && value.metadata.uid !== pending.originalUid)
    || (pending.savedUid && value.metadata.uid !== pending.savedUid)) return false
  if (!pending.derived && !pending.originalUid && (!value.metadata.ownerReferences?.some(owner => owner.uid === pending.groupUid)
    || value.metadata.annotations?.[SITE_DOMAIN] !== pending.group)) return false
  return pending.targets.every(index => dnsName(value.spec?.rules?.[index]?.host) === pending.host
    && value.spec.rules[index].http?.paths?.some(path => pending.services.includes(path.backend?.service?.name)))
}

function childEntries(root) {
  let entries
  try { entries = JSON.parse(root?.metadata?.annotations?.['w7.cc/child-hosts'] || '[]') }
  catch { throw new Error('域名分组配置格式不正确，请在面板域名管理中检查') }
  if (!Array.isArray(entries)) throw new Error('域名分组配置格式不正确，请在面板域名管理中检查')
  return entries
}

function derivedEntry(root, current, oldHost) {
  const rootName = root.metadata.name, labels = current.metadata.labels || {}
  const matches = childEntries(root).filter(entry => entry && dnsName(entry.host) === oldHost && typeof entry.name === 'string'
    && entry.name && (current.metadata.name === `${rootName}-${entry.name}` || labels.parents === `${rootName}-${entry.name}`))
  if (matches.length !== 1) throw new Error('无法唯一定位域名分组中的当前域名，请刷新后重试')
  return matches[0]
}

function sameDerivedEntry(entry, expected) {
  return entry?.name === expected.name && dnsName(entry.host) === dnsName(expected.host)
    && !!entry.autoSsl === !!expected.autoSsl && !!entry.sslRedirect === !!expected.sslRedirect
    && (entry.dnsProfileId || '') === (expected.dnsProfileId || '') && (entry.dnsGrant || '') === (expected.dnsGrant || '')
}

function assertDerivedRootSite(context, root) {
  const owner = root.metadata.annotations?.[SITE_DOMAIN]
  const services = [context.application?.metadata?.name, context.tool?.metadata?.name].filter(Boolean)
  if ((root.metadata.namespace && root.metadata.namespace !== context.namespace) || (owner && owner !== context.group)
    || !(root.spec?.rules || []).some(rule => rule.http?.paths?.some(path => services.includes(path.backend?.service?.name))))
    throw new Error('域名分组已不属于当前站点，请刷新检查')
}

async function readDerivedRoot(context, pending) {
  const root = (await panelAxios.get(`${ingressApi(context.namespace)}/${encodeURIComponent(pending.derived.rootName)}`)).data
  if (root?.metadata?.uid !== pending.derived.rootUid) throw new Error('域名分组已被其他操作替换，请刷新检查')
  assertDerivedRootSite(context, root)
  const entries = childEntries(root).filter(entry => entry?.name === pending.derived.entry.name)
  if (entries.length !== 1) throw new Error('域名分组中的当前条目已被其他操作修改，请刷新检查')
  return { root, entry: entries[0] }
}

async function waitForDerived(context, pending) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const current = (await panelAxios.get(`${ingressApi(context.namespace)}/${encodeURIComponent(pending.body.metadata.name)}`)).data
      if (acceptedIngress(current, pending)) return current
      if (current?.metadata?.labels?.['w7.cc/ingress-rootname'] !== pending.derived.rootName
        || current.spec?.rules?.some(rule => ![pending.oldHost, pending.host].includes(dnsName(rule.host))))
        throw new Error('派生域名入口已被其他操作修改，请刷新检查')
    } catch (error) {
      if (error.response?.status !== 404) throw error
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 750))
  }
  throw new Error('域名分组已更新，正在等待域名入口同步，请检查提交结果')
}

async function renameDerivedDomain(context, current, host, oldHost, profileId, all) {
  const rootName = current.metadata.labels['w7.cc/ingress-rootname']
  const root = all.find(item => item?.metadata?.name === rootName)
    || (await panelAxios.get(`${ingressApi(context.namespace)}/${encodeURIComponent(rootName)}`)).data
  if (!root?.metadata?.uid || !root.metadata.resourceVersion
    || (root.metadata.namespace && root.metadata.namespace !== context.namespace)) throw new Error('域名分组信息不完整，请刷新后重试')
  assertDerivedRootSite(context, root)
  const previous = derivedEntry(root, current, oldHost), entry = { ...clone(previous), host }
  const grantName = `${rootName}-${entry.name}`
  if (entry.autoSsl && host.startsWith('*.')) {
    const profiles = (await panelAxios.get('/panel-api/v1/dns-profiles')).data
    if (!Array.isArray(profiles) || !matchingDnsProfiles(profiles, host).some(profile => profile.id === profileId))
      throw new Error('请选择属于新泛域名的已验证 DNS 配置')
    const grant = (await panelAxios.post(`/panel-api/v1/dns-profiles/${encodeURIComponent(profileId)}/grant`, {
      namespace: context.namespace, name: grantName, host
    })).data
    if (!grant?.['w7.cc/dns-grant'] || grant['w7.cc/dns-profile'] !== profileId || !grant['cert-manager.io/cluster-issuer']?.startsWith('w7-dns-'))
      throw new Error('DNS 签发授权失败')
    entry.dnsProfileId = profileId; entry.dnsGrant = grant['w7.cc/dns-grant']
  } else { delete entry.dnsProfileId; delete entry.dnsGrant }
  const entries = childEntries(root).map(item => item.name === entry.name ? entry : item)
  const body = clone(current), targets = []
  body.spec.rules.forEach((rule, index) => { if (dnsName(rule.host) === oldHost) { rule.host = host; targets.push(index) } })
  const pending = { namespace: context.namespace, group: context.group, groupUid: context.appGroup?.metadata?.uid,
    originalUid: current.metadata.uid, body, oldHost, host, targets,
    services: [context.application?.metadata?.name, context.tool?.metadata?.name].filter(Boolean),
    derived: { rootName, rootUid: root.metadata.uid, rootResourceVersion: root.metadata.resourceVersion, entry, previous, grantName } }
  const patch = [
    { op: 'test', path: '/metadata/uid', value: root.metadata.uid },
    { op: 'test', path: '/metadata/resourceVersion', value: root.metadata.resourceVersion },
    { op: 'replace', path: '/metadata/annotations/w7.cc~1child-hosts', value: JSON.stringify(entries) }
  ]
  try {
    await nginxDomainChange(context, host, true, oldHost)
    try { await panelAxios.patch(`${ingressApi(context.namespace)}/${encodeURIComponent(rootName)}`, patch, PATCH) }
    catch (error) {
      const observed = await readDerivedRoot(context, pending)
      if (!sameDerivedEntry(observed.entry, entry)) throw error
    }
    const observed = await readDerivedRoot(context, pending)
    if (!sameDerivedEntry(observed.entry, entry)) throw new Error('域名分组提交状态未确认，请检查提交结果')
    const saved = await waitForDerived(context, pending)
    return finish(context, pending, saved)
  } catch (error) {
    throw Object.assign(new Error(`${detail(error)}；请检查提交结果，勿重复保存`), { uncertain: true, pending })
  }
}

function remainingIngress(current, oldHost) {
  const body = clone(current)
  body.spec.rules = (body.spec.rules || []).filter(rule => dnsName(rule.host) !== oldHost)
  if (!body.spec.rules.length) return null
  body.spec.tls = (body.spec.tls || []).map(tls => {
    if (!Array.isArray(tls.hosts)) return tls
    const hosts = tls.hosts.filter(host => dnsName(host) !== oldHost)
    return hosts.length ? { ...tls, hosts } : null
  }).filter(Boolean)
  if (!body.spec.tls.length) delete body.spec.tls
  return body
}

async function completeSource(context, pending, verify = false) {
  if (!pending.source) return null
  const source = pending.source, url = `${ingressApi(context.namespace)}/${encodeURIComponent(source.name)}`
  let current
  try {
    current = (await panelAxios.get(url)).data
    if (current?.metadata?.uid !== source.uid) throw new Error('原域名资源已被其他操作替换')
    if (!current.spec?.rules?.some(rule => dnsName(rule.host) === pending.oldHost)) return current
    if (!verify && current.metadata.resourceVersion !== source.resourceVersion) throw new Error('原域名资源已被其他操作修改')
    if (!canEditDomain(context, current, pending.oldHost)) throw new Error('原域名路由已不属于当前站点')
    const body = remainingIngress(current, pending.oldHost)
    if (!body) {
      pending.retainedAlias = true
      return current
    }
    try {
      const saved = (await panelAxios.put(url, body)).data
      if (saved?.metadata?.uid === source.uid && !saved.spec?.rules?.some(rule => dnsName(rule.host) === pending.oldHost)) return saved
      throw new Error('原域名更新响应不完整')
    } catch (error) {
      const observed = (await panelAxios.get(url)).data
      if (observed?.metadata?.uid === source.uid && !observed.spec?.rules?.some(rule => dnsName(rule.host) === pending.oldHost)) return observed
      throw error
    }
  } catch (error) {
    throw Object.assign(new Error(`${detail(error)}；新域名入口已创建，原域名清理状态未确认，请检查提交结果`), { uncertain: true, pending })
  }
}

async function finish(context, pending, saved, source = null) {
  let warning = pending.warning || ''
  if (pending.retainedAlias) warning += (warning ? '；' : '') + '旧入口还关联其他域名的证书，已保留旧域名别名，请在面板域名管理中调整。'
  if (context.gatewayEnabled) {
    try {
      const references = (await panelAxios.get(ingressApi(context.namespace))).data?.items
      if (!Array.isArray(references)) throw new Error('域名列表读取失败')
      if (!references.some(item => item.spec?.rules?.some(rule => dnsName(rule.host) === pending.oldHost)))
        await nginxDomainChange(context, pending.oldHost, false, pending.host)
    } catch { warning += (warning ? '；' : '') + '新域名已保存，旧域名的网关别名未清理，请在网关配置中检查。' }
  }
  return { ingress: clone(saved), ...(source ? { ingresses: [clone(source), clone(saved)] } : {}), warning, unchanged: false }
}

export async function verifySiteDomainRename(context, pending) {
  if (!pending?.body?.metadata?.name || pending.namespace !== context.namespace || pending.group !== context.group)
    throw new Error('域名提交信息不完整，请刷新检查')
  if (pending.derived) {
    const observed = await readDerivedRoot(context, pending)
    if (!sameDerivedEntry(observed.entry, pending.derived.entry)) {
      if (sameDerivedEntry(observed.entry, pending.derived.previous)) {
        const current = (await panelAxios.get(`${ingressApi(context.namespace)}/${encodeURIComponent(pending.body.metadata.name)}`)).data
        return { applied: false, ingress: current }
      }
      throw new Error('域名分组中的当前条目已被其他操作修改，请刷新检查')
    }
    try {
      const saved = await waitForDerived(context, pending)
      return { applied: true, ...await finish(context, pending, saved) }
    } catch (error) { throw Object.assign(error, { uncertain: true, pending }) }
  }
  let current
  try { current = (await panelAxios.get(`${ingressApi(context.namespace)}/${encodeURIComponent(pending.body.metadata.name)}`)).data }
  catch (error) {
    if (!pending.originalUid && error.response?.status === 404) return { applied: false }
    throw error
  }
  if (!acceptedIngress(current, pending)) {
    if (pending.originalUid && current?.metadata?.uid === pending.originalUid
      && pending.targets.every(index => dnsName(current.spec?.rules?.[index]?.host) === pending.oldHost)) return { applied: false, ingress: current }
    throw new Error('域名资源已被其他操作修改，请刷新检查')
  }
  const source = await completeSource(context, pending, true)
  return { applied: true, ...await finish(context, pending, current, source) }
}

export async function renameSiteDomain(context, original, value, profileId = '', selectedHost = original?.spec?.rules?.[0]?.host || context.hostname) {
  const oldHost = dnsName(selectedHost), host = normalizeDomain(value)
  if (!canEditDomain(context, original, oldHost)) throw new Error('未找到当前站点对应的域名路由，请刷新后重试')
  if (host === oldHost) return { ingress: original, warning: '', unchanged: true }
  const base = ingressApi(context.namespace)
  const current = (await panelAxios.get(`${base}/${encodeURIComponent(original.metadata.name)}`)).data
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
  if (current.metadata.labels?.['w7.cc/ingress-rootname']) return renameDerivedDomain(context, current, host, oldHost, profileId, all)
  const state = domainHttpsState(current, oldHost), auto = state.auto
  let body = clone(current), annotations = body.metadata.annotations || (body.metadata.annotations = {})
  let targets = []
  body.spec.rules.forEach((rule, index) => {
    if (dnsName(rule.host) === oldHost) { rule.host = host; targets.push(index) }
  })
  let changedTls = false
  for (const tls of body.spec.tls || []) {
    if (!tls.hosts?.some(name => dnsName(name) === oldHost)) continue
    tls.hosts = tls.hosts.map(name => dnsName(name) === oldHost ? host : name)
    changedTls = true
    if (auto) tls.secretName = certificateSecret(body)
  }
  if (auto && !domainHttpsState(body, host).https) {
    body.spec.tls = [...(body.spec.tls || []), { hosts: [host], secretName: certificateSecret(body) }]
    changedTls = true
  }
  const unrelated = (current.spec.rules || []).some(rule => dnsName(rule.host) !== oldHost)
    || (current.spec.tls || []).some(tls => tls.hosts?.some(name => dnsName(name) !== oldHost))
  const sharedTls = (current.spec.tls || []).some(tls => tls.hosts?.some(name => dnsName(name) === oldHost)
    && tls.hosts.some(name => dnsName(name) !== oldHost))
  let source = null
  if (auto && changedTls && unrelated && (sharedTls || host.startsWith('*.') || oldHost.startsWith('*.')
    || current.metadata.annotations?.['cert-manager.io/cluster-issuer']?.startsWith('w7-dns-'))) {
    if (!context.appGroup?.metadata?.uid) throw new Error('应用信息不完整，请刷新后重试')
    source = { name: current.metadata.name, uid: current.metadata.uid, resourceVersion: current.metadata.resourceVersion }
    const selected = targets.map(index => body.spec.rules[index])
    body.spec.rules = selected
    delete body.spec.defaultBackend
    body.spec.tls = (body.spec.tls || []).filter(tls => tls.hosts?.some(name => dnsName(name) === host))
      .map(tls => ({ ...tls, hosts: [host], secretName: certificateSecret(body) }))
    body.metadata.name = `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    for (const key of ['uid', 'resourceVersion', 'generation', 'creationTimestamp', 'managedFields', 'selfLink', 'deletionTimestamp', 'deletionGracePeriodSeconds']) delete body.metadata[key]
    delete body.status
    for (const key of ['parents', 'parentsPath', 'w7.cc/ingress-rootname', 'w7.cc/hide']) delete body.metadata.labels?.[key]
    delete body.metadata.annotations?.['w7.cc/child-hosts']
    body.metadata.ownerReferences = (body.metadata.ownerReferences || []).filter(owner => owner.kind !== 'Ingress')
    if (!body.metadata.ownerReferences.some(owner => owner.uid === context.appGroup.metadata.uid)) body.metadata.ownerReferences.push({
      apiVersion: context.appGroup.apiVersion || 'w7panel.w7.com/v1alpha1', kind: context.appGroup.kind || 'AppGroup', name: context.group, uid: context.appGroup.metadata.uid
    })
    annotations = body.metadata.annotations
    annotations[SITE_DOMAIN] = context.group
    delete annotations['w7.cc/dns-profile']; delete annotations['w7.cc/dns-grant']
    annotations['cert-manager.io/cluster-issuer'] = 'w7-letsencrypt-prod'
    targets = selected.map((_, index) => index)
  }
  if (auto && changedTls) {
    if (host.startsWith('*.')) {
      const profiles = (await panelAxios.get('/panel-api/v1/dns-profiles')).data
      if (!Array.isArray(profiles) || !matchingDnsProfiles(profiles, host).some(profile => profile.id === profileId))
        throw new Error('请选择属于新泛域名的已验证 DNS 配置')
      const grant = (await panelAxios.post(`/panel-api/v1/dns-profiles/${encodeURIComponent(profileId)}/grant`, {
        namespace: context.namespace, name: body.metadata.name, host
      })).data
      if (!grant?.['w7.cc/dns-grant'] || grant['w7.cc/dns-profile'] !== profileId || !grant['cert-manager.io/cluster-issuer']?.startsWith('w7-dns-'))
        throw new Error('DNS 签发授权失败')
      Object.assign(annotations, grant)
    } else if (!(body.spec.tls || []).some(tls => tls.hosts?.some(name => String(name).startsWith('*.')))) {
      delete annotations['w7.cc/dns-profile']
      delete annotations['w7.cc/dns-grant']
      annotations['cert-manager.io/cluster-issuer'] = 'w7-letsencrypt-prod'
    }
  }
  const pending = { namespace: context.namespace, group: context.group, groupUid: context.appGroup?.metadata?.uid,
    originalUid: source ? undefined : original.metadata.uid, source, body, oldHost, host, targets,
    services: [context.application?.metadata?.name, context.tool?.metadata?.name].filter(Boolean),
    warning: !auto && state.https ? '域名已保存，请确认手工证书是否覆盖新域名。' : '' }
  const url = `${base}/${encodeURIComponent(body.metadata.name)}`
  let undoNginx = null, saved
  try {
    undoNginx = await nginxDomainChange(context, host, true, oldHost)
    saved = (source ? await panelAxios.post(base, body) : await panelAxios.put(url, body)).data
    if (!acceptedIngress(saved, pending)) throw new Error('域名更新响应不完整')
  } catch (error) {
    let observed
    try { observed = (await panelAxios.get(url)).data }
    catch (readError) {
      if (source && readError.response?.status === 404) observed = null
      else throw Object.assign(new Error(`${detail(error)}；提交状态未确认，请检查提交结果，勿重复保存`), { uncertain: true, pending })
    }
    if (acceptedIngress(observed, pending)) saved = observed
    else {
      if (undoNginx) {
        try {
          const references = (await panelAxios.get(base)).data?.items
          if (!Array.isArray(references) || references.some(item => item.spec?.rules?.some(rule => dnsName(rule.host) === host)))
            throw new Error('new domain is referenced')
          await undoNginx()
        } catch { throw Object.assign(new Error(`${detail(error)}；网关配置可能已更新，请检查提交结果`), { uncertain: true, pending }) }
      }
      if (error.uncertain) error.pending = pending
      throw error
    }
  }
  pending.savedUid = saved.metadata.uid
  const remaining = await completeSource(context, pending)
  return finish(context, pending, saved, remaining)
}


export async function removeSiteDomain(context, original, host) {
  const oldHost = dnsName(host)
  if (!canEditDomain(context, original, oldHost)) throw new Error('当前域名不属于本站点，无法删除')
  const url = `${ingressApi(context.namespace)}/${encodeURIComponent(original.metadata.name)}`
  const current = (await panelAxios.get(url)).data
  if (current?.metadata?.uid !== original.metadata.uid || current.metadata.resourceVersion !== original.metadata.resourceVersion)
    throw new Error('域名已被其他操作修改，请刷新后重试')
  if (!canEditDomain(context, current, oldHost)) throw new Error('当前域名不属于本站点，无法删除')
  const rootName = current.metadata.labels?.['w7.cc/ingress-rootname']
  if (rootName) {
    const rootUrl = `${ingressApi(context.namespace)}/${encodeURIComponent(rootName)}`
    const root = (await panelAxios.get(rootUrl)).data
    assertDerivedRootSite(context, root)
    const entry = derivedEntry(root, current, oldHost)
    await panelAxios.patch(rootUrl, [
      { op: 'test', path: '/metadata/uid', value: root.metadata.uid },
      { op: 'test', path: '/metadata/resourceVersion', value: root.metadata.resourceVersion },
      { op: 'replace', path: '/metadata/annotations/w7.cc~1child-hosts', value: JSON.stringify(childEntries(root).filter(item => item.name !== entry.name)) }
    ], PATCH)
    return
  }
  // Removing a parent Ingress would also delete its derived domains.
  const remaining = remainingIngress(current, oldHost)
  if (remaining) { await panelAxios.put(url, remaining); return }
  if (childEntries(current).length) throw new Error('当前入口仍关联其他域名，请先在面板域名管理中解除分组，避免同时删除其他域名')
  await panelAxios.delete(url, {
    data: { apiVersion: 'v1', kind: 'DeleteOptions', preconditions: { uid: current.metadata.uid, resourceVersion: current.metadata.resourceVersion } }
  })
}
