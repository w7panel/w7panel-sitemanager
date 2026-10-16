export function appendUnlimitedStatus(item, unlimitedNames = ['zend opcache', 'pdo_mysql', 'mysqli', 'exif', 'redis', 'xdebug', 'yaf', 'phalcon', 'mongodb', 'yac', 'grpc']) {
  item.is_unlimited = unlimitedNames.includes(item.name.toLowerCase());
  return item
}

export function parseExtensions(configText) {
  const installText = configText.replace(/^[\s\S]*\[PHP Modules\]/, '')
  return [...new Set(installText.split('\n').filter(item => {
    return !!item && item !== '[Zend Modules]'
  }).map(item => {
    const name = item.toLowerCase()
    return name === 'zend opcache' ? 'opcache' : name
  }))]
}

export function parseTemplate(data, version) {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      data = {}
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    data = {}
  }
  const template = {
    install_command: '',
    uninstall_command: '',
    enable_command: '',
    disable_command: ''
  }
  if (data.template && typeof data.template === 'object' && !Array.isArray(data.template)) {
    Object.keys(data.template).forEach(key => {
      if (typeof data.template[key] === 'string') {
        template[key] = data.template[key]
      }
    })
  }
  const extensions = Array.isArray(data.extensions) ? data.extensions : []
  const unlimitedNames = typeof data.php_perpetual_extensions === 'string' && data.php_perpetual_extensions
    ? data.php_perpetual_extensions.split(',')
    : []
  return [template, extensions.filter(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.name !== 'string' || !item.name.trim()) {
      return false
    }
    if (Array.isArray(item.not_support_php_versions) && item.not_support_php_versions.length) {
      return !item.not_support_php_versions.includes(version)
    }
    return true
  }).map(item => {
    const extension = { ...item }
    if (Array.isArray(item.not_support_php_versions)) {
      extension.not_support_php_versions = [...item.not_support_php_versions]
    }
    const name = extension.name;
    for (let key in template) {
      if (typeof extension[key] !== 'string' || !extension[key]) {
        extension[key] = template[key].replace(/\$extension_name/g, () => name);
      }
    }
    return extension;
  }), unlimitedNames];
}
