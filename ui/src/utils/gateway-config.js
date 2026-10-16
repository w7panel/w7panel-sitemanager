import { readSelection, RUNTIME_CONFIG } from './runtime-config'
import { ingressBackendPatch } from './ingress-config'
import { defaultGatewayNginxConfig, initializeNginxConfigCommand, requireNginxConfigFileCommand, saveNginxConfigCommand, checkNginxValidation } from './nginx-config'

const DEPLOYMENTS = '/apis/apps/v1/namespaces/default/deployments'
const SERVICES = '/api/v1/namespaces/default/services'
const INGRESSES = '/apis/networking.k8s.io/v1/namespaces/default/ingresses'
const APPGROUPS = '/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups'
const PATCH = { headers: { 'Content-Type': 'application/json-patch+json' } }
export const GATEWAY_CONFIG = 'w7.cc/tradition-gateway'
export const GATEWAY_CONTAINERS = 'w7.cc/tradition-gateway-containers'
export const GATEWAY_RUNTIME_FIELDS = ['image', 'imagePullPolicy', 'command', 'args', 'ports', 'env']
const OPERATION = 'w7.cc/gateway-operation'
const clone = value => JSON.parse(JSON.stringify(value))
const delay = () => new Promise(resolve => setTimeout(resolve, 1000))
const testVersion = resource => ({ op: 'test', path: '/metadata/resourceVersion', value: resource.metadata.resourceVersion })

export function gatewayConfig(application, tool, service = null) {
  const raw = tool.metadata?.annotations?.[GATEWAY_CONFIG]
  const containers = tool.metadata?.annotations?.[GATEWAY_CONTAINERS]
  if (!raw || !containers) throw new Error('当前应用尚不支持管理网关开关，请先升级 tradition-tool Chart')
  let config, variants
  try { config = JSON.parse(raw); variants = JSON.parse(containers) } catch { throw new Error('网关运行配置格式不正确，请升级应用后重试') }
  if (config.toolService !== tool.metadata.name
    || !Number.isInteger(config.toolPort) || config.toolPort < 1 || config.toolPort > 65535
    || !variants.enabled?.image || !variants.disabled?.image || variants.enabled.name !== variants.disabled.name) {
    throw new Error('网关运行配置不完整或与当前应用不匹配')
  }
  const container = tool.spec.template.spec.containers.find(item => item.name === variants.enabled.name)
  if (!container) throw new Error('未找到网关容器')
  readSelection(tool, GATEWAY_RUNTIME_FIELDS)
  const applicationPort = (service?.spec?.ports || []).find(port => (port.protocol || 'TCP') === 'TCP')?.port || 0
  return { ...config, applicationService: application.metadata.name, applicationPort, variants, enabled: (container.image === variants.enabled.image && JSON.stringify(container.command || []) === JSON.stringify(variants.enabled.command || []) && JSON.stringify(container.args || []) === JSON.stringify(variants.enabled.args || []))
      || ((container.command || []).some(arg => /(?:^|\/)sh$/.test(arg)) && (container.args || []).some(arg => arg.includes("nginx -g 'daemon off;'"))) }
}

function gatewayRuntimePatch(tool, containerName, preserve = true) {
  const selection = readSelection(tool, GATEWAY_RUNTIME_FIELDS)
  selection.containers = { ...selection.containers }
  // 准备 shell 是临时步骤，不应在升级时被保留为正式启动命令。
  if (preserve) selection.containers[containerName] = [...GATEWAY_RUNTIME_FIELDS]
  else delete selection.containers[containerName]
  selection.servicePorts = true
  return [testVersion(tool),
    { op: 'add', path: '/metadata/annotations', value: { ...tool.metadata.annotations, [RUNTIME_CONFIG]: JSON.stringify(selection) } }
  ]
}

export function gatewayDeploymentPatch(tool, container, operation, preserve = true) {
  const containers = tool.spec.template.spec.containers.map(item => item.name === container.name ? clone(container) : item)
  return [...gatewayRuntimePatch(tool, container.name, preserve),
    { op: 'add', path: '/spec/template/metadata/labels', value: { ...tool.spec.template.metadata?.labels, [OPERATION]: operation } },
    { op: 'add', path: '/spec/template/spec/containers', value: containers }
  ]
}

export function gatewayIngressPatches(ingresses, config, enabled) {
  const target = enabled ? { name: config.toolService, port: { number: config.toolPort } }
    : { name: config.applicationService, port: { number: config.applicationPort } }
  if (!enabled && (!Number.isInteger(config.applicationPort) || config.applicationPort < 1)) throw new Error('应用没有可直接访问的 Service 端口，暂时无法关闭网关')
  const result = []
  for (const ingress of ingresses) {
    const patch = ingressBackendPatch(ingress, [config.applicationService, config.toolService], target)
    if (patch) result.push({ name: ingress.metadata.name, patch })
  }
  if (!result.length) throw new Error('未找到当前应用的访问入口，请先配置应用域名和 Ingress')
  return result
}

