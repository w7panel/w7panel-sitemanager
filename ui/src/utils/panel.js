import axios from 'axios'

const panelAxios = axios.create({
  baseURL: '',
  timeout: 900000
})

function getPanelToken() {
  return window.$wujie?.props?.paneltoken || localStorage.getItem('X-W7Panel-Token') || ''
}

export function getPanelNamespace() {
  return window.$wujie?.props?.namespace || 'default'
}

panelAxios.interceptors.request.use(config => {
  config.headers = config.headers || {}
  config.headers.Authorization = `Bearer ${getPanelToken()}`
  if (
    config.url.includes('/apps/v1')
    || config.url.includes('/apis/batch/v1')
    || config.url.includes('/apis/networking.k8s.io/')
    || config.url.includes('/apis/w7panel.w7.com')
    || config.url.includes('/apis/cert-manager.io/')
    || config.url.includes('/api/v1')
  ) {
    // Older tool pages use default in their API constants. Scope those requests
    // to the namespace supplied by the panel, including exec requests below.
    config.url = config.url.replace('/namespaces/default/', `/namespaces/${encodeURIComponent(getPanelNamespace())}/`)
    config.url = '/k8s-proxy' + config.url
  }
  return config
})

panelAxios.exec = function (containerName, podName, shell) {
  return panelAxios.post('/panel-api/v1/exec2', {
    podName,
    containerName,
    tty: false,
    namespace: getPanelNamespace(),
    command: ['sh', '-c', shell]
  })
}

panelAxios.execall = function (containerName, PodNames, shell) {
  return panelAxios.post('/panel-api/v1/exec-all', {
    PodNames,
    containerName,
    tty: false,
    namespace: getPanelNamespace(),
    command: ['sh', '-c', shell]
  })
}

export default panelAxios
