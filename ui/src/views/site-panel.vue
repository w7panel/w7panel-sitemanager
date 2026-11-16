<template>
  <section class="site-panel" v-loading="loading">
    <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon>
      <el-button text @click="load">重试</el-button>
    </el-alert>
    <iframe v-else-if="src" :key="src" ref="frame" :src="src" :title="title" referrerpolicy="no-referrer" @load="loading = false" @error="onError" />
  </section>
</template>
<script>
const TITLES = { files: '文件管理', terminal: '终端命令', logs: '运行日志' }

export default {
  name: 'SitePanel',
  props: { context: { type: Object, required: true } },
  data: () => ({ src: '', error: '', loading: false }),
  computed: {
    view() { return this.$route.meta.sitePanel },
    title() { return TITLES[this.view] || '站点工具' }
  },
  watch: { view: { immediate: true, handler() { this.load() } } },
  methods: {
    load() {
      this.src = ''; this.error = ''; this.loading = true
      try {
        const getUrl = window.$wujie?.props?.getSitePanelUrl
        if (typeof getUrl !== 'function') throw new Error('当前面板暂不支持内置文件管理、终端和日志，请升级面板后重试。')
        const url = new URL(getUrl(this.view))
        const token = new URLSearchParams(url.hash.slice(1)).get('paneltoken')
        if (!token?.trim()) throw new Error('站点工具登录凭据缺失，请刷新面板后重试。')
        this.src = url.href
      } catch (error) { this.error = error.message; this.loading = false }
    },
    onError() { this.error = `${this.title}加载失败，请重试`; this.loading = false },
    async canLeave() {
      if (this.view !== 'files') return true
      try {
        const panel = this.$refs.frame?.contentWindow?.__W7_SITE_PANEL__
        return panel?.canLeave ? await panel.canLeave() : true
      } catch {
        this.$message.error('无法检查文件的保存状态，请刷新面板后重试')
        return false
      }
    }
  }
}
</script>
<style scoped>
.site-panel{height:calc(100vh - 120px);min-height:520px;position:relative}.site-panel iframe{display:block;width:100%;height:100%;border:0;background:#fff}
</style>
