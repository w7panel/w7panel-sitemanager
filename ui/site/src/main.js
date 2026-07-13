import { createApp } from 'vue'
import App from './App.vue'
import {
	ElAlert,
	ElButton,
	ElCheckbox,
	ElConfigProvider,
	ElDialog,
	ElEmpty,
	ElForm,
	ElFormItem,
	ElIcon,
	ElInput,
	ElLoading,
	ElMessage,
	ElMessageBox,
	ElOption,
	ElPagination,
	ElPopover,
	ElPopconfirm,
	ElSelect,
	ElSwitch,
	ElTabPane,
	ElTable,
	ElTableColumn,
	ElTabs,
	ElTag,
	ElTooltip
} from 'element-plus'
import './assets/css/element-plus.css'
import './assets/css/style.css'
import routes from './router'
import {
	Check,
	CloseBold,
	Delete,
	Document,
	Edit,
	Plus,
	RefreshLeft,
	Setting,
	VideoPause,
	VideoPlay,
	WarningFilled
} from '@element-plus/icons-vue'
import './assets/css/global.less'

if (window.__POWERED_BY_WUJIE__) {
	window.__webpack_public_path__ = window.__WUJIE_PUBLIC_PATH__;
}

if (process.env.NODE_ENV === 'development') {
	const token = process.env.VUE_APP_SITE_MANAGER_TOKEN || process.env.VUE_APP_TOKEN
	if (token) {
		localStorage.setItem('X-Site-Manager-Token', token)
	}
}

const app = createApp(App);
const elementComponents = [
	ElAlert,
	ElButton,
	ElCheckbox,
	ElConfigProvider,
	ElDialog,
	ElEmpty,
	ElForm,
	ElFormItem,
	ElIcon,
	ElInput,
	ElOption,
	ElPagination,
	ElPopover,
	ElPopconfirm,
	ElSelect,
	ElSwitch,
	ElTabPane,
	ElTable,
	ElTableColumn,
	ElTabs,
	ElTag,
	ElTooltip
]
const icons = {
	Check,
	CloseBold,
	Delete,
	Document,
	Edit,
	Plus,
	RefreshLeft,
	Setting,
	VideoPause,
	VideoPlay,
	WarningFilled
}

Object.entries(icons).forEach(([key, component]) => {
	app.component(key, component)
})

elementComponents.forEach(component => {
	app.use(component)
})
app.use(ElLoading)
app.config.globalProperties.$message = ElMessage
app.config.globalProperties.$msgbox = ElMessageBox
app.config.globalProperties.$alert = ElMessageBox.alert
app.config.globalProperties.$confirm = ElMessageBox.confirm
app.config.globalProperties.$prompt = ElMessageBox.prompt
app.use(routes)

if (window.__POWERED_BY_WUJIE__) {
	window.__WUJIE_MOUNT = () => {
		app.mount('#site');
	};
	window.__WUJIE_UNMOUNT = () => {
		app.unmount();
	};
} else {
	app.mount('#site');
}

const debounce = (fn, delay) => {
	let timer = null;
	return function () {
		let context = this;
		let args = arguments;
		clearTimeout(timer);
		timer = setTimeout(function () {
			fn.apply(context, args);
		}, delay);
	};
};
const _ResizeObserver = window.ResizeObserver;
window.ResizeObserver = class ResizeObserver extends _ResizeObserver {
	constructor(callback) {
		callback = debounce(callback, 16);
		super(callback);
	}
};
