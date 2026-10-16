import { createApp } from 'vue'
import {
  ElAlert, ElButton, ElCheckbox, ElCol, ElDescriptions, ElDescriptionsItem,
  ElDialog, ElForm, ElFormItem, ElInput, ElInputNumber, ElLoading, ElMessage,
  ElOption, ElRow, ElSelect, ElSwitch, ElTable, ElTableColumn, ElTabPane, ElTabs
} from 'element-plus'
import App from './App.vue'
import router from './router'
import './assets/css/element-plus.css'

if (window.__POWERED_BY_WUJIE__) {
  window.__webpack_public_path__ = window.__WUJIE_PUBLIC_PATH__
}

let app = null

function createNginxApp() {
  const nextApp = createApp(App)
  nextApp.use(router)
  const components = [
    ElAlert, ElButton, ElDialog, ElLoading,
    ElCheckbox, ElCol, ElDescriptions, ElDescriptionsItem, ElForm, ElFormItem,
    ElInput, ElInputNumber, ElOption, ElRow, ElSelect, ElSwitch,
    ElTable, ElTableColumn, ElTabPane, ElTabs
  ]
  components.forEach(component => nextApp.use(component))
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
