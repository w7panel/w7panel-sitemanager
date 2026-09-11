import axios from 'axios'

const panelAxios = axios.create({
  baseURL: '',
  timeout: 900000
})

function getPanelToken() {
  return window.$wujie?.props?.paneltoken || localStorage.getItem('X-W7Panel-Token') || ''
}

panelAxios.interceptors.request.use(config => {
  config.headers = config.headers || {}
  config.headers.Authorization = `Bearer ${getPanelToken()}`
  if (
    config.url.includes('/apps/v1')
    || config.url.includes('/apis/w7panel.w7.com')
    || config.url.includes('/api/v1')
  ) {
    config.url = '/k8s-proxy' + config.url
  }
  return config
})

panelAxios.exec = function (containerName, podName, shell) {
  return panelAxios.post('/panel-api/v1/exec2', {
    podName,
    containerName,
    tty: false,
    namespace: 'default',
    command: ['sh', '-c', shell]
  })
}

export default panelAxios
