import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
export const SITE_FILES_MENU_DO = '__panel_site_files__'

// Operates on a supplied MicroApp snapshot; never contacts or updates a cluster.
export function siteMenuPatch(microapp) {
  if (!microapp?.metadata?.resourceVersion || !Array.isArray(microapp.spec?.bindings)) throw new Error('请提供包含 resourceVersion 和 spec.bindings 的 MicroApp JSON')
  if (!['w7-traditiontool', 'w7-phptool'].includes(microapp.metadata.labels?.['w7.cc/identifie'])) throw new Error('仅支持站点工具 MicroApp')
  const obsoleteTitles = new Set(['网关配置', '终端', '日志', '重启'])
  const bindings = microapp.spec.bindings.map(binding => {
    if (!Array.isArray(binding.menu) || !binding.menu.some(menu => ['站点配置', '基础配置', '网关配置'].includes(menu.title) || ['#/', '#/version', '#/nginx', '#/site/basic'].includes(menu.do))) return binding
    const fileEntry = binding.menu.find(item => [SITE_FILES_MENU_DO, '#/site/files', '#/files'].includes(item.do))
    const menu = binding.menu.filter(item => !obsoleteTitles.has(item.title) && !['#/nginx', '#/files', '#/site/gateway', '#/site/files', SITE_FILES_MENU_DO].includes(item.do))
    const index = menu.findIndex(item => ['站点配置', '基础配置'].includes(item.title) || ['#/', '#/version', '#/site/basic'].includes(item.do))
    const renamedRoutes = new Map([['#/files', SITE_FILES_MENU_DO], ['#/site/files', SITE_FILES_MENU_DO]])
    if (index >= 0 && menu[index].do) renamedRoutes.set(menu[index].do, '#/site/basic')
    const entry = { ...(index >= 0 ? menu[index] : {}), title: '站点配置', do: '#/site/basic' }
    if (index >= 0) menu[index] = entry; else menu.unshift(entry)
    menu.push({ ...fileEntry, title: '文件管理', do: SITE_FILES_MENU_DO, icon: fileEntry?.icon || 'icon-folder',
      ...(!fileEntry && entry.parent !== undefined ? { parent: entry.parent } : {}), is_default: 0, displayorder: Number(entry.displayorder || 0) - 1 })
    return { ...binding, menu: menu.map(item => renamedRoutes.has(item.parent)
      ? { ...item, parent: renamedRoutes.get(item.parent) } : item) }
  })
  return [{ op: 'test', path: '/metadata/resourceVersion', value: microapp.metadata.resourceVersion }, { op: 'replace', path: '/spec/bindings', value: bindings }]
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify(siteMenuPatch(JSON.parse(readFileSync(process.argv[2] || 0, 'utf8'))), null, 2) + '\n') }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1 }
}
