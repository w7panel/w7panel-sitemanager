<template>
  <main class="runtime-page" v-loading="loading">
    <header class="page-heading page-card">
      <div><h1>运行配置</h1><p>统一管理应用版本、启动方式和端口，保存后应用会重新启动。</p></div>
      <el-button type="primary" class="panel-outline-button" :disabled="saving" @click="loadApplication">刷新配置</el-button>
    </header>
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
    <template v-if="deployment && !loadError">
      <section class="page-card">
        <header class="card-header"><h2>版本与镜像</h2><p>管理应用主容器，未修改的配置继续跟随应用更新。</p></header>
        <div class="card-body form-grid">
          <span class="field-label">应用容器</span><code>{{ containerName }}</code>
          <span class="field-label">当前镜像</span><code>{{ currentImage }}</code>
          <template v-if="versions.length && imageTemplate">
            <label for="version">应用版本</label>
            <select id="version" v-model="selectedVersion" :disabled="saving">
              <option v-if="!versions.includes(currentVersion)" :value="currentVersion">{{ currentVersion || '保留当前镜像' }}</option>
              <option v-for="version in versions" :key="version" :value="version">{{ version }}</option>
            </select>
          </template>
          <template v-else><span class="field-label">应用版本</span><span class="muted">未配置可切换的版本，可继续修改命令和端口。</span></template>
          <span class="field-label">系统盘存储路径</span>
          <div v-if="systemDiskPaths.length" class="path-list"><code v-for="path in systemDiskPaths" :key="path">{{ path }}</code></div><span v-else class="muted">未配置</span>
        </div>
        <div v-if="versionChanged && systemDiskPaths.length" class="risk-warning" role="alert">切换版本会重置系统盘数据。请提前备份；新版本启动正常后才会清理旧版本目录。</div>
      </section>
      <section class="page-card">
        <header class="card-header"><h2>启动方式</h2><p>使用镜像默认启动方式，或填写自己的启动命令。</p></header>
        <div class="card-body">
          <div class="startup-options" role="radiogroup" aria-label="启动方式">
            <label class="startup-option"><input v-model="startup.mode" type="radio" value="default" :disabled="saving" /><span>使用镜像默认启动方式</span></label>
            <label class="startup-option"><input v-model="startup.mode" type="radio" value="custom" :disabled="saving" /><span>自定义启动命令</span></label>
          </div>
          <p v-if="startup.mode === 'default'" class="field-help">按镜像内置的启动方式运行，无需填写命令。</p>
          <div v-else class="startup-command">
            <label for="startup-command">启动命令</label>
            <textarea id="startup-command" v-model="startup.text" :disabled="saving" rows="3" spellcheck="false" placeholder="例如：php-fpm -F 或 npm run start" />
            <p v-if="startup.inheritedArgs" class="field-help">当前使用镜像内置命令，附加参数为 {{ startup.inheritedArgs }}。未编辑时保持原配置；修改时请填写完整启动命令。</p>
            <p class="field-help">直接填写完整命令即可，多条命令可用 &amp;&amp; 连接。请确保相关程序已在容器中安装。</p>
          </div>
        </div>
      </section>
      <section class="page-card">
        <header class="card-header section-heading"><div><h2>端口</h2><p>填写应用实际监听的端口。</p></div><el-button type="primary" class="panel-outline-button" :disabled="saving" @click="addPort">添加端口</el-button></header>
        <div class="card-body">
          <div v-if="!ports.length" class="empty">尚未配置端口。</div>
          <div v-else class="port-list">
            <div v-for="(port, index) in ports" :key="index" class="port-row">
              <label :for="`port-${index}`">{{ ports.length > 1 ? `端口 ${index + 1}` : '端口' }}</label>
              <input :id="`port-${index}`" v-model.number="port.containerPort" type="number" min="1" max="65535" :disabled="saving" placeholder="例如 8080" />
              <el-button v-if="!port.existing" text type="danger" :disabled="saving" @click="ports.splice(index, 1)">移除</el-button>
            </div>
          </div>
          <p class="field-help">端口需与应用的启动命令或配置一致；已有端口暂不支持删除。</p>
        </div>
      </section>
      <footer class="save-bar"><div><strong>{{ saving ? savingPhase : '保存后重启应用' }}</strong><p>修改过的启动方式和端口将在支持运行配置保留的应用更新中继续生效。</p></div><el-button type="primary" :loading="saving" @click="saveRuntime">保存并应用</el-button></footer>
    </template>
  </main>
