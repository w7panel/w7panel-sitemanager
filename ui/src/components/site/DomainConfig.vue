<template>
  <div class="domains" v-loading="loading">
    <el-alert class="domain-notice" type="info" title="添加域名后，请在您持有域名的DNS解析后台添加对应的域名解析记录：" :closable="false" show-icon />
    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon />
    <template v-for="row in rows" :key="row.key">
      <div class="domain-row">
        <span class="domain-protocol">{{ row.https ? 'https://' : 'http://' }}</span><span class="domain-host">{{ row.host }}</span>
        <el-checkbox :model-value="!!row.auto" :disabled="busy || loading || !!httpsDraft || !!removeRow || !row.editable" :aria-label="`${row.host} 自动HTTPS`" @change="(enabled, event) => toggleHttps(row, enabled, event)">自动HTTPS</el-checkbox>
        <el-button v-if="row.removable" text type="danger" :disabled="busy || loading || !!httpsDraft" @click="removeRow = row">移除</el-button>
      </div>
      <div v-if="httpsDraft?.key === row.key" class="domain-https">
        <el-select v-model="httpsDraft.profileId" :disabled="busy" :teleported="false" placeholder="选择已验证的 DNS 配置" aria-label="泛域名 DNS 配置">
          <el-option v-for="profile in httpsDraft.profiles" :key="profile.id" :label="`${profile.name || profile.provider} · ${profile.zone}`" :value="profile.id" />
        </el-select>
        <p v-if="!httpsDraft.profiles.length" class="domain-help">请先在面板域名管理中验证 DNS 配置，再启用泛域名自动 HTTPS。</p>
        <div><el-button type="primary" :loading="busy" :disabled="!httpsDraft.profileId" @click="confirmHttps">启用自动HTTPS</el-button><el-button :disabled="busy" @click="httpsDraft = null">取消</el-button></div>
      </div>
    </template>
    <div v-if="removeRow" class="domain-confirm" role="alert">确定移除 {{ removeRow.host }}？
      <el-button :loading="busy" type="danger" @click="remove">确认移除</el-button><el-button :disabled="busy" @click="removeRow = null">取消</el-button>
    </div>
    <el-button v-if="!form" class="domain-add" :disabled="busy || loading || !!httpsDraft" @click="add">＋ 添加域名</el-button>
    <el-button v-if="!form" text :disabled="busy || loading || !!httpsDraft" @click="load">刷新域名</el-button>
    <div v-else class="domain-form">
      <div class="domain-entry">
        <el-input v-model="form.host" :disabled="!!form.ingress || busy" :spellcheck="false" placeholder="例如 www.example.com" aria-label="域名">
          <template #prepend>{{ form.autoHttps ? 'https://' : 'http://' }}</template>
        </el-input>
        <el-checkbox v-model="form.autoHttps" :disabled="busy">自动HTTPS</el-checkbox>
      </div>
      <el-select v-if="!form.ingress && !context.gatewayEnabled && backendPorts.length > 1" v-model="form.backendPort" :teleported="false" placeholder="选择 HTTP 服务端口" aria-label="转发端口">
        <el-option v-for="port in backendPorts" :key="port.port" :value="port.port" :label="`${port.name || 'TCP'} · ${port.port}`" />
      </el-select>
      <el-select v-if="form.autoHttps && form.host.startsWith('*.' )" v-model="form.profileId" :teleported="false" placeholder="选择已验证的 DNS 配置" aria-label="泛域名 DNS 配置">
        <el-option v-for="profile in matchingProfiles" :key="profile.id" :label="`${profile.name || profile.provider} · ${profile.zone}`" :value="profile.id" />
      </el-select>
      <p v-if="form.autoHttps && form.host.startsWith('*.') && !matchingProfiles.length" class="domain-help">请先在面板域名管理中验证 DNS 配置，再启用泛域名自动 HTTPS。</p>
      <p v-if="whiteList.length" class="domain-help">可使用的域名范围：{{ whiteList.map(item => item.domain).join('、') }}</p>
      <div><el-button type="primary" :loading="busy" @click="save">保存域名</el-button><el-button :disabled="busy" @click="form = null">取消</el-button></div>
    </div>
  </div>
