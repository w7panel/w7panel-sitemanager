<template>
  <div class="app-shell">
    <NginxConfig v-if="route === 'nginx'" />
    <VersionSwitch v-else />
  </div>
</template>

<script>
import NginxConfig from './views/nginx.vue'
import VersionSwitch from './views/version-switch.vue'

function resolveRoute(value) {
  const path = String(value || '')
    .trim()
    .replace(/^#/, '')
    .split('?')[0]
    .replace(/\/+$/, '')
  return path === '/version' ? 'version' : 'nginx'
}

export default {
  name: 'App',
  components: { NginxConfig, VersionSwitch },
  data() {
    return { route: resolveRoute(window.location.hash) }
  },
  mounted() {
    this.onHashChange = () => { this.route = resolveRoute(window.location.hash) }
    this.onWujieRouteChange = route => { this.route = resolveRoute(route) }
    window.addEventListener('hashchange', this.onHashChange)
    window.$wujie?.bus?.$on('routeChange', this.onWujieRouteChange)
  },
  beforeUnmount() {
    window.removeEventListener('hashchange', this.onHashChange)
    window.$wujie?.bus?.$off('routeChange', this.onWujieRouteChange)
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
