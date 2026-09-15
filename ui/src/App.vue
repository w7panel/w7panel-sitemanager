<template>
  <div class="app-shell">
    <router-view />
  </div>
</template>

<script>
function resolveRoutePath(value) {
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
  return segments[segments.length - 1] === 'version' ? '/version' : '/nginx'
}

export default {
  name: 'App',
  created() {
    const initialRoute = resolveRoutePath(window.location.hash)
    if (this.$route.path !== initialRoute) this.$router.replace(initialRoute)
    window.$wujie?.bus?.$on('routeChange', this.handleWujieRouteChange)
  },
  beforeUnmount() {
    window.$wujie?.bus?.$off('routeChange', this.handleWujieRouteChange)
  },
  methods: {
    handleWujieRouteChange(route) {
      const target = resolveRoutePath(route)
      if (this.$route.path !== target) this.$router.push(target)
    }
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
