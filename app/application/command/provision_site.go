package command

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/we7coreteam/w7-rangine-go/v2/src/console"
)

type siteProvisionCommandArgs struct {
	PanelURL            string
	PanelToken          string
	PanelAccessToken    string
	Namespace           string
	Operation           string
	Release             string
	EnvironmentTitle    string
	EnvironmentName     string
	EnvironmentVersion  string
	EnvironmentLanguage string
	Domain              string
	EnableSSL           bool
	AppName             string
	SiteK8sAppName      string
	TargetEnvAppName    string
	CodeDownloadURL     string
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

func (p *panelKubernetesAPI) Delete(ctx context.Context, path string) error {
	return p.do(ctx, http.MethodDelete, path, nil, nil)
}

func (p *panelKubernetesAPI) do(ctx context.Context, method, path string, body, response any) error {
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
		request.Header.Set("Content-Type", "application/json")
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

func (p siteProvisioner) buildEnvironmentDeployment(ctx context.Context, source map[string]any) (map[string]any, error) {
	result, ok := deepCopyJSONValue(source).(map[string]any)
	if !ok {
		return nil, errors.New("source environment deployment is invalid")
	}
	template := objectMap(objectMap(result, "spec"), "template")
	templateMetadata := objectMap(template, "metadata")
	templateAnnotations := objectMap(templateMetadata, "annotations")
	copyRules, _ := templateAnnotations["w7.cc/yaml_copy"].(string)
	if strings.TrimSpace(copyRules) != "" && copyRules != "null" {
		var copySource map[string]any
		if err := p.panel.Get(ctx, p.deploymentPath("w7-sitemanager-site-manager"), &copySource); err != nil {
			return nil, fmt.Errorf("query yaml_copy source deployment: %w", err)
		}
		var err error
		result, err = applyYAMLCopy(result, copySource, copyRules)
		if err != nil {
			return nil, fmt.Errorf("apply yaml_copy: %w", err)
		}
		template = objectMap(objectMap(result, "spec"), "template")
		templateMetadata = objectMap(template, "metadata")
		templateAnnotations = objectMap(templateMetadata, "annotations")
	}

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
	annotations["w7.cc/parent-group-name"] = p.args.Release
	labels["w7.cc/parent-group-name"] = p.args.Release
	labels["app"] = p.args.TargetEnvAppName

	spec := objectMap(result, "spec")
	selectorLabels := objectMap(objectMap(spec, "selector"), "matchLabels")
	selectorLabels["app"] = p.args.TargetEnvAppName
	templateLabels := objectMap(templateMetadata, "labels")
	templateLabels["app"] = p.args.TargetEnvAppName
	podSpec := objectMap(template, "spec")
	containers, ok := podSpec["containers"].([]any)
	if !ok || len(containers) == 0 {
		return nil, errors.New("source environment deployment has no containers")
	}
	container, ok := containers[0].(map[string]any)
	if !ok {
		return nil, errors.New("source environment deployment has an invalid first container")
	}
	container["name"] = p.args.TargetEnvAppName
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

type yamlCopyRule struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

var yamlPathPartRegexp = regexp.MustCompile(`^([^\[]+)(?:\[([0-9]+)\])?$`)

func applyYAMLCopy(target, source map[string]any, rulesJSON string) (map[string]any, error) {
	var rules []yamlCopyRule
	if err := json.Unmarshal([]byte(rulesJSON), &rules); err != nil {
		return nil, err
	}
	for _, rule := range rules {
		sourcePath, err := parseYAMLPath(rule.Source)
		if err != nil {
			return nil, err
		}
		targetPath, err := parseYAMLPath(rule.Target)
		if err != nil {
			return nil, err
		}
		value, err := getYAMLPath(source, sourcePath)
		if err != nil {
			return nil, fmt.Errorf("read source path %s: %w", rule.Source, err)
		}
		updated, err := setYAMLPath(target, targetPath, deepCopyJSONValue(value))
		if err != nil {
			return nil, fmt.Errorf("write target path %s: %w", rule.Target, err)
		}
		var ok bool
		target, ok = updated.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("yaml_copy target path %s replaced the deployment root", rule.Target)
		}
	}
	return target, nil
}

func parseYAMLPath(value string) ([]any, error) {
	parts := strings.Split(value, ".")
	path := make([]any, 0, len(parts)*2)
	for _, part := range parts {
		match := yamlPathPartRegexp.FindStringSubmatch(part)
		if len(match) == 0 {
			return nil, fmt.Errorf("invalid yaml_copy path %q", value)
		}
		path = append(path, match[1])
		if match[2] != "" {
			index, err := strconv.Atoi(match[2])
			if err != nil {
				return nil, err
			}
			path = append(path, index)
		}
	}
	return path, nil
}

func getYAMLPath(value any, path []any) (any, error) {
	current := value
	for _, part := range path {
		if current == nil {
			return nil, nil
		}
		switch key := part.(type) {
		case string:
			object, ok := current.(map[string]any)
			if !ok {
				return nil, nil
			}
			current = object[key]
		case int:
			list, ok := current.([]any)
			if !ok || key < 0 || key >= len(list) {
				return nil, nil
			}
			current = list[key]
		}
	}
	return current, nil
}

func setYAMLPath(value any, path []any, replacement any) (any, error) {
	if len(path) == 0 {
		return replacement, nil
	}
	switch key := path[0].(type) {
	case string:
		object, ok := value.(map[string]any)
		if !ok || object == nil {
			object = map[string]any{}
		}
		child, err := setYAMLPath(object[key], path[1:], replacement)
		if err != nil {
			return nil, err
		}
		object[key] = child
		return object, nil
	case int:
		if key < 0 {
			return nil, fmt.Errorf("index %d is out of range", key)
		}
		list, _ := value.([]any)
		for len(list) <= key {
			list = append(list, nil)
		}
		child, err := setYAMLPath(list[key], path[1:], replacement)
		if err != nil {
			return nil, err
		}
		list[key] = child
		return list, nil
	}
	return nil, errors.New("unsupported yaml_copy path component")
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
