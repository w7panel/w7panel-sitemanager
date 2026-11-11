import { test } from 'node:test'
import assert from 'node:assert/strict'
import { siteMenuPatch, SITE_FILES_MENU_DO } from './site-menu.mjs'
test('menu migration preserves role/access metadata and unrelated pages, and is idempotent', () => {
  const resource = { metadata: { resourceVersion: '10', labels: { 'w7.cc/identifie': 'w7-traditiontool' } }, spec: { bindings: [{ name: 'normal', status: 1, support: 'thirdparty_cd', menu: [{ title: '站点配置', do: '#/version', icon: 'site', is_default: 1 }, { title: '网关配置', do: '#/nginx' }, { title: '终端', do: 'terminal' }, { title: 'PHP 环境', do: '#/environment' }] }] } }
  const patch = siteMenuPatch(resource), binding = patch[1].value[0]
  assert.equal(patch[0].value, '10'); assert.equal(binding.support, 'thirdparty_cd'); assert.equal(binding.menu[0].is_default, 1)
  assert.deepEqual(binding.menu.map(item => item.do), ['#/site/basic', '#/environment', SITE_FILES_MENU_DO])
  assert.equal(binding.menu[2].is_default, 0)
  assert.deepEqual(siteMenuPatch({ ...resource, spec: { bindings: patch[1].value } })[1].value, patch[1].value)
})
test('menu migration replaces old file shortcuts with the native site entry and preserves custom file entries', () => {
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
  assert.equal(binding.menu[2].do, SITE_FILES_MENU_DO); assert.equal(binding.menu[2].title, '文件管理')
})
test('unrelated MicroApps cannot be migrated by mistake', () => assert.throws(() => siteMenuPatch({ metadata: { resourceVersion: '1' }, spec: { bindings: [] } })))

test('renamed site and file menus retain the parent links of existing child menus', () => {
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
    assert.equal(byDo.get(SITE_FILES_MENU_DO).parent, '#/site/basic')
    assert.equal(byDo.get(SITE_FILES_MENU_DO).permission, 'site/files')
    assert.equal(byDo.get('#/custom').parent, '#/site/basic')
    assert.equal(byDo.get('#/file-help').parent, SITE_FILES_MENU_DO)
    for (const menu of menus) if (menu.parent) assert(byDo.has(menu.parent), `missing parent: ${menu.parent}`)
    assert.deepEqual(siteMenuPatch({ ...resource, spec: { bindings } })[1].value, bindings)
  }
})

test('a new file entry inherits the site menu group while an existing top-level entry stays top-level', () => {
  for (const existingFile of [false, true]) {
    const resource = { metadata: { resourceVersion: '13', labels: { 'w7.cc/identifie': 'w7-traditiontool' } }, spec: { bindings: [{ name: 'founder', menu: [
      { title: '站点工具', do: '#/tools' },
      { title: '站点配置', do: '#/version', parent: '#/tools' },
      ...(existingFile ? [{ title: '文件管理', do: '#/site/files' }] : []),
    ] }] } }
    const menus = siteMenuPatch(resource)[1].value[0].menu
    assert.equal(menus.find(menu => menu.do === SITE_FILES_MENU_DO).parent, existingFile ? undefined : '#/tools')
  }
})