export class GatewayController {
  constructor(api, { group, toolName, onPhase = () => {} }) {
    this.api = api; this.group = group; this.toolName = toolName; this.onPhase = onPhase
  }
  async load() {
    if (!this.group || !this.toolName) throw new Error('缺少应用或网关名称')
    const appGroup = (await this.api.get(`${APPGROUPS}/${encodeURIComponent(this.group)}`)).data
    const applicationName = (appGroup.status?.items || []).find(item => item.kind === 'Deployment' && item.name === this.group)?.name
    if (!applicationName) throw new Error('未找到传统应用主 Deployment')
    const [application, tool] = await Promise.all([
      this.api.get(`${DEPLOYMENTS}/${encodeURIComponent(applicationName)}`).then(r => r.data),
      this.api.get(`${DEPLOYMENTS}/${encodeURIComponent(this.toolName)}`).then(r => r.data)
    ])
    let service = null
    try {
      service = (await this.api.get(`${SERVICES}/${encodeURIComponent(applicationName)}`)).data
    } catch (error) {
      if (error.response?.status !== 404) throw error
    }
    const config = gatewayConfig(application, tool, service)
    const domain = new URL(appGroup.metadata?.annotations?.['w7.cc/default-domain'] || '')
    if (!['http:', 'https:'].includes(domain.protocol)) throw new Error('应用默认域名不正确')
    this.state = { application, tool, config, initialNginxConfig: defaultGatewayNginxConfig(application, config, domain.hostname), fileName: `${domain.hostname}.conf` }
    return this.state
  }
  async patchTool(container, operation, preserve = true) {
    const { tool } = this.state
    this.state.tool = (await this.api.patch(`${DEPLOYMENTS}/${encodeURIComponent(tool.metadata.name)}`,
      gatewayDeploymentPatch(tool, container, operation, preserve), PATCH)).data
  }
  async waitForTool(operation, ready) {
    const { tool, config } = this.state
    if (tool.spec.replicas === 0) throw new Error('网关已停止，请先启动后重试')
    const selector = { ...tool.spec.selector.matchLabels, ...(operation ? { [OPERATION]: operation } : {}) }
    const labelSelector = Object.entries(selector).map(([key, value]) => `${key}=${value}`).join(',')
    const deadline = Date.now() + 5 * 60 * 1000
    while (Date.now() < deadline) {
      const current = (await this.api.get(`${DEPLOYMENTS}/${encodeURIComponent(tool.metadata.name)}`)).data
      if (current.spec.template.metadata?.labels?.[OPERATION] !== operation) throw new Error('网关已被其他操作更新，请刷新后重试')
      const pods = (await this.api.get('/api/v1/namespaces/default/pods', { params: { labelSelector } })).data?.items || []
      const pod = pods.find(item => !item.metadata?.deletionTimestamp && item.status?.phase === 'Running'
        && item.status.containerStatuses?.some(status => status.name === config.variants.enabled.name && status.state?.running && (!ready || status.ready)))
      if (pod && (!ready || (current.status?.observedGeneration >= tool.metadata.generation
        && current.status?.updatedReplicas === (current.spec.replicas ?? 1) && current.status?.availableReplicas === (current.spec.replicas ?? 1)))) {
        this.state.tool = current
        return { containerName: config.variants.enabled.name, podName: pod.metadata.name }
      }
      if (current.status?.conditions?.some(item => item.type === 'Progressing' && item.status === 'False' && item.reason === 'ProgressDeadlineExceeded')) throw new Error('网关启动失败，请检查容器状态后重试')
      await delay()
    }
    throw new Error('等待网关启动超时，访问入口未确认切换成功，请刷新检查')
  }
  async ensureService() {
    const { application, tool, config } = this.state
    try {
      const service = (await this.api.get(`${SERVICES}/${encodeURIComponent(tool.metadata.name)}`)).data
      if (!(service.spec?.ports || []).some(port => port.port === config.toolPort && (port.protocol || 'TCP') === 'TCP' && (port.targetPort === 'http' || port.targetPort === 80))) throw new Error('网关 Service 端口与应用配置不匹配')
      const selector = tool.spec.selector.matchLabels
      if (!service.spec.selector || !Object.entries(selector).every(([key, value]) => service.spec.selector[key] === value)) throw new Error('网关 Service 未指向当前网关容器')
    } catch (error) {
      if (error.response?.status !== 404) throw error
      const release = application.metadata.annotations?.['meta.helm.sh/release-name'] || this.group
      await this.api.post(SERVICES, { apiVersion: 'v1', kind: 'Service', metadata: {
        name: tool.metadata.name, namespace: 'default',
        labels: { 'app.kubernetes.io/managed-by': 'Helm', 'w7.cc/group-name': this.group },
        annotations: { 'meta.helm.sh/release-name': release, 'meta.helm.sh/release-namespace': 'default' },
        ownerReferences: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: tool.metadata.name, uid: tool.metadata.uid }]
      }, spec: { type: 'ClusterIP', selector: tool.spec.selector.matchLabels, ports: [{ name: 'http', port: config.toolPort, targetPort: 'http', protocol: 'TCP' }] } })
      return true
    }
    return false
  }
  async switch(enabled, initialConfig = '', { repairConfig = false } = {}) {
    let changed = false
    let nginxConfigSaved = false
    try {
      await this.load()
      const { config, tool, fileName } = this.state
      if (repairConfig && (!enabled || config.enabled || this.recovery?.fileName !== fileName)) throw Object.assign(new Error('配置修复状态已变化，请重新开启网关后检查配置'), { nginxRecoveryUnavailable: true })
      if (repairConfig && !initialConfig.trim()) throw new Error('Nginx配置不能为空')
      if (tool.spec.replicas === 0) throw new Error('网关已停止，请先启动后重试')
      const ingresses = (await this.api.get(INGRESSES, { params: { labelSelector: `w7.cc/group-name=${this.group}` } })).data?.items || []
      const routes = gatewayIngressPatches(ingresses, config, enabled)
      const operation = `gw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      if (enabled) {
        const initialContent = initialConfig.trim() ? initialConfig : this.state.initialNginxConfig
        changed = await this.ensureService()
        // Start a shell before starting nginx so an absent vhost can be initialized on the PVC.
        const preparation = clone(config.variants.enabled)
        const script = preparation.args?.[0]
        if (!script?.includes("nginx -g 'daemon off;'")) throw new Error('当前网关启动脚本不支持初始化配置，请升级 tradition-tool')
        preparation.args[0] = script.replace("nginx -g 'daemon off;'", 'while :; do sleep 3600; done')
        let activeOperation = tool.spec.template.metadata?.labels?.[OPERATION]
        if (!config.enabled) {
          this.onPhase('准备网关配置目录')
          await this.patchTool(preparation, operation, false)
          changed = true
          activeOperation = operation
        }
        const pod = await this.waitForTool(activeOperation, false)
        this.onPhase(repairConfig ? '保存修复配置并校验 Nginx 语法' : '保留已有配置并校验 Nginx 语法')
        try {
          const response = await this.api.exec(pod.containerName, pod.podName, repairConfig
            ? saveNginxConfigCommand(initialContent, fileName) : initializeNginxConfigCommand(fileName, initialContent))
          checkNginxValidation(response.data)
          nginxConfigSaved = repairConfig
        } catch (error) {
          if (error.nginxValidationFailed && !config.enabled) {
            try {
              const response = await this.api.exec(pod.containerName, pod.podName,
                `${requireNginxConfigFileCommand(fileName)}\ncat "$CONF_FILE"`)
              this.recovery = { fileName }
              error.nginxRecovery = { ...pod, fileName, content: String(response.data ?? ''), preserveDraft: repairConfig }
            } catch (readError) {
              this.recovery = null
              error.nginxRecoveryUnavailable = true
              error.message += '\n实际配置读取失败，编辑内容已保留，请重新开启后重试。' + (readError.response?.data?.error || readError.message)
            }
          }
          throw error
        }
        this.onPhase('启动 Nginx 网关')
        if (!config.enabled) {
          await this.patchTool(config.variants.enabled, operation + '-run')
          activeOperation = operation + '-run'
        }
        await this.waitForTool(activeOperation, true)
        if (config.enabled) {
          // 已经运行 nginx 时只补运行保留标记，避免为了重试转发而重启容器。
          const current = this.state.tool
          this.state.tool = (await this.api.patch(`${DEPLOYMENTS}/${encodeURIComponent(current.metadata.name)}`,
            gatewayRuntimePatch(current, config.variants.enabled.name), PATCH)).data
        }
        changed = true
      }
      this.onPhase('切换应用访问入口')
      for (const route of routes) { await this.api.patch(`${INGRESSES}/${encodeURIComponent(route.name)}`, route.patch, PATCH); changed = true }
      if (!enabled) {
        this.onPhase('关闭 Nginx 网关')
        await this.patchTool(config.variants.disabled, operation)
        await this.waitForTool(operation, true)
      }
      const state = await this.load()
      this.recovery = null
      return state
    } catch (error) {
      const detail = error.response?.data?.error || error.response?.data?.message || error.message
      throw Object.assign(new Error((changed ? '部分配置已提交，请刷新检查后重试。' : '') + detail),
        { nginxRecovery: error.nginxRecovery, nginxValidationFailed: error.nginxValidationFailed,
          nginxConfigSaved, nginxRecoveryUnavailable: error.nginxRecoveryUnavailable })
    } finally { this.onPhase('') }
  }
}
