// The panel's existing toFile handler appends this value to a string route.
// Vue Router decodes its hash once; files.vue then decodes the path once more.
export async function openSiteFiles(context, wujie = window.$wujie) {
  const { group, application, directory, directoryError } = context
  if (!directory) throw new Error(directoryError || '无法确定站点目录')
  const firstContainer = application?.spec?.template?.spec?.containers?.[0]
  if (directory.containerName !== firstContainer?.name) {
    throw new Error('面板文件管理当前使用应用的首个容器，无法直接定位其他容器中的站点目录')
  }
  if (typeof wujie?.bus?.$emit !== 'function') throw new Error('请从面板打开站点配置，以使用文件管理')
  wujie.bus.$emit('toFile', {
    appgroup: group,
    kind: 'deployments',
    appname: application.metadata.name,
    ...(context.microAppName ? { sourceMicroApp: context.microAppName, sourceMenuDo: '__panel_site_files__' } : {}),
    path: encodeURIComponent(encodeURIComponent(directory.path))
  })
}
