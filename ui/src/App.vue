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
  const page = segments[segments.length - 1]
  if (page === 'environment') return '/environment'
  return ['runtime-config', 'version'].includes(page) ? '/runtime-config' : '/nginx'
}

function getInitialRoute() {
  const location = window.$wujie?.location || window.location
  return location.hash || location.pathname || window.location.hash
}

export default {
  name: 'App',
  created() {
    const initialRoute = resolveRoutePath(getInitialRoute())
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
/* Wujie renders inside a transformed, scrollable host. Keep scrolling in the
   application so fixed modal masks cannot be scrolled out of that host. */
:host {
  display: block;
  height: 100%;
  min-height: 0;
}
html,
body,
#nginx {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  margin: 0;
  font-size: 14px;
  color: #1d2129;
  -webkit-font-smoothing: antialiased;
}
.app-shell {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
/* Dialog and MessageBox use different body classes to lock background scroll. */
.el-popup-parent--hidden .app-shell,
.el-message-box-parent--hidden .app-shell {
  overflow: hidden;
}
</style>
