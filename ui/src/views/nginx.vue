<template>
  <main class="nginx-page" v-loading="loading">
    <section v-if="gatewayManaged || gatewayError" class="page-card gateway-card">
      <div><h2>网关转发</h2><p>{{ gatewayEnabled ? '已开启，应用通过 Nginx 网关访问。' : gatewayEditing ? '请先确认下方 Nginx 配置，保存并校验通过后才会切换访问入口。' : '尚未开启。点击“配置并开启网关”查看并编辑 Nginx 配置，确认后点击“保存配置并开启”。' }}</p></div>
      <el-button v-if="gatewayManaged && !gatewayEditing" type="primary" :class="{ 'gateway-close-button': gatewayEnabled }" :loading="gatewayBusy" :disabled="loading || saveLoading" @click="gatewayEnabled ? switchGateway(false) : prepareGateway()">{{ gatewayEnabled ? '关闭网关转发' : '配置并开启网关' }}</el-button>
    </section>
    <el-alert v-if="gatewayError" class="template-notice" type="error" :closable="false" show-icon :title="gatewayValidationFailed ? 'Nginx 配置校验失败，请修改后重试' : gatewayError">
      <pre v-if="gatewayEditing" class="gateway-error-detail">{{ gatewayError }}</pre>
      <el-button v-if="gatewayRetry !== null && !gatewayEditing" size="small" :loading="gatewayBusy" @click="gatewayRetry && !gatewayEnabled ? prepareGateway() : switchGateway(gatewayRetry)">重试{{ gatewayRetry ? '开启' : '关闭' }}</el-button>
    </el-alert>
    <div v-if="gatewayBusy" class="gateway-progress" role="status" aria-live="polite">
      <span class="gateway-progress-spinner" aria-hidden="true"></span>
      <span>{{ gatewayPhase || '正在处理网关配置，请稍候…' }}</span>
    </div>
    <el-alert v-if="(gatewayEnabled || (gatewayEditing && gatewayConfigExists)) && latestTemplateDiffers" class="template-notice" type="warning" :closable="false" show-icon
      title="应用最新模板与当前生效配置不同"
      description="升级已保留你的配置。可查看最新模板，将需要的内容合并到下方配置后再应用。" />
    <el-alert v-if="latestTemplateError" class="template-notice" type="warning" :closable="false" show-icon
      title="最新模板读取失败" :description="latestTemplateError" />
    <section v-if="gatewayEnabled || gatewayEditing" class="page-card editor-card">
      <header class="card-header">
        <div class="heading-row">
          <h1>Nginx 配置</h1>
          <el-button v-if="latestNginxConfig !== null" @click="latestDialogVisible = true">查看最新模板</el-button>
        </div>
        <p>{{ gatewayEditing ? gatewayConfigExists ? '已读取存储中的站点配置，请确认或修改后保存并开启。' : '尚无站点配置，已生成常用配置，请根据应用的目录、端口等补充后保存并开启。' : '编辑默认域名对应的站点配置，应用时自动校验 Nginx 语法，失败会恢复原文件。' }}</p>
      </header>
      <div :inert="gatewayBusy || saveLoading ? '' : null"><Editor v-model:content="nginxConfig" /></div>
    </section>
    <div v-if="gatewayEnabled || gatewayEditing" class="actions">
      <el-button size="large" type="primary" :loading="saveLoading || gatewayBusy" :disabled="loading" @click="gatewayEditing ? switchGateway(true, true) : nginxSave()">
        {{ gatewayEditing ? '保存配置并开启' : '应用' }}
      </el-button>
    </div>
    <el-dialog v-model="latestDialogVisible" append-to-body align-center class="nginx-template-dialog" modal-class="nginx-template-overlay" title="应用最新 Nginx 模板" width="min(1000px, 94vw)">
      <p class="template-help">这是最近一次安装或升级生成的模板。若当前配置有自定义修改，可复制需要的内容到编辑器，手动合并后应用。</p>
      <textarea class="template-content" :value="latestNginxConfig" readonly spellcheck="false" aria-label="应用最新 Nginx 模板，只读" />
      <template #footer><el-button @click="latestDialogVisible = false">关闭</el-button></template>
    </el-dialog>
  </main>
</template>

<script>
import Editor from '@/components/Editor.vue'
import panelAxios from '@/utils/panel'
import { ElMessageBox } from 'element-plus'
import { GatewayController, GATEWAY_CONTAINERS } from '@/utils/gateway-config'
import { normalizeNginxConfig, latestNginxTemplateCommand, requireNginxConfigFileCommand, saveNginxConfigCommand, checkNginxValidation } from '@/utils/nginx-config'

