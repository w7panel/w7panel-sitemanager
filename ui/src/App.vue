<template>
  <div class="app-shell">
    <NginxConfig v-if="route === 'nginx'" />
    <VersionSwitch v-else />
  </div>
</template>

<script>
import NginxConfig from './views/nginx.vue'
import VersionSwitch from './views/version-switch.vue'

export default {
  name: 'App',
  components: { NginxConfig, VersionSwitch },
  data() {
    return { route: window.location.hash === '#version' ? 'version' : 'nginx' }
  },
  mounted() {
    this.onHashChange = () => { this.route = window.location.hash === '#version' ? 'version' : 'nginx' }
    window.addEventListener('hashchange', this.onHashChange)
  },
  beforeUnmount() {
    window.removeEventListener('hashchange', this.onHashChange)
  }
}
</script>

<style>
html,
body,
#nginx {
  width: 100%;
  min-height: 100%;
  margin: 0;
  font-size: 14px;
  color: #1d2129;
  background: #f2f3f5;
  -webkit-font-smoothing: antialiased;
}
.app-shell { min-height: 100vh; }
</style>
