import { test } from 'node:test'
import assert from 'node:assert/strict'
import { siteMenuPatch, SITE_FILES_MENU_DO } from './site-menu.mjs'
test('menu migration preserves role/access metadata and unrelated pages, and is idempotent', () => {
  const resource = { metadata: { resourceVersion: '10', labels: { 'w7.cc/identifie': 'w7-traditiontool' } }, spec: { bindings: [{ name: 'normal', status: 1, support: 'thirdparty_cd', menu: [{ title: '站点配置', do: '#/version', icon: 'site', is_default: 1 }, { title: '网关配置', do: '#/nginx' }, { title: '终端', do: 'terminal' }, { title: 'PHP 环境', do: '#/environment' }] }] } }
  const patch = siteMenuPatch(resource), binding = patch[1].value[0]
  assert.equal(patch[0].value, '10'); assert.equal(binding.support, 'thirdparty_cd'); assert.equal(binding.menu[0].is_default, 1)
  assert.deepEqual(binding.menu.map(item => item.do), ['#/site/basic', '#/environment'])
  assert.deepEqual(siteMenuPatch({ ...resource, spec: { bindings: patch[1].value } })[1].value, patch[1].value)
})
test('menu migration removes outer file shortcuts and preserves custom file entries', () => {
  const customFileMenu = { title: '文件管理', do: 'app:custom-files#/files', icon: 'custom-folder' }
  const resource = { metadata: { resourceVersion: '11', labels: { 'w7.cc/identifie': 'w7-traditiontool' } }, spec: { bindings: [{ name: 'normal', menu: [
    { title: '站点配置', do: '#/site/basic' },
    { title: '文件管理', do: '#/site/files' },
    { title: '文件快捷入口', do: '#/files' },
    customFileMenu,
    { title: '日志', do: 'logs' },
    { title: '重启', do: 'restart' },
  ] }] } }
  const binding = siteMenuPatch(resource)[1].value[0]
  assert.deepEqual(binding.menu.slice(0, 2), [{ title: '站点配置', do: '#/site/basic' }, customFileMenu])
  assert.equal(binding.menu.length, 2)
})
test('unrelated MicroApps cannot be migrated by mistake', () => assert.throws(() => siteMenuPatch({ metadata: { resourceVersion: '1' }, spec: { bindings: [] } })))

test('children of the removed file shortcut remain reachable under site configuration', () => {
  for (const oldSiteRoute of ['#/', '#/version']) {
    const resource = { metadata: { resourceVersion: '12', labels: { 'w7.cc/identifie': 'w7-phptool' } }, spec: { bindings: [{ name: 'normal', menu: [
      { title: '站点工具', do: '#/tools' },
      { title: '站点配置', do: oldSiteRoute, parent: '#/tools', is_default: 1 },
      { title: '文件管理', do: '#/files', parent: oldSiteRoute, permission: 'site/files' },
      { title: '自定义配置', do: '#/custom', parent: oldSiteRoute },
      { title: '文件帮助', do: '#/file-help', parent: '#/files' },
    ] }] } }
    const bindings = siteMenuPatch(resource)[1].value
    const menus = bindings[0].menu
    const byDo = new Map(menus.map(menu => [menu.do, menu]))
    assert.equal(byDo.get('#/site/basic').parent, '#/tools')
    assert.equal(byDo.has(SITE_FILES_MENU_DO), false)
    assert.equal(byDo.get('#/custom').parent, '#/site/basic')
    assert.equal(byDo.get('#/file-help').parent, '#/site/basic')
    for (const menu of menus) if (menu.parent) assert(byDo.has(menu.parent), `missing parent: ${menu.parent}`)
    assert.deepEqual(siteMenuPatch({ ...resource, spec: { bindings } })[1].value, bindings)
  }
})

test('legacy native file entries are removed without changing the site menu group', () => {
  for (const fileRoute of [null, '#/files', '#/site/files', SITE_FILES_MENU_DO]) {
    const resource = { metadata: { resourceVersion: '13', labels: { 'w7.cc/identifie': 'w7-traditiontool' } }, spec: { bindings: [{ name: 'founder', menu: [
      { title: '站点工具', do: '#/tools' },
      { title: '站点配置', do: '#/version', parent: '#/tools' },
      ...(fileRoute ? [{ title: '文件管理', do: fileRoute }, { title: '文件帮助', do: '#/file-help', parent: fileRoute }] : []),
    ] }] } }
    const menus = siteMenuPatch(resource)[1].value[0].menu
    assert.equal(menus.find(menu => menu.do === '#/site/basic').parent, '#/tools')
    assert.equal(menus.some(menu => [SITE_FILES_MENU_DO, '#/files', '#/site/files'].includes(menu.do)), false)
    if (fileRoute) assert.equal(menus.find(menu => menu.do === '#/file-help').parent, '#/site/basic')
  }
})
