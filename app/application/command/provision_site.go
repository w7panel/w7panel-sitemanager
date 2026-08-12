package command

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/we7coreteam/w7-rangine-go/v2/src/console"
)

const (
	rootCAInjectionAnnotationKey     = "w7.cc/inject-root-ca"
	systemRebootRestoreAnnotationKey = "w7.cc/system-reboot-restore"
	sysboxRootfsRWLayerAnnotation    = "sysbox/rootfs-rw-layer"
)

type siteProvisionCommandArgs struct {
	PanelURL              string
	PanelToken            string
	PanelAccessToken      string
	Namespace             string
	Operation             string
	Release               string
	EnvironmentTitle      string
	EnvironmentName       string
	EnvironmentVersion    string
	EnvironmentLanguage   string
	Domain                string
	EnableSSL             bool
	AppName               string
	SiteK8sAppName        string
	TargetEnvAppName      string
	CodeDownloadURL       string
	SidecarContainers     string
	SidecarInitContainers string
	SidecarVolumes        string
	HostAliases           string
	PodAnnotations        string
}

var siteProvisionArgsValue siteProvisionCommandArgs

type SiteProvision struct {
	console.Abstract
}

func (SiteProvision) GetName() string {
	return "provision:site"
}

func (SiteProvision) Configure(cmd *cobra.Command) {
	cmd.Flags().StringVar(&siteProvisionArgsValue.PanelURL, "panel-url", "", "W7Panel internal URL")
	cmd.Flags().StringVar(&siteProvisionArgsValue.PanelToken, "panel-token", "", "W7Panel token used to call the Kubernetes proxy")
	cmd.Flags().StringVar(&siteProvisionArgsValue.PanelAccessToken, "panel-access-token", "", "W7Panel access token used to log in to site manager")
	cmd.Flags().StringVar(&siteProvisionArgsValue.Namespace, "namespace", "default", "Kubernetes namespace")
	cmd.Flags().StringVar(&siteProvisionArgsValue.Operation, "operation", "install", "Helm operation: install or upgrade")
	cmd.Flags().StringVar(&siteProvisionArgsValue.Release, "release", "", "Helm release name")
	cmd.Flags().StringVar(&siteProvisionArgsValue.EnvironmentTitle, "title", "", "environment title")
	cmd.Flags().StringVar(&siteProvisionArgsValue.EnvironmentName, "name", "", "source environment deployment name")
	cmd.Flags().StringVar(&siteProvisionArgsValue.EnvironmentLanguage, "language", "", "environment language")
	cmd.Flags().StringVar(&siteProvisionArgsValue.EnvironmentVersion, "version", "", "environment version")
	cmd.Flags().StringVar(&siteProvisionArgsValue.Domain, "domain", "", "site domain")
	cmd.Flags().BoolVar(&siteProvisionArgsValue.EnableSSL, "ssl", false, "enable SSL")
	cmd.Flags().StringVar(&siteProvisionArgsValue.AppName, "app-name", "", "application identify")
	cmd.Flags().StringVar(&siteProvisionArgsValue.SiteK8sAppName, "site-k8s-app-name", "", "site Kubernetes application name")
	cmd.Flags().StringVar(&siteProvisionArgsValue.TargetEnvAppName, "target-env-app-name", "", "target environment deployment name")
	cmd.Flags().StringVar(&siteProvisionArgsValue.CodeDownloadURL, "code-download-url", "", "code download URL")
	cmd.Flags().StringVar(&siteProvisionArgsValue.SidecarContainers, "sidecar-containers", "", "base64 encoded sidecar containers JSON")
	cmd.Flags().StringVar(&siteProvisionArgsValue.SidecarInitContainers, "sidecar-init-containers", "", "base64 encoded sidecar init containers JSON")
	cmd.Flags().StringVar(&siteProvisionArgsValue.SidecarVolumes, "sidecar-volumes", "", "base64 encoded sidecar volumes JSON")
	cmd.Flags().StringVar(&siteProvisionArgsValue.HostAliases, "host-aliases", "", "base64 encoded Pod hostAliases JSON")
	cmd.Flags().StringVar(&siteProvisionArgsValue.PodAnnotations, "pod-annotations", "", "base64 encoded pod annotations JSON")
}