</template>
<script>
import { ElMessageBox } from 'element-plus'
import panelAxios from '@/utils/panel'
import { startupDraft, resolveStartup, portRows, buildRuntimePlan, deploymentPatch, serviceBody, servicePatch } from '@/utils/runtime-config'

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
      currentImage: '',
      currentVersion: '',
      containerName: '',
      startup: startupDraft({}),
      ports: [],
      service: null,
      loadError: '',
      savingPhase: ''
    }
  },
  computed: {
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
    async loadApplication() {
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
      } catch (error) {
        this.loadError = error?.response?.data?.message || error?.message || '应用信息获取失败'
      } finally {
        this.loading = false
      }
    },
    resetDraft() {
      const container = this.deployment?.spec?.template?.spec?.containers?.[0]
      this.containerName = container?.name || ''
      if (!container) return
      this.currentImage = container.image || ''
      this.currentVersion = this.currentVersionFromImage(this.currentImage)
      this.selectedVersion = this.currentVersion
      this.startup = startupDraft(container)
      this.ports = portRows(container, this.service)
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
      if (this.saving || !this.deployment || this.loadError) return
      let plan
      let body
      try {
        if (this.versionChanged && this.deployment.spec.replicas === 0) throw new Error('应用已停止，请先启动后再切换版本')
        if (this.versionChanged && !this.versions.includes(this.selectedVersion)) throw new Error('请选择支持的版本')
        const startup = resolveStartup(this.startup)
        plan = buildRuntimePlan(this.deployment, this.service, {
          containerName: this.containerName, command: startup.command, args: startup.args,
          ports: this.ports.map(port => ({ ...port, servicePort: port.mapped ? port.servicePort : port.containerPort })),
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
        await this.loadApplication()
      } catch (error) {
        const detail = error?.response?.data?.message || error?.response?.data?.error || error?.message || '保存失败'
        const state = deploymentApplied
          ? (body && !serviceApplied ? '容器配置已提交，但 Service 未确认更新成功。请刷新检查后重试；旧系统盘目录未清理。' : '配置已提交，但启动或清理未完成。请检查运行状态。')
          : '未确认配置提交成功，请刷新检查后重试。'
        this.loadError = `${state} ${detail}`
        this.$message.error(this.loadError)
      } finally { this.saving = false; this.savingPhase = '' }
    }
  }
}
</script>

<style scoped>
.runtime-page { box-sizing: border-box; display: grid; gap: 16px; width: 100%; min-width: 0; margin: 0; padding-bottom: 32px; }
.page-heading, .section-heading, .save-bar { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.page-heading { padding: 20px 24px; }
h1 { margin: 0; color: #1d2129; font-size: 18px; font-weight: 600; }
h2 { margin: 0; color: #1d2129; font-size: 16px; font-weight: 600; }
.page-heading p, .card-header p, .save-bar p { margin: 8px 0 0; color: #86909c; font-size: 13px; line-height: 1.6; }
.page-card { background: #fff; border-radius: 6px; box-shadow: 0 2px 8px rgb(0 0 0 / 4%); overflow: hidden; }
.card-header { padding: 22px 24px 16px; border-bottom: 1px solid #f2f3f5; }
.card-body { padding: 24px; }
.form-grid { display: grid; grid-template-columns: 126px minmax(0, 720px); gap: 18px 20px; align-items: start; }
.form-grid > * { min-width: 0; }
.form-grid label, .field-label { padding-top: 8px; color: #4e5969; }
code { box-sizing: border-box; display: inline-block; max-width: 100%; padding: 7px 10px; color: #1d2129; background: #f7f8fa; border-radius: 4px; word-break: break-all; white-space: pre-wrap; }
.path-list { display: grid; gap: 6px; }
.muted, .empty { color: #86909c; line-height: 36px; font-size: 13px; }
input, select, textarea { box-sizing: border-box; width: 100%; border: 1px solid #c9cdd4; border-radius: 4px; background: #fff; color: #1d2129; font-size: 14px; padding: 8px 10px; }
select, input { height: 36px; }
.form-grid select { max-width: 380px; }
textarea { resize: vertical; font-family: ui-monospace, monospace; line-height: 1.6; }
input:focus, select:focus, textarea:focus { outline: 2px solid rgb(22 93 255 / 15%); border-color: #165dff; }
input:disabled, select:disabled, textarea:disabled { background: #f7f8fa; color: #86909c; }
.field-help { margin: 8px 0 0; color: #86909c; font-size: 12px; line-height: 1.7; }
.risk-warning { margin: 0 24px 24px; padding: 12px 16px; color: #7a4600; background: #fff7e8; border: 1px solid #ffcf8b; border-radius: 4px; line-height: 1.7; }
.startup-options { display: flex; flex-wrap: wrap; gap: 16px 28px; }
.startup-option { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; color: #4e5969; }
.startup-option input { width: 16px; height: 16px; margin: 0; accent-color: #165dff; }
.startup-command { display: grid; gap: 10px; width: 100%; max-width: 720px; min-width: 0; margin-top: 20px; }
.startup-command > label { color: #4e5969; }
.port-list { display: grid; gap: 12px; max-width: 540px; }
.port-row { display: grid; grid-template-columns: 80px minmax(0, 380px) auto; align-items: center; gap: 16px; }
.port-row label { color: #4e5969; }
.save-bar { padding: 18px 24px; background: #fff; border: 1px solid #e5e6eb; border-radius: 6px; box-shadow: 0 -4px 16px rgb(0 0 0 / 3%); }
.save-bar strong { color: #1d2129; font-size: 14px; font-weight: 500; }
:deep(.el-button) { border-radius: 4px; --el-color-primary: #165dff; }
.page-heading > div, .section-heading > div { flex: 1; min-width: 0; }
.page-heading .panel-outline-button, .section-heading .panel-outline-button { margin-left: auto; }
@media (max-width: 640px) { .form-grid { grid-template-columns: 1fr; gap: 8px; } .form-grid label { margin-top: 8px; } .page-heading, .card-body, .card-header { padding: 16px; } .page-heading, .section-heading { align-items: flex-start; gap: 12px; } .save-bar { align-items: flex-start; flex-direction: column; gap: 12px; } }
</style>
