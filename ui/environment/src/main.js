import { createApp } from 'vue'
import App from './App.vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import locale from 'element-plus/es/locale/lang/zh-cn'
import './assets/css/style.css'
import routes from './router'
import './assets/css/global.less'

if (window.__POWERED_BY_WUJIE__) {
	window.__webpack_public_path__ = window.__WUJIE_PUBLIC_PATH__;
}

let app = null

const createEnvironmentApp = () => {
	const nextApp = createApp(App)
	nextApp.use(ElementPlus, { locale })
	nextApp.use(routes)
	return nextApp
}

if (window.__POWERED_BY_WUJIE__) {
	window.__WUJIE_MOUNT = () => {
		app = createEnvironmentApp()
		app.mount('#site');
	};
	window.__WUJIE_UNMOUNT = () => {
		if (app) {
			app.unmount();
			app = null
		}
	};
} else {
	app = createEnvironmentApp()
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
