const NGINX_CONF_DIR = '/www/server/nginx/conf.d'
const NGINX_TEMPLATE_DIR = '/www/server/nginx/template-configs'
export const NGINX_VALIDATION_FAILED = 'W7_NGINX_VALIDATION_FAILED\n'

export function requireNginxConfigFileCommand(configFileName) {
  if (!/^[A-Za-z0-9._-]+\.conf$/.test(configFileName) || configFileName.includes('..')) throw new Error('站点配置文件名不合法')
  return `set -eu
CONF_DIR='${NGINX_CONF_DIR}'
[ -d "$CONF_DIR" ] || { echo "Nginx 配置目录不存在: $CONF_DIR" >&2; exit 1; }
CONF_FILE="$CONF_DIR/${configFileName}"
[ -f "$CONF_FILE" ] || { echo "未找到默认域名对应的 Nginx 配置文件: $CONF_FILE" >&2; exit 1; }`
}

// exec2 drops command output on nonzero exit. Return a recognizable result for
// syntax failures so the UI can retain nginx's diagnostic without panel changes.
export function checkNginxValidation(data) {
  const output = String(data ?? '')
  if (output.startsWith(NGINX_VALIDATION_FAILED)) {
    const detail = output.slice(NGINX_VALIDATION_FAILED.length).trim()
    throw Object.assign(new Error(detail || 'Nginx 配置校验失败'), { nginxValidationFailed: true })
  }
}

export function saveNginxConfigCommand(content, configFileName) {
  const text = String(content ?? '')
  let marker = 'W7_NGINX_EOF'
  while (text.includes(marker)) marker += '_X'
  return `${requireNginxConfigFileCommand(configFileName)}
TMP_DIR=$(mktemp -d "$CONF_DIR/.w7-nginx-save.XXXXXX")
replaced=false
cleanup() {
  if [ "$replaced" = true ]; then mv "$TMP_DIR/backup" "$CONF_FILE"; fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
cp -p "$CONF_FILE" "$TMP_DIR/backup"
cp -p "$CONF_FILE" "$TMP_DIR/new"
cat <<'${marker}' > "$TMP_DIR/new"
${text}
${marker}
replaced=true
mv "$TMP_DIR/new" "$CONF_FILE"
if nginx -t > "$TMP_DIR/validation" 2>&1; then
  replaced=false
else
  mv "$TMP_DIR/backup" "$CONF_FILE"
  replaced=false
  printf '%s\\n' 'W7_NGINX_VALIDATION_FAILED'
  cat "$TMP_DIR/validation"
  echo 'Nginx 配置校验失败，已恢复原配置'
fi`
}

// This is a tool-owned starting point, not the application's published nginx template.
export function defaultGatewayNginxConfig(application, config, domain) {
  if (!/^[A-Za-z0-9._-]+$/.test(domain) || domain.includes('..')) throw new Error('站点域名不合法')
  const service = config.applicationService
  const namespace = application.metadata.namespace || 'default'
  if (![service, namespace].every(name => /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name))) throw new Error('应用 Service 名称或命名空间不正确')
  const port = config.applicationPort
  const hasBackend = Number.isInteger(port) && port >= 1 && port <= 65535
  const php = (application.spec?.template?.spec?.containers || []).some(container => /(?:^|[/_-])php(?:[:@/_-]|$)/i.test(container.image || ''))
  const upstream = `${service}.${namespace}.svc.cluster.local:${port}`
  const location = php && hasBackend ? `    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ ^/(.+\\.php)(/.*)?$ {
        include fastcgi_params;
        fastcgi_split_path_info ^(.+\\.php)(/.+)$;
        fastcgi_param DOCUMENT_ROOT /www/wwwroot;
        fastcgi_param SCRIPT_FILENAME /www/wwwroot$fastcgi_script_name;
        fastcgi_param PATH_INFO $fastcgi_path_info;
        fastcgi_param HTTP_X_FORWARDED_PROTO $scheme;
        fastcgi_pass ${upstream};
        fastcgi_index index.php;
    }` : hasBackend ? `    location / {
        proxy_pass http://${upstream};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }` : `    location / {
        try_files $uri $uri/ =404;
    }

    location ~ \\.php(?:/|$) {
        return 404;
    }`
  return `server {
    listen 80;
    server_name ${domain};
    root /www/wwwroot/${domain};
    index ${php && hasBackend ? 'index.php ' : ''}index.html index.htm;
    access_log /dev/stdout;
    error_log /dev/stderr;

    location ~ /\\. {
        deny all;
    }

${location}
}
`
}

export function initializeNginxConfigCommand(fileName, content) {
  if (!/^[A-Za-z0-9._-]+\.conf$/.test(fileName) || fileName.includes('..')) throw new Error('站点配置文件名不合法')
  let marker = 'W7_GATEWAY_INITIAL_CONFIG'
  while (content.includes(marker)) marker += '_X'
  return `set -eu
CONF_DIR='${NGINX_CONF_DIR}'
CONF_FILE="$CONF_DIR/${fileName}"
mkdir -p "$CONF_DIR"
VALIDATION_LOG=$(mktemp)
trap 'rm -f "$VALIDATION_LOG"' EXIT
created=false
if [ ! -e "$CONF_FILE" ] && [ ! -L "$CONF_FILE" ]; then
  TMP_FILE=$(mktemp "$CONF_DIR/.initial.XXXXXX")
  trap 'rm -f "$TMP_FILE" "$VALIDATION_LOG"' EXIT
  cat <<'${marker}' > "$TMP_FILE"
${content}
${marker}
  chmod 644 "$TMP_FILE"
  if ln "$TMP_FILE" "$CONF_FILE"; then created=true; fi
  rm -f "$TMP_FILE"
  trap 'rm -f "$VALIDATION_LOG"' EXIT
fi
if ! nginx -t > "$VALIDATION_LOG" 2>&1; then
  if [ "$created" = true ]; then rm -f "$CONF_FILE"; fi
  printf '%s\\n' 'W7_NGINX_VALIDATION_FAILED'
  cat "$VALIDATION_LOG"
  echo 'Nginx 配置校验失败，访问入口尚未切换'
  exit 0
fi
cat "$CONF_FILE"`
}

export function latestNginxTemplateCommand(configFileName) {
  const file = `${NGINX_TEMPLATE_DIR}/${configFileName}`.replaceAll("'", "'\"'\"'")
  return `set -eu
LATEST_FILE='${file}'
if [ -f "$LATEST_FILE" ]; then cat "$LATEST_FILE"; fi`
}

export function normalizeNginxConfig(content) {
  const lines = String(content).split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const kept = []
  let quote = ''
  let escaped = false
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')
    if (/^[ \t]*$/.test(line) && !quote && !escaped) continue
    kept.push(line)
    escaped = false
    for (const char of line) {
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (quote) {
        if (char === quote) quote = ''
        continue
      }
      if (char === '#') break
      if (char === '"' || char === "'") quote = char
    }
  }
  return kept.join('\n')
}
