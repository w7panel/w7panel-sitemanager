<template>
  <main class="basic-config" v-loading="loading">
    <el-alert v-if="loadError || saveError" :title="loadError || saveError" type="error" :closable="false" show-icon><el-button @click="deployment ? refreshApplication() : loadApplication()">重试</el-button></el-alert>
    <template v-if="deployment && !loadError">
      <el-form label-width="116px" class="site-form" @submit.prevent>
        <el-form-item label="域名" required><DomainConfig ref="domains" :context="context" /></el-form-item>
        <el-form-item label="目录">
          <div class="site-directory" aria-label="站点目录">{{ context.directory?.path || '无法确定站点目录' }}</div>
          <p v-if="context.directoryError" class="field-help">{{ context.directoryError }}</p>
        </el-form-item>
        <el-form-item label="运行环境" required>
          <div class="environment-field">
            <el-select v-if="versions.length && imageTemplate" v-model="selectedVersion" :disabled="saving" :teleported="false" aria-label="运行环境版本">
              <el-option v-if="!versions.includes(currentVersion)" :value="currentVersion" :label="currentVersion || '保留当前环境'" />
              <el-option v-for="version in versions" :key="version" :label="version" :value="version" />
            </el-select>
            <span v-else>{{ currentVersion || currentImage.split('/').pop() || '当前环境' }}</span>
            <p class="field-help">{{ context.appGroup.spec?.title || context.appGroup.metadata.annotations?.title || '当前站点' }}使用独立运行环境。</p>
          </div>
        </el-form-item>
        <el-form-item label="启动命令" required>
          <div class="startup-field">
            <div class="startup-options">
              <label><input v-model="startup.mode" type="radio" value="default" :disabled="saving" />使用默认启动方式</label>
              <label><input v-model="startup.mode" type="radio" value="custom" :disabled="saving" />自定义启动命令</label>
            </div>
            <el-input v-if="startup.mode === 'custom'" v-model="startup.text" type="textarea" :rows="3" :disabled="saving" aria-label="启动命令" placeholder="例如 cd /www/wwwroot &amp;&amp; npm run start" />
            <p v-if="startup.inheritedArgs" class="field-help">当前附加参数：{{ startup.inheritedArgs }}。未编辑时保留原配置。</p>
            <p class="field-help">{{ startup.mode === 'default' ? '按环境内置的启动方式运行。' : '填写完整命令，多条命令可用 && 连接。' }}</p>
          </div>
        </el-form-item>
        <el-form-item label="端口">
          <div class="ports-field">
            <div v-for="(port, index) in ports" :key="index" class="port-row">
              <el-input-number v-model="port.containerPort" :min="1" :max="65535" :controls="false" :disabled="saving" :aria-label="`应用端口 ${index + 1}`" />
              <el-button v-if="!port.existing" text type="danger" :disabled="saving" @click="ports.splice(index, 1)">移除</el-button>
            </div>
            <el-button class="port-add" :disabled="saving" @click="addPort">＋ 添加端口</el-button>
            <p class="field-help">填写应用实际监听的端口；已有端口暂不支持删除。</p>
          </div>
        </el-form-item>
        <el-form-item v-if="versionChanged && systemDiskPaths.length"><el-alert type="warning" title="切换版本会重置系统盘数据，请先备份。新版本就绪后会清理旧版本目录。" :closable="false" show-icon /></el-form-item>
        <el-form-item>
          <div><el-button type="primary" :loading="saving" :disabled="!!saveError" @click="saveRuntime">保存并应用</el-button><el-button :disabled="saving" @click="refreshApplication">刷新</el-button>
            <p class="field-help">{{ saving ? savingPhase : '保存运行配置后应用会重新启动。' }}</p></div>
        </el-form-item>
      </el-form>
      <details class="runtime-details"><summary>详细信息</summary><dl><dt>应用容器</dt><dd>{{ containerName }}</dd><dt>当前镜像</dt><dd>{{ currentImage }}</dd><dt>系统盘路径</dt><dd>{{ systemDiskPaths.join('、') || '未配置' }}</dd></dl></details>
    </template>
  </main>
