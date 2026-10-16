// Keep the exact original argv until the user changes the visible startup form.
const quoteArgument = value => /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
  ? value
  : "'" + value.replaceAll("'", "'\"'\"'") + "'"

export function startupDraft(container) {
  const command = [...(container.command || [])]
  const args = [...(container.args || [])]
  const argv = [...command, ...args]
  const shell = argv.length === 3 && /(^|\/)(?:ba|a|da|k|z)?sh$/.test(argv[0]) && /^-[a-z]*c[a-z]*$/.test(argv[1])
  const mode = argv.length ? 'custom' : 'default'
  const text = !command.length ? '' : shell ? argv[2] : argv.map(quoteArgument).join(' ')
  return {
    mode, text, initialMode: mode, initialText: text,
    originalCommand: command, originalArgs: args,
    shellCommand: shell ? argv.slice(0, 2) : ['/bin/sh', '-c'],
    inheritedArgs: !command.length && args.length ? args.map(quoteArgument).join(' ') : ''
  }
}

export function resolveStartup(draft) {
  if (draft.mode === draft.initialMode && draft.text === draft.initialText) {
    return { command: [...draft.originalCommand], args: [...draft.originalArgs] }
  }
  if (draft.mode === 'default') return { command: [], args: [] }
  if (draft.mode !== 'custom' || !draft.text.trim()) throw new Error('请填写完整的启动命令，或选择使用镜像默认启动方式')
  if (draft.text.includes('\0')) throw new Error('启动命令包含无效字符')
  return { command: [...draft.shellCommand], args: [draft.text] }
}

export const RUNTIME_CONFIG = 'w7.cc/tradition-runtime-config'

