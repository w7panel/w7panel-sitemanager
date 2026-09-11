import { createApp } from 'vue'
import { ElButton, ElLoading, ElMessage } from 'element-plus'
import App from './App.vue'
import './assets/css/element-plus.css'

if (window.__POWERED_BY_WUJIE__) {
  window.__webpack_public_path__ = window.__WUJIE_PUBLIC_PATH__
}

let app = null

function createNginxApp() {
  const nextApp = createApp(App)
  nextApp.use(ElButton)
  nextApp.use(ElLoading)
  nextApp.config.globalProperties.$message = ElMessage
  return nextApp
}

function mount() {
  app = createNginxApp()
  app.mount('#nginx')
}

if (window.__POWERED_BY_WUJIE__) {
  window.__WUJIE_MOUNT = mount
  window.__WUJIE_UNMOUNT = () => {
    app?.unmount()
    app = null
  }
} else {
  mount()
}
