{{/*
Expand the name of the chart.
*/}}
{{- define "tradition-tool.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "tradition-tool.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "tradition-tool.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "tradition-tool.labels" -}}
helm.sh/chart: {{ include "tradition-tool.chart" . }}
{{ include "tradition-tool.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "tradition-tool.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tradition-tool.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "tradition-tool.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "tradition-tool.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* 发布值仅决定未修改过的工具首次使用 nginx 还是 pause。 */}}
{{- define "tradition-tool.gatewayEnabled" -}}
{{- eq (lower (toString .Values.gatewayEnabled)) "true" -}}
{{- end -}}

{{/* 只读取工具自身明确标记的运行字段；不关联主应用，也不另外保存网关开关。 */}}
{{- define "tradition-tool.runtimeConfig" -}}
{{- $result := dict "selection" (dict) "containers" (dict) -}}
{{- if .Values.preserveRuntimeConfig -}}
  {{- $existing := lookup "apps/v1" "Deployment" .Release.Namespace (include "tradition-tool.fullname" .) -}}
  {{- $raw := dig "metadata" "annotations" "w7.cc/tradition-runtime-config" "{}" ($existing | default dict) -}}
  {{- $selection := mustFromJson $raw -}}
  {{- if not (kindIs "map" $selection) -}}{{- fail "tool runtime config must be a JSON object" -}}{{- end -}}
  {{- if and (hasKey $selection "servicePorts") (not (kindIs "bool" $selection.servicePorts)) -}}{{- fail "tool runtime servicePorts must be a boolean" -}}{{- end -}}
  {{- if and (hasKey $selection "containers") (not (kindIs "map" $selection.containers)) -}}{{- fail "tool runtime containers must be an object" -}}{{- end -}}
  {{- $selected := get $selection "containers" | default dict -}}
  {{- range $fields := $selected -}}
    {{- if not (kindIs "slice" $fields) -}}{{- fail "tool runtime fields must be an array" -}}{{- end -}}
    {{- range $field := $fields -}}
      {{- if not (has $field (list "image" "imagePullPolicy" "command" "args" "ports" "env")) -}}{{- fail "unsupported tool runtime container field" -}}{{- end -}}
    {{- end -}}
  {{- end -}}
  {{- $_ := set $result "selection" $selection -}}
  {{- range $container := dig "spec" "template" "spec" "containers" (list) ($existing | default dict) -}}
    {{- if hasKey $selected $container.name -}}
      {{- $_ := set $result.containers $container.name $container -}}
    {{- end -}}
  {{- end -}}
  {{- if ($selection.servicePorts | default false) -}}
    {{- $service := lookup "v1" "Service" .Release.Namespace (include "tradition-tool.fullname" .) -}}
    {{- if $service -}}
      {{- $ports := list -}}
      {{- range $port := dig "spec" "ports" (list) $service -}}
        {{- $ports = append $ports (pick $port "name" "port" "targetPort" "protocol" "appProtocol") -}}
      {{- end -}}
      {{- if $ports -}}
        {{- $_ := set $result "service" (dict "type" (dig "spec" "type" "ClusterIP" $service) "ports" $ports) -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- toJson $result -}}
{{- end -}}

{{/* The UI switches these rendered configurations instead of guessing image names or scripts. */}}
{{- define "tradition-tool.gatewayContainer" -}}
{{- $enabled := .enabled -}}
{{- with .root -}}
name: tradition-tool
securityContext:
  {{- toYaml .Values.securityContext | nindent 2 }}
{{- if $enabled }}
image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
imagePullPolicy: {{ .Values.image.pullPolicy }}
command: [ "sh", "-c" ]
args:
  - |
    CONF_PATH="{{.Values.global.NGINX_DIR}}/conf.d"
    NGINX_CONF="/etc/nginx/nginx.conf"
    mkdir -p "$CONF_PATH"

    DEFAULT_WORKER=2
    HOST_CPU=$(grep -c '^processor' /proc/cpuinfo)
    FINAL_WORKER=${NGINX_WORKER_PROCESSES:-$DEFAULT_WORKER}
    [ "$FINAL_WORKER" -eq "$HOST_CPU" ] && FINAL_WORKER=$DEFAULT_WORKER
    sed -i "s/\(worker_processes\).*;/\1 $FINAL_WORKER;/" "$NGINX_CONF"

    grep -q "include $CONF_PATH/\*.conf;" "$NGINX_CONF" || \
    sed -i "/include \/etc\/nginx\/conf.d\/\*.conf;/a\    include $CONF_PATH/*.conf;" "$NGINX_CONF"

    nginx -g 'daemon off;'
env:
  - name: NGINX_WORKER_PROCESSES
    valueFrom:
      resourceFieldRef:
        resource: limits.cpu
        divisor: '1'
ports:
  - name: http
    containerPort: 80
    protocol: TCP
  - name: https
    containerPort: 443
    protocol: TCP
{{- else }}
image: "{{ .Values.placeholderImage.repository }}:{{ .Values.placeholderImage.tag }}"
imagePullPolicy: {{ .Values.placeholderImage.pullPolicy | default "IfNotPresent" }}
{{- end }}
volumeMounts:
  - mountPath: {{.Values.global.NGINX_DIR}}
    name: site-storage
    subPath: nginx-dir
  - mountPath: {{.Values.global.NGINX_WEB_DIR}}
    name: site-storage
    subPath: nginx-web-dir
resources:
  {{- toYaml .Values.resources | nindent 2 }}
{{- end -}}
{{- end -}}
