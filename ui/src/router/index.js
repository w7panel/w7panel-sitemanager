import { createRouter, createWebHashHistory } from 'vue-router'
import NginxConfig from '@/views/nginx.vue'
import RuntimeConfig from '@/views/runtime-config.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/nginx'
    },
    {
      path: '/nginx',
      name: 'nginx',
      component: NginxConfig
    },
    {
      path: '/runtime-config',
      name: 'runtime-config',
      component: RuntimeConfig
    },
    {
      path: '/version',
      redirect: '/runtime-config'
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/nginx'
    }
  ]
})

export default router
