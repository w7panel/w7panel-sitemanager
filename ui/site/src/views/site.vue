<template>
  <div style="min-height: 100%;">
    <div class="bg-white bg-padding pb-24" style="border-top: 1px solid #eeeeee;">
      <div class="df jc-b">
        <el-button type="primary" icon="plus" @click="add">新建站点</el-button>
      </div>

      <el-table :data="tableData" class="mt-20 table-header" v-loading="loading">
        <el-table-column label="域名" prop="domain">
          <template #default="scope">
            <div v-if="scope.row.domain?.length">
              <a
                style="color: #0052d9;"
                :href="domainUrl(scope.row.domain[0])"
                target="_blank"
              >{{ domainUrl(scope.row.domain[0]) }}</a>
            </div>
            <div v-if="scope.row.domain?.length > 1">
              <el-popover width="200">
                <template #reference>
                  <span style="color: #0052d9; font-size: 12px;">等{{ scope.row.domain.length }}个域名</span>
                </template>
                <div>
                  <div
                    v-for="(item, index) in scope.row.domain"
                    :key="item.domain + '-' + index"
                    style="word-break: keep-all; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;"
                  >
                    <a v-if="index !== 0" style="color: #0052d9;" :href="domainUrl(item)" target="_blank">
                      {{ domainUrl(item) }}
                    </a>
                  </div>
                </div>
              </el-popover>
            </div>
            <span v-if="!scope.row.domain?.length">-</span>
          </template>
        </el-table-column>

        <el-table-column label="目录" prop="root_dir">
          <template #default="scope">
            <el-button v-if="scope.row.root_dir" type="text" @click="toFile(scope.row)">
              /www/wwwroot/{{ scope.row.root_dir }}
            </el-button>
            <span v-else>-</span>
            <div style="color: #999; margin-top: -4px; font-size: 12px;">
              {{ scope.row.remark || '-' }}
            </div>
          </template>
        </el-table-column>

        <el-table-column label="环境" prop="environment_name" min-width="180">
          <template #default="scope">
            <div>{{ scope.row.environment_name || '-' }}</div>
            <div v-if="scope.row.environment_status === null" class="environment-status is-loading">
              <el-icon class="my-rotate"><Loading /></el-icon>
              <span>检测中...</span>
            </div>
            <div v-else-if="scope.row.environment_status === 2" class="environment-status is-loading">
              <el-icon class="my-rotate"><Loading /></el-icon>
              <span>等待环境启动中...</span>
            </div>
            <el-tag v-else-if="scope.row.environment_status === 1" type="success" size="small">运行中</el-tag>
            <el-tag v-else type="danger" size="small">已停止</el-tag>
          </template>
        </el-table-column>

        <el-table-column align="left" label="操作" width="330">
          <template #default="scope">
            <el-button type="text" @click="edit(scope.row)">编辑</el-button>
            <el-button v-if="scope.row.domain?.length" type="text" @click="shortcut(scope.row)">https配置</el-button>
            <el-button
              v-if="managedAppGroupName(scope.row)"
              type="text"
              @click="appManage(managedAppGroupName(scope.row))"
            >应用管理</el-button>
            <el-popconfirm
              title="确认要删除站点吗？"
              icon="WarningFilled"
              confirm-button-type="danger"
              icon-color="#f53f3f"
              width="180"
              @confirm="del(scope.row)"
            >
              <template #reference>
                <el-button type="text">删除</el-button>
              </template>
              <template #actions="{ confirm, cancel }">
                <div style="text-align: left;">
                  <div>
                    <el-checkbox checked disabled>
                      {{ scope.row.app_group_only ? '删除应用及站点配置' : '删除站点配置' }}
                    </el-checkbox>
                  </div>
                  <div v-if="!scope.row.app_group_only">
                    <el-checkbox v-model="deleteSiteConfig">删除站点文件</el-checkbox>
                  </div>
                </div>
                <el-button size="small" @click="deleteSiteConfig = false; cancel()">取消</el-button>
                <el-button type="primary" size="small" @click="confirm">确认</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-20 df jc-e">
        <el-pagination
          v-model:page-size="paginate"
          :current-page="page"
          :page-count="lastPage"
          :page-sizes="[10, 20, 30, 40]"
          background
          layout="sizes, prev, pager, next"
          @size-change="getData(1)"
          @current-change="getData"
        />
      </div>
    </div>

    <el-dialog
      v-model="visible"
      :title="editId ? '编辑站点' : '添加站点'"
      :width="700"
      :close-on-click-modal="!submitLoading"
      :close-on-press-escape="!submitLoading"
      :show-close="!submitLoading"
    >
      <el-form ref="form" :model="form" label-position="left" label-width="90px">
        <el-form-item
          :rules="[{ required: true, message: '域名不能为空', trigger: 'manual' }]"
          label="域名"
          prop="domain"
        >
          <div style="width: 100%;">
            <el-alert
              style="margin-bottom: 10px;"
              title="添加域名后，请在您持有域名的DNS解析后台添加对应的域名解析记录："
              :description="domainTips"
              type="primary"
              show-icon
              :closable="false"
            />
            <div
              v-for="(item, index) in form.domain"
              :key="index"
              style="display: flex; align-items: center; margin-bottom: 20px;"
            >
              <el-input
                v-model="form.domain[index].domain"
                style="flex: 1; margin-right: 10px;"
                placeholder="请输入域名"
                :disabled="Boolean(editId) && index === 0"
                @change="changeDir"
              >
                <template #prepend>{{ form.domain[index].isSSL ? 'https://' : 'http://' }}</template>
              </el-input>
              <el-checkbox
                v-model="form.domain[index].isSSL"
                label="自动https"
                :disabled="Boolean(editId) && index === 0"
              />
              <div style="flex: 0 0 30px; text-align: center;">
                <el-button
                  v-if="index !== 0"
                  icon="delete"
                  link
                  type="danger"
                  @click="removeDomain(index)"
                />
              </div>
            </div>
            <el-button
              icon="plus"
              type="primary"
              style="background: #fff; color: #0052d9; width: 100%;"
              @click="form.domain.push({ domain: '', isSSL: true })"
            >添加域名</el-button>
          </div>
        </el-form-item>

        <el-form-item
          :rules="[{ required: true, message: '目录不能为空', trigger: 'manual' }]"
          label="目录"
          prop="root_dir"
        >
          <el-input v-model="form.root_dir" disabled>
            <template #prepend>/www/wwwroot/</template>
          </el-input>
        </el-form-item>

        <el-form-item
          :rules="editingAppGroupOnly ? [] : [{ required: true, message: '请选择环境应用', trigger: 'manual' }]"
          label="环境应用"
          prop="environment_app_identifie"
        >
          <el-select
            v-model="form.environment_app_identifie"
            placeholder="请选择环境应用"
            :loading="environmentAppsLoading"
            :disabled="editingAppGroupOnly"
            style="width: 260px;"
            @change="handleEnvironmentAppChange"
          >
            <el-option
              v-for="item in environmentAppOptions"
              :key="item.identifie"
              :label="item.name"
              :value="item.identifie"
            />
          </el-select>
        </el-form-item>

        <el-form-item
          :rules="editingAppGroupOnly ? [] : [{ required: true, message: '请选择环境版本', trigger: 'manual' }]"
          label="环境版本"
          prop="environment_version"
        >
          <el-select
            v-model="form.environment_version"
            :disabled="editingAppGroupOnly || !form.environment_app_identifie"
            placeholder="请选择环境版本"
            style="width: 260px;"
          >
            <el-option
              v-for="version in environmentVersionOptions"
              :key="version"
              :label="version"
              :value="version"
            />
          </el-select>
          <div
            v-if="!editingAppGroupOnly && form.environment_app_identifie && !environmentVersionOptions.length"
            class="environment-version-empty"
          >未获取到可用版本</div>
          <div v-if="editId && environmentChanged" class="environment-change-tip">
            确定后将安装新的环境应用，安装完成后自动卸载旧环境。
          </div>
          <div v-if="editId && activeEnvironment" class="environment-actions">
            <tooltip-button content="环境配置" @click="config(activeEnvironment)">
              <el-icon><Setting /></el-icon>
              <span>环境配置</span>
            </tooltip-button>
            <tooltip-button content="终端命令" @click="terminal(activeEnvironment)">
              <svg
                fill="none"
                stroke="currentColor"
                stroke-width="4"
                viewBox="0 0 48 48"
                aria-hidden="true"
                focusable="false"
                stroke-linecap="butt"
                stroke-linejoin="miter"
              >
                <path d="M23.071 17 16 24.071l7.071 7.071m9.001-14.624-4.14 15.454M9 42h30a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v34a1 1 0 0 0 1 1Z" />
              </svg>
              <span>终端命令</span>
            </tooltip-button>
            <tooltip-button content="查看日志" @click="envLog(activeEnvironment)">
              <el-icon><Document /></el-icon>
              <span>查看日志</span>
            </tooltip-button>
            <tooltip-button content="重启环境" @click="reloadEnvironment(activeEnvironment)">
              <el-icon><RefreshLeft /></el-icon>
              <span>重启环境</span>
            </tooltip-button>
          </div>
        </el-form-item>

        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" :rows="5" type="textarea" />
        </el-form-item>
        <el-form-item>
          <el-button size="large" type="primary" :loading="submitLoading" @click="onSubmit">
            {{ submitLoading ? submitStatusText : '确定' }}
          </el-button>
          <el-button
            v-if="pendingInstallCancel"
            size="large"
            @click="cancelEnvironmentInstall"
          >取消等待</el-button>
        </el-form-item>
      </el-form>
    </el-dialog>
  </div>
