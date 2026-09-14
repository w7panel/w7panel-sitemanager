UI_DIR ?= ui
HELM_CHART_DIR ?= charts
HELM_CHART := $(HELM_CHART_DIR)/Chart.yaml
HELM_CHART_NAME ?= $(shell awk '$$1=="name:" {print $$2; exit}' $(HELM_CHART))
HELM_CHART_VERSION ?= $(shell awk '$$1=="version:" {print $$2; exit}' $(HELM_CHART))
HELM_APP_VERSION ?= $(shell awk '$$1=="appVersion:" {gsub(/"/, "", $$2); print $$2; exit}' $(HELM_CHART))
PROJECT_NAME ?= $(HELM_CHART_NAME)
HELM_PACKAGE ?= $(HELM_CHART_DIR)/$(HELM_CHART_NAME)-$(HELM_CHART_VERSION).tgz
FRONTEND_PACKAGE ?= frontend.zip

.PHONY: ui-install ui-build frontend-package helm-lint helm-template helm-package package publish clean help
ui-install:
	cd $(UI_DIR) && npm ci
ui-build: ui-install
	cd $(UI_DIR) && npm run build
frontend-package: ui-build
	rm -f $(FRONTEND_PACKAGE)
	cd $(UI_DIR)/dist && zip -rq ../../$(FRONTEND_PACKAGE) .
helm-lint:
	helm lint $(HELM_CHART_DIR)
helm-template:
	helm template $(PROJECT_NAME) $(HELM_CHART_DIR) --set PVC_NAME=example-pvc
helm-package: helm-lint
	rm -f $(HELM_PACKAGE)
	helm package $(HELM_CHART_DIR) --destination $(HELM_CHART_DIR) --version "$(HELM_CHART_VERSION)" --app-version "$(HELM_APP_VERSION)"
package: frontend-package helm-package
publish: package
clean:
	rm -rf $(UI_DIR)/dist $(FRONTEND_PACKAGE)
help:
	@echo "make ui-build          构建 UI"
	@echo "make frontend-package  构建并打包 frontend.zip"
	@echo "make helm-lint         校验 Helm Chart"
	@echo "make helm-package      打包 Helm Chart"
	@echo "make package           构建前端并打包 Helm"
