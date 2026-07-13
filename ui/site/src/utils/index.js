import axios from "axios";
import { ElMessage, ElMessageBox } from 'element-plus';
import { getPanelToken, getSiteManagerToken, setSiteManagerToken, SITE_MANAGER_TOKEN_HEADER } from './auth-token';

const myAxios = axios.create({
    baseURL: window?.$wujie?.props?.url,
    timeout: 90000
});

myAxios.interceptors.request.use(config => {
    config.headers[SITE_MANAGER_TOKEN_HEADER] = getSiteManagerToken()
    config.headers['Authorization'] = `Bearer ${getPanelToken()}`
    return config
}, err => {
    Promise.reject(err)
})

myAxios.interceptors.response.use(res => {
    setSiteManagerToken(res.headers?.[SITE_MANAGER_TOKEN_HEADER.toLowerCase()])
    if (res.status >= 200 && res.status < 300 && res) {
        return Promise.resolve(res)
    }
}, error => {
    if (error?.response?.status == 401) {
        window.formrelogining = true;
        return Promise.reject(error);
    }

    if (error?.response?.status == 422) {
        let errorinfo = error.response.data.errors;
        if (!errorinfo) { return }
        let keys = Object.keys(errorinfo);
        let messages = keys.map(key => {
            return errorinfo[key].join('\n');
        });

        ElMessageBox.alert(messages.join('<br/>'), "提示", { confirmButtonText: "确定", dangerouslyUseHTMLString: true });

        return Promise.reject(error);
    }

    if (error?.response?.status == 429) { return }
    if (error?.response?.status == 408) { return }
    if (!error?.config?.dontalert) {
        if (error.response && !error.config.headers.cancelerror && error.response?.data?.error) {
            ElMessage({
                message: error.response.data.error,
                duration: 3000,
                type: 'error',
            });
        }
    }

    return Promise.reject(error)
});

export default myAxios;
