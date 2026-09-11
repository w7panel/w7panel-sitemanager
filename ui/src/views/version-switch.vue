<template>
  <main class="version-page" v-loading="loading">
    <section class="page-card">
      <header class="card-header">
        <h1>传统应用版本切换</h1>
        <p>选择应用版本，确认新版本启动正常后才会清理旧版本运行目录。</p>
      </header>
      <div class="card-body">
        <div v-if="imageTemplate" class="info-row"><span>镜像模板</span><code>{{ imageTemplate }}</code></div>
        <div v-if="!versions.length" class="empty">当前应用没有配置可切换的版本。</div>
        <div v-else class="version-form">
          <label for="version">应用版本</label>
          <select id="version" v-model="selectedVersion" :disabled="saving">
            <option v-for="version in versions" :key="version" :value="version">{{ version }}</option>
          </select>
          <el-button type="primary" :loading="saving" :disabled="!selectedVersion" @click="switchVersion">切换版本</el-button>
        </div>
        <div v-if="currentImage" class="current">当前镜像：{{ currentImage }}</div>
      </div>
    </section>
  </main>
</template>

<script>
import { ElMessageBox } from 'element-plus'
import panelAxios from '@/utils/panel'

const IMAGE_TEMPLATE = 'w7.cc/image_template'
const IMAGE_VERSIONS = 'w7.cc/image_version'
const ROOTFS_ANNOTATION = 'sysbox/rootfs-rw-layer'

export default {
  name: 'VersionSwitch',
  data() {
    return {
      loading: true,
      saving: false,
      deployment: null,
      imageTemplate: '',
      versions: [],
      selectedVersion: '',
      currentImage: ''
    }
  },
  created() {
    this.loadDeployment()
  },
  methods: {
    deploymentName() {
      return window.$wujie?.props?.app_name || ''
    },
    async loadDeployment() {
      const name = this.deploymentName()
      if (!name) {
        this.$message.error('未获取到应用 Deployment 名称')
        this.loading = false
        return
      }
      try {
        const response = await panelAxios.get(`/apis/apps/v1/namespaces/default/deployments/${encodeURIComponent(name)}`)
        this.deployment = response.data
        const annotations = {
          ...(this.deployment?.metadata?.annotations || {}),
          ...(this.deployment?.spec?.template?.metadata?.annotations || {})
        }
        this.imageTemplate = String(annotations[IMAGE_TEMPLATE] || '').trim()
        this.versions = String(annotations[IMAGE_VERSIONS] || '')
          .split(/[|,\s]+/).map(item => item.trim()).filter(Boolean)
        const containers = this.deployment?.spec?.template?.spec?.containers || []
        this.currentImage = containers.find(item => !item.name?.includes('init'))?.image || containers[0]?.image || ''
        const currentVersion = this.imageTemplate.includes('{version}')
          ? this.currentImage.replace(this.imageTemplate.replace('{version}', ''), '').replace(/^[-:]/, '')
          : ''
        this.selectedVersion = this.versions.includes(currentVersion) ? currentVersion : this.versions[0] || ''
      } catch (error) {
        this.$message.error(error?.response?.data?.message || error?.message || '应用信息获取失败')
      } finally {
        this.loading = false
      }
    },
    buildImage(version) {
      if (!this.imageTemplate.includes('{version}')) throw new Error('应用未配置有效的镜像模板')
      return this.imageTemplate.replaceAll('{version}', version)
    },
    updateRootfsPath(annotations, version) {
      const raw = annotations[ROOTFS_ANNOTATION]
      if (!raw) return annotations
      try {
        const entries = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!Array.isArray(entries)) return annotations
        annotations[ROOTFS_ANNOTATION] = JSON.stringify(entries.map(entry => ({
          ...entry,
          path: String(entry.path || '').replace(
            /^(www\/server\/)[^/]+(\/system)$/,
            `$1${this.applicationName()}-${version}$2`
          )
        })))
      } catch {
        // Keep an unrecognised annotation untouched.
      }
      return annotations
    },
    rootfsPaths(annotations) {
      try {
        const raw = annotations?.[ROOTFS_ANNOTATION]
        const entries = typeof raw === 'string' ? JSON.parse(raw) : raw
        return Array.isArray(entries)
          ? entries.map(entry => String(entry?.path || '').trim()).filter(Boolean)
          : []
      } catch {
        return []
      }
    },
    async waitForRollout() {
      const name = this.deploymentName()
      const generation = this.deployment?.metadata?.generation
      // Do not impose a fixed timeout: large images can take considerably
      // longer than a few minutes to pull. Keep polling until Kubernetes
      // reports the updated replicas are ready, so stale Sysbox data is never
      // removed while the new workload is still starting.
      while (true) {
        const response = await panelAxios.get(`/apis/apps/v1/namespaces/default/deployments/${encodeURIComponent(name)}`)
        const deployment = response.data
        const status = deployment?.status || {}
        const ready = status.updatedReplicas >= (deployment?.spec?.replicas || 1)
          && status.readyReplicas >= (deployment?.spec?.replicas || 1)
          && status.availableReplicas >= (deployment?.spec?.replicas || 1)
          && (!generation || status.observedGeneration >= generation)
        if (ready) return deployment
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    },
    async getReadyPod(deployment) {
      const selector = Object.entries(deployment?.spec?.selector?.matchLabels || {})
        .map(([key, value]) => `${key}=${value}`).join(',')
      if (!selector) throw new Error('未获取到应用 Pod 选择器')
      const response = await panelAxios.get('/api/v1/namespaces/default/pods', {
        params: { labelSelector: selector }
      })
      const readyPods = (response.data?.items || []).filter(item => {
        const statuses = item.status?.containerStatuses || []
        return item.status?.phase === 'Running' && statuses.length > 0 && statuses.every(status => status.ready)
      })
      const pod = readyPods.sort((left, right) =>
        String(right.metadata?.creationTimestamp || '').localeCompare(
          String(left.metadata?.creationTimestamp || '')
        )
      )[0]
      if (!pod?.metadata?.name) throw new Error('未获取到新版本 Pod')
      const container = pod.spec?.containers?.find(item => !item.name?.includes('init')) || pod.spec?.containers?.[0]
      return { podName: pod.metadata.name, containerName: container?.name }
    },
    async cleanupOldRootfs(oldPaths, newAnnotations, deployment) {
      const newPaths = this.rootfsPaths(newAnnotations)
      const stalePaths = oldPaths.filter(path => !newPaths.includes(path))
        .filter(path => /^www\/server\/[A-Za-z0-9._-]+\/system$/.test(path))
      if (!stalePaths.length) return
      const { podName, containerName } = await this.getReadyPod(deployment)
      if (!containerName) return
      const command = stalePaths
        .map(path => `rm -rf -- '/${path}'`)
        .join('\n')
      await panelAxios.exec(containerName, podName, `set -eu\n${command}`)
    },
    applicationName() {
      return String(this.deployment?.metadata?.labels?.['w7.cc/identifie']
        || window.$wujie?.props?.app_identifie || this.deploymentName())
        .replace(/[^A-Za-z0-9._-]+/g, '-')
    },
    async switchVersion() {
      if (!this.selectedVersion || !this.deployment) return
      const currentVersion = this.currentImage || '当前版本'
      try {
        await ElMessageBox.confirm(
          `确认将应用切换到版本 ${this.selectedVersion} 吗？\n当前镜像：${currentVersion}`,
          '确认切换版本',
          { confirmButtonText: '确认切换', cancelButtonText: '取消', type: 'warning' }
        )
      } catch {
        return
      }
      this.saving = true
      try {
        const podTemplate = this.deployment.spec.template
        const oldAnnotations = { ...(podTemplate.metadata?.annotations || {}) }
        const oldRootfsPaths = this.rootfsPaths(oldAnnotations)
        const existingContainers = podTemplate.spec?.containers || []
        const mainIndex = existingContainers.findIndex(container => !container.name?.includes('init'))
        const containers = existingContainers.map((container, index) => ({
          name: container.name,
          ...(index === (mainIndex < 0 ? 0 : mainIndex)
            ? { image: this.buildImage(this.selectedVersion) }
            : {})
        }))
        const annotations = { ...(podTemplate.metadata?.annotations || {}) }
        this.updateRootfsPath(annotations, this.selectedVersion)
        const patchAnnotations = annotations
        await panelAxios.patch(
          `/apis/apps/v1/namespaces/default/deployments/${encodeURIComponent(this.deploymentName())}`,
          { spec: { template: { metadata: { annotations }, spec: { containers } } } },
          { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } }
        )
        const updatedDeployment = await this.waitForRollout()
        await this.cleanupOldRootfs(oldRootfsPaths, patchAnnotations, updatedDeployment)
        this.$message.success('版本切换成功')
        await this.loadDeployment()
      } catch (error) {
        this.$message.error(error?.response?.data?.message || error?.message || '版本切换失败')
      } finally {
        this.saving = false
      }
    }
  }
}
</script>

