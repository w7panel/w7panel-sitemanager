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

LOCAL_EXTENSION_SRC_DIR=/tmp/php-extension-src
USE_LOCAL_EXTENSION_SOURCES=0
case "$PHP_VERSION" in
  8.0|8.1)
    USE_LOCAL_EXTENSION_SOURCES=1
    ;;
esac

extract_local_extension_source() {
  package="$1"
  source_dir="$LOCAL_EXTENSION_SRC_DIR/${package%.tar.gz}"
  extract_dir="$source_dir.extract"

  rm -rf "$source_dir" "$extract_dir"
  mkdir -p "$source_dir" "$extract_dir"

  echo "download PHP extension source: ${package%.tar.gz}"
  curl -fsSL --retry 5 --retry-delay 2 \
    -o "$LOCAL_EXTENSION_SRC_DIR/$package" \
    "https://pecl.php.net/get/${package%.tar.gz}.tgz"

  tar -xzf "$LOCAL_EXTENSION_SRC_DIR/$package" -C "$extract_dir"
  if [ -f "$extract_dir/package.xml" ]; then
    cp -a "$extract_dir/." "$source_dir/"
    top_dir="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    if [ -n "$top_dir" ]; then
      cp -a "$top_dir/." "$source_dir/"
    fi
  else
    top_dir="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    cp -a "$top_dir/." "$source_dir/"
  fi
  rm -rf "$extract_dir" "$LOCAL_EXTENSION_SRC_DIR/$package"
}

if [ "$USE_LOCAL_EXTENSION_SOURCES" = 1 ]; then
  for package in \
    igbinary-3.2.16.tar.gz \
    mcrypt-1.0.9.tar.gz \
    redis-6.3.0.tar.gz \
    yaml-2.3.0.tar.gz \
    imagick-3.7.0.tar.gz \
    memcached-3.4.0.tar.gz \
    swoole-5.1.8.tar.gz
  do
    extract_local_extension_source "$package"
  done
fi

INSTALLABLE_REQUIRED_EXTENSIONS="
bcmath
bz2
exif
gd
mysqli
pcntl
pdo_mysql
sockets
sourceguardian
sysvmsg
sysvsem
sysvshm
xsl
zip
"

if [ "$USE_LOCAL_EXTENSION_SOURCES" = 1 ]; then
  INSTALLABLE_REQUIRED_EXTENSIONS="$INSTALLABLE_REQUIRED_EXTENSIONS
/tmp/php-extension-src/igbinary-3.2.16
/tmp/php-extension-src/mcrypt-1.0.9
/tmp/php-extension-src/redis-6.3.0
/tmp/php-extension-src/yaml-2.3.0
"
  VERSION_SPECIFIC_EXTENSIONS="
/tmp/php-extension-src/imagick-3.7.0
/tmp/php-extension-src/memcached-3.4.0
/tmp/php-extension-src/swoole-5.1.8
"
else
  INSTALLABLE_REQUIRED_EXTENSIONS="$INSTALLABLE_REQUIRED_EXTENSIONS
igbinary
mcrypt
redis
yaml
"
  VERSION_SPECIFIC_EXTENSIONS="
imagick
memcached
swoole
"
fi

case "$PHP_VERSION" in
  8.1)
    ;;
  7.*|8.*)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS apcu-5.1.28"
    ;;
  *)
    VERSION_SPECIFIC_EXTENSIONS="$VERSION_SPECIFIC_EXTENSIONS apcu"
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
  checked_extension="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  checked_extension="${checked_extension%%-*}"
  modules="$(php -m | tr '[:upper:]' '[:lower:]')"

  case "$checked_extension" in
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
      module_name="$checked_extension"
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
