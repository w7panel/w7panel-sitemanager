<template>
  <main class="nginx-page" v-loading="loading">
    <el-alert v-if="latestTemplateDiffers" class="template-notice" type="warning" :closable="false" show-icon
      title="应用最新模板与当前生效配置不同"
      description="升级已保留你的配置。可查看最新模板，将需要的内容合并到下方配置后再应用。" />
    <el-alert v-if="latestTemplateError" class="template-notice" type="warning" :closable="false" show-icon
      title="最新模板读取失败" :description="latestTemplateError" />
    <section class="page-card editor-card">
      <header class="card-header">
        <div class="heading-row">
          <h1>Nginx 配置</h1>
          <el-button v-if="latestNginxConfig !== null" @click="latestDialogVisible = true">查看最新模板</el-button>
        </div>
        <p>编辑默认域名对应的站点配置，保存前会自动校验 Nginx 语法。</p>
      </header>
      <Editor v-model:content="nginxConfig" />
    </section>
    <div class="actions">
      <el-button size="large" type="primary" :loading="saveLoading" @click="nginxSave">
        应用
      </el-button>
    </div>
    <el-dialog v-model="latestDialogVisible" title="应用最新 Nginx 模板" width="min(1000px, 94vw)">
      <p class="template-help">这是最近一次安装或升级生成的模板。若当前配置有自定义修改，可复制需要的内容到编辑器，手动合并后应用。</p>
      <textarea class="template-content" :value="latestNginxConfig" readonly spellcheck="false" aria-label="应用最新 Nginx 模板，只读" />
      <template #footer><el-button @click="latestDialogVisible = false">关闭</el-button></template>
    </el-dialog>
  </main>
</template>

<script>
import Editor from '@/components/Editor.vue'
import panelAxios from '@/utils/panel'

const NGINX_CONF_DIR = '/www/server/nginx/conf.d'
const NGINX_TEMPLATE_DIR = '/www/server/nginx/template-configs'
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
      latestDialogVisible: false
    }
  },
  computed: {
    latestTemplateDiffers() {
      return this.latestNginxConfig !== null
        && this.normalizeNginxConfig(this.latestNginxConfig) !== this.normalizeNginxConfig(this.appliedNginxConfig)
    }
  },
  created() {
    this.loadNginxConfig()
  },
  methods: {
    normalizeNginxConfig(content) {
      const lines = String(content).split('\n')
      if (lines[lines.length - 1] === '') lines.pop()
      const kept = []
      let quote = ''
      let escaped = false
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '')
        if (/^[ \t]*$/.test(line) && !quote && !escaped) continue
        kept.push(line)
        escaped = false
        for (const char of line) {
          if (escaped) { escaped = false; continue }
          if (char === '\\') { escaped = true; continue }
          if (quote) {
            if (char === quote) quote = ''
            continue
          }
          if (char === '#') break
          if (char === '"' || char === "'") quote = char
        }
      }
      return kept.join('\n')
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
    getConfFileCommand(configFileName) {
      return `set -eu
CONF_DIR='${NGINX_CONF_DIR}'
[ -d "$CONF_DIR" ] || { echo "Nginx 配置目录不存在: $CONF_DIR" >&2; exit 1; }
CONF_FILE="$CONF_DIR/${configFileName}"
[ -f "$CONF_FILE" ] || { echo "未找到默认域名对应的 Nginx 配置文件: $CONF_FILE" >&2; exit 1; }`
    },
    buildSaveCommand(content, configFileName) {
      const text = content === undefined || content === null ? '' : String(content)
      let marker = 'W7_NGINX_EOF'
      let index = 0
      while (text.includes(marker)) {
        index += 1
        marker = `W7_NGINX_EOF_${index}`
      }

      return `${this.getConfFileCommand(configFileName)}
TMP_FILE="/tmp/w7-nginx-conf.$$"
BACKUP_FILE="/tmp/w7-nginx-conf-backup.$$"
cleanup() { rm -f "$TMP_FILE" "$BACKUP_FILE"; }
trap cleanup EXIT HUP INT TERM
cat <<'${marker}' > "$TMP_FILE"
${text}
${marker}
cp -p "$CONF_FILE" "$BACKUP_FILE"
mv "$TMP_FILE" "$CONF_FILE"
if ! nginx -t; then
  mv "$BACKUP_FILE" "$CONF_FILE"
  echo 'Nginx 配置校验失败，已恢复原配置' >&2
  exit 1
fi
rm -f "$BACKUP_FILE"
trap - EXIT HUP INT TERM`
    },
    buildLatestTemplateCommand(configFileName) {
      const file = `${NGINX_TEMPLATE_DIR}/${configFileName}`.replaceAll("'", "'\"'\"'")
      return `set -eu
LATEST_FILE='${file}'
if [ -f "$LATEST_FILE" ]; then cat "$LATEST_FILE"; fi`
    },
    async loadLatestTemplate(containerName, podName, configFileName) {
      this.latestNginxConfig = null
      this.latestTemplateError = ''
      try {
        const response = await panelAxios.exec(containerName, podName, this.buildLatestTemplateCommand(configFileName))
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
              `${this.getConfFileCommand(configFileName)}\ncat "$CONF_FILE"`
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
        await panelAxios.exec(
          containerName,
          podName,
          this.buildSaveCommand(content, configFileName)
        )
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
}
.template-notice { margin-bottom: 16px; }
.heading-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.template-help { margin: 0 0 16px; color: #4e5969; line-height: 1.7; }
.template-content { box-sizing: border-box; width: 100%; height: 52vh; padding: 16px; border: 1px solid #e5e6eb; border-radius: 4px; background: #f7f8fa; color: #1d2129; font: 13px/1.7 ui-monospace, monospace; resize: vertical; white-space: pre; overflow: auto; }
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