const APPGROUP_API = '/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups'
const DEFAULT_DOMAIN_ANNOTATION = 'w7.cc/default-domain'

export default {
  name: 'NginxConfig',
  components: { Editor },
  data() {
    return {
      loading: true,
      saveLoading: false,
      nginxConfig: '',
      appliedNginxConfig: '',
      latestNginxConfig: null,
      latestTemplateError: '',
      latestDialogVisible: false,
      gatewayManaged: false,
      gatewayEnabled: true,
      gatewayBusy: false,
      gatewayPhase: '',
      gatewayError: '',
      gatewayRetry: null,
      gatewayEditing: false,
      gatewayConfigExists: false,
      gatewayValidationFailed: false
    }
  },
  computed: {
    latestTemplateDiffers() {
      return this.latestNginxConfig !== null
        && normalizeNginxConfig(this.latestNginxConfig) !== normalizeNginxConfig(this.appliedNginxConfig)
    }
  },
  async created() {
    await this.initializeGateway()
    if (this.gatewayEnabled) await this.loadNginxConfig()
    else this.loading = false
  },
  methods: {
    async initializeGateway() {
      try {
        const name = this.getNginxDeploymentName()
        if (!name) return
        const tool = (await panelAxios.get(`/apis/apps/v1/namespaces/default/deployments/${encodeURIComponent(name)}`)).data
        this.gatewayEnabled = !/(^|\/)pause(?::|@|$)/.test(tool.spec?.template?.spec?.containers?.[0]?.image || '')
        if (!tool.metadata?.annotations?.[GATEWAY_CONTAINERS]) {
          if (!this.gatewayEnabled) this.gatewayError = '当前版本暂不支持开启网关，请先升级 tradition-tool Chart。'
          return
        }
        this.gatewayController = new GatewayController(panelAxios, {
          group: this.getAppgroupName(), toolName: name,
          onPhase: phase => { this.gatewayPhase = phase }
        })
        const state = await this.gatewayController.load()
        this.gatewayManaged = true
        this.gatewayEnabled = state.config.enabled
      } catch (error) {
        this.gatewayError = error?.response?.data?.error || error.message || '网关状态读取失败'
      }
    },
    async prepareGateway() {
      if (this.gatewayBusy || this.saveLoading || !this.gatewayController) return
      this.gatewayBusy = true
      this.gatewayError = ''
      this.gatewayRetry = true
      this.gatewayValidationFailed = false
      try {
        const prepared = await this.gatewayController.prepare()
        this.gatewayEditing = true
        this.gatewayEnabled = false
        this.gatewayConfigExists = prepared.exists
        this.nginxConfig = prepared.content
        this.appliedNginxConfig = prepared.exists ? prepared.content : ''
        this.gatewayRetry = null
        await this.loadLatestTemplate(prepared.containerName, prepared.podName, prepared.fileName)
      } catch (error) {
        this.gatewayError = error?.response?.data?.error || error.message
        this.$message.error(this.gatewayError)
      } finally { this.gatewayBusy = false; this.gatewayPhase = '' }
    },
    async switchGateway(enabled, saveConfig = false) {
      if (this.gatewayBusy || this.saveLoading || !this.gatewayController) return
      if (saveConfig && !this.nginxConfig.trim()) { this.$message.warning('Nginx配置不能为空'); return }
      try {
        await ElMessageBox.confirm(saveConfig
          ? '将保存当前配置，校验通过并启动 Nginx 后切换应用访问入口。校验失败会恢复保存前的文件状态。'
          : enabled
          ? '将重新校验 Nginx 并切换应用访问入口。'
          : '将关闭 Nginx 网关，并将访问入口切回应用。请确认应用本身支持直接访问。',
        enabled ? '开启网关转发' : '关闭网关转发', { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' })
      } catch { return }
      if (this.gatewayBusy || this.saveLoading) return
      this.gatewayBusy = true
      this.gatewayError = ''
      this.gatewayValidationFailed = false
      this.gatewayRetry = enabled
      try {
        const state = await this.gatewayController.switch(enabled, this.nginxConfig, { saveConfig })
        this.gatewayEnabled = state.config.enabled
        this.gatewayRetry = null
        this.gatewayEditing = false
        if (enabled) await this.loadNginxConfig()
        this.$message.success(enabled ? '网关转发已开启' : '网关转发已关闭')
      } catch (error) {
        this.gatewayValidationFailed = !!error.nginxValidationFailed
        if (saveConfig && (error.nginxConfigSaved || error.nginxPreparationRequired)) {
          const state = await this.gatewayController.load().catch(() => null)
          if (state) this.gatewayEnabled = state.config.enabled
          if (this.gatewayEnabled || error.nginxPreparationRequired) this.gatewayEditing = false
        }
        this.gatewayError = error.message
        this.$message.error(error.message)
      } finally { this.gatewayBusy = false; this.gatewayPhase = '' }
    },
    getAppgroupName() {
      return window.$wujie?.props?.group || window.$wujie?.props?.appgroup || ''
    },
    getNginxDeploymentName() {
      return window.$wujie?.props?.app_name || window.$wujie?.props?.microappName || ''
    },
    async getNginxConfigFileName() {
      const appgroup = this.getAppgroupName()
      if (!appgroup) throw new Error('未获取到 AppGroup 名称')

      const manifestResponse = await panelAxios.get(`${APPGROUP_API}/${encodeURIComponent(appgroup)}`)
      const defaultDomain = String(
        manifestResponse.data?.metadata?.annotations?.[DEFAULT_DOMAIN_ANNOTATION] || ''
      ).trim()
      if (!defaultDomain) throw new Error(`AppGroup 缺少 ${DEFAULT_DOMAIN_ANNOTATION} 注解`)

      let domain
      try {
        const url = new URL(defaultDomain)
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
        domain = url.hostname
      } catch {
        throw new Error(`${DEFAULT_DOMAIN_ANNOTATION} 注解不是有效的 HTTP(S) 地址`)
      }
      if (!domain) throw new Error(`未能从 ${DEFAULT_DOMAIN_ANNOTATION} 注解中获取域名`)

      return `${domain}.conf`
    },
    async getNginxContainer() {
      const deploymentName = this.getNginxDeploymentName()
      if (!deploymentName) throw new Error('未获取到 Nginx Deployment 名称')

      const deploymentResponse = await panelAxios.get(
        `/apis/apps/v1/namespaces/default/deployments/${deploymentName}`
      )
      const deployment = deploymentResponse.data
      const containerName = deployment?.spec?.template?.spec?.containers?.[0]?.name
      if (!containerName) throw new Error('未获取到 Nginx 容器名称')

      const matchLabels = deployment?.spec?.selector?.matchLabels || {}
      const labelSelector = Object.entries(matchLabels)
        .map(([key, value]) => `${key}=${value}`)
        .join(',')
      if (!labelSelector) throw new Error('未获取到 Nginx Pod 选择器')

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const podResponse = await panelAxios.get('/api/v1/namespaces/default/pods', {
          params: { labelSelector }
        })
        // Exec only needs a running container; a failed readiness probe must not block repair.
        const candidates = (podResponse.data?.items || []).filter(item => {
          if (!item.metadata?.name || item.metadata.deletionTimestamp || item.status?.phase !== 'Running') return false
          const status = item.status?.containerStatuses?.find(status => status.name === containerName)
          return !!status?.state?.running
        })
        const pod = candidates.find(item => item.status.containerStatuses.some(status => status.name === containerName && status.ready))
          || candidates[0]
        if (pod) return { podName: pod.metadata.name, containerName }
        if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 1000))
      }
      throw new Error('Nginx 容器尚未运行，暂时无法读取或保存配置。请先恢复容器运行后重试')
    },
    async loadLatestTemplate(containerName, podName, configFileName) {
      this.latestNginxConfig = null
      this.latestTemplateError = ''
      try {
        const response = await panelAxios.exec(containerName, podName, latestNginxTemplateCommand(configFileName))
        const content = String(response.data ?? '')
        // Older charts do not publish a template. Valid generated templates are nonempty.
        this.latestNginxConfig = content.length ? content : null
      } catch (error) {
        const detail = error?.response?.data?.error || error?.message || '读取失败'
        this.latestTemplateError = `当前配置仍可编辑和应用。${detail}`
      }
    },
    async loadNginxConfig() {
      if (!this.getNginxDeploymentName()) {
        this.$message.error('未获取到 Nginx Deployment 名称')
        this.loading = false
        return
      }
      if (!this.getAppgroupName()) {
        this.$message.error('未获取到 AppGroup 名称')
        this.loading = false
        return
      }

      try {
        const [{ containerName, podName }, configFileName] = await Promise.all([
          this.getNginxContainer(),
          this.getNginxConfigFileName()
        ])
        let lastError
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await panelAxios.exec(
              containerName,
              podName,
              `${requireNginxConfigFileCommand(configFileName)}\ncat "$CONF_FILE"`
            )
            this.nginxConfig = String(response.data ?? '')
            this.appliedNginxConfig = this.nginxConfig
            lastError = null
            break
          } catch (error) {
            lastError = error
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
        if (lastError) throw lastError
        await this.loadLatestTemplate(containerName, podName, configFileName)
      } catch (error) {
        this.$message.error(error?.response?.data?.error || error?.message || 'Nginx配置获取失败')
      } finally {
        this.loading = false
      }
    },
    async nginxSave() {
      if (this.gatewayBusy || this.saveLoading || !this.gatewayEnabled) return
      if (!this.getNginxDeploymentName()) {
        this.$message.error('未获取到 Nginx Deployment 名称')
        return
      }
      if (!this.getAppgroupName()) {
        this.$message.error('未获取到 AppGroup 名称')
        return
      }
      if (!this.nginxConfig.trim()) {
        this.$message.warning('Nginx配置不能为空')
        return
      }

      const content = this.nginxConfig
      this.saveLoading = true
      try {
        const [{ containerName, podName }, configFileName] = await Promise.all([
          this.getNginxContainer(),
          this.getNginxConfigFileName()
        ])
        const response = await panelAxios.exec(
          containerName,
          podName,
          saveNginxConfigCommand(content, configFileName)
        )
        checkNginxValidation(response?.data)
        await this.reload()
        this.appliedNginxConfig = content
        this.$message.success('操作成功')
      } catch (error) {
        this.$message.error(error?.response?.data?.error || error?.message || 'Nginx配置保存失败')
      } finally {
        this.saveLoading = false
      }
    },
    reload() {
      return panelAxios.patch(
        '/apis/apps/v1/namespaces/default/deployments/' + this.getNginxDeploymentName(),
        {
          spec: {
            template: {
              metadata: { labels: { reload: String(Date.now()) } }
            }
          }
        },
        {
          headers: { 'Content-Type': 'application/strategic-merge-patch+json' }
        }
      )
    }
  }
}
</script>

