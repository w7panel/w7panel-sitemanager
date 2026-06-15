#!/bin/sh
set -eu

IMAGE_PREFIX="${IMAGE_PREFIX:-zpk.idc.w7.com/public/php}"
VERSIONS="${VERSIONS:-5.6 7.2 7.4 8.0 8.1}"
PUSH="${PUSH:-0}"

for arg in "$@"; do
  case "$arg" in
    IMAGE_PREFIX=*)
      IMAGE_PREFIX="${arg#IMAGE_PREFIX=}"
      ;;
    VERSIONS=*)
      VERSIONS="${arg#VERSIONS=}"
      ;;
    version=*)
      VERSIONS="${arg#version=}"
      ;;
    versions=*)
      VERSIONS="${arg#versions=}"
      ;;
    PUSH=*)
      PUSH="${arg#PUSH=}"
      ;;
    push=*)
      PUSH="${arg#push=}"
      ;;
    *)
      echo "Unsupported argument: $arg" >&2
      echo "Usage: $0 [IMAGE_PREFIX=repo] [VERSIONS='8.0 8.1'|version=8.1] [PUSH=1]" >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

for version in $VERSIONS; do
  docker build \
    --build-arg "PHP_VERSION=$version" \
    -f "$SCRIPT_DIR/Dockerfile" \
    -t "$IMAGE_PREFIX:$version-fpm-alpine" \
    "$SCRIPT_DIR"

  if [ "$PUSH" = "1" ]; then
    docker push "$IMAGE_PREFIX:$version-fpm-alpine"
  fi
done
