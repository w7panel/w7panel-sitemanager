#!/bin/sh
set -eu

PHP_VERSION="${1:-}"
if [ -z "$PHP_VERSION" ]; then
  echo "usage: install-w7-php-extensions.sh <php-version>" >&2
  exit 2
fi
echo "install-w7-php-extensions: PHP_VERSION=$PHP_VERSION"

if command -v apk >/dev/null 2>&1; then
  sed -i 's#dl-cdn.alpinelinux.org#mirrors.aliyun.com#g' /etc/apk/repositories || true
  apk add --no-cache \
    bash \
    ca-certificates \
    composer \
    curl \
    git \
    libstdc++ \
    tzdata \
    zip
  cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
  echo "Asia/Shanghai" > /etc/timezone
fi

INSTALLABLE_REQUIRED_EXTENSIONS="
bcmath
bz2
exif
gd
igbinary
mcrypt
memcached
mysqli
pcntl
pdo_mysql
redis
sockets
sourceguardian
sysvmsg
sysvsem
sysvshm
xsl
yaml
zip
"

VERSION_SPECIFIC_EXTENSIONS="imagick-3.7.0"

case "$PHP_VERSION" in
  8.*)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS apcu-5.1.28"
    ;;
  *)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS apcu"
    ;;
esac

case "$PHP_VERSION" in
  8.0)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS swoole-5.1.8"
    ;;
  8.1)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS swoole-6.1.8"
    ;;
  *)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS swoole"
    ;;
esac

case "$PHP_VERSION" in
  8.0)
    # ionCube does not publish a PHP 8.0 Alpine/musl loader in the current package.
    ;;
  *)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS ioncube_loader"
    ;;
esac

case "$PHP_VERSION" in
  5.6|7.0)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS @fix_letsencrypt"
    ;;
esac

case "$PHP_VERSION" in
  5.6|7.0|7.1)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS sodium"
    ;;
esac

case "$PHP_VERSION" in
  5.6|7.0|7.1|7.2|7.3|7.4|8.0)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS opcache"
    ;;
esac

is_installed_extension() {
  extension="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  extension="${extension%%-*}"
  modules="$(php -m | tr '[:upper:]' '[:lower:]')"

  case "$extension" in
    ioncube_loader)
      module_name="ioncube loader"
      ;;
    opcache)
      module_name="zend opcache"
      ;;
    sodium)
      if printf '%s\n' "$modules" | grep -Fx "sodium" >/dev/null 2>&1 || printf '%s\n' "$modules" | grep -Fx "libsodium" >/dev/null 2>&1; then
        return 0
      fi
      return 1
      ;;
    *)
      module_name="$extension"
      ;;
  esac

  printf '%s\n' "$modules" | grep -Fx "$module_name" >/dev/null 2>&1
}

EXTENSIONS_TO_INSTALL=""
for extension in $INSTALLABLE_REQUIRED_EXTENSIONS $VERSION_SPECIFIC_EXTENSIONS; do
  if is_installed_extension "$extension"; then
    echo "skip installed PHP extension: $extension"
    continue
  fi
  EXTENSIONS_TO_INSTALL="$EXTENSIONS_TO_INSTALL $extension"
done

if [ -n "$EXTENSIONS_TO_INSTALL" ]; then
  echo "install PHP extensions:$EXTENSIONS_TO_INSTALL"
  install-php-extensions $EXTENSIONS_TO_INSTALL
fi

php -m

rm -rf \
  /root/.cache \
  /root/.composer \
  /tmp/* \
  /usr/local/include/php \
  /usr/local/lib/php/.channels \
  /usr/local/lib/php/.filemap \
  /usr/local/lib/php/.lock \
  /usr/local/lib/php/.registry \
  /usr/local/lib/php/PEAR \
  /usr/local/lib/php/build \
  /usr/local/lib/php/doc \
  /usr/local/lib/php/test \
  /usr/local/php/man \
  /usr/share/doc \
  /usr/share/licenses \
  /usr/share/man \
  /var/cache/apk/* \
  /var/tmp/*