func (SiteProvision) GetDescription() string {
	return "provision a traditional site through W7Panel APIs"
}

func (SiteProvision) Handle(cmd *cobra.Command, _ []string) {
	if err := runSiteProvision(cmd.Context(), siteProvisionArgsValue); err != nil {
		panic(err)
	}
}

type panelKubernetesClient interface {
	Get(context.Context, string, any) error
	Post(context.Context, string, any, any) error
	Patch(context.Context, string, any, any) error
	Delete(context.Context, string) error
}

type panelKubernetesAPI struct {
	baseURL string
	token   string
	client  *http.Client
}

type panelAPIError struct {
	StatusCode int
	Body       string
}

func (e panelAPIError) Error() string {
	return fmt.Sprintf("panel Kubernetes proxy returned HTTP %d: %s", e.StatusCode, e.Body)
}

func newPanelKubernetesAPI(baseURL, token string) (*panelKubernetesAPI, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, errors.New("panel-url is required")
	}
	return &panelKubernetesAPI{
		baseURL: baseURL,
		token:   token,
		client:  &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (p *panelKubernetesAPI) Get(ctx context.Context, path string, response any) error {
	return p.do(ctx, http.MethodGet, path, nil, response)
}

func (p *panelKubernetesAPI) Post(ctx context.Context, path string, body, response any) error {
	return p.do(ctx, http.MethodPost, path, body, response)
}

func (p *panelKubernetesAPI) Patch(ctx context.Context, path string, body, response any) error {
	return p.doWithContentType(ctx, http.MethodPatch, path, body, response, "application/strategic-merge-patch+json")
}

func (p *panelKubernetesAPI) Delete(ctx context.Context, path string) error {
	return p.do(ctx, http.MethodDelete, path, nil, nil)
}

func (p *panelKubernetesAPI) do(ctx context.Context, method, path string, body, response any) error {
	return p.doWithContentType(ctx, method, path, body, response, "application/json")
}

func (p *panelKubernetesAPI) doWithContentType(ctx context.Context, method, path string, body, response any, contentType string) error {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(data)
	}
	request, err := http.NewRequestWithContext(ctx, method, p.baseURL+"/k8s-proxy"+path, bodyReader)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+p.token)
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", contentType)
	}

	result, err := p.client.Do(request)
	if err != nil {
		return err
	}
	defer result.Body.Close()
	resultBody, err := io.ReadAll(result.Body)
	if err != nil {
		return err
	}
	if result.StatusCode < http.StatusOK || result.StatusCode >= http.StatusMultipleChoices {
		return panelAPIError{StatusCode: result.StatusCode, Body: strings.TrimSpace(string(resultBody))}
	}
	if response == nil || len(resultBody) == 0 {
		return nil
	}
	return json.Unmarshal(resultBody, response)
}

type siteProvisioner struct {
	panel panelKubernetesClient
	args  siteProvisionCommandArgs
}

type provisionResult struct {
	EnvironmentAppName string
	NginxVhostTemplate string
	CreatedEnvironment bool
	CreatedIngressName string
}

func runSiteProvision(ctx context.Context, args siteProvisionCommandArgs) error {
	if err := validateProvisionArgs(args); err != nil {
		return err
	}
	panel, err := newPanelKubernetesAPI(args.PanelURL, args.PanelToken)
	if err != nil {
		return err
	}
	provisioner := siteProvisioner{panel: panel, args: args}
	result, err := provisioner.provision(ctx)
	if err != nil {
		return err
	}

	if err = createSite(buildCreateSiteArgs(args, result)); err != nil {
		provisioner.rollback(ctx, result)
		return fmt.Errorf("create site: %w", err)
	}

	slog.Info("site provisioned", "app_name", args.AppName, "domain", args.Domain, "environment_app_name", result.EnvironmentAppName)
	return nil
}

