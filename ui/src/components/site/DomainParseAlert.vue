<template>
  <el-alert v-if="error" class="domain-notice domain-notice--with-title" type="warning" title="域名解析记录读取失败" :closable="false" show-icon>
    <span>{{ error }}</span><el-button text :loading="loading" @click="load">重试</el-button>
  </el-alert>
  <el-alert v-else-if="domainParse && !domainParse.configured" class="domain-notice" type="warning" :closable="false" show-icon>系统尚未配置域名解析记录，请联系管理员获取。</el-alert>
  <el-alert v-else-if="domainParse" class="domain-notice domain-notice--with-title" type="info" title="添加域名后，请在您持有域名的DNS解析后台添加对应的域名解析记录：" :closable="false" show-icon>
    <span>记录类型：</span>
    <span>{{ domainParse.type }}，</span>
    <span>记录值：</span>
    <span>{{ domainParse.value }}</span>
    <span v-if="domainParse.multipleIps">（IP任选一个，解析功能支持也可添加多条记录）</span>
  </el-alert>
</template>
<script>
import panelAxios from '@/utils/panel'

export default {
  name: 'DomainParseAlert',
  data: () => ({ domainParse: null, error: '', loading: false }),
  created() { this.load() },
  methods: {
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        const { data } = await panelAxios.get('/panel-api/v1/domain-parse')
        const spec = data?.spec || {}
        const ips = (Array.isArray(spec.ips) ? spec.ips : [])
          .filter(ip => typeof ip === 'string' && ip.trim()).map(ip => ip.trim())
        const type = spec.type || 'A'
        this.domainParse = {
          type,
          configured: type === 'A' ? ips.length > 0 : !!spec.cname,
          value: type === 'A' ? ips.join(',') : spec.cname || '',
          multipleIps: type === 'A' && ips.length > 1
        }
      } catch (error) {
        if (error.response?.status === 404) this.domainParse = { configured: false }
        else this.error = error.response?.data?.message || error.message
      } finally { this.loading = false }
    }
  }
}
</script>
<style scoped>
.domain-notice.el-alert {
  --el-alert-padding: 8px 15px;
  --el-alert-border-radius-base: var(--border-radius-small, 2px);
  --el-alert-icon-size: 16px;
  --el-alert-icon-large-size: 16px;
  border: 1px solid transparent;
  font-size: 14px;
  line-height: 1.5715;
  text-align: left;
}
.domain-notice--with-title.el-alert {
  --el-alert-padding: 15px;
  --el-alert-icon-large-size: 18px;
  align-items: flex-start;
}
.domain-notice.el-alert--info { --el-alert-bg-color: var(--color-primary-light-1, #e8f3ff); }
.domain-notice.el-alert--warning { --el-alert-bg-color: var(--color-warning-light-1, #fff7e8); }
.domain-notice.el-alert.is-light { color: var(--color-text-1, #1d2129); }
.domain-notice :deep(.el-alert__content) { flex: 1; min-width: 0; }
.domain-notice :deep(.el-alert__title) { font-size: 16px; font-weight: 500; line-height: 1.5; }
.domain-notice.el-alert.is-light :deep(.el-alert__description) { color: var(--color-text-1, #1d2129); line-height: 1.5715; }
.domain-notice--with-title.el-alert.is-light :deep(.el-alert__description) { color: var(--color-text-2, #4e5969); }
.domain-notice.el-alert :deep(.el-alert__icon) { flex-shrink: 0; margin-right: 8px; }
.domain-notice--with-title :deep(.el-alert__icon) { margin-top: 3px; }
.domain-notice.el-alert--info :deep(.el-alert__icon) { color: rgb(var(--primary-6, 22, 93, 255)); }
.domain-notice.el-alert--warning :deep(.el-alert__icon) { color: rgb(var(--warning-6, 255, 125, 0)); }
</style>
