PROJECT_NAME=rangine

GO_BASE=$(shell pwd)
GO_BIN=$(GO_BASE)/bin
FILE_NAME=$(shell date +%Y%m%d%H%M)
LINUX_CC ?= x86_64-linux-musl-gcc
LINUX_CXX ?= x86_64-linux-musl-g++
HELM_CHART_DIR=charts
HELM_VALUES_FILE := $(HELM_CHART_DIR)/values.yaml
HELM_IMAGE_REPOSITORY := $(shell awk '/^image:/{flag=1; next} flag && /^[^[:space:]]/{flag=0} flag && $$1=="repository:" {print $$2; exit}' $(HELM_VALUES_FILE))
HELM_IMAGE_TAG := $(shell awk '/^image:/{flag=1; next} flag && /^[^[:space:]]/{flag=0} flag && $$1=="tag:" {print $$2; exit}' $(HELM_VALUES_FILE))
IMAGE_REPOSITORY ?= $(HELM_IMAGE_REPOSITORY)
IMAGE_TAG ?= $(HELM_IMAGE_TAG)
HELM_CHART_VERSION ?= $(shell awk '$$1=="version:" {print $$2; exit}' $(HELM_CHART_DIR)/Chart.yaml)
HELM_APP_VERSION ?= $(IMAGE_TAG)
HELM_PACKAGE_IMAGE_TAG ?= $(IMAGE_TAG)
HELM_PACKAGE ?= $(HELM_CHART_DIR)/site-manager-$(HELM_CHART_VERSION).tgz
HELM_NGINX_PACKAGE ?= $(HELM_CHART_DIR)/charts/site-manager-nginx-$(HELM_CHART_VERSION).tgz

SOURCE_FILES=*.go

IMAGE_TARGET ?= $(IMAGE_REPOSITORY):$(IMAGE_TAG)

.PHONY: tidy build-osx build build-windows makebuild dockerbuild helm-package publish dev test help

tidy:
	go mod tidy

build-osx:
	go build -o ${GO_BIN}/${PROJECT_NAME}_osx ${SOURCE_FILES}
build:
	CGO_ENABLED=1 GOARCH=amd64 GOOS=linux CC=$(LINUX_CC) CXX=$(LINUX_CXX) go build -gcflags=-trimpath=$$GOPATH -asmflags=-trimpath=$$GOPATH -ldflags "-w -s" -o builder/server ${SOURCE_FILES}
build-windows:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o ${GO_BIN}/${PROJECT_NAME}.exe ${SOURCE_FILES}

makebuild: tidy build

dockerbuild:
	docker build -t $(IMAGE_TARGET) .

helm-package:
	@test -n "$(HELM_PACKAGE_IMAGE_TAG)" || (echo "HELM_PACKAGE_IMAGE_TAG is empty. Pass HELM_PACKAGE_IMAGE_TAG=vX.Y.Z."; exit 1)
	@test -n "$(HELM_CHART_VERSION)" || (echo "HELM_CHART_VERSION is empty."; exit 1)
	@test -n "$(HELM_APP_VERSION)" || (echo "HELM_APP_VERSION is empty."; exit 1)
	@tmp_dir=$$(mktemp -d); \
	cp $(HELM_CHART_DIR)/Chart.yaml $$tmp_dir/Chart.yaml; \
	cp $(HELM_CHART_DIR)/values.yaml $$tmp_dir/values.yaml; \
	cp $(HELM_CHART_DIR)/charts/nginx/Chart.yaml $$tmp_dir/nginx-Chart.yaml; \
	test ! -f $(HELM_CHART_DIR)/Chart.lock || cp $(HELM_CHART_DIR)/Chart.lock $$tmp_dir/Chart.lock; \
	test ! -f $(HELM_NGINX_PACKAGE) || cp $(HELM_NGINX_PACKAGE) $$tmp_dir/site-manager-nginx.tgz; \
	restore() { \
		cp $$tmp_dir/Chart.yaml $(HELM_CHART_DIR)/Chart.yaml; \
		cp $$tmp_dir/values.yaml $(HELM_CHART_DIR)/values.yaml; \
		cp $$tmp_dir/nginx-Chart.yaml $(HELM_CHART_DIR)/charts/nginx/Chart.yaml; \
		if test -f $$tmp_dir/Chart.lock; then cp $$tmp_dir/Chart.lock $(HELM_CHART_DIR)/Chart.lock; else rm -f $(HELM_CHART_DIR)/Chart.lock; fi; \
		if test -f $$tmp_dir/site-manager-nginx.tgz; then cp $$tmp_dir/site-manager-nginx.tgz $(HELM_NGINX_PACKAGE); else rm -f $(HELM_NGINX_PACKAGE); fi; \
		rm -rf $$tmp_dir; \
	}; \
	trap restore EXIT; \
	rm -f $(HELM_PACKAGE); \
	perl -0pi -e 's/^version:\s*.*/version: $(HELM_CHART_VERSION)/m; s/^appVersion:\s*.*/appVersion: "$(HELM_APP_VERSION)"/m' $(HELM_CHART_DIR)/Chart.yaml; \
	perl -0pi -e 's/(- name:\s*site-manager-nginx\s*\n\s*version:\s*).*/$${1}$(HELM_CHART_VERSION)/m' $(HELM_CHART_DIR)/Chart.yaml; \
	perl -0pi -e 's/^version:\s*.*/version: $(HELM_CHART_VERSION)/m; s/^appVersion:\s*.*/appVersion: "$(HELM_APP_VERSION)"/m' $(HELM_CHART_DIR)/charts/nginx/Chart.yaml; \
	perl -0pi -e 's/^(\s*tag:\s*).*/$${1}$(HELM_PACKAGE_IMAGE_TAG)/m' $(HELM_CHART_DIR)/values.yaml; \
	helm dependency build --skip-refresh $(HELM_CHART_DIR); \
	helm package $(HELM_CHART_DIR) --destination $(HELM_CHART_DIR)

publish: makebuild dockerbuild helm-package
	@test -n "$(IMAGE_TAG)" || (echo "IMAGE_TAG is empty. Run from a git tag or pass IMAGE_TAG=vX.Y.Z."; exit 1)
	docker push $(IMAGE_TARGET)

dev:
	go run ${SOURCE_FILES} server:start

test:
	go test -v ./tests/...

help:
	@echo "make - 编译 Go 代码, 生成二进制文件"
	@echo "make dev - 在开发模式下编译 Go 代码"
	@echo "make publish - 编译二进制、构建镜像、按 git tag 打镜像 tag，并打包 Helm"