func buildCreateSiteArgs(args siteProvisionCommandArgs, result provisionResult) appCommandArgs {
	return appCommandArgs{
		AppName:             args.AppName,
		EnvironmentTitle:    args.EnvironmentTitle,
		EnvironmentName:     args.EnvironmentName,
		EnvironmentVersion:  args.EnvironmentVersion,
		EnvironmentLanguage: args.EnvironmentLanguage,
		CodeDownloadUrl:     args.CodeDownloadURL,
		Domain:              args.Domain,
		K8sAppName:          args.SiteK8sAppName,
		K8sEnvAppName:       result.EnvironmentAppName,
		NginxVhostTemplate:  result.NginxVhostTemplate,
		EnableSsl:           args.EnableSSL,
		Token:               args.PanelAccessToken,
	}
}

func validateProvisionArgs(args siteProvisionCommandArgs) error {
	required := map[string]string{
		"panel-url":           args.PanelURL,
		"panel-token":         args.PanelToken,
		"panel-access-token":  args.PanelAccessToken,
		"namespace":           args.Namespace,
		"release":             args.Release,
		"name":                args.EnvironmentName,
		"version":             args.EnvironmentVersion,
		"language":            args.EnvironmentLanguage,
		"domain":              args.Domain,
		"app-name":            args.AppName,
		"site-k8s-app-name":   args.SiteK8sAppName,
		"target-env-app-name": args.TargetEnvAppName,
		"code-download-url":   args.CodeDownloadURL,
	}
	for name, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required", name)
		}
	}
	if args.Operation != "install" && args.Operation != "upgrade" {
		return errors.New("operation must be install or upgrade")
	}
	return nil
}

func (p siteProvisioner) provision(ctx context.Context) (provisionResult, error) {
	result, err := p.prepareEnvironment(ctx)
	if err != nil {
		return provisionResult{}, err
	}
	if p.args.Operation == "install" {
		result.CreatedIngressName, err = p.createIngress(ctx)
		if err != nil {
			p.rollback(ctx, result)
			return provisionResult{}, err
		}
	}
	return result, nil
}

func (p siteProvisioner) deploymentPath(name string) string {
	return "/apis/apps/v1/namespaces/" + p.args.Namespace + "/deployments/" + panelSafeName(name)
}

func (p siteProvisioner) prepareEnvironment(ctx context.Context) (provisionResult, error) {
	var target map[string]any
	err := p.panel.Get(ctx, p.deploymentPath(p.args.TargetEnvAppName), &target)
	if err == nil {
		if err = p.patchExistingEnvironmentPodExtensions(ctx, target); err != nil {
			return provisionResult{}, err
		}
		return provisionResult{
			EnvironmentAppName: p.args.TargetEnvAppName,
			NginxVhostTemplate: nginxVhostTemplate(target),
		}, nil
	}
	// Keep the legacy shell behavior: any failed target lookup falls through to
	// resolving and creating the environment. The following source lookup or
	// create request will still surface authentication and connectivity errors.
	var source map[string]any
	if err = p.panel.Get(ctx, p.deploymentPath(p.args.EnvironmentName), &source); err != nil {
		return provisionResult{}, fmt.Errorf("query source environment deployment: %w", err)
	}
	prepared, err := p.buildEnvironmentDeployment(ctx, source)
	if err != nil {
		return provisionResult{}, err
	}
	path := "/apis/apps/v1/namespaces/" + p.args.Namespace + "/deployments"
	if err = p.panel.Post(ctx, path, prepared, nil); err != nil {
		return provisionResult{}, fmt.Errorf("create environment deployment: %w", err)
	}
	// The original YAML queried the target again after POST before reading the
	// nginx template. Preserve that behavior so webhook mutations are visible.
	var created map[string]any
	if err = p.panel.Get(ctx, p.deploymentPath(p.args.TargetEnvAppName), &created); err != nil {
		return provisionResult{}, fmt.Errorf("query created environment deployment: %w", err)
	}
	return provisionResult{
		EnvironmentAppName: p.args.TargetEnvAppName,
		NginxVhostTemplate: nginxVhostTemplate(created),
		CreatedEnvironment: true,
	}, nil
}

