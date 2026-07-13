export const SITE_MANAGER_TOKEN_HEADER = 'X-Site-Manager-Token'

export function getWujieAccessToken() {
    return window?.$wujie?.props?.access_token || window?.wujie?.props?.access_token || ''
}

export function getSiteManagerToken() {
    return localStorage.getItem(SITE_MANAGER_TOKEN_HEADER) || ''
}

export function setSiteManagerToken(token) {
    if (token) {
        localStorage.setItem(SITE_MANAGER_TOKEN_HEADER, token)
    }
}

export function getPanelToken() {
    return window?.$wujie?.props?.paneltoken || localStorage.getItem('X-W7Panel-Token') || ''
}