</template>
<script>
import { ElMessageBox } from 'element-plus'
import panelAxios from '@/utils/panel'
import DomainConfig from '@/components/site/DomainConfig.vue'
import { startupDraft, resolveStartup, portRows, runtimePortDraft, buildRuntimePlan, deploymentPatch, serviceBody, servicePatch } from '@/utils/runtime-config'

const IMAGE_TEMPLATE = 'w7.cc/image_template'
const IMAGE_VERSIONS = 'w7.cc/image_version'
const ROOTFS_ANNOTATION = 'sysbox/rootfs-rw-layer'
const APPGROUP_API = '/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups'
const DEPLOYMENT_API = '/apis/apps/v1/namespaces/default/deployments'
const SERVICE_API = '/api/v1/namespaces/default/services'
const PATCH_OPTIONS = { headers: { 'Content-Type': 'application/json-patch+json' } }
const JOB_API = '/apis/batch/v1/namespaces/default/jobs'
const CLEANUP_MOUNT_PATH = '/www/server'
const CLEANUP_IMAGE = 'busybox:1.37.0'

export default {
  name: 'RuntimeConfig',
  components: { DomainConfig },
  props: { context: { type: Object, required: true } },
  emits: ['refresh'],
  data() {
    return {
      loading: true,
      initialDraft: '',
      saving: false,
      appGroup: null,
      deployment: null,
      workloadName: '',
      imageTemplate: '',
      versions: [],
      selectedVersion: '',
      currentImage: '',
      currentVersion: '',
      containerName: '',
      startup: startupDraft({}),
      ports: [],
      service: null,
      loadError: '',
      saveError: '',
      savingPhase: ''
    }
  },
  computed: {
    runtimeDraft() { return JSON.stringify({ version: this.selectedVersion, mode: this.startup.mode, text: this.startup.text, ports: this.ports }) },
    runtimeDirty() { return !!this.initialDraft && this.runtimeDraft !== this.initialDraft },
    versionChanged() { return !!this.selectedVersion && this.selectedVersion !== this.currentVersion },
    systemDiskPaths() {
      const deploymentAnnotations = this.deployment?.spec?.template?.metadata?.annotations || {}
      const deploymentPaths = this.rootfsPaths(deploymentAnnotations)
      const paths = deploymentPaths.length
        ? deploymentPaths
        : this.rootfsPaths(this.appGroup?.metadata?.annotations || {})
      return [...new Set(paths)]
    }
  },
  created() {
    this.loadApplication()
  },
  methods: {
    async canLeave() {
      if (this.saving || this.$refs.domains?.busy) { this.$message.info('正在保存配置，请稍候'); return false }
      if (!this.runtimeDirty && !this.$refs.domains?.hasDraft()) return true
      try { await ElMessageBox.confirm('有未保存的站点配置，确定离开吗？', '未保存的配置', { confirmButtonText: '放弃并离开', cancelButtonText: '继续编辑', type: 'warning' }); return true }
      catch { return false }
    },
    async refreshApplication() {
      if (!await this.canLeave()) return
      if (this.$refs.domains) { this.$refs.domains.form = null; this.$refs.domains.httpsDraft = null; this.$refs.domains.removeRow = null; this.$refs.domains.load() }
      await this.loadApplication()
      this.$emit('refresh')
    },
    appGroupName() {
      return window.$wujie?.props?.group || window.$wujie?.props?.appgroup || ''
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
    async loadApplication({ afterSave = false } = {}) {
      this.loading = true
      this.loadError = ''
      const appGroupName = this.appGroupName()
      if (!appGroupName) {
        this.loadError = '未获取到 AppGroup 名称'
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
        try {
          this.service = (await panelAxios.get(`${SERVICE_API}/${encodeURIComponent(this.workloadName)}`)).data
        } catch (error) {
          if (error?.response?.status !== 404) throw error
          this.service = null
        }
        this.resetDraft()
        this.saveError = ''
      } catch (error) {
        const detail = error?.response?.data?.message || error?.message || '应用信息获取失败'
        if (afterSave) this.saveError = `运行配置已应用，但配置刷新失败，请刷新检查后重试。 ${detail}`
        else this.loadError = detail
      } finally {
        this.loading = false
      }
    },
    resetDraft() {
      const containers = this.deployment?.spec?.template?.spec?.containers || []
      const container = containers.find(item => item.name === this.context.directory?.containerName) || containers[0]
      this.containerName = container?.name || ''
      if (!container) return
      this.currentImage = container.image || ''
      this.currentVersion = this.currentVersionFromImage(this.currentImage)
      this.selectedVersion = this.currentVersion
      this.startup = startupDraft(container)
      this.ports = portRows(container, this.service)
      this.initialDraft = this.runtimeDraft
    },
    addPort() {
      let index = this.ports.length + 1
      while (this.ports.some(port => port.name === `port-${index}`)) index += 1
      this.ports.push({ name: `port-${index}`, protocol: 'TCP', containerPort: '', servicePort: '', existing: false, mapped: false })
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
          path: entry.name === this.containerName
            ? `www/server/${this.appGroupName()}/${this.applicationName()}-${version}/system`
            : entry.path
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
      const deadline = Date.now() + 15 * 60 * 1000
      while (Date.now() < deadline) {
        const response = await panelAxios.get(
          `${DEPLOYMENT_API}/${encodeURIComponent(this.workloadName)}`
        )
        const deployment = response.data
        const status = deployment?.status || {}
        if (deployment?.spec?.paused) throw new Error('工作负载已暂停，请在面板恢复后检查配置')
        const failed = (status.conditions || []).find(item => item.type === 'Progressing' && item.status === 'False' && item.reason === 'ProgressDeadlineExceeded')
        if (failed) throw new Error(failed.message || '应用启动失败，请检查容器日志')
        const desired = deployment?.spec?.replicas ?? 1
        const ready = (status.updatedReplicas || 0) === desired
          && (status.replicas || 0) === desired
          && (status.readyReplicas || 0) === desired
          && (status.availableReplicas || 0) === desired
          && (!generation || status.observedGeneration >= generation)
        if (ready) return deployment
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
      throw new Error('配置已提交，但应用在 15 分钟内未就绪，请检查运行状态；旧系统盘目录未清理')
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
        && /^www\/server\/(?:[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+\/system$/.test(entry.path)
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
    async saveRuntime() {
      if (this.saving || !this.deployment || this.loadError || this.saveError) return
      let plan
      let body
      try {
        if (this.versionChanged && this.deployment.spec.replicas === 0) throw new Error('应用已停止，请先启动后再切换版本')
        if (this.versionChanged && !this.versions.includes(this.selectedVersion)) throw new Error('请选择支持的版本')
        const startup = resolveStartup(this.startup)
        plan = buildRuntimePlan(this.deployment, this.service, {
          containerName: this.containerName, command: startup.command, args: startup.args,
          ports: runtimePortDraft(this.ports, this.service),
          image: this.versionChanged ? this.buildImage(this.selectedVersion) : '',
          version: this.selectedVersion
        })
        if (!plan.changes.length) { this.$message.info('配置没有变化'); return }
        if (plan.serviceChanged || plan.portsChanged) body = serviceBody(this.deployment, this.service, plan, this.appGroupName())
      } catch (error) { this.$message.error(error.message); return }
      try {
        await ElMessageBox.confirm(
          `即将更新：${plan.changes.join('、')}。应用会重新启动。${this.versionChanged && this.systemDiskPaths.length ? '\n切换版本会重置系统盘数据，请确认已备份。' : ''}`,
          '确认应用运行配置',
          { confirmButtonText: '保存并应用', cancelButtonText: '取消', type: 'warning' }
        )
      } catch { return }
      this.saving = true
      this.savingPhase = '检查配置是否已被其他操作修改'
      let deploymentApplied = false
      let serviceApplied = false
      const versionChanged = this.versionChanged
      try {
        const latest = (await panelAxios.get(`${DEPLOYMENT_API}/${encodeURIComponent(this.workloadName)}`)).data
        if (latest.metadata.resourceVersion !== this.deployment.metadata.resourceVersion) throw new Error('应用已被其他操作更新，请刷新配置后重试')
        if (body && this.service) {
          const latestService = (await panelAxios.get(`${SERVICE_API}/${encodeURIComponent(this.workloadName)}`)).data
          if (latestService.metadata.resourceVersion !== this.service.metadata.resourceVersion) throw new Error('Service 已被其他操作更新，请刷新配置后重试')
        }
        const oldAnnotations = { ...(this.deployment.spec.template.metadata?.annotations || {}) }
        const oldRootfsEntries = this.rootfsEntries(oldAnnotations)
        let annotations
        if (versionChanged) {
          annotations = { ...oldAnnotations }
          const appGroupRootfs = this.appGroup?.metadata?.annotations?.[ROOTFS_ANNOTATION]
          if (!annotations[ROOTFS_ANNOTATION] && appGroupRootfs !== undefined && appGroupRootfs !== null) annotations[ROOTFS_ANNOTATION] = appGroupRootfs
          this.updateRootfsPath(annotations, this.selectedVersion)
        }
        this.savingPhase = '更新应用容器和配置保留标记'
        this.deployment = (await panelAxios.patch(
          `${DEPLOYMENT_API}/${encodeURIComponent(this.workloadName)}`,
          deploymentPatch(this.deployment, plan, annotations), PATCH_OPTIONS
        )).data
        deploymentApplied = true
        if (body) {
          this.savingPhase = '更新端口访问配置'
          if (this.service) await panelAxios.patch(`${SERVICE_API}/${encodeURIComponent(this.workloadName)}`, servicePatch(this.service, body), PATCH_OPTIONS)
          else await panelAxios.post(SERVICE_API, body)
          serviceApplied = true
        }
        this.savingPhase = '等待应用启动就绪'
        const updatedDeployment = await this.waitForRollout()
        if (versionChanged) {
          this.savingPhase = '清理旧版本系统盘目录'
          await this.cleanupOldRootfs(oldRootfsEntries, annotations, updatedDeployment)
        }
        this.$message.success('运行配置已应用')
        await this.loadApplication({ afterSave: true })
        this.$emit('refresh')
      } catch (error) {
        const detail = error?.response?.data?.message || error?.response?.data?.error || error?.message || '保存失败'
        const state = deploymentApplied
          ? (body && !serviceApplied ? '容器配置已提交，但 Service 未确认更新成功。请刷新检查后重试；旧系统盘目录未清理。' : '配置已提交，但启动或清理未完成。请检查运行状态。')
          : '未确认配置提交成功，请刷新检查后重试。'
        this.saveError = `${state} ${detail}`
        this.$message.error(this.saveError)
      } finally { this.saving = false; this.savingPhase = '' }
    }
  }
}
</script>

<style scoped>
.basic-config{max-width:1100px;padding:0 0 24px}.site-form :deep(.el-form-item){margin-bottom:28px}.site-form :deep(.el-form-item__content){display:block;min-width:0}.site-form :deep(.el-form-item__label){justify-content:flex-start;padding-left:12px}.site-directory{line-height:32px;overflow-wrap:anywhere}.environment-field{max-width:420px}.environment-field .el-select{width:280px}.startup-options{display:flex;gap:24px;margin-bottom:12px;flex-wrap:wrap}.startup-options label{display:flex;align-items:center;gap:6px;cursor:pointer}.field-help{font-size:13px;line-height:1.7;color:#86909c;margin:8px 0 0}.ports-field{display:grid;gap:10px;justify-items:start}.port-add{--el-button-text-color:var(--el-color-primary)}.port-row{display:flex;gap:12px}.runtime-details{margin-left:116px;color:#86909c;font-size:13px}.runtime-details summary{cursor:pointer}.runtime-details dl{display:grid;grid-template-columns:100px 1fr;gap:12px}.runtime-details dd{margin:0;overflow-wrap:anywhere}@media(max-width:760px){.runtime-details{margin-left:0}.site-form :deep(.el-form-item__label){width:90px!important}}
</style>
