import { createRouter, createWebHashHistory } from 'vue-router'
import NginxConfig from '@/views/nginx.vue'
import RuntimeConfig from '@/views/runtime-config.vue'
import SiteConfig from '@/views/site-config.vue'
import SitePanel from '@/views/site-panel.vue'

const EnvironmentConfig = () => import('@/views/environment.vue')

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/site/basic'
    },
    {
      path: '/nginx',
      redirect: '/site/gateway'
    },
    {
      path: '/version',
      redirect: '/site/basic'
    },
    { path: '/files', redirect: '/site/files' },
    {
      path: '/site', component: SiteConfig, redirect: '/site/basic',
      children: [
        { path: 'basic', name: 'site-basic', component: RuntimeConfig },
        { path: 'gateway', name: 'site-gateway', component: NginxConfig },
        { path: 'files', name: 'site-files', component: SitePanel, meta: { sitePanel: 'files' } },
        { path: 'terminal', name: 'site-terminal', component: SitePanel, meta: { sitePanel: 'terminal' } },
        { path: 'logs', name: 'site-logs', component: SitePanel, meta: { sitePanel: 'logs' } }
      ]
    },
    {
      path: '/environment',
      name: 'environment',
      component: EnvironmentConfig
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/site/basic'
    }
  ]
})

export default router
