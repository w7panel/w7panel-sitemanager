ARG PHP_EXTENSION_INSTALLER_VERSION=2.10.0
ARG PHP_VERSION=8.1

FROM mlocati/php-extension-installer:${PHP_EXTENSION_INSTALLER_VERSION} AS php_extension_installer

FROM php:${PHP_VERSION}-fpm-alpine

ARG PHP_VERSION=8.1
ENV TZ=Asia/Shanghai
ENV IPE_SWOOLE_WITHOUT_IOURING=1

COPY --from=php_extension_installer /usr/bin/install-php-extensions /usr/local/bin/install-php-extensions
COPY common/install-w7-php-extensions.sh /usr/local/bin/install-w7-php-extensions

RUN chmod +x /usr/local/bin/install-php-extensions \
    /usr/local/bin/install-w7-php-extensions \
  && install-w7-php-extensions "$PHP_VERSION" \
  && rm -f \
    /usr/local/bin/install-php-extensions \
    /usr/local/bin/install-w7-php-extensions
