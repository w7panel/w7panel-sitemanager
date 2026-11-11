export function normalizeDomain(value) {
  const host = String(value || '').trim().toLowerCase().replace(/\.$/, '')
  const bare = host.replace(/^\*\./, '')
  if (host.length > 253 || !bare.includes('.') || !bare.split('.').every(part => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
    || /^\d+(\.\d+){3}$/.test(bare)) throw new Error('请输入有效域名，不包含协议、端口或路径')
  return host
}

