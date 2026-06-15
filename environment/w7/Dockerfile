ARG PHP_VERSION=8.1

FROM php:${PHP_VERSION}-fpm-alpine

ARG PHP_VERSION=8.1
ENV TZ=Asia/Shanghai
ENV IPE_SWOOLE_WITHOUT_IOURING=1

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

COPY common/install-php-extensions /usr/local/bin/install-php-extensions
COPY common/install-w7-php-extensions.sh /usr/local/bin/install-w7-php-extensions

RUN chmod +x /usr/local/bin/install-php-extensions \
    /usr/local/bin/install-w7-php-extensions \
  && install-w7-php-extensions "$PHP_VERSION" \
  && rm -f \
    /usr/local/bin/install-php-extensions \
    /usr/local/bin/install-w7-php-extensions