</template>

<script>
import myAxios from '@/utils/index'
import panelAxios from '@/utils/panel'
import { ElMessage } from 'element-plus'
import {
  emitWujieEvent,
  envLog,
  getEnvironmentStatus,
  getPods,
  reloadEnvironment,
  terminal
} from './utils'
import TooltipButton from '@/components/TooltipButton'

const ENVIRONMENT_RELEASE_PREFIX = 'site-env-'
const INSTALL_TIMEOUT = 30 * 60 * 1000
const DEPLOYMENT_DISCOVERY_TIMEOUT = 30 * 1000
const DEPLOYMENT_DISCOVERY_INTERVAL = 1000
const APPGROUP_API = '/apis/w7panel.w7.com/v1alpha1'
const MANIFEST_TYPE_ANNOTATION = 'w7.cc/manifest-type'
const DEFAULT_DOMAIN_ANNOTATION = 'w7.cc/default-domain'
const DOMAINS_ANNOTATION = 'w7.cc/domains'
const SITE_REMARK_ANNOTATION = 'w7.cc/site-remark'
const ENVIRONMENT_MANIFEST_TYPE = 'environment'
const PARENT_LABEL = 'w7.cc/parent'
const LEGACY_LIST_PAGE_SIZE = 10000

function getHostProps() {
  if (window.__POWERED_BY_WUJIE__) return window.$wujie?.props || {}
  return window.microData?.cd || {}
}

function isEnvironmentRootApp(group) {
  const metadata = group?.metadata
  return metadata?.annotations?.[MANIFEST_TYPE_ANNOTATION] === ENVIRONMENT_MANIFEST_TYPE
    && !metadata?.labels?.[PARENT_LABEL]
    && !metadata?.deletionTimestamp
}

