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
  let path = String(value || '').trim()
  try {
    path = decodeURIComponent(path)
  } catch {
    // Keep malformed encoded routes usable as plain strings.
  }
  const hashIndex = path.lastIndexOf('#')
  if (hashIndex >= 0) path = path.slice(hashIndex + 1)
  path = path.split('?')[0].replace(/^\/+|\/+$/g, '')
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] === 'version' ? 'version' : 'nginx'
}

export default {
  name: 'App',
  components: { NginxConfig, VersionSwitch },
  data() {
    return {
      route: resolveRoute(window.location.hash),
      onHashChange: null,
      onWujieRouteChange: null
    }
  },
  created() {
    this.onWujieRouteChange = route => { this.route = resolveRoute(route) }
    window.$wujie?.bus?.$on('routeChange', this.onWujieRouteChange)
  },
  mounted() {
    this.onHashChange = () => { this.route = resolveRoute(window.location.hash) }
    window.addEventListener('hashchange', this.onHashChange)
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
