# W7 PHP FPM Alpine Images

This directory builds W7 PHP FPM Alpine runtime images.

Default image repository:

```text
zpk.idc.w7.com/public/php
```

Image tag format:

```text
zpk.idc.w7.com/public/php:<php-version>-fpm-alpine
```

## Build

Build PHP 7.4:

```sh
cd environment/w7
docker build --build-arg PHP_VERSION=7.4 -t zpk.idc.w7.com/public/php:7.4-fpm-alpine .
```

Push PHP 7.4:

```sh
docker push zpk.idc.w7.com/public/php:7.4-fpm-alpine
```

Build configured versions:

```sh
sh environment/w7/build-all.sh
```

Build and push configured versions:

```sh
PUSH=1 sh environment/w7/build-all.sh
```

The script also accepts `KEY=VALUE` arguments:

```sh
cd environment/w7
./build-all.sh PUSH=1
```

Override versions or image repository:

```sh
VERSIONS="7.4 8.1" IMAGE_PREFIX="zpk.idc.w7.com/public/php" sh environment/w7/build-all.sh
```

## Runtime Packages

The common setup installs:

```text
bash ca-certificates composer curl git libstdc++ tzdata zip
```

Timezone is configured as `Asia/Shanghai` by writing `/etc/localtime` and `/etc/timezone`.

## PHP Extensions

The base extension list is:

```text
bcmath bz2 exif gd igbinary mcrypt memcached mysqli pcntl pdo_mysql redis sockets sourceguardian sysvmsg sysvsem sysvshm xsl yaml zip
```

Version-specific additions:

```text
All versions: imagick-3.7.0
PHP 8.x: apcu-5.1.28
All other versions: apcu
PHP 8.0: swoole-5.1.8
PHP 8.1: swoole-6.1.8
All other versions: swoole
PHP 5.6/7.0/7.1: sodium
PHP 5.6/7.0/7.1/7.2/7.3/7.4/8.0: opcache
PHP 5.6/7.0: @fix_letsencrypt
All versions except PHP 8.0: ioncube_loader
```

Modules normally included by the official `php:<version>-fpm-alpine` image are not repeated in the install list.

## Image Behavior

Images inherit the official `php:<version>-fpm-alpine` entrypoint and command.

No custom start script is installed.

The build copies `install-php-extensions` and `install-w7-php-extensions` only for the build step. Both files are deleted after extension installation.

The Dockerfile does not run module verification during build.

## Manual Verification

After building, modules can be checked manually:

```sh
docker run --rm zpk.idc.w7.com/public/php:7.4-fpm-alpine php -m
```

## Notes

The Dockerfile pins `mlocati/php-extension-installer` to `2.10.0` to reduce compatibility drift while building old PHP versions.

The current `docker-php-extension-installer` README documents Alpine support from Alpine 3.9 / PHP 7.1 upward. The official `php:5.6-fpm-alpine` and `php:7.0-fpm-alpine` images use older Alpine versions, so those versions are best-effort.

`ioncube_loader` is installed as the Zend extension provided by the ionCube loader package when a loader exists for the selected PHP version. It is skipped for PHP 8.0 because the current ionCube package does not include `ioncube_loader_lin-musl_8.0.so` for Alpine images. `SourceGuardian` is installed with the loader supported by the installer.

`phpdbg_webhelper` is not installed because it is not a standard extension in the official PHP FPM Alpine images and is not supported by the bundled installer.