function appGroupCreationTime(group) {
  const value = group?.metadata?.creationTimestamp
  const timestamp = value ? Date.parse(value) : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

export default {
  name: 'SiteList',
  components: { TooltipButton },
  data() {
    return {
      deleteSiteConfig: false,
      loading: true,
      submitLoading: false,
      submitStatusText: '处理中...',
      environmentAppsLoading: false,
      environmentApps: [],
      environmentAppsPromise: null,
      environmentVersionOptions: [],
      pendingInstallCancel: null,
      allEnvironments: [],
      currentEnvironmentOption: null,
      originalEnvironmentIdentifie: '',
      originalEnvironmentVersion: '',
      activeEnvironment: null,
      editingAppGroupOnly: false,
      form: {
        domain: [],
        root_dir: '',
        remark: '',
        environment_id: '',
        environment_app_identifie: '',
        environment_version: ''
      },
      editId: '',
      visible: false,
      page: 1,
      paginate: 10,
      lastPage: 1,
      tableData: [],
      panelDomainList: [],
      panelData: [],
      domainTips: '',
      environmentStatusTimers: {},
      environmentStatusFetchVersion: 0,
      appGroupAbortController: null,
      appGroupWarningShown: false
    }
  },
  computed: {
    environmentAppOptions() {
      const list = [...this.environmentApps]
      if (this.currentEnvironmentOption && !list.some(item => {
        return this.normalizeIdentifie(item.identifie) === this.normalizeIdentifie(this.currentEnvironmentOption.identifie)
      })) {
        list.push(this.currentEnvironmentOption)
      }
      return list
    },
    environmentChanged() {
      return Boolean(this.editId)
        && (
          this.form.environment_app_identifie !== this.originalEnvironmentIdentifie
          || this.form.environment_version !== this.originalEnvironmentVersion
        )
    },
    selectedEnvironmentApp() {
      return this.findEnvironmentAppByIdentifie(this.form.environment_app_identifie)
    }
  },
  created() {
    this.environmentAppsPromise = this.getEnvironmentApps()
    this.getData(1)
    this.getPanelDomainList()
    this.getDomainTips()
  },
  beforeUnmount() {
    this.pendingInstallCancel?.()
    this.appGroupAbortController?.abort()
    this.clearEnvironmentStatusTimers()
  },
  methods: {
    domainUrl(domain) {
      if (!domain?.domain) return ''
      return (domain.isSSL ? 'https://' : 'http://') + domain.domain
    },
    appManage(appgroup) {
      window.open('/app/appgroup/' + appgroup + '/micro')
    },
    managedAppGroupName(row) {
      return row?.ext?.k8s_app_name
        || row?.environment_app_group_name
        || row?.environment_app_group?.metadata?.name
        || ''
    },
    appGroupIdentifie(appGroup) {
      return appGroup?.spec?.identifie
        || appGroup?.metadata?.annotations?.['w7.cc/identifie']
        || appGroup?.status?.deployInfo?.[0]?.identifie
        || ''
    },
    appGroupResourceName(row, kind) {
      const appGroup = row?.environment_app_group
      const deployInfo = appGroup?.status?.deployInfo || []
      const appIdentifie = this.normalizeIdentifie(this.appGroupIdentifie(appGroup))
      const moduleInfo = deployInfo.find(item => {
        return this.normalizeIdentifie(item?.identifie) === appIdentifie
      })
      const moduleResource = (moduleInfo?.resourcesList || []).find(item => {
        return String(item?.kind || '').toLowerCase() === kind.toLowerCase() && item?.name
      })
      if (moduleResource?.name) return moduleResource.name

      const deployResources = deployInfo.flatMap(item => item?.resourcesList || [])
      const resources = [...deployResources, ...(appGroup?.status?.items || [])]
      return resources.find(item => {
        return String(item?.kind || '').toLowerCase() === kind.toLowerCase() && item?.name
      })?.name || ''
    },
    async listEnvironmentAppGroups(namespace, signal) {
      const props = getHostProps()
      if (typeof props.k8sproxy !== 'function') {
        throw new Error('主面板未注入 k8sproxy，请升级主面板后重试')
      }

      const normalizedNamespace = String(namespace || '').trim()
      if (!normalizedNamespace) throw new Error('namespace 不能为空')

      const path = `${APPGROUP_API}/namespaces/${encodeURIComponent(normalizedNamespace)}/appgroups`
      const response = await props.k8sproxy(path, { method: 'GET', signal })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.message || `获取应用列表失败 (${response.status})`)
      }

      const items = Array.isArray(payload?.items) ? payload.items : []
      return items
        .filter(isEnvironmentRootApp)
        .sort((left, right) => appGroupCreationTime(right) - appGroupCreationTime(left))
    },
    getDomainTips() {
      panelAxios.get('/api/v1/namespaces/default/configmaps/domain-parse').then(res => {
        if (res.data.data.type === 'cname') {
          this.domainTips = '记录类型：cname，记录值：' + res.data.data.cname
        } else {
          this.domainTips = '记录类型：' + res.data.data.type + '，记录值：' + res.data.data.ips
        }
      }).catch(() => {
        this.domainTips = '请将域名解析到当前面板。'
      })
    },
    async getEnvironmentApps() {
      this.environmentAppsLoading = true
      try {
        const response = await myAxios.get('/api/environment/support-list')
        const list = response.data?.data?.list || []
        this.environmentApps = list.map(item => {
          const identifie = item.identifie || item.identify
          return {
            ...item,
            identifie,
            formula_url: item.formula_url || 'https://zpk.w7.cc/zpk/respo/info/' + identifie,
            versions: this.parseEnvironmentVersions(item.versions || item.support_version)
          }
        }).filter(item => item.identifie).sort((a, b) => {
          if (a.name?.toLowerCase() === 'php') return -1
          if (b.name?.toLowerCase() === 'php') return 1
          return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
        })
      } finally {
        this.environmentAppsLoading = false
      }
    },
    parseEnvironmentVersions(value) {
      const values = Array.isArray(value) ? value : String(value || '').split(',')
      return [...new Set(values.map(item => String(item).trim()).filter(Boolean))]
    },
    loadEnvironmentVersions(identifie, preferredVersion = '') {
      const normalizedIdentifie = this.normalizeIdentifie(identifie)
      const environmentApp = this.environmentAppOptions.find(item => {
        return this.normalizeIdentifie(item.identifie) === normalizedIdentifie
      })
      const versions = this.parseEnvironmentVersions(environmentApp?.versions)
      if (preferredVersion && !versions.includes(preferredVersion)) versions.unshift(preferredVersion)
      this.environmentVersionOptions = versions
      this.form.environment_version = preferredVersion
    },
    handleEnvironmentAppChange(identifie) {
      this.form.environment_version = ''
      this.loadEnvironmentVersions(identifie)
    },
    normalizeIdentifie(value) {
      return String(value || '').trim().toLowerCase().replace(/_/g, '-')
    },
    findEnvironmentAppByIdentifie(identifie) {
      const normalizedIdentifie = this.normalizeIdentifie(identifie)
      if (!normalizedIdentifie) return null
      return this.environmentApps.find(item => {
        return [item.identifie, item.identify].some(value => {
          return this.normalizeIdentifie(value) === normalizedIdentifie
        })
      }) || null
    },
    siteRowKey(item) {
      if (item?.id !== undefined && item?.id !== null && item.id !== '') return 'site:' + item.id
      const domains = (item?.domain || []).map(domain => {
        return typeof domain === 'string' ? domain : this.domainUrl(domain)
      }).filter(Boolean).sort()
      return domains.length ? 'domain:' + domains.join(',') : ''
    },
    appGroupEnvironmentStatus(group) {
      if (group?.status?.ready === true) return 1
      const deployStatus = String(group?.status?.deployStatus || '').toLowerCase()
      if (['deployed', 'running', 'ready', 'success', 'succeeded'].includes(deployStatus)) return 1
      if (['deploying', 'installing', 'pending', 'updating', 'progressing'].includes(deployStatus)) return 2
      return 0
    },
    createAppGroupSiteRow(group) {
      const name = group?.metadata?.name || ''
      const defaultDomain = String(
        group?.metadata?.annotations?.[DEFAULT_DOMAIN_ANNOTATION] || ''
      ).trim()
      let domain = []
      let rootDir = ''
      let annotatedDomains = []
      try {
        const parsed = JSON.parse(group?.metadata?.annotations?.[DOMAINS_ANNOTATION] || '[]')
        if (Array.isArray(parsed)) annotatedDomains = parsed
      } catch {
        // Invalid domain annotations fall back to the default domain.
      }
      const domainUrls = [...new Set([defaultDomain, ...annotatedDomains].filter(Boolean))]
      domain = domainUrls.map(value => {
        try {
          const url = new URL(value)
          if (['http:', 'https:'].includes(url.protocol) && url.host) {
            return {
              domain: url.host,
              isSSL: url.protocol === 'https:'
            }
          }
        } catch {
          // Ignore an invalid entry without hiding other valid domains.
        }
        return null
      }).filter(Boolean)
      if (defaultDomain) {
        try {
          rootDir = new URL(defaultDomain).host
        } catch {
          rootDir = domain[0]?.domain || ''
        }
      } else {
        rootDir = domain[0]?.domain || ''
      }
      return {
        id: 'appgroup:' + name,
        domain,
        root_dir: rootDir,
        remark: group?.metadata?.annotations?.[SITE_REMARK_ANNOTATION] || '',
        environment_id: '',
        environment_name: group?.spec?.title || name,
        environment_app_identifie: this.appGroupIdentifie(group),
        environment_app_name: this.appGroupResourceName({ environment_app_group: group }, 'deployment'),
        environment_group: name,
        environment_language: group?.metadata?.annotations?.['w7.cc/image_language'] || '',
        environment_version: '',
        environment_used_num: 0,
        environment_status: this.appGroupEnvironmentStatus(group),
        environment_image_name: '',
        environment_containers: [],
        environment_app_group_name: name,
        environment_app_group: group,
        app_group_only: true,
        ext: {},
        created_at: group?.metadata?.creationTimestamp || ''
      }
    },
    mergeSiteRows(appGroups, legacyRows) {
      const legacyByEnvironmentGroup = new Map()
      legacyRows.forEach(row => {
        const group = this.normalizeIdentifie(row.environment_group)
        if (!group) return
        if (!legacyByEnvironmentGroup.has(group)) legacyByEnvironmentGroup.set(group, [])
        legacyByEnvironmentGroup.get(group).push(row)
      })

      const merged = []
      const includedLegacyRows = new Set()
      appGroups.forEach(appGroup => {
        const appGroupName = appGroup?.metadata?.name || ''
        const matchedRows = legacyByEnvironmentGroup.get(this.normalizeIdentifie(appGroupName)) || []
        if (!matchedRows.length) {
          merged.push(this.createAppGroupSiteRow(appGroup))
          return
        }

        matchedRows.forEach(row => {
          const key = this.siteRowKey(row)
          if (key) includedLegacyRows.add(key)
          merged.push({
            ...row,
            environment_name: row.environment_name || appGroup?.spec?.title || appGroupName,
            environment_app_group_name: appGroupName,
            environment_app_group: appGroup,
            app_group_only: false
          })
        })
      })

      legacyRows.forEach(row => {
        const key = this.siteRowKey(row)
        if (!key || !includedLegacyRows.has(key)) merged.push(row)
      })
      return merged
    },
    getEnvironmentById(id) {
      return this.allEnvironments.find(item => item.id === id) || null
    },
    resolveEnvironmentIdentifie(environment, row, deployment) {
      const metadataAnnotations = deployment?.metadata?.annotations || {}
      const podAnnotations = deployment?.spec?.template?.metadata?.annotations || {}
      const labels = deployment?.metadata?.labels || {}
      const exactCandidates = [
        this.appGroupIdentifie(row?.environment_app_group),
        row?.environment_app_identifie,
        labels['w7.cc/identifie'],
        labels['w7.cc/module-name'],
        metadataAnnotations['w7.cc/identifie'],
        podAnnotations['w7.cc/identifie'],
        environment?.name
      ].filter(Boolean)
      for (const candidate of exactCandidates) {
        const matched = this.environmentApps.find(item => {
          return [item.identifie, item.identify].some(value => {
            return this.normalizeIdentifie(value) === this.normalizeIdentifie(candidate)
          })
        })
        if (matched) return matched.identifie
      }
      if (exactCandidates.length) return exactCandidates[0]

      const title = String(environment?.title || '').trim()
      const versionSuffix = environment?.version ? '-' + environment.version : ''
      const environmentTitle = versionSuffix && title.endsWith(versionSuffix)
        ? title.slice(0, -versionSuffix.length)
        : title
      const titleMatched = this.environmentApps.find(item => {
        return this.normalizeIdentifie(item.name) === this.normalizeIdentifie(environmentTitle)
      })
      return titleMatched?.identifie || 'legacy-environment-' + environment?.id
    },
    clearEnvironmentStatusTimers() {
      Object.values(this.environmentStatusTimers).forEach(timer => clearInterval(timer))
      this.environmentStatusTimers = {}
    },
    updateEnvironmentItem(item, deployment, pods) {
      return {
        ...item,
        environment_status: deployment ? getEnvironmentStatus(deployment, pods) : 0,
        environment_image_name: deployment?.spec?.template?.spec?.containers?.[0]?.image || '',
        environment_containers: deployment?.spec?.template?.spec?.containers || []
      }
    },
    pollEnvironmentStatus(item, fetchVersion) {
      const key = this.siteRowKey(item) || item.environment_app_group_name || item.environment_app_name
      if (!key || this.environmentStatusTimers[key]) return

      const timer = setInterval(async () => {
        const deploymentName = item.environment_app_name?.replace(/_/g, '-')
        const [deploymentRes, podRes] = await Promise.allSettled([
          panelAxios.get('/apis/apps/v1/namespaces/default/deployments/' + deploymentName),
          getPods(deploymentName)
        ])
        if (fetchVersion !== this.environmentStatusFetchVersion) {
          clearInterval(timer)
          delete this.environmentStatusTimers[key]
          return
        }

        const deployment = deploymentRes.status === 'fulfilled' ? deploymentRes.value?.data : null
        const pods = podRes.status === 'fulfilled' ? podRes.value?.data?.items || [] : []
        const status = deployment ? getEnvironmentStatus(deployment, pods) : 0
        if (status === 2) return

        this.tableData = this.tableData.map(row => {
          return this.siteRowKey(row) === this.siteRowKey(item)
            ? this.updateEnvironmentItem(row, deployment, pods)
            : row
        })
        clearInterval(timer)
        delete this.environmentStatusTimers[key]
      }, 3000)
      this.environmentStatusTimers[key] = timer
    },
    async refreshEnvironmentStatuses(data, fetchVersion) {
      const results = await Promise.all(data.map(async item => {
        const deploymentName = item.environment_app_name?.replace(/_/g, '-')
        if (!deploymentName) return item.app_group_only ? item : this.updateEnvironmentItem(item, null, [])
        const [deploymentRes, podRes] = await Promise.allSettled([
          panelAxios.get('/apis/apps/v1/namespaces/default/deployments/' + deploymentName),
          getPods(deploymentName)
        ])
        const deployment = deploymentRes.status === 'fulfilled' ? deploymentRes.value?.data : null
        const pods = podRes.status === 'fulfilled' ? podRes.value?.data?.items || [] : []
        return this.updateEnvironmentItem(item, deployment, pods)
      }))
      if (fetchVersion !== this.environmentStatusFetchVersion) return

      this.tableData = results
      results.filter(item => item.environment_status === 2).forEach(item => {
        this.pollEnvironmentStatus(item, fetchVersion)
      })
    },
    async getData(p, notChangePage) {
      this.clearEnvironmentStatusTimers()
      const fetchVersion = ++this.environmentStatusFetchVersion
      this.appGroupAbortController?.abort()
      this.appGroupAbortController = new AbortController()
      this.loading = true
      if (!notChangePage) this.page = p

      try {
        const appGroupPromise = this.listEnvironmentAppGroups(
          'default',
          this.appGroupAbortController.signal
        ).catch(error => {
          if (error?.name === 'AbortError') throw error
          if (!this.appGroupWarningShown) {
            this.appGroupWarningShown = true
            this.$message.warning(error?.message || '获取环境应用列表失败，已展示旧站点列表')
          }
          return []
        })
        const [siteResponse, environmentResponse, appGroups] = await Promise.all([
          myAxios.post('/api/site/list', {
            page: 1,
            page_size: LEGACY_LIST_PAGE_SIZE
          }),
          myAxios.post('/api/environment/list', {
            page: 1,
            page_size: LEGACY_LIST_PAGE_SIZE
          }),
          appGroupPromise
        ])
        if (fetchVersion !== this.environmentStatusFetchVersion) return

        this.allEnvironments = environmentResponse.data?.data?.list || []
        const data = siteResponse.data?.data?.list || []
        const legacyRows = data.map(item => {
          const environment = this.getEnvironmentById(item.environment_id)
          return {
            ...item,
            environment_group: environment?.group || '',
            environment_language: environment?.language || '',
            environment_version: environment?.version || '',
            environment_used_num: environment?.used_num || 0,
            domain: (item.domain || []).map(domain => ({
              domain: domain.replace(/(http|https):\/\//, ''),
              isSSL: domain.startsWith('https://')
            })),
            environment_status: null,
            environment_image_name: '',
            environment_containers: [],
            environment_app_group_name: '',
            environment_app_group: null,
            app_group_only: false
          }
        })
        const mergedRows = this.mergeSiteRows(appGroups, legacyRows)
        this.lastPage = Math.max(1, Math.ceil(mergedRows.length / this.paginate))
        if (this.page > this.lastPage) this.page = this.lastPage
        const start = (this.page - 1) * this.paginate
        const rows = mergedRows.slice(start, start + this.paginate)
        this.tableData = rows
        await this.refreshEnvironmentStatuses(rows, fetchVersion)
      } catch (error) {
        if (error?.name !== 'AbortError') {
          this.$message.error(error?.response?.data?.error || error?.message || '获取站点列表失败')
        }
      } finally {
        if (fetchVersion === this.environmentStatusFetchVersion) this.loading = false
      }
    },
    environmentFromSite(row) {
      const environment = this.getEnvironmentById(row.environment_id) || {}
      return {
        ...environment,
        id: row.environment_id,
        title: environment.title || row.environment_name,
        app_name: environment.app_name || row.environment_app_name,
        group: environment.group || row.environment_group,
        language: environment.language || row.environment_language,
        version: environment.version || row.environment_version,
        used_num: environment.used_num ?? row.environment_used_num,
        imageName: row.environment_image_name || '',
        containers: row.environment_containers || [],
        status: row.environment_status
      }
    },
    async loadActiveEnvironment(row) {
      const environment = this.environmentFromSite(row)
      const deploymentName = environment.app_name?.replace(/_/g, '-')
      if (!deploymentName) {
        this.activeEnvironment = environment
        return
      }
      const [deploymentRes, podRes] = await Promise.allSettled([
        panelAxios.get('/apis/apps/v1/namespaces/default/deployments/' + deploymentName),
        getPods(deploymentName)
      ])
      const deployment = deploymentRes.status === 'fulfilled' ? deploymentRes.value?.data : null
      const pods = podRes.status === 'fulfilled' ? podRes.value?.data?.items || [] : []
      this.activeEnvironment = {
        ...environment,
        imageName: deployment?.spec?.template?.spec?.containers?.[0]?.image || environment.imageName,
        containers: deployment?.spec?.template?.spec?.containers || environment.containers,
        status: deployment ? getEnvironmentStatus(deployment, pods) : 0
      }
    },
    async getEnvironmentPod(row) {
      const deploymentName = row.app_name?.replace(/_/g, '-')
      const response = await getPods(deploymentName)
      const pods = response.data?.items || []
      const pod = pods.find(item => item.status?.phase === 'Running' && !item.metadata?.deletionTimestamp)
      if (!pod) throw new Error('环境尚未启动')
      return pod
    },
    async terminal(row) {
      try {
        const pod = await this.getEnvironmentPod(row)
        terminal(row.app_name.replace(/_/g, '-'), pod.metadata.name)
      } catch (error) {
        this.$message.warning(error.message)
      }
    },
    async envLog(row) {
      try {
        const pod = await this.getEnvironmentPod(row)
        const containers = pod.spec?.containers || row.containers || []
        const containerName = containers[0]?.name
        if (!containerName) throw new Error('未获取到环境容器')
        envLog(pod.metadata.name, containerName, containers)
      } catch (error) {
        this.$message.warning(error.message)
      }
    },
    reloadEnvironment(row) {
      reloadEnvironment(row.app_name.replace(/_/g, '-')).then(() => {
        this.$message.success('重启成功')
      })
    },
    config(row) {
      if (!row.group || !row.app_name || !row.imageName) {
        this.$message.warning('环境尚未启动，暂时无法配置')
        return
      }
      const imageName = row.imageName.replace(/\//g, 'W7IMAGENAMESLASH')
      emitWujieEvent('openApp', {
        title: '环境配置',
        appgroup: row.group,
        path: '#/' + row.app_name.replace(/_/g, '-') + '/' + imageName + '/' + (row.version || 'latest')
      })
    },
    async toFile(site) {
      try {
        const deploymentName = site.environment_app_name?.replace(/_/g, '-')
          || this.appGroupResourceName(site, 'deployment')
        if (!deploymentName) throw new Error('未获取到环境 Deployment')
        const envData = await panelAxios.get(
          '/apis/apps/v1/namespaces/default/deployments/' + deploymentName
        )
        if (envData?.data?.spec?.replicas <= 0) {
          this.$message.warning('环境未启动')
          return
        }
        emitWujieEvent('openFile', {
          kind: 'deployments',
          appname: deploymentName,
          path: '/www/wwwroot/' + site.root_dir
        })
      } catch {
        this.$message.warning('环境未启动')
      }
    },
    changeDir(value) {
      if (value && !this.form.root_dir) {
        this.form.root_dir = value.split('\n').filter(Boolean)[0]
      }
    },
    shortcut(data) {
      const name = this.panelDomainList.find(item => item.domain === data.domain[0]?.domain)?.name
        || this.appGroupResourceName(data, 'ingress')
      if (!name) {
        this.$message.warning('未获取到该域名对应的 Ingress')
        return
      }
      emitWujieEvent('domainCert', { domainName: name })
    },
    createName(length = 8) {
      const chars = 'abcdefghijklmnopqrstuvwxyz'
      let result = ''
      for (let index = 0; index < length; index += 1) {
        result += chars[Math.floor(Math.random() * chars.length)]
      }
      return result
    },
    domainToName(value) {
      return value.replace(/\*/g, 'x').replace(/(\.|\/|_)/g, '-').toLowerCase()
    },
    getListData(data) {
      this.panelDomainList = data.filter(item => {
        const parent = item?.metadata?.labels?.parents
        return !parent || !data.find(candidate => candidate.metadata.name === parent)
      }).map(item => ({
        name: item.metadata.name,
        domain: item?.spec?.rules?.[0]?.host
      }))
    },
    getPanelDomainList() {
      return panelAxios.get('/apis/networking.k8s.io/v1/namespaces/default/ingresses', {
        loading: true
      }).then(res => {
        this.panelData = res?.data?.items || []
        this.getListData(this.panelData)
      }).catch(() => {})
    },
    makeSSLInfo(data, isSSL) {
      data.metadata.annotations = data.metadata.annotations || {}
      if (!isSSL) {
        delete data.metadata.annotations['higress.io/ssl-redirect']
        delete data.metadata.annotations['w7.cc/ssl-redirect']
        delete data.metadata.annotations['cert-manager.io/cluster-issuer']
        delete data.metadata.annotations['cert-manager.io/renew-before']
        delete data.spec.tls
      } else {
        data.metadata.annotations['higress.io/ssl-redirect'] = 'false'
        data.metadata.annotations['w7.cc/ssl-redirect'] = 'false'
        data.metadata.annotations['cert-manager.io/cluster-issuer'] = 'w7-letsencrypt-prod'
        data.metadata.annotations['cert-manager.io/renew-before'] = '30m'
        data.spec.tls = [{
          hosts: [data.spec.rules[0].host],
          secretName: this.domainToName(data.spec.rules[0].host) + '-tls-secret'
        }]
      }
      return data
    },
    addDomain(domains) {
      const [mainDomain, ...childDomains] = domains
      const group = window.$wujie?.props?.group || window.$wujie?.props?.releaseName
      const backend = {
        service: {
          name: group + '-site-manager-nginx',
          port: { number: 80 }
        }
      }
      let data = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: {
          name: 'ing-' + this.createName(),
          namespace: 'default',
          annotations: {
            'kubernetes.io/ingress.class': 'higress',
            'higress.io/resource-definer': 'higress'
          },
          labels: {
            'higress.io/resource-definer': 'higress',
            app: group + '-site-manager-nginx',
            group
          }
        },
        spec: {
          rules: [{
            host: mainDomain.domain,
            http: { paths: [{ path: '/', pathType: 'Prefix', backend }] }
          }]
        }
      }
      if (childDomains.length) {
        data.metadata.annotations['w7.cc/child-hosts'] = JSON.stringify(childDomains.map(domain => ({
          name: this.createName(),
          host: domain.domain,
          autoSsl: domain.isSSL,
          sslRedirect: false
        })))
      }
      data = this.makeSSLInfo(data, mainDomain.isSSL)
      return panelAxios.post('/apis/networking.k8s.io/v1/namespaces/default/ingresses', data).then(() => {
        this.getPanelDomainList()
      })
    },
    updateDomain(oldDomain, newDomains) {
      let postData = this.panelData.find(item => item?.spec?.rules?.[0]?.host === oldDomain.domain)
      if (!postData) return this.addDomain(newDomains)

      const [mainDomain, ...childDomains] = newDomains
      postData.spec.rules[0].host = mainDomain.domain
      postData = this.makeSSLInfo(postData, mainDomain.isSSL)
      postData.metadata.annotations['w7.cc/child-hosts'] = JSON.stringify(childDomains.map(domain => ({
        name: this.createName(),
        host: domain.domain,
        autoSsl: domain.isSSL,
        sslRedirect: false
      })))
      return panelAxios.put(
        '/apis/networking.k8s.io/v1/namespaces/default/ingresses/' + postData.metadata.name,
        postData
      ).then(() => this.getPanelDomainList())
    },
    async updateAppGroupDomains(row, newDomains) {
      const appgroup = this.managedAppGroupName(row)
      let ingressName = this.appGroupResourceName(row, 'ingress')
      let postData = this.panelData.find(item => item?.metadata?.name === ingressName)
      if (!postData && ingressName) {
        const response = await panelAxios.get(
          '/apis/networking.k8s.io/v1/namespaces/default/ingresses/' + encodeURIComponent(ingressName)
        )
        postData = response.data
      }
      if (!postData && appgroup) {
        const response = await panelAxios.get('/apis/networking.k8s.io/v1/namespaces/default/ingresses', {
          params: { labelSelector: `w7.cc/group-name=${appgroup}` },
          noAlert: true
        })
        postData = (response.data?.items || []).find(item => !item?.metadata?.deletionTimestamp)
        ingressName = postData?.metadata?.name || ''
      }
      if (!postData) {
        ingressName = this.panelDomainList.find(item => {
          return item.domain === row.domain[0]?.domain
        })?.name
        postData = this.panelData.find(item => item?.metadata?.name === ingressName)
      }
      if (!postData) throw new Error('未获取到该站点对应的 Ingress')

      const [mainDomain, ...childDomains] = newDomains
      postData.spec.rules[0].host = mainDomain.domain
      postData = this.makeSSLInfo(postData, mainDomain.isSSL)
      postData.metadata.annotations = postData.metadata.annotations || {}
      postData.metadata.annotations['w7.cc/child-hosts'] = JSON.stringify(childDomains.map(domain => ({
        name: this.createName(),
        host: domain.domain,
        autoSsl: domain.isSSL,
        sslRedirect: false
      })))
      return panelAxios.put(
        '/apis/networking.k8s.io/v1/namespaces/default/ingresses/' + ingressName,
        postData
      ).then(() => this.getPanelDomainList())
    },
    updateAppGroupSiteMetadata(appgroup, domains, remark) {
      if (!appgroup) return Promise.resolve()
      const domainUrls = (domains || []).map(this.domainUrl).filter(Boolean)
      return panelAxios.patch(
        `${APPGROUP_API}/namespaces/default/appgroups/${encodeURIComponent(appgroup)}`,
        {
          metadata: {
            annotations: {
              [DEFAULT_DOMAIN_ANNOTATION]: domainUrls[0] || '',
              [DOMAINS_ANNOTATION]: JSON.stringify(domainUrls),
              [SITE_REMARK_ANNOTATION]: String(remark || '')
            }
          }
        },
        { headers: { 'Content-Type': 'application/merge-patch+json' } }
      )
    },
    appGroupDomains(row) {
      const primaryDomains = JSON.parse(JSON.stringify(row.domain || []))
      const ingressName = this.panelDomainList.find(item => {
        return item.domain === row.domain[0]?.domain
      })?.name || this.appGroupResourceName(row, 'ingress')
      const ingress = this.panelData.find(item => item?.metadata?.name === ingressName)
      const childHostsValue = ingress?.metadata?.annotations?.['w7.cc/child-hosts']
      if (!childHostsValue) return primaryDomains

      try {
        const childHosts = JSON.parse(childHostsValue)
        if (!Array.isArray(childHosts)) return primaryDomains
        return [
          ...primaryDomains,
          ...childHosts.filter(item => item?.host).map(item => ({
            domain: item.host,
            isSSL: item.autoSsl === true
          }))
        ]
      } catch {
        return primaryDomains
      }
    },
    deleteDomain(domain) {
      const name = this.panelDomainList.find(item => item.domain === domain)?.name
      if (!name) return Promise.resolve()
      return panelAxios.delete('/apis/networking.k8s.io/v1/namespaces/default/ingresses/' + name).then(() => {
        this.getPanelDomainList()
      })
    },
    removeDomain(index) {
      this.form.domain.splice(index, 1)
    },
    add() {
      this.editId = ''
      this.editingAppGroupOnly = false
      this.originalEnvironmentIdentifie = ''
      this.originalEnvironmentVersion = ''
      this.currentEnvironmentOption = null
      this.activeEnvironment = null
      this.environmentVersionOptions = []
      this.form = {
        domain: [{ domain: '', isSSL: true }],
        root_dir: '',
        remark: '',
        environment_id: '',
        environment_app_identifie: '',
        environment_version: ''
      }
      this.submitLoading = false
      this.submitStatusText = '处理中...'
      this.visible = true
    },
    async edit(row) {
      if (row.app_group_only) {
        if (this.environmentAppsPromise) await this.environmentAppsPromise.catch(() => {})
        const sourceIdentifie = this.appGroupIdentifie(row.environment_app_group)
        const matchedEnvironmentApp = this.findEnvironmentAppByIdentifie(sourceIdentifie)
        const identifie = matchedEnvironmentApp?.identifie || sourceIdentifie
        const environmentVersion = row.environment_version || ''
        this.editId = row.id
        this.editingAppGroupOnly = true
        this.originalEnvironmentIdentifie = identifie
        this.originalEnvironmentVersion = environmentVersion
        this.currentEnvironmentOption = matchedEnvironmentApp ? null : {
            identifie,
            name: (row.environment_name || identifie || '当前环境') + '（当前）',
            formula_url: ''
          }
        this.activeEnvironment = null
        this.form = {
          domain: this.appGroupDomains(row),
          root_dir: row.root_dir,
          remark: row.remark,
          environment_id: '',
          environment_app_identifie: identifie,
          environment_version: environmentVersion
        }
        this.loadEnvironmentVersions(identifie, environmentVersion)
        this.visible = true
        await this.loadActiveEnvironment(row)
        return
      }
      this.editingAppGroupOnly = false
      if (this.environmentAppsPromise) await this.environmentAppsPromise.catch(() => {})
      const environment = this.getEnvironmentById(row.environment_id)
      let deployment = null
      if (environment?.app_name) {
        deployment = await this.getAppConfig(environment.app_name).catch(() => null)
      }
      const identifie = this.resolveEnvironmentIdentifie(environment, row, deployment)
      const environmentVersion = environment?.version || ''
      this.editId = row.id
      this.originalEnvironmentIdentifie = identifie
      this.originalEnvironmentVersion = environmentVersion
      this.currentEnvironmentOption = this.environmentApps.some(item => {
        return this.normalizeIdentifie(item.identifie) === this.normalizeIdentifie(identifie)
      })
        ? null
        : { identifie, name: (row.environment_name || '当前环境') + '（当前）', formula_url: '' }
      this.form = {
        domain: JSON.parse(JSON.stringify(row.domain)),
        root_dir: row.root_dir,
        remark: row.remark,
        environment_id: row.environment_id,
        environment_app_identifie: identifie,
        environment_version: environmentVersion
      }
      this.visible = true
      this.loadEnvironmentVersions(identifie, environmentVersion)
      await this.loadActiveEnvironment(row)
    },
    getSiteManagerPVCName() {
      const releaseName = window.$wujie?.props?.group || window.$wujie?.props?.releaseName
      return releaseName ? releaseName + '-site-manager' : ''
    },
    createEnvironmentReleaseName() {
      return (ENVIRONMENT_RELEASE_PREFIX + Date.now().toString(36) + '-' + this.createName(4)).slice(0, 63)
    },
    openEnvironmentInstaller(environmentApp, releaseName, domain, version) {
      const hasHandler = typeof window.$wujie?.props?.handles?.openStoreInstall === 'function'
        || typeof window.$wujie?.bus?.$emit === 'function'
      if (!hasHandler) return Promise.reject(new Error('当前面板不支持应用安装弹窗'))

      return new Promise((resolve, reject) => {
        let settled = false
        let timeout = null
        const clearWaiting = () => {
          window.clearTimeout(timeout)
          if (this.pendingInstallCancel === cancelWaiting) this.pendingInstallCancel = null
        }
        const fail = error => {
          if (settled) return
          settled = true
          clearWaiting()
          reject(error)
        }
        const cancelWaiting = () => fail(new Error('已取消等待环境应用安装'))
        const finish = moduleName => {
          if (settled) return
          const installedModuleName = moduleName || environmentApp.identifie
          if (!installedModuleName) {
            fail(new Error('未获取到环境应用标识'))
            return
          }
          settled = true
          clearWaiting()
          resolve(installedModuleName)
        }
        this.pendingInstallCancel = cancelWaiting
        timeout = window.setTimeout(() => {
          fail(new Error('等待环境应用安装超时'))
        }, INSTALL_TIMEOUT)

        try {
          const pvcName = this.getSiteManagerPVCName()
          const opened = emitWujieEvent('openStoreInstall', {
            path: environmentApp.formula_url,
            domain,
            releaseName,
            pvcName,
            startParams: {
              IMAGE_VERSION: version,
              DOMAIN_URL: domain,
              PVC_NAME: pvcName
            }
          }, finish)
          if (opened === false) {
            fail(new Error('环境应用安装弹窗打开失败'))
          }
        } catch (error) {
          fail(error)
        }
      })
    },
    cancelEnvironmentInstall() {
      this.pendingInstallCancel?.()
    },
    waitForDeploymentDiscovery() {
      return new Promise(resolve => window.setTimeout(resolve, DEPLOYMENT_DISCOVERY_INTERVAL))
    },
    async findInstalledDeployment(releaseName, moduleName) {
      const response = await panelAxios.get('/apis/apps/v1/namespaces/default/deployments', {
        params: { labelSelector: `w7.cc/group-name=${releaseName}` },
        noAlert: true
      })
      const normalizedModuleName = this.normalizeIdentifie(moduleName)
      const deployments = (response.data?.items || []).filter(item => {
        return !item?.metadata?.deletionTimestamp
      })
      return deployments.find(item => {
        const labels = item?.metadata?.labels || {}
        const identifie = labels['w7.cc/identifie'] || labels['w7.cc/module-name']
        return this.normalizeIdentifie(identifie) === normalizedModuleName
          && !labels[PARENT_LABEL]
      }) || (deployments.length === 1 ? deployments[0] : null)
    },
    async resolveInstalledDeployment(releaseName, moduleName) {
      const deadline = Date.now() + DEPLOYMENT_DISCOVERY_TIMEOUT
      let deployment = null
      while (!deployment && Date.now() < deadline) {
        deployment = await this.findInstalledDeployment(releaseName, moduleName)
        if (!deployment) await this.waitForDeploymentDiscovery()
      }
      const appName = deployment?.metadata?.name
      if (!appName) throw new Error('安装成功，但未从 Deployments 接口获取到环境应用')

      const appGroupResponse = await panelAxios.get(
        '/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups/' + encodeURIComponent(releaseName)
      )
      const appGroup = appGroupResponse.data || {}
      return { appName, appGroup, deployment }
    },
    getAppConfig(name) {
      return panelAxios.get(
        '/apis/apps/v1/namespaces/default/deployments/' + encodeURIComponent(name)
      ).then(res => res.data)
    },
    async applyEnvironmentVersion(appName, deployment, version) {
      const podAnnotations = deployment?.spec?.template?.metadata?.annotations || {}
      const metadataAnnotations = deployment?.metadata?.annotations || {}
      const annotations = { ...metadataAnnotations, ...podAnnotations }
      const supportedVersions = this.parseEnvironmentVersions(annotations['w7.cc/image_version'])
      if (supportedVersions.length && !supportedVersions.includes(version)) {
        throw new Error('环境应用不支持所选版本 ' + version)
      }

      const imageTemplate = annotations['w7.cc/image_template'] || ''
      if (!imageTemplate.includes('{version}')) {
        throw new Error('所选环境应用缺少镜像版本模板')
      }
      const container = deployment?.spec?.template?.spec?.containers?.[0]
      if (!container?.name) throw new Error('未获取到环境应用容器')

      const image = imageTemplate.split('{version}').join(version)
      if (container.image !== image) {
        await panelAxios.patch(
          '/apis/apps/v1/namespaces/default/deployments/' + encodeURIComponent(appName),
          {
            spec: {
              template: {
                spec: {
                  containers: [{ name: container.name, image }]
                }
              }
            }
          },
          { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } }
        )
        container.image = image
      }
      return deployment
    },
    buildEnvironmentPayload(environmentApp, releaseName, moduleName, appName, deployment, version) {
      const podAnnotations = deployment?.spec?.template?.metadata?.annotations || {}
      const metadataAnnotations = deployment?.metadata?.annotations || {}
      const annotations = { ...metadataAnnotations, ...podAnnotations }
      const nginxTemplate = annotations['w7.cc/nginx_vhost_template'] || ''
      if (!nginxTemplate) throw new Error('所选环境应用缺少 Nginx 配置模板')

      return {
        title: (environmentApp.name || moduleName) + '-' + version,
        language: annotations['w7.cc/image_language'] || environmentApp.name || moduleName,
        group: releaseName,
        version,
        app_name: appName,
        nginx_vhost_template: nginxTemplate
      }
    },
    async deleteAppGroup(name) {
      if (!name) return
      try {
        await panelAxios.delete(
          '/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups/' + name.replace(/_/g, '-')
        )
      } catch (error) {
        if (error?.response?.status !== 404) throw error
      }
    },
    async cleanupFailedEnvironmentInstallation(releaseName, environmentId) {
      if (environmentId) {
        await myAxios.post('/api/environment/delete', { id: environmentId }).catch(() => {})
      }

      let appGroup = null
      try {
        const response = await panelAxios.get(
          '/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups/' + releaseName.replace(/_/g, '-'),
          { noAlert: true }
        )
        appGroup = response.data || null
      } catch (error) {
        // 查询失败时不执行破坏性回滚；404 表示没有需要清理的 AppGroup。
        return
      }

      if (this.appGroupEnvironmentStatus(appGroup) === 1) return
      await this.deleteAppGroup(releaseName).catch(() => {})
    },
    async installEnvironmentApplication(environmentApp, version) {
      if (!environmentApp?.formula_url) throw new Error('请选择有效的环境应用')
      if (!version) throw new Error('请选择环境版本')
      const releaseName = this.createEnvironmentReleaseName()
      let environmentId = 0
      try {
        const moduleName = await this.openEnvironmentInstaller(
          environmentApp,
          releaseName,
          this.domainUrl(this.form.domain[0]),
          version
        )
        const installed = await this.resolveInstalledDeployment(releaseName, moduleName)
        const deployment = await this.applyEnvironmentVersion(
          installed.appName,
          installed.deployment,
          version
        )
        const payload = this.buildEnvironmentPayload(
          environmentApp,
          releaseName,
          moduleName,
          installed.appName,
          deployment,
          version
        )
        await Promise.all([
          this.updateAppGroupSiteMetadata(releaseName, this.form.domain, this.form.remark),
          this.updateAppGroupDomains({
            domain: this.form.domain,
            environment_app_group: installed.appGroup
          }, this.form.domain)
        ])
        const response = await myAxios.post('/api/environment/create', payload)
        environmentId = response.data?.data?.id
        if (!environmentId) throw new Error('环境记录创建失败')
        return { ...payload, id: environmentId, used_num: 0 }
      } catch (error) {
        await this.cleanupFailedEnvironmentInstallation(releaseName, environmentId)
        throw error
      }
    },
    async deleteLegacyEnvironmentResources(environment) {
      const appName = environment.app_name?.replace(/_/g, '-')
      if (!appName) return
      const results = await Promise.allSettled([
        panelAxios.delete('/apis/apps/v1/namespaces/default/deployments/' + appName),
        panelAxios.delete('/api/v1/namespaces/default/services/' + appName + '-lb')
      ])
      const failed = results.find(result => {
        return result.status === 'rejected' && result.reason?.response?.status !== 404
      })
      if (failed) throw failed.reason
    },
    async deleteUnusedLegacyGroup(group) {
      if (!group) return
      const response = await myAxios.post('/api/environment/list', {
        page: 1,
        page_size: 1,
        group
      })
      if (response.data?.data?.total === 0) await this.deleteAppGroup(group)
    },
    async deleteEnvironmentApplication(environment) {
      if (!environment?.id) return
      await myAxios.post('/api/environment/delete', { id: environment.id })
      if (environment.group?.startsWith(ENVIRONMENT_RELEASE_PREFIX)) {
        await this.deleteAppGroup(environment.group)
        return
      }
      await this.deleteLegacyEnvironmentResources(environment)
      await this.deleteUnusedLegacyGroup(environment.group)
    },
    sitePayload(environmentId) {
      return {
        domain: this.form.domain.map(this.domainUrl),
        root_dir: this.form.root_dir,
        remark: this.form.remark,
        environment_id: environmentId
      }
    },
    onSubmit() {
      this.$refs.form.validate(async valid => {
        if (!valid || this.submitLoading) return
        if (this.editingAppGroupOnly) {
          this.submitLoading = true
          this.submitStatusText = '保存中...'
          try {
            const currentRow = this.tableData.find(item => item.id === this.editId)
            if (!currentRow) throw new Error('未找到当前站点')
            await Promise.all([
              this.updateAppGroupDomains(currentRow, this.form.domain),
              this.updateAppGroupSiteMetadata(
                this.managedAppGroupName(currentRow),
                this.form.domain,
                this.form.remark
              )
            ])
            this.$message.success('操作成功')
            this.visible = false
            await this.getData(this.page, true)
            this.reload()
          } catch (error) {
            this.$message.error(error?.response?.data?.error || error?.message || '操作失败')
          } finally {
            this.submitLoading = false
            this.submitStatusText = '处理中...'
          }
          return
        }
        if ((!this.editId || this.environmentChanged) && !this.selectedEnvironmentApp) {
          this.$message.warning('请选择有效的环境应用')
          return
        }

        this.submitLoading = true
        this.submitStatusText = (!this.editId || this.environmentChanged) ? '等待安装环境应用...' : '保存中...'
        const currentRow = this.tableData.find(item => item.id === this.editId)
        const oldEnvironment = currentRow ? this.environmentFromSite(currentRow) : null
        let newEnvironment = null
        let siteSaved = false

        try {
          let environmentId = this.form.environment_id
          if (!this.editId || this.environmentChanged) {
            newEnvironment = await this.installEnvironmentApplication(
              this.selectedEnvironmentApp,
              this.form.environment_version
            )
            environmentId = newEnvironment.id
            this.submitStatusText = '保存站点...'
          }

          if (this.editId) {
            await myAxios.post('/api/site/update', {
              id: this.editId,
              ...this.sitePayload(environmentId)
            })
          } else {
            await myAxios.post('/api/site/create', this.sitePayload(environmentId))
          }
          siteSaved = true

          const appgroup = newEnvironment?.group || currentRow?.environment_app_group_name
          if (appgroup && !newEnvironment) {
            try {
              await this.updateAppGroupSiteMetadata(appgroup, this.form.domain, this.form.remark)
            } catch {
              this.$message.warning('站点已保存，但站点信息同步到 AppGroup 失败')
            }
          }

          if (this.editId && newEnvironment && oldEnvironment && Number(oldEnvironment.used_num || 0) <= 1) {
            this.submitStatusText = '卸载旧环境...'
            try {
              await this.deleteEnvironmentApplication(oldEnvironment)
            } catch {
              this.$message.warning('站点已更新，但旧环境卸载失败，请稍后重试')
            }
          }

          try {
            if (newEnvironment) {
              await this.getPanelDomainList()
            } else if (currentRow?.environment_app_group) {
              await this.updateAppGroupDomains(currentRow, this.form.domain)
            } else if (this.editId) {
              await this.updateDomain(currentRow.domain[0], this.form.domain)
            } else {
              await this.addDomain(this.form.domain)
            }
          } catch {
            this.$message.warning('站点已保存，但域名配置同步失败')
          }

          this.$message.success('操作成功')
          this.visible = false
          await this.getData(this.editId ? this.page : 1, Boolean(this.editId))
          this.reload()
        } catch (error) {
          if (newEnvironment && !siteSaved) {
            // 安装已成功时只撤销未绑定的环境记录，保留用户刚安装的 AppGroup。
            await myAxios.post('/api/environment/delete', { id: newEnvironment.id }).catch(() => {})
          }
          this.$message.error(error?.response?.data?.error || error?.message || '操作失败')
        } finally {
          this.pendingInstallCancel = null
          this.submitLoading = false
          this.submitStatusText = '处理中...'
        }
      })
    },
    reload() {
      const group = window.$wujie?.props?.group || window.$wujie?.props?.releaseName
      return panelAxios.patch('/apis/apps/v1/namespaces/default/deployments/' + group + '-site-manager-nginx', {
        spec: { template: { metadata: { labels: { reload: String(Date.now()) } } } }
      }, {
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' }
      }).catch(() => {})
    },
    getSiteDetail(id) {
      return myAxios.post('/api/site/info', { id })
    },
    async prepareEnvironmentForRootRemoval(environment) {
      if (!environment?.app_name) return
      try {
        const deployment = await this.getAppConfig(environment.app_name)
        deployment.spec.template.spec.containers[0].command = ['sh', '-c', 'tail -f /dev/null']
        await panelAxios.put(
          '/apis/apps/v1/namespaces/default/deployments/' + environment.app_name.replace(/_/g, '-'),
          deployment
        )
      } catch {
        // The backend also performs delayed directory cleanup.
      }
    },
    async del(row) {
      if (row.app_group_only) {
        try {
          const appgroup = this.managedAppGroupName(row)
          if (!appgroup) throw new Error('未获取到 AppGroup 名称')
          await this.deleteAppGroup(appgroup)
          ElMessage({ message: '删除成功', type: 'success' })
          await this.getData(this.page, true)
          this.getPanelDomainList()
        } catch (error) {
          this.$message.error(error?.response?.data?.error || error?.message || '删除失败')
        } finally {
          this.deleteSiteConfig = false
        }
        return
      }

      try {
        const detail = await this.getSiteDetail(row.id)
        const environment = detail.data?.data?.site_environment
        if (this.deleteSiteConfig) await this.prepareEnvironmentForRootRemoval(environment)

        await myAxios.post('/api/site/delete', {
          id: row.id,
          remove_root_dir: this.deleteSiteConfig
        })

        const cleanupTasks = []
        if (row.ext?.k8s_app_name) cleanupTasks.push(this.deleteAppGroup(row.ext.k8s_app_name))
        if (environment && Number(environment.used_num || 0) <= 1) {
          cleanupTasks.push(this.deleteEnvironmentApplication(environment))
        }
        const cleanupResults = await Promise.allSettled(cleanupTasks)
        if (cleanupResults.some(result => result.status === 'rejected')) {
          this.$message.warning('站点已删除，但部分关联应用清理失败')
        } else {
          ElMessage({ message: '删除成功', type: 'success' })
        }

        await this.deleteDomain(row.domain[0]?.domain).catch(() => {})
        this.getData(this.page, true)
        this.reload()
      } catch (error) {
        this.$message.error(error?.response?.data?.error || error?.message || '删除失败')
      } finally {
        this.deleteSiteConfig = false
      }
    }
  }
}
</script>

<style scoped>
.environment-status {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
}

.environment-status.is-loading {
  color: #e6a23c;
}

.environment-change-tip {
  flex: 0 0 100%;
  margin-top: 6px;
  color: #e6a23c;
  font-size: 12px;
  line-height: 20px;
}

.environment-version-empty {
  margin-left: 10px;
  color: #f56c6c;
  font-size: 12px;
}

.environment-actions {
  display: flex;
  align-items: center;
  flex: 0 0 100%;
  margin-top: 10px;
}
</style>
