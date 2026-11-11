export function resolveSiteRoute(value) {
  let path = String(value || '').trim()
  try { path = decodeURIComponent(path) } catch { /* Preserve a malformed legacy URL. */ }
  const hash = path.lastIndexOf('#')
  if (hash >= 0) path = path.slice(hash + 1)
  path = '/' + path.split('?')[0].replace(/^\/+|\/+$/g, '')
  const aliases = { '/': '/site/basic', '/version': '/site/basic', '/nginx': '/site/gateway', '/files': '/site/files' }
  if (aliases[path]) return aliases[path]
  return ['/site/basic', '/site/gateway', '/site/files', '/environment'].includes(path) ? path : '/site/basic'
}