func (p siteProvisioner) patchExistingEnvironmentPodExtensions(ctx context.Context, deployment map[string]any) error {
	if !hasProvisionPodExtensions(p.args) {
		return nil
	}
	template := objectMap(objectMap(deployment, "spec"), "template")
	templateMetadata := objectMap(template, "metadata")
	templateAnnotations := objectMap(templateMetadata, "annotations")
	podSpec := objectMap(template, "spec")
	if err := applyProvisionPodExtensions(podSpec, templateAnnotations, p.args); err != nil {
		return fmt.Errorf("apply sidecars to existing environment deployment: %w", err)
	}
	patch := map[string]any{
		"spec": map[string]any{
			"template": template,
		},
	}
	if err := p.panel.Patch(ctx, p.deploymentPath(p.args.TargetEnvAppName), patch, nil); err != nil {
		return fmt.Errorf("patch existing environment deployment sidecars: %w", err)
	}
	return nil
}

func hasProvisionPodExtensions(args siteProvisionCommandArgs) bool {
	return strings.TrimSpace(args.SidecarContainers) != "" ||
		strings.TrimSpace(args.SidecarInitContainers) != "" ||
		strings.TrimSpace(args.SidecarVolumes) != "" ||
		strings.TrimSpace(args.HostAliases) != "" ||
		strings.TrimSpace(args.PodAnnotations) != ""
}

func (p siteProvisioner) buildEnvironmentDeployment(ctx context.Context, source map[string]any) (map[string]any, error) {
	result, ok := deepCopyJSONValue(source).(map[string]any)
	if !ok {
		return nil, errors.New("source environment deployment is invalid")
	}
	template := objectMap(objectMap(result, "spec"), "template")
	templateMetadata := objectMap(template, "metadata")
	templateAnnotations := objectMap(templateMetadata, "annotations")
	var siteManager map[string]any
	if err := p.panel.Get(ctx, p.deploymentPath("w7-sitemanager-site-manager"), &siteManager); err != nil {
		return nil, fmt.Errorf("query site-manager deployment for shared storage: %w", err)
	}
	sharedPVCName, err := mergeSiteManagerStorage(result, siteManager)
	if err != nil {
		return nil, fmt.Errorf("merge site-manager shared storage: %w", err)
	}
	delete(templateAnnotations, "w7.cc/yaml_copy")

	metadata := objectMap(result, "metadata")
	for _, key := range []string{"resourceVersion", "uid", "creationTimestamp", "managedFields", "ownerReferences"} {
		delete(metadata, key)
	}
	delete(result, "status")
	metadata["name"] = p.args.TargetEnvAppName
	metadata["namespace"] = p.args.Namespace
	metadata["generation"] = 0
	annotations := objectMap(metadata, "annotations")
	labels := objectMap(metadata, "labels")
	annotations["w7.cc/create-svc"] = "true"
	annotations["title"] = p.args.TargetEnvAppName
	annotations["w7.cc/owner-group-name"] = p.args.Release
	labels["w7.cc/owner-group-name"] = p.args.Release
	labels["app"] = p.args.TargetEnvAppName

	spec := objectMap(result, "spec")
	selectorLabels := objectMap(objectMap(spec, "selector"), "matchLabels")
	selectorLabels["app"] = p.args.TargetEnvAppName
	templateLabels := objectMap(templateMetadata, "labels")
	templateLabels["app"] = p.args.TargetEnvAppName
	podSpec := objectMap(template, "spec")
	if err := applyProvisionPodExtensions(podSpec, templateAnnotations, p.args); err != nil {
		return nil, err
	}
	containers, ok := podSpec["containers"].([]any)
	if !ok || len(containers) == 0 {
		return nil, errors.New("source environment deployment has no containers")
	}
	container, ok := containers[0].(map[string]any)
	if !ok {
		return nil, errors.New("source environment deployment has an invalid first container")
	}
	container["name"] = p.args.TargetEnvAppName
	if strings.EqualFold(strings.TrimSpace(fmt.Sprint(templateAnnotations[systemRebootRestoreAnnotationKey])), "false") {
		podSpec["runtimeClassName"] = "sysbox-runc"
		podSpec["hostUsers"] = false
	}
	if err := rebuildPersistentRootfsAnnotation(templateAnnotations, p.args.TargetEnvAppName, sharedPVCName); err != nil {
		return nil, fmt.Errorf("configure persistent rootfs: %w", err)
	}
	if imageTemplate, _ := templateAnnotations["w7.cc/image_template"].(string); imageTemplate != "" {
		container["image"] = strings.ReplaceAll(imageTemplate, "{version}", p.args.EnvironmentVersion)
	}
	env, _ := container["env"].([]any)
	for _, item := range env {
		if variable, ok := item.(map[string]any); ok && variable["name"] == "METADATA_NAME" {
			variable["value"] = p.args.TargetEnvAppName
			delete(variable, "valueFrom")
		}
	}
	container["env"] = env
	podSpec["affinity"] = map[string]any{
		"podAffinity": map[string]any{
			"requiredDuringSchedulingIgnoredDuringExecution": []any{map[string]any{
				"labelSelector": map[string]any{
					"matchExpressions": []any{map[string]any{
						"key": "w7.cc/identifie", "operator": "In", "values": []any{"w7-sitemanager"},
					}},
				},
				"topologyKey": "kubernetes.io/hostname",
			}},
		},
	}
	return result, nil
}

