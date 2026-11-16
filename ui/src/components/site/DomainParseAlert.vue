<template>
  <el-alert v-if="error" class="domain-notice" type="warning" title="域名解析记录读取失败" :closable="false" show-icon>
    <span>{{ error }}</span><el-button text :loading="loading" @click="load">重试</el-button>
  </el-alert>
  <el-alert v-else-if="domainParse && !domainParse.configured" class="domain-notice" type="warning" title="系统尚未配置域名解析记录，请联系管理员获取。" :closable="false" show-icon />
  <el-alert v-else-if="domainParse" class="domain-notice" type="info" title="添加域名后，请在您持有域名的DNS解析后台添加对应的域名解析记录：" :closable="false" show-icon>
    <span>记录类型：{{ domainParse.type }}，记录值：{{ domainParse.value }}</span>
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
.domain-notice.el-alert--info{--el-alert-bg-color:#ecf5ff;color:#1d2129}.domain-notice.el-alert--info :deep(.el-alert__icon){color:#0052d9}
</style>