function commandArguments(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${label}必须是字符串数组`)
  }
  return [...value]
}

export function readSelection(deployment, supportedFields = ['command', 'args', 'ports', 'livenessProbe', 'readinessProbe', 'startupProbe']) {
  let selection
  try { selection = JSON.parse(deployment.metadata?.annotations?.[RUNTIME_CONFIG] || '{}') } catch {
    throw new Error('已有运行配置标记不是有效 JSON，请先修复后再保存')
  }
  if (!selection || Array.isArray(selection) || typeof selection !== 'object'
    || (selection.servicePorts !== undefined && typeof selection.servicePorts !== 'boolean')
    || (selection.containers !== undefined && (!selection.containers || Array.isArray(selection.containers) || typeof selection.containers !== 'object'))) {
    throw new Error('已有运行配置标记结构不正确')
  }
  for (const fields of Object.values(selection.containers || {})) {
    if (!Array.isArray(fields) || fields.some(field => !supportedFields.includes(field))) {
      throw new Error('已有运行配置标记包含不支持的字段')
    }
  }
  return selection
}

const protocolOf = port => port.protocol || 'TCP'
const targetMatches = (servicePort, containerPort) => (containerPort.name && servicePort.targetPort === containerPort.name)
  || Number(servicePort.targetPort || servicePort.port) === containerPort.containerPort
const matches = (servicePort, containerPort) => protocolOf(servicePort) === protocolOf(containerPort)
  && (targetMatches(servicePort, containerPort) || (containerPort.name && servicePort.name === containerPort.name))

export function portRows(container, service) {
  return (container.ports || []).map((port, index) => {
    const mapping = (service?.spec?.ports || []).find(item => matches(item, port))
    return {
      name: port.name || `port-${index + 1}`,
      containerPort: port.containerPort,
      servicePort: mapping?.port || port.containerPort,
      protocol: protocolOf(port),
      existing: true,
      mapped: !!mapping
    }
  })
}

const integerPort = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65535
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function buildRuntimePlan(deployment, service, draft) {
  const containers = deployment.spec?.template?.spec?.containers || []
  const original = containers.find(item => item.name === draft.containerName)
  if (!original) throw new Error('未找到应用容器')
  const next = JSON.parse(JSON.stringify(original))
  const selection = readSelection(deployment)
  const fields = new Set(selection.containers?.[original.name] || [])
  const command = commandArguments(draft.command, '启动命令')
  const args = commandArguments(draft.args, '启动参数')
  const changes = []
  // command and args form one startup configuration, even when one is unchanged or empty.
  if (!same(original.command || [], command) || !same(original.args || [], args)) {
    next.command = command
    next.args = args
    fields.add('command')
    fields.add('args')
    changes.push('启动方式')
  }
  if (draft.image && draft.image !== original.image) {
    next.image = draft.image
    next.env = (next.env || []).filter(item => item.name !== 'IMAGE_VERSION')
    next.env.push({ name: 'IMAGE_VERSION', value: draft.version })
    changes.push('镜像版本')
  }
  const oldPorts = original.ports || []
  if (draft.ports.length < oldPorts.length) throw new Error('已有端口可能被探针或路由引用，当前不支持删除已有端口')
  const names = new Set()
  const numbers = new Set()
  const updatedPorts = draft.ports.map((row, index) => {
    if (!/^[a-z]([a-z0-9-]{0,13}[a-z0-9])?$/.test(row.name) || row.name.includes('--') || names.has(row.name)) throw new Error('端口名称须以字母开头，使用小写字母、数字或连字符，最多 15 位且不能重复')
    if (!integerPort(row.containerPort) || !integerPort(row.servicePort)) throw new Error('端口必须是 1–65535 的整数')
    if (!['TCP', 'UDP', 'SCTP'].includes(row.protocol)) throw new Error('端口协议无效')
    const key = `${row.containerPort}/${row.protocol}`
    if (numbers.has(key)) throw new Error('容器端口和协议不能重复')
    names.add(row.name); numbers.add(key)
    const old = oldPorts[index]
    if (old && (row.name !== (old.name || `port-${index + 1}`) || row.protocol !== protocolOf(old))) throw new Error('已有端口的名称和协议不能修改')
    return { ...old, ...(old?.name || !old ? { name: row.name } : {}), containerPort: Number(row.containerPort), protocol: row.protocol }
  })
  for (const other of containers.filter(item => item.name !== original.name)) {
    if ((other.ports || []).some(port => updatedPorts.some(item => item.name && item.name === port.name))) throw new Error('端口名称与其他容器重复')
  }
  const portsChanged = !same(oldPorts.map(port => ({ ...port, protocol: protocolOf(port) })), updatedPorts)
  const originalRows = portRows(original, service)
  const staleMappings = oldPorts.some(port => (service?.spec?.ports || []).some(item => matches(item, port) && !targetMatches(item, port)))
  const mappingRequested = portsChanged || staleMappings
    || (!service && selection.servicePorts && updatedPorts.length > 0) || draft.ports.some((row, index) => Number(row.servicePort) !== Number(originalRows[index]?.servicePort))
  const servicePorts = JSON.parse(JSON.stringify(service?.spec?.ports || []))
  if (mappingRequested) updatedPorts.forEach((port, index) => {
    const old = oldPorts[index]
    const mappings = old ? servicePorts.filter(item => matches(item, old)) : []
    if (mappings.length) {
      if (Number(draft.ports[index].servicePort) !== mappings[0].port) throw new Error('已有 Service 端口不能修改，请只调整容器端口')
      mappings.forEach(item => { item.targetPort = port.name || port.containerPort })
    } else {
      const servicePort = Number(draft.ports[index].servicePort)
      if (servicePorts.some(item => item.name === draft.ports[index].name || (item.port === servicePort && protocolOf(item) === port.protocol))) throw new Error('Service 端口名称或端口号与现有映射冲突')
      servicePorts.push({ name: draft.ports[index].name, port: servicePort, targetPort: port.name || port.containerPort, protocol: port.protocol })
    }
  })
  // Kubernetes requires names for every port when a second mapping is added.
  if (mappingRequested && servicePorts.length > 1) servicePorts.forEach((port, index) => {
    if (!port.name) {
      let name = `svc-${index + 1}`
      while (servicePorts.some(other => other.name === name)) name += '-x'
      port.name = name
    }
  })
  const serviceChanged = !same(service?.spec?.ports || [], servicePorts)
  if (serviceChanged && service?.spec?.type === 'ExternalName') throw new Error('当前不支持修改 ExternalName Service')
  if (portsChanged) {
    next.ports = updatedPorts
    fields.add('ports')
    for (const field of ['livenessProbe', 'readinessProbe', 'startupProbe']) {
      const probe = next[field]
      if (!probe) continue
      if (probe.exec) throw new Error('当前应用使用自定义命令探针，请先确认探针配置后再修改容器端口')
      const endpoint = probe.httpGet || probe.tcpSocket || probe.grpc
      if (endpoint && typeof endpoint.port === 'number') {
        const indexes = oldPorts.map((port, i) => port.containerPort === endpoint.port ? i : -1).filter(i => i >= 0)
        const targets = [...new Set(indexes.map(i => updatedPorts[i].containerPort))]
        if (targets.length > 1) throw new Error('探针端口存在多个映射，无法自动联动')
        if (targets.length === 1 && targets[0] !== endpoint.port) { endpoint.port = targets[0]; fields.add(field) }
      }
    }
    changes.push('应用端口')
  }
  if (serviceChanged) changes.push(service ? '端口访问配置' : '新增端口访问')
  if (portsChanged || serviceChanged) {
    selection.servicePorts = true
    fields.add('ports')
  }
  if (fields.size) selection.containers = { ...selection.containers, [original.name]: [...fields] }
  return { next, selection, servicePorts, changes, serviceChanged, portsChanged }
}

export function deploymentPatch(deployment, plan, podAnnotations) {
  const containers = deployment.spec.template.spec.containers.map(container => container.name === plan.next.name ? plan.next : container)
  return [
    { op: 'test', path: '/metadata/resourceVersion', value: deployment.metadata.resourceVersion },
    { op: 'add', path: '/metadata/annotations', value: { ...deployment.metadata.annotations, [RUNTIME_CONFIG]: JSON.stringify(plan.selection) } },
    { op: 'add', path: '/spec/template/spec/containers', value: containers },
    ...(podAnnotations ? [{ op: 'add', path: '/spec/template/metadata/annotations', value: podAnnotations }] : [])
  ]
}

export function serviceBody(deployment, service, plan, releaseName) {
  const namespace = deployment.metadata.namespace || 'default'
  const selector = deployment.spec.selector?.matchLabels
  if (!selector || !Object.keys(selector).length || deployment.spec.selector?.matchExpressions?.length) throw new Error('无法从工作负载获取可用的 Service 选择器')
  const annotations = deployment.metadata.annotations || {}
  const release = annotations['meta.helm.sh/release-name'] || releaseName
  if (!release) throw new Error('无法确定 Helm Release 名称')
  const owner = { apiVersion: 'apps/v1', kind: 'Deployment', name: deployment.metadata.name, uid: deployment.metadata.uid }
  if (!owner.uid) throw new Error('工作负载缺少 UID')
  return {
    apiVersion: 'v1', kind: 'Service',
    metadata: {
      ...service?.metadata,
      name: deployment.metadata.name, namespace,
      labels: { ...service?.metadata?.labels, 'app.kubernetes.io/managed-by': 'Helm', 'w7.cc/group-name': releaseName },
      annotations: { ...service?.metadata?.annotations, 'meta.helm.sh/release-name': release, 'meta.helm.sh/release-namespace': namespace },
      ownerReferences: [...(service?.metadata?.ownerReferences || []).filter(item => item.uid !== owner.uid), owner]
    },
    spec: { ...(service?.spec || { type: 'ClusterIP', selector }), ports: plan.servicePorts }
  }
}

export function servicePatch(service, body) {
  return [
    { op: 'test', path: '/metadata/resourceVersion', value: service.metadata.resourceVersion },
    { op: 'add', path: '/metadata/labels', value: body.metadata.labels },
    { op: 'add', path: '/metadata/annotations', value: body.metadata.annotations },
    { op: 'add', path: '/metadata/ownerReferences', value: body.metadata.ownerReferences },
    { op: 'add', path: '/spec/ports', value: body.spec.ports }
  ]
}