func rebuildPersistentRootfsAnnotation(annotations map[string]any, containerName, pvcName string) error {
	restoreValue, configured := annotations[systemRebootRestoreAnnotationKey]
	if !configured || !strings.EqualFold(strings.TrimSpace(fmt.Sprint(restoreValue)), "false") {
		delete(annotations, sysboxRootfsRWLayerAnnotation)
		return nil
	}
	if strings.TrimSpace(pvcName) == "" {
		return errors.New("site-manager shared storage has no PVC claimName")
	}
	value, err := json.Marshal([]map[string]any{{
		"name":                    containerName,
		"volumeName":              pvcName,
		"path":                    fmt.Sprintf("/www/server/%s/system", containerName),
		"persistentSpecialMounts": true,
	}})
	if err != nil {
		return fmt.Errorf("encode annotation: %w", err)
	}
	annotations[sysboxRootfsRWLayerAnnotation] = string(value)
	return nil
}

func ensureRootCAInjectionAnnotation(sidecarContainers []any, annotations map[string]any) {
	if len(sidecarContainers) == 0 {
		return
	}
	annotations[rootCAInjectionAnnotationKey] = "true"
}

func applyProvisionPodExtensions(podSpec, annotations map[string]any, args siteProvisionCommandArgs) error {
	containers, err := decodeProvisionObjectList(args.SidecarContainers, "sidecar containers")
	if err != nil {
		return err
	}
	initContainers, err := decodeProvisionObjectList(args.SidecarInitContainers, "sidecar init containers")
	if err != nil {
		return err
	}
	volumes, err := decodeProvisionObjectList(args.SidecarVolumes, "sidecar volumes")
	if err != nil {
		return err
	}
	hostAliases, err := decodeProvisionObjectList(args.HostAliases, "host aliases")
	if err != nil {
		return err
	}
	podAnnotations, err := decodeProvisionObjectMap(args.PodAnnotations, "pod annotations")
	if err != nil {
		return err
	}

	if len(containers) > 0 {
		existing, err := optionalObjectList(podSpec, "containers", "target environment containers")
		if err != nil {
			return err
		}
		podSpec["containers"] = mergeNamedObjectLists(existing, containers)
	}
	if len(initContainers) > 0 {
		existing, err := optionalObjectList(podSpec, "initContainers", "target environment initContainers")
		if err != nil {
			return err
		}
		podSpec["initContainers"] = mergeNamedObjectLists(existing, initContainers)
	}
	if len(volumes) > 0 {
		existing, err := optionalObjectList(podSpec, "volumes", "target environment volumes")
		if err != nil {
			return err
		}
		podSpec["volumes"] = mergeNamedObjectLists(existing, volumes)
	}
	if len(hostAliases) > 0 {
		existing, err := optionalObjectList(podSpec, "hostAliases", "target environment hostAliases")
		if err != nil {
			return err
		}
		merged, err := mergeHostAliasLists(existing, hostAliases)
		if err != nil {
			return err
		}
		podSpec["hostAliases"] = merged
	}
	for key, value := range podAnnotations {
		annotations[key] = value
	}
	// A provisioned sidecar must always receive the panel root CA. Apply this
	// after caller-provided annotations so a stale or explicit false value
	// cannot disable the mount required by the sidecar.
	ensureRootCAInjectionAnnotation(containers, annotations)
	return nil
}

