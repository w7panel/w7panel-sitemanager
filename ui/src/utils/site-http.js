// PHP-FPM speaks FastCGI; a TCP Service alone does not make it an HTTP backend.
export function requiresFastcgi(application) {
  return (application?.spec?.template?.spec?.containers || []).some(container => {
    const command = [...(container.command || []), ...(container.args || [])].join(' ')
    if (/\bphp(?:[0-9.]*)?\s+-S\s/.test(command)) return false
    return /\bphp-fpm\b/.test(command)
      || (/(?:^|[/_-])php(?:[:@/_-]|$)/i.test(container.image || '') && !/apache/i.test(container.image || ''))
  })
}