<style scoped>
.version-page { min-height: calc(100vh - 53px); padding: 24px 28px 32px; box-sizing: border-box; }
.page-card { background: #fff; border-radius: 6px; box-shadow: 0 2px 8px rgb(0 0 0 / 4%); }
.card-header { padding: 22px 24px 16px; border-bottom: 1px solid #f2f3f5; }
.card-header h1 { margin: 0; color: #1d2129; font-size: 18px; font-weight: 600; }
.card-header p { margin: 8px 0 0; color: #86909c; font-size: 13px; }
.card-body { padding: 24px; }
.info-row { display: flex; gap: 20px; align-items: center; color: #4e5969; }
.info-row code { padding: 4px 8px; color: #1d2129; background: #f2f3f5; border-radius: 3px; word-break: break-all; }
.empty { color: #86909c; }
.version-form { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
.version-form label { color: #1d2129; font-weight: 500; }
select { min-width: 220px; height: 36px; padding: 0 10px; color: #1d2129; background: #fff; border: 1px solid #c9cdd4; border-radius: 4px; outline: none; }
select:focus { border-color: #165dff; box-shadow: 0 0 0 2px rgb(22 93 255 / 12%); }
.version-form :deep(.el-button) { height: 36px; min-width: 112px; border-radius: 4px; --el-color-primary: #165dff; }
.current { margin-top: 22px; padding-top: 16px; color: #86909c; border-top: 1px solid #f2f3f5; word-break: break-all; }
</style>