func decodeProvisionObjectList(encoded, description string) ([]any, error) {
	if strings.TrimSpace(encoded) == "" {
		return nil, nil
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode %s: %w", description, err)
	}
	items := []any{}
	if err = json.Unmarshal(data, &items); err != nil {
		return nil, fmt.Errorf("parse %s: %w", description, err)
	}
	for _, item := range items {
		if _, ok := item.(map[string]any); !ok {
			return nil, fmt.Errorf("%s must contain JSON objects", description)
		}
	}
	return items, nil
}

func decodeProvisionObjectMap(encoded, description string) (map[string]any, error) {
	if strings.TrimSpace(encoded) == "" {
		return nil, nil
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode %s: %w", description, err)
	}
	value := map[string]any{}
	if err = json.Unmarshal(data, &value); err != nil {
		return nil, fmt.Errorf("parse %s: %w", description, err)
	}
	return value, nil
}

func mergeNamedObjectLists(existing, additions []any) []any {
	result := append([]any(nil), existing...)
	indexByName := make(map[string]int, len(result))
	for index, item := range result {
		if object, ok := item.(map[string]any); ok {
			if name, _ := object["name"].(string); name != "" {
				indexByName[name] = index
			}
		}
	}
	for _, item := range additions {
		object := item.(map[string]any)
		name, _ := object["name"].(string)
		if index, exists := indexByName[name]; name != "" && exists {
			result[index] = object
			continue
		}
		if name != "" {
			indexByName[name] = len(result)
		}
		result = append(result, object)
	}
	return result
}

func mergeHostAliasLists(existing, additions []any) ([]any, error) {
	result := make([]any, 0, len(existing)+len(additions))
	indexByIP := make(map[string]int)
	hostnameIPs := make(map[string]string)

	for _, item := range append(append([]any(nil), existing...), additions...) {
		alias, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("host aliases must contain JSON objects")
		}
		ip, _ := alias["ip"].(string)
		ip = strings.TrimSpace(ip)
		if net.ParseIP(ip) == nil {
			return nil, fmt.Errorf("host alias has invalid IP %q", ip)
		}
		hostnamesValue, ok := alias["hostnames"].([]any)
		if !ok || len(hostnamesValue) == 0 {
			return nil, fmt.Errorf("host alias %s has no hostnames", ip)
		}

		hostnames := make([]any, 0, len(hostnamesValue))
		for _, value := range hostnamesValue {
			hostname, ok := value.(string)
			hostname = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(hostname)), ".")
			if !ok || hostname == "" {
				return nil, fmt.Errorf("host alias %s contains an invalid hostname", ip)
			}
			if existingIP, exists := hostnameIPs[hostname]; exists && existingIP != ip {
				return nil, fmt.Errorf("host alias %s maps to both %s and %s", hostname, existingIP, ip)
			}
			hostnameIPs[hostname] = ip
			hostnames = appendUniqueStringValue(hostnames, hostname)
		}

		if index, exists := indexByIP[ip]; exists {
			existingAlias := result[index].(map[string]any)
			existingHostnames := existingAlias["hostnames"].([]any)
			for _, hostname := range hostnames {
				existingHostnames = appendUniqueStringValue(existingHostnames, hostname.(string))
			}
			existingAlias["hostnames"] = existingHostnames
			continue
		}
		indexByIP[ip] = len(result)
		result = append(result, map[string]any{"ip": ip, "hostnames": hostnames})
	}
	return result, nil
}