</template>
<script>
import { normalizeDomain, ingressApi, domainIngress, domainHttpsState, setAutoHttps, nginxDomainChange, SITE_DOMAIN } from '@/utils/site-domain'
import { loadSiteContext } from '@/utils/site-context'
import panelAxios from '@/utils/panel'
export default {
  props: { context: { type: Object, required: true } },
  data: () => ({ loading: false, busy: false, error: '', ingresses: [],
    classes: [], profiles: [], whiteList: [], optionsReady: false, form: null, removeRow: null, httpsDraft: null }),
  computed: {
    rows() {
      const rows = [], services = [this.context.application.metadata.name, this.context.tool?.metadata?.name].filter(Boolean)
      for (const ingress of this.ingresses) {
        for (const rule of ingress.spec?.rules || []) {
          if (!rule.host || !rule.http?.paths?.some(path => services.includes(path.backend?.service?.name))) continue
          const { auto, https, simple, editable } = domainHttpsState(ingress, rule.host)
          rows.push({ key: `${ingress.metadata.name}/${rule.host}`, host: rule.host, ingress, https, auto, editable,
            removable: simple && rule.host !== this.context.hostname && ingress.metadata.annotations?.[SITE_DOMAIN] === this.context.group })
        }
      }
      if (!rows.some(row => row.host === this.context.hostname)) rows.unshift({ key: 'default', host: this.context.hostname, https: false })
      return [
        ...rows.filter(row => row.host === this.context.hostname),
        ...rows.filter(row => row.host !== this.context.hostname)
      ]
    },
    backendPorts() { return (this.context.service?.spec?.ports || []).filter(port => (port.protocol || 'TCP') === 'TCP') },
    matchingProfiles() { const host = this.form?.host.replace(/^\*\./, '').toLowerCase() || ''; return this.profiles.filter(item => host === item.zone || host.endsWith('.' + item.zone)) }
  },
  mounted() { this.load() },
  methods: {
    async load() {
      this.loading = true; this.error = ''
      try {
        this.ingresses = (await panelAxios.get(ingressApi(this.context.namespace))).data?.items || []
      } catch (error) { this.error = error.response?.data?.message || error.message }
      finally { this.loading = false }
    },
    async loadOptions() {
      this.optionsReady = false
      const response = await panelAxios.get('/panel-api/v1/auth/domain-white-list')
      const data = response.data?.code === 200 ? response.data.data : response.data
      if (!Array.isArray(data)) throw new Error('域名范围读取失败，请刷新重试')
      this.whiteList = data.filter(item => !item.disabled)
      this.classes = (await panelAxios.get('/apis/networking.k8s.io/v1/ingressclasses')).data?.items?.map(item => item.metadata.name) || []
      try { this.profiles = (await panelAxios.get('/panel-api/v1/dns-profiles')).data || [] } catch { this.profiles = [] }
      this.optionsReady = true
    },
    async add() {
      this.loading = true; this.error = ''
      try { await this.loadOptions(); this.form = { host: '', autoHttps: false, ingressClass: this.classes[0] || '', profileId: '', backendPort: this.backendPorts.length === 1 ? this.backendPorts[0].port : '' } }
      catch (error) { this.error = error.message }
      finally { this.loading = false }
    },
    async toggleHttps(row, enabled, event) {
      // 服务端确认前保留原值，失败或等待 DNS 配置时也能继续操作。
      if (event?.target?.type === 'checkbox') event.target.checked = !!row?.auto
      enabled = !!enabled
      if (this.busy || this.loading || this.httpsDraft || this.removeRow || !row?.editable || !row.ingress || enabled === !!row.auto) return
      const draft = { key: row.key, host: row.host, ingress: row.ingress, autoHttps: enabled,
        profileId: row.ingress.metadata.annotations?.['w7.cc/dns-profile'] || '' }
      if (enabled && row.host.startsWith('*.') && !draft.profileId) {
        this.busy = true; this.error = ''
        try {
          const profiles = (await panelAxios.get('/panel-api/v1/dns-profiles')).data
          if (!Array.isArray(profiles)) throw new Error('DNS 配置读取失败，请刷新重试')
          const host = row.host.slice(2).toLowerCase().replace(/\.$/, '')
          const matches = profiles.filter(profile => {
            const zone = String(profile.zone || '').toLowerCase().replace(/\.$/, '')
            return zone && (host === zone || host.endsWith('.' + zone))
          })
          if (matches.length === 1) draft.profileId = matches[0].id
          else { this.httpsDraft = { ...draft, profiles: matches }; return }
        } catch (error) { this.error = error.response?.data?.message || error.message; return }
        finally { this.busy = false }
      }
      return this.updateHttps(draft)
    },
    async confirmHttps() {
      if (!this.httpsDraft?.profileId) return
      return this.updateHttps(this.httpsDraft)
    },
    async updateHttps(draft) {
      if (this.busy || this.loading || !draft?.ingress) return false
      this.busy = true; this.error = ''
      try {
        const original = draft.ingress.metadata
        const url = `${ingressApi(this.context.namespace)}/${encodeURIComponent(original.name)}`
        const current = (await panelAxios.get(url)).data
        if (!current || current.metadata.uid !== original.uid || current.metadata.resourceVersion !== original.resourceVersion)
          throw new Error('域名已被其他操作修改，请刷新后重试')
        const ingress = setAutoHttps(current, draft.autoHttps)
        if (draft.autoHttps && draft.host.startsWith('*.')) {
          if (!draft.profileId) throw new Error('请选择已验证的泛域名 DNS 配置')
          const grant = (await panelAxios.post(`/panel-api/v1/dns-profiles/${encodeURIComponent(draft.profileId)}/grant`, {
            namespace: this.context.namespace, name: original.name, host: draft.host
          })).data
          if (!grant?.['w7.cc/dns-grant']) throw new Error('DNS 签发授权失败')
          Object.assign(ingress.metadata.annotations, grant)
        }
        const saved = (await panelAxios.put(url, ingress)).data
        this.ingresses = this.ingresses.map(item => item.metadata.name === original.name ? (saved?.metadata ? saved : ingress) : item)
        if (this.httpsDraft === draft) this.httpsDraft = null
        this.$message.success(draft.autoHttps ? '自动HTTPS已启用' : '自动HTTPS已关闭')
        return true
      } catch (error) { this.error = error.response?.data?.message || error.message; return false }
      finally { this.busy = false }
    },
    async save() {
      if (this.busy || !this.optionsReady) return
      this.busy = true; this.error = ''; let undoNginx = null, submitted = false
      try {
        const form = this.form, host = normalizeDomain(form.host)
        const context = await loadSiteContext()
        if (!form.ingress && this.whiteList.length && !this.whiteList.some(item => host.endsWith('.' + item.domain))) throw new Error('该域名不在当前可绑定范围内')
        if (!form.ingress && !form.ingressClass) throw new Error('未发现可用入口网关，请联系管理员检查')
        const all = (await panelAxios.get(ingressApi(context.namespace))).data?.items || []
        if (!form.ingress && all.some(item => item.spec?.rules?.some(rule => rule.host === host))) throw new Error('该域名已经存在，请使用已有域名配置')
        let ingress
        if (form.ingress) {
          ingress = all.find(item => item.metadata.name === form.ingress.metadata.name)
          if (!ingress || ingress.metadata.resourceVersion !== form.ingress.metadata.resourceVersion) throw new Error('域名已被其他操作修改，请刷新重试')
          ingress = setAutoHttps(ingress, form.autoHttps)
        } else ingress = domainIngress(context, { ...form, host }, `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
        if (form.autoHttps && host.startsWith('*.')) {
          if (!form.profileId) throw new Error('请选择已验证的泛域名 DNS 配置')
          const grant = (await panelAxios.post(`/panel-api/v1/dns-profiles/${encodeURIComponent(form.profileId)}/grant`, {
            namespace: context.namespace, name: ingress.metadata.name, host
          })).data
          if (!grant?.['w7.cc/dns-grant']) throw new Error('DNS 签发授权失败')
          Object.assign(ingress.metadata.annotations, grant)
        }
        if (!form.ingress) undoNginx = await nginxDomainChange(context, host)
        if (form.ingress) await panelAxios.put(`${ingressApi(context.namespace)}/${encodeURIComponent(ingress.metadata.name)}`, ingress)
        else await panelAxios.post(ingressApi(context.namespace), ingress)
        submitted = true; this.form = null; this.$message.success('域名已保存'); await this.load()
      } catch (error) {
        this.error = error.response?.data?.message || error.message
        if (undoNginx && !submitted) {
          // A transport error may occur after the Ingress was accepted. Re-read before compensating.
          try {
            const current = (await panelAxios.get(ingressApi(this.context.namespace))).data?.items || []
            if (current.some(item => item.spec?.rules?.some(rule => rule.host === this.form?.host))) this.error += '；域名可能已提交，请刷新检查'
            else await undoNginx()
          } catch { this.error += '；网关配置可能已更新，请检查后重试' }
        }
      } finally { this.busy = false }
    },
    async remove() {
      if (this.busy || !this.removeRow?.removable) return
      this.busy = true; this.error = ''
      try {
        const row = this.removeRow
        await panelAxios.delete(`${ingressApi(this.context.namespace)}/${encodeURIComponent(row.ingress.metadata.name)}`, {
          data: { apiVersion: 'v1', kind: 'DeleteOptions', preconditions: { uid: row.ingress.metadata.uid, resourceVersion: row.ingress.metadata.resourceVersion } }
        })
        this.removeRow = null
        // Extra server_name entries do not route traffic after the Ingress is removed.
        // Preserve custom Nginx content rather than risk removing a still-referenced alias.
        this.$message.success('域名已移除'); await this.load()
      } catch (error) { this.error = error.response?.data?.message || error.message }
      finally { this.busy = false }
    },
    hasDraft() { return !!this.form || !!this.httpsDraft || this.busy }
  }
}
</script>
<style scoped>
.domains{display:grid;gap:14px}.domain-notice.el-alert{--el-alert-bg-color:#ecf5ff;color:#1d2129}.domain-notice :deep(.el-alert__icon){color:#0052d9}.domain-row{display:flex;align-items:center;gap:12px;min-height:44px;border:1px solid #dcdfe6;border-radius:4px;padding:0 12px;flex-wrap:wrap}.domain-row>.el-checkbox{flex-shrink:0;margin-right:0}.domain-protocol{color:#86909c}.domain-host{flex:1;overflow-wrap:anywhere}.domain-help{font-size:12px;color:#86909c}.domain-add{width:100%;color:#0052d9}.domain-form,.domain-https{display:grid;gap:14px}.domain-entry{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.domain-entry>.el-input{flex:1 1 240px;min-width:0}.domain-entry>.el-checkbox{flex-shrink:0;margin-right:0}.domain-confirm{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px;background:#fff7e6}
</style>
