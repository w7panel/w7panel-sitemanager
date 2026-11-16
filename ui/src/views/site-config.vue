<template>
  <main class="site-page" v-loading="loading">
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon><el-button @click="load">重试</el-button></el-alert>
    <template v-if="context">
      <nav class="site-navigation" aria-label="站点配置">
        <router-link to="/site/basic">基础配置</router-link>
        <router-link v-if="context.gatewayAvailable" to="/site/gateway">网关配置</router-link>
        <router-link to="/site/files">文件管理</router-link>
        <router-link to="/site/terminal">终端命令</router-link>
        <router-link to="/site/logs">运行日志</router-link>
      </nav>
      <div class="site-content">
        <router-view v-slot="{ Component }"><component :is="Component" :key="$route.name" ref="page" :context="context" @refresh="load" /></router-view>
      </div>
    </template>
  </main>
</template>
<script>
import { loadSiteContext } from '@/utils/site-context'
export default {
  name: 'SiteConfig',
  data: () => ({ context: null, loading: false, error: '' }),
  created() {
    this.unregisterFileLeaveGuard = window.$wujie?.props?.registerSiteFileLeaveGuard?.(() => this.canLeave())
    this.load()
  },
  beforeUnmount() { this.unregisterFileLeaveGuard?.() },
  beforeRouteUpdate() { return this.canLeave() },
  beforeRouteLeave() { return this.canLeave() },
  methods: {
    async canLeave() { return this.$refs.page?.canLeave ? this.$refs.page.canLeave() : true },
    async load() {
      this.loading = true; this.error = ''
      try {
        this.context = await loadSiteContext()
      }
      catch (error) { this.error = error.response?.data?.message || error.message }
      finally { this.loading = false }
    }
  }
}
</script>
<style scoped>
.site-page{--el-color-primary:#0052d9;display:flex;box-sizing:border-box;min-height:100%;padding:24px 0;background:#fff;color:#1d2129}.site-navigation{display:flex;flex-direction:column;width:140px;flex-shrink:0;border-right:1px solid #e5e6eb}.site-navigation a{box-sizing:border-box;display:block;padding:17px 22px;border:0;background:transparent;font:inherit;line-height:20px;color:#4e5969;cursor:pointer;text-decoration:none;border-right:3px solid transparent;text-align:center}.site-navigation a.router-link-active{color:#0052d9;border-color:#0052d9;background:#f7faff}.site-content{padding:0 28px;min-width:0;flex:1}@media(max-width:760px){.site-page{flex-direction:column}.site-navigation{flex-direction:row;flex-wrap:wrap;width:auto;border-right:0;border-bottom:1px solid #e5e6eb}.site-navigation a{border-right:0;border-bottom:3px solid transparent;padding:14px}.site-content{padding:24px 16px}}
</style>