func appendUniqueStringValue(values []any, value string) []any {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func (p siteProvisioner) createIngress(ctx context.Context) (string, error) {
	name, err := randomIngressName()
	if err != nil {
		return "", err
	}
	annotations := map[string]any{
		"kubernetes.io/ingress.class": "higress",
		"higress.io/resource-definer": "higress",
	}
	if p.args.EnableSSL {
		annotations["higress.io/ssl-redirect"] = "false"
		annotations["w7.cc/ssl-redirect"] = "false"
		annotations["cert-manager.io/cluster-issuer"] = "w7-letsencrypt-prod"
		annotations["cert-manager.io/renew-before"] = "30m"
	}
	ingress := map[string]any{
		"apiVersion": "networking.k8s.io/v1",
		"kind":       "Ingress",
		"metadata": map[string]any{
			"name": name, "namespace": p.args.Namespace, "annotations": annotations,
			"labels": map[string]any{
				"higress.io/resource-definer": "higress",
				"app":                         "w7-sitemanager-site-manager-nginx", "group": "w7-sitemanager",
				"w7.cc/group-name": "w7-sitemanager", "w7.cc/group-names": p.args.Release,
			},
		},
		"spec": map[string]any{
			"rules": []any{map[string]any{
				"host": p.args.Domain,
				"http": map[string]any{"paths": []any{map[string]any{
					"path": "/", "pathType": "Prefix",
					"backend": map[string]any{"service": map[string]any{
						"name": "w7-sitemanager-site-manager-nginx",
						"port": map[string]any{"number": 80},
					}},
				}}},
			}},
		},
	}
	if p.args.EnableSSL {
		objectMap(ingress, "spec")["tls"] = []any{map[string]any{
			"hosts": []any{p.args.Domain}, "secretName": p.args.Domain + "-tls-secret",
		}}
	}
	path := "/apis/networking.k8s.io/v1/namespaces/" + p.args.Namespace + "/ingresses"
	if err = p.panel.Post(ctx, path, ingress, nil); err != nil {
		return "", fmt.Errorf("create ingress %s: %w", name, err)
	}
	return name, nil
}

func (p siteProvisioner) rollback(ctx context.Context, result provisionResult) {
	if result.CreatedIngressName != "" {
		path := "/apis/networking.k8s.io/v1/namespaces/" + p.args.Namespace + "/ingresses/" + result.CreatedIngressName
		if err := p.panel.Delete(ctx, path); err != nil && !isPanelNotFound(err) {
			slog.Error("rollback ingress failed", "name", result.CreatedIngressName, "err", err)
		}
	}
	if result.CreatedEnvironment {
		if err := p.panel.Delete(ctx, p.deploymentPath(result.EnvironmentAppName)); err != nil && !isPanelNotFound(err) {
			slog.Error("rollback environment deployment failed", "name", result.EnvironmentAppName, "err", err)
		}
	}
}

func isPanelNotFound(err error) bool {
	var apiError panelAPIError
	return errors.As(err, &apiError) && apiError.StatusCode == http.StatusNotFound
}

func mergeSiteManagerStorage(target, siteManager map[string]any) (string, error) {
	sourcePodSpec, err := deploymentPodSpec(siteManager, "site-manager")
	if err != nil {
		return "", err
	}
	sourceContainers, ok := sourcePodSpec["containers"].([]any)
	if !ok || len(sourceContainers) == 0 {
		return "", errors.New("site-manager deployment has no containers")
	}
	sourceContainer, ok := sourceContainers[0].(map[string]any)
	if !ok {
		return "", errors.New("site-manager deployment has an invalid first container")
	}
	sourceMounts, ok := sourceContainer["volumeMounts"].([]any)
	if !ok || len(sourceMounts) <= 3 {
		return "", errors.New("site-manager deployment requires volumeMounts[2] and volumeMounts[3]")
	}
	sourceVolumes, ok := sourcePodSpec["volumes"].([]any)
	if !ok || len(sourceVolumes) == 0 {
		return "", errors.New("site-manager deployment requires a PVC volume")
	}

	targetPodSpec, err := deploymentPodSpec(target, "target environment")
	if err != nil {
		return "", err
	}
	targetContainers, ok := targetPodSpec["containers"].([]any)
	if !ok || len(targetContainers) == 0 {
		return "", errors.New("target environment deployment has no containers")
	}
	targetContainer, ok := targetContainers[0].(map[string]any)
	if !ok {
		return "", errors.New("target environment deployment has an invalid first container")
	}
	targetMounts, err := optionalObjectList(targetContainer, "volumeMounts", "target environment volumeMounts")
	if err != nil {
		return "", err
	}
	for _, index := range []int{2, 3} {
		mount, ok := sourceMounts[index].(map[string]any)
		if !ok {
			return "", fmt.Errorf("site-manager deployment volumeMounts[%d] is invalid", index)
		}
		targetMounts = append(targetMounts, deepCopyJSONValue(mount))
	}
	targetContainer["volumeMounts"] = targetMounts

	targetVolumes, err := optionalObjectList(targetPodSpec, "volumes", "target environment volumes")
	if err != nil {
		return "", err
	}
	var sourceVolume map[string]any
	for index, item := range sourceVolumes {
		volume, ok := item.(map[string]any)
		if !ok {
			return "", fmt.Errorf("site-manager deployment volumes[%d] is invalid", index)
		}
		if _, ok := volume["persistentVolumeClaim"].(map[string]any); ok {
			sourceVolume = volume
			break
		}
	}
	if sourceVolume == nil {
		return "", nil
	}
	claimName, _ := sourceVolume["name"].(string)
	if strings.TrimSpace(claimName) == "" {
		return "", errors.New("site-manager deployment PVC volume has no name")
	}
	if !containsNamedObject(targetVolumes, sourceVolume) {
		targetVolumes = append(targetVolumes, deepCopyJSONValue(sourceVolume))
	}
	targetPodSpec["volumes"] = targetVolumes
	return claimName, nil
}

func deploymentPodSpec(deployment map[string]any, description string) (map[string]any, error) {
	spec, ok := deployment["spec"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s deployment has no spec", description)
	}
	template, ok := spec["template"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s deployment has no pod template", description)
	}
	podSpec, ok := template["spec"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s deployment has no pod spec", description)
	}
	return podSpec, nil
}

func optionalObjectList(parent map[string]any, key, description string) ([]any, error) {
	value, exists := parent[key]
	if !exists || value == nil {
		return []any{}, nil
	}
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("%s is invalid", description)
	}
	return items, nil
}

