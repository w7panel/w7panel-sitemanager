import axios from "axios";

const myAxios = axios.create({
    baseURL: '',
    timeout: 900000,
    headers: {
        "Authorization": `Bearer ${window.$wujie?.props?.paneltoken}`
    }
});


const newApiSuffix = '/panel-api/v1'

myAxios.interceptors.request.use((config) => {
    if (config.url.includes('/apps/v1') || config.url.includes('/apis/w7panel.w7.com') || config.url.includes('/api/v1') || config.url.includes('/apis/batch/v1') || config.url.includes('/apis/networking.k8s.io')) {
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
    ws.onmessage = onMessage || function () {}
    ws.onclose = onSuccess || function () {}
    ws.onerror = onError || function () {}
}

export default myAxios;
