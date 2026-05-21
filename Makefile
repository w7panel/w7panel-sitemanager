PROJECT_NAME=rangine

GO_BASE=$(shell pwd)
GO_BIN=$(GO_BASE)/bin
FILE_NAME=$(shell date +%Y%m%d%H%M)
HELM_VALUES_FILE=helm/bt/values.yaml

SOURCE_FILES=*.go

IMAGE_REPOSITORY ?= $(shell awk '/^image:/{flag=1; next} flag && /^[^[:space:]]/{flag=0} flag && $$1=="repository:" {print $$2; exit}' $(HELM_VALUES_FILE))
IMAGE_TAG ?= $(shell awk '/^image:/{flag=1; next} flag && /^[^[:space:]]/{flag=0} flag && $$1=="tag:" {print $$2; exit}' $(HELM_VALUES_FILE))
IMAGE_LATEST ?= $(IMAGE_REPOSITORY):latest
IMAGE_TARGET ?= $(IMAGE_REPOSITORY):$(IMAGE_TAG)

.PHONY: build-osx build build-windows makebuild dockerbuild publish dev test help

build-osx:
	go build -o ${GO_BIN}/${PROJECT_NAME}_osx ${SOURCE_FILES}
build:
	CGO_ENABLED=1 GOARCH=amd64 GOOS=linux CC=x86_64-linux-musl-gcc CXX=x86_64-linux-musl-g++ go build -gcflags=-trimpath=$GOPATH -asmflags=-trimpath=$GOPATH -ldflags "-w -s" -o builder/server ${SOURCE_FILES}
build-windows:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o ${GO_BIN}/${PROJECT_NAME}.exe ${SOURCE_FILES}

makebuild: build

dockerbuild:
	docker build -t $(IMAGE_LATEST) .

publish: makebuild dockerbuild
	docker tag $(IMAGE_LATEST) $(IMAGE_TARGET)
	docker push $(IMAGE_TARGET)

dev:
	go run ${SOURCE_FILES} server:start

test:
	go test -v ./tests/...

help:
	@echo "make - 编译 Go 代码, 生成二进制文件"
	@echo "make dev - 在开发模式下编译 Go 代码"
	@echo "make publish - 编译二进制、构建镜像、按 Helm tag 打 tag 并 push"