<style scoped>
.nginx-page {
  box-sizing: border-box;
  padding-bottom: 32px;
}
.gateway-card { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 20px 24px; margin-bottom: 16px; }
.gateway-close-button {
  flex-shrink: 0;
  height: 32px;
  padding: 0 15px;
  border-radius: 2px;
  font-weight: 400;
  --el-button-bg-color: transparent;
  --el-button-text-color: #165dff;
  --el-button-border-color: #165dff;
  --el-button-hover-bg-color: transparent;
  --el-button-hover-text-color: #4080ff;
  --el-button-hover-border-color: #4080ff;
  --el-button-active-bg-color: transparent;
  --el-button-active-text-color: #0e42d2;
  --el-button-active-border-color: #0e42d2;
  --el-button-disabled-bg-color: transparent;
  --el-button-disabled-text-color: #94bfff;
  --el-button-disabled-border-color: #94bfff;
}
.gateway-close-button:focus-visible { outline: 0; box-shadow: 0 0 0 3px #bedaff; }
.gateway-error-detail { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.7 ui-monospace, monospace; }
.gateway-card h2 { margin: 0; color: #1d2129; font-size: 16px; }
.gateway-card p { color: #86909c; font-size: 13px; line-height: 1.7; }
.gateway-progress { display: flex; align-items: center; gap: 12px; box-sizing: border-box; margin: 0 0 16px; padding: 16px 24px; border: 1px solid #d6e4ff; border-radius: 6px; background: #f0f5ff; color: #1d2129; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.gateway-progress-spinner { flex: 0 0 auto; box-sizing: border-box; width: 16px; height: 16px; border: 2px solid #bedaff; border-top-color: #165dff; border-radius: 50%; animation: gateway-progress-spin 0.8s linear infinite; }
@keyframes gateway-progress-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .gateway-progress-spinner { animation: none; } }
.template-notice { margin-bottom: 16px; }
.heading-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.template-help { margin: 0 0 16px; color: #4e5969; line-height: 1.7; }
.template-content { box-sizing: border-box; width: 100%; height: 52vh; padding: 16px; border: 1px solid #e5e6eb; border-radius: 4px; background: #f7f8fa; color: #1d2129; font: 13px/1.7 ui-monospace, monospace; min-height: 0; flex: 1 1 auto; resize: none; white-space: pre; overflow: auto; overscroll-behavior: contain; }
.page-card { background: #fff; border-radius: 6px; box-shadow: 0 2px 8px rgb(0 0 0 / 4%); }
.editor-card { overflow: hidden; }
.card-header { padding: 22px 24px 16px; border-bottom: 1px solid #f2f3f5; }
.card-header h1 { margin: 0; color: #1d2129; font-size: 18px; font-weight: 600; }
.card-header p { margin: 8px 0 0; color: #86909c; font-size: 13px; }
.editor-card :deep(.editor) { border: 0; border-radius: 0; }
.editor-card :deep(.cm-editor) { min-height: 520px; }
.actions { display: flex; justify-content: center; margin-top: 20px; }
.actions :deep(.el-button) { min-width: 112px; border-radius: 4px; --el-color-primary: #165dff; }
</style>
