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
  data = JSON.parse(data)
  const { template, extensions, php_perpetual_extensions } = data;
  return [template, extensions.filter(item => {
    if (item.not_support_php_versions?.length) {
      return !item.not_support_php_versions.includes(version)
    }
    return true
  }).map(item => {
    const name = item.name;
    for (let key in template) {
      if (!item[key]) {
        item[key] = template[key].replace(/\$extension_name/g, name);
      }
    }
    return item;
  }), php_perpetual_extensions ? php_perpetual_extensions.split(',') : []];
}
