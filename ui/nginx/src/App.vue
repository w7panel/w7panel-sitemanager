<template>
  <NginxConfig />
</template>

<script>
import NginxConfig from './views/nginx.vue'

export default {
  name: 'App',
  components: { NginxConfig }
}
</script>

<style>
html,
body,
#nginx {
  min-height: 100%;
  margin: 0;
}
</style>
