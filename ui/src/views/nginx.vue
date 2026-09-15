<template>
  <main class="nginx-page" v-loading="loading">
    <section class="page-card editor-card">
      <header class="card-header">
        <h1>Nginx 配置</h1>
        <p>编辑默认域名对应的站点配置，保存前会自动校验 Nginx 语法。</p>
      </header>
      <Editor v-model:content="nginxConfig" />
    </section>
    <div class="actions">
      <el-button size="large" type="primary" :loading="saveLoading" @click="nginxSave">
        应用
      </el-button>
    </div>
  </main>
</template>

<script>
import Editor from '@/components/Editor.vue'
import panelAxios from '@/utils/panel'

const NGINX_CONF_DIR = '/www/server/nginx/conf.d'
const APPGROUP_API = '/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups'
const DEFAULT_DOMAIN_ANNOTATION = 'w7.cc/default-domain'

export default {
  name: 'NginxConfig',
  components: { Editor },
  data() {
    return {
      loading: true,
      saveLoading: false,
      nginxConfig: ''
    }
  },
  created() {
    this.loadNginxConfig()
  },
  methods: {
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
        const pod = (podResponse.data?.items || []).find(item => {
          if (item.metadata?.deletionTimestamp || item.status?.phase !== 'Running') return false
          const status = item.status?.containerStatuses?.find(status => status.name === containerName)
          return status?.ready === true
        })
        if (pod?.metadata?.name) return { podName: pod.metadata.name, containerName }
        if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 1000))
      }
      throw new Error('未获取到 Ready 状态的 Nginx Pod')
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
            lastError = null
            break
          } catch (error) {
            lastError = error
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
        if (lastError) throw lastError
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

      this.saveLoading = true
      try {
        const [{ containerName, podName }, configFileName] = await Promise.all([
          this.getNginxContainer(),
          this.getNginxConfigFileName()
        ])
        await panelAxios.exec(
          containerName,
          podName,
          this.buildSaveCommand(this.nginxConfig, configFileName)
        )
        await this.reload()
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
.editor-card { overflow: hidden; }
.card-header { padding: 22px 24px 16px; border-bottom: 1px solid #f2f3f5; }
.card-header h1 { margin: 0; color: #1d2129; font-size: 18px; font-weight: 600; }
.card-header p { margin: 8px 0 0; color: #86909c; font-size: 13px; }
.editor-card :deep(.editor) { border: 0; border-radius: 0; }
.editor-card :deep(.cm-editor) { min-height: 520px; }
.actions { display: flex; justify-content: center; margin-top: 20px; }
.actions :deep(.el-button) { min-width: 112px; border-radius: 4px; --el-color-primary: #165dff; }
</style>