func containsNamedObject(existing []any, candidate map[string]any) bool {
	candidateName, _ := candidate["name"].(string)
	for _, item := range existing {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if name, _ := object["name"].(string); candidateName != "" && name == candidateName {
			return true
		}
	}
	return false
}

func deepCopyJSONValue(value any) any {
	data, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var copied any
	if err = json.Unmarshal(data, &copied); err != nil {
		return value
	}
	return copied
}

func objectMap(parent map[string]any, key string) map[string]any {
	if value, ok := parent[key].(map[string]any); ok {
		return value
	}
	value := map[string]any{}
	parent[key] = value
	return value
}

func nginxVhostTemplate(deployment map[string]any) string {
	spec := objectMap(deployment, "spec")
	template := objectMap(spec, "template")
	templateMetadata := objectMap(template, "metadata")
	if rawValue, exists := objectMap(templateMetadata, "annotations")["w7.cc/nginx_vhost_template"]; exists && rawValue != nil && rawValue != false {
		value, _ := rawValue.(string)
		return value
	}
	metadata := objectMap(deployment, "metadata")
	rawValue := objectMap(metadata, "annotations")["w7.cc/nginx_vhost_template"]
	if rawValue == nil || rawValue == false {
		return ""
	}
	value, _ := rawValue.(string)
	return value
}

func panelSafeName(value string) string {
	return strings.ReplaceAll(value, "_", "-")
}

func randomIngressName() (string, error) {
	random := make([]byte, 4)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("generate ingress name: %w", err)
	}
	name := fmt.Sprintf("ing-%d-%s", time.Now().Unix(), hex.EncodeToString(random))
	name = strings.ToLower(strings.ReplaceAll(name, "_", "-"))
	if len(name) > 63 {
		name = name[:63]
	}
	return strings.TrimSuffix(name, "-"), nil
}
