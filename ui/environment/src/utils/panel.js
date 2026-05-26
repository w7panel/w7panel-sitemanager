import axios from "axios";

const myAxios = axios.create({
    baseURL: '',
    timeout: 900000,
});


const newApiSuffix = '/panel-api/v1'

myAxios.interceptors.request.use((config) => {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${window.$wujie?.props?.paneltoken || ''}`
    if (config.url?.includes('/apps/v1') || config.url?.includes('/apis/appgroup.w7.cc') || config.url?.includes('/api/v1') || config.url?.includes('/apis/batch/v1') || config.url?.includes('/apis/networking.k8s.io')) {
        config.url = '/k8s-proxy' + config.url
    }
    return config
})

myAxios.exec = function (name, podName, shell) {
    return myAxios.post(newApiSuffix + '/exec2', {
        podName: podName,
        containerName: name,
        tty: false,
        namespace: "default",
        command: ["sh", "-c", shell]
    })
}

myAxios.execall = function (name, PodNames, shell) {
    return myAxios.post(newApiSuffix + '/exec-all', {
        PodNames,
        containerName: name,
        tty: false,
        namespace: "default",
        command: ["sh", "-c", shell]
    })
}


myAxios.wsExec = function (name, podName, shell, onMessage, onSuccess, onError) {
    const ws = new WebSocket(`${newApiSuffix}/exec?podName=${podName}&containerName=${name}&tty=false&namespace=default&command=sh&command=-c&command=${encodeURIComponent(shell)}&api-token=${window.$wujie?.props?.paneltoken}`)
    const noop = () => {}
    ws.onmessage = onMessage || noop
    ws.onclose = onSuccess || noop
    ws.onerror = onError || noop
}

export default myAxios;
