import { normalizeDomain } from './site-hostname'

// Retain token offsets so custom directives, comments and quoted strings stay intact.
export function updateNginxDomain(content, primary, domain, add = true) {
  const host = normalizeDomain(domain)
  const tokens = []
  for (let i = 0; i < content.length;) {
    if (/\s/.test(content[i])) { i += 1; continue }
    if (content[i] === '#') { while (i < content.length && content[i] !== '\n') i += 1; continue }
    const start = i
    if ('{};'.includes(content[i])) { tokens.push({ value: content[i], start: i, end: ++i }); continue }
    let quote = ''
    while (i < content.length) {
      const char = content[i]
      if (char === '\\') { i += 2; continue }
      if (quote) { if (char === quote) quote = ''; i += 1; continue }
      if (char === '"' || char === "'") { quote = char; i += 1; continue }
      if (char === '$' && content[i + 1] === '{') {
        const end = content.indexOf('}', i + 2)
        if (end < 0) throw new Error('Nginx 配置变量格式不完整')
        i = end + 1; continue
      }
      if (/\s/.test(char) || '{};#'.includes(char)) break
      i += 1
    }
    const raw = content.slice(start, i)
    tokens.push({ value: raw.replace(/^(["'])(.*)\1$/, '$2'), raw, start, end: i })
  }
  const stack = [], candidates = [], defaults = []
  let statement = []
  for (const token of tokens) {
    if (token.value === '{') { stack.push({ kind: statement[0]?.value, names: [], defaultServer: false }); statement = []; continue }
    if (token.value === '}') {
      const block = stack.pop()
      if (block?.kind === 'server') {
        if (block.names.some(item => item.names.some(name => name.value === primary))) candidates.push(block)
        else if (block.defaultServer) defaults.push(block)
      }
      statement = []; continue
    }
    if (token.value === ';') {
      const block = stack[stack.length - 1]
      if (block?.kind === 'server' && statement[0]?.value === 'listen' && statement.some(item => item.value === 'default_server')) block.defaultServer = true
      if (block?.kind === 'server' && statement[0]?.value === 'server_name') block.names.push({ keyword: statement[0], names: statement.slice(1), end: token.start })
      statement = []; continue
    }
    statement.push(token)
  }
  if (!candidates.length) candidates.push(...defaults)
  if (candidates.length !== 1 || candidates[0].names.length !== 1) throw new Error('无法唯一定位当前站点的 server_name，请先在网关配置中调整域名')
  const directive = candidates[0].names[0]
  if (candidates[0].defaultServer) return content
  const matches = directive.names.filter(token => token.value === host)
  if (add) {
    if (matches.length) return content
    return content.slice(0, directive.end) + ' ' + host + content.slice(directive.end)
  }
  if (host === primary) throw new Error('不能移除站点默认域名')
  let result = content
  for (const token of matches.reverse()) result = result.slice(0, token.start) + result.slice(token.end)
  return result
}
