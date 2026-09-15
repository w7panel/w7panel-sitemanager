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
const APPGROUP_API = '/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups'
const DEPLOYMENT_API = '/apis/apps/v1/namespaces/default/deployments'
const JOB_API = '/apis/batch/v1/namespaces/default/jobs'
const CLEANUP_MOUNT_PATH = '/www/server'
const CLEANUP_IMAGE = 'busybox:1.37.0'

export default {
  name: 'VersionSwitch',
  data() {
    return {
      loading: true,
      saving: false,
      appGroup: null,
      deployment: null,
      workloadName: '',
      imageTemplate: '',
      versions: [],
      selectedVersion: '',
      currentImage: ''
    }
  },
  created() {
    this.loadApplication()
  },
  methods: {
    appGroupName() {
      return window.$wujie?.props?.group || ''
    },
    findWorkloadName(appGroup) {
      const appGroupName = appGroup?.metadata?.name || this.appGroupName()
      return (appGroup?.status?.items || []).find(item =>
        item?.kind === 'Deployment' && item?.name === appGroupName
      )?.name || ''
    },
    currentVersionFromImage(image) {
      const markerIndex = this.imageTemplate.indexOf('{version}')
      if (markerIndex < 0) return ''
      const prefix = this.imageTemplate.slice(0, markerIndex)
      const suffix = this.imageTemplate.slice(markerIndex + '{version}'.length)
      if (!image.startsWith(prefix) || !image.endsWith(suffix)) return ''
      return image.slice(prefix.length, suffix ? -suffix.length : undefined)
    },
    async loadApplication() {
      const appGroupName = this.appGroupName()
      if (!appGroupName) {
        this.$message.error('未获取到 AppGroup 名称')
        this.loading = false
        return
      }
      try {
        const appGroupResponse = await panelAxios.get(`${APPGROUP_API}/${encodeURIComponent(appGroupName)}`)
        this.appGroup = appGroupResponse.data
        this.workloadName = this.findWorkloadName(this.appGroup)
        if (!this.workloadName) {
          throw new Error(`AppGroup 中未找到同名 Deployment：${appGroupName}`)
        }

        const annotations = this.appGroup?.metadata?.annotations || {}
        this.imageTemplate = String(annotations[IMAGE_TEMPLATE] || '').trim()
        this.versions = String(annotations[IMAGE_VERSIONS] || '')
          .split(/[|,\s]+/).map(item => item.trim()).filter(Boolean)
        const deploymentResponse = await panelAxios.get(
          `${DEPLOYMENT_API}/${encodeURIComponent(this.workloadName)}`
        )
        this.deployment = deploymentResponse.data
        const containers = this.deployment?.spec?.template?.spec?.containers || []
        this.currentImage = containers.find(item => !item.name?.includes('init'))?.image || containers[0]?.image || ''
        const currentVersion = this.currentVersionFromImage(this.currentImage)
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
    rootfsEntries(annotations) {
      try {
        const raw = annotations?.[ROOTFS_ANNOTATION]
        const entries = typeof raw === 'string' ? JSON.parse(raw) : raw
        return Array.isArray(entries)
          ? entries.map(entry => ({
            ...entry,
            path: String(entry?.path || '').trim(),
            volumeName: String(entry?.volumeName || '').trim()
          })).filter(entry => entry.path)
          : []
      } catch {
        return []
      }
    },
    rootfsPaths(annotations) {
      return this.rootfsEntries(annotations).map(entry => entry.path)
    },
    async waitForRollout() {
      const generation = this.deployment?.metadata?.generation
      // Do not impose a fixed timeout: large images can take considerably
      // longer than a few minutes to pull. Keep polling until Kubernetes
      // reports the updated replicas are ready, so stale Sysbox data is never
      // removed while the new workload is still starting.
      while (true) {
        const response = await panelAxios.get(
          `${DEPLOYMENT_API}/${encodeURIComponent(this.workloadName)}`
        )
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
    cleanupJobGenerateName() {
      const workload = String(this.workloadName || 'application')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'application'
      return `${`${workload}-rootfs-cleanup`.slice(0, 56).replace(/-+$/g, '')}-`
    },
    async waitForCleanupJob(jobName) {
      while (true) {
        const response = await panelAxios.get(`${JOB_API}/${encodeURIComponent(jobName)}`)
        const status = response.data?.status || {}
        if ((status.succeeded || 0) > 0) return
        const failed = (status.conditions || []).find(condition =>
          condition?.type === 'Failed' && condition?.status === 'True'
        )
        if (failed) throw new Error(failed.message || failed.reason || '旧版本目录清理 Job 执行失败')
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    },
    async cleanupOldRootfs(oldEntries, newAnnotations, deployment) {
      const newPaths = new Set(this.rootfsPaths(newAnnotations))
      const staleEntries = oldEntries.filter(entry =>
        !newPaths.has(entry.path)
        && entry.volumeName
        && /^www\/server\/[A-Za-z0-9._-]+\/system$/.test(entry.path)
      )
      if (!staleEntries.length) return

      const entriesByVolume = new Map()
      staleEntries.forEach(entry => {
        const directory = entry.path.replace(/\/system$/, '')
        const directories = entriesByVolume.get(entry.volumeName) || new Set()
        directories.add(directory)
        entriesByVolume.set(entry.volumeName, directories)
      })

      const podSpec = deployment?.spec?.template?.spec || {}
      const deploymentVolumes = podSpec.volumes || []
      const volumeNames = [...entriesByVolume.keys()]
      const volumes = volumeNames.map(name => deploymentVolumes.find(volume => volume?.name === name))
      const missingVolume = volumeNames.find((name, index) => !volumes[index])
      if (missingVolume) throw new Error(`Deployment 中未找到 Sysbox 存储卷：${missingVolume}`)

      const containers = volumeNames.map((volumeName, index) => ({
        name: `cleanup-${index + 1}`,
        image: CLEANUP_IMAGE,
        imagePullPolicy: 'IfNotPresent',
        command: ['sh', '-c'],
        args: [[
          'set -eu',
          ...[...entriesByVolume.get(volumeName)]
            .map(directory => `rm -rf -- '${CLEANUP_MOUNT_PATH}/${directory}'`)
        ].join('\n')],
        volumeMounts: [{ name: volumeName, mountPath: CLEANUP_MOUNT_PATH }]
      }))

      const cleanupPodSpec = {
        restartPolicy: 'Never',
        enableServiceLinks: false,
        containers,
        volumes
      }
      const inheritedPodSpecFields = [
        'affinity',
        'nodeSelector',
        'tolerations',
        'imagePullSecrets',
        'serviceAccountName',
        'schedulerName',
        'priorityClassName'
      ]
      inheritedPodSpecFields.forEach(field => {
        if (podSpec[field] !== undefined && podSpec[field] !== null) {
          cleanupPodSpec[field] = podSpec[field]
        }
      })

      const response = await panelAxios.post(JOB_API, {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          generateName: this.cleanupJobGenerateName(),
          labels: {
            'w7.cc/group-name': this.appGroupName(),
            'w7.cc/rootfs-cleanup': 'true'
          }
        },
        spec: {
          backoffLimit: 0,
          activeDeadlineSeconds: 300,
          ttlSecondsAfterFinished: 300,
          template: {
            metadata: {
              labels: {
                'w7.cc/group-name': this.appGroupName(),
                'w7.cc/rootfs-cleanup': 'true'
              }
            },
            spec: cleanupPodSpec
          }
        }
      })
      const jobName = response.data?.metadata?.name
      if (!jobName) throw new Error('旧版本目录清理 Job 创建成功，但未返回 Job 名称')
      await this.waitForCleanupJob(jobName)
    },
    applicationName() {
      return String(this.deployment?.metadata?.labels?.['w7.cc/identifie']
        || this.appGroup?.spec?.identifie
        || this.appGroup?.metadata?.labels?.['w7.cc/identifie']
        || this.workloadName)
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
        const oldRootfsEntries = this.rootfsEntries(oldAnnotations)
        const existingContainers = podTemplate.spec?.containers || []
        const mainIndex = existingContainers.findIndex(container => !container.name?.includes('init'))
        const mainContainer = existingContainers[mainIndex < 0 ? 0 : mainIndex]
        if (!mainContainer?.name) throw new Error('未获取到应用容器名称')
        const hasImageVersionEnv = (mainContainer.env || []).some(item => item?.name === 'IMAGE_VERSION')
        const containers = [{
          name: mainContainer.name,
          image: this.buildImage(this.selectedVersion),
          ...(hasImageVersionEnv
            ? { env: [{ name: 'IMAGE_VERSION', value: this.selectedVersion }] }
            : {})
        }]
        const annotations = { ...(podTemplate.metadata?.annotations || {}) }
        const appGroupRootfs = this.appGroup?.metadata?.annotations?.[ROOTFS_ANNOTATION]
        if (appGroupRootfs !== undefined && appGroupRootfs !== null) {
          annotations[ROOTFS_ANNOTATION] = appGroupRootfs
        }
        this.updateRootfsPath(annotations, this.selectedVersion)
        const patchAnnotations = annotations
        const patchResponse = await panelAxios.patch(
          `${DEPLOYMENT_API}/${encodeURIComponent(this.workloadName)}`,
          { spec: { template: { metadata: { annotations }, spec: { containers } } } },
          { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } }
        )
        this.deployment = patchResponse.data
        const updatedDeployment = await this.waitForRollout()
        await this.cleanupOldRootfs(oldRootfsEntries, patchAnnotations, updatedDeployment)
        this.$message.success('版本切换成功')
        await this.loadApplication()
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
.version-page { box-sizing: border-box; }
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
