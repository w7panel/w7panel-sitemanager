import { createRouter, createWebHashHistory } from 'vue-router'
import NginxConfig from '@/views/nginx.vue'
import VersionSwitch from '@/views/version-switch.vue'

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
      path: '/version',
      name: 'version',
      component: VersionSwitch
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/nginx'
    }
  ]
})

export default router
