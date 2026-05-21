package command

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/w7panel/w7panel-sitemanager/common/helper"
	"github.com/w7panel/w7panel-sitemanager/common/service/site_manager"
	"github.com/w7panel/w7panel-sitemanager/common/service/w7panel"
	"github.com/w7panel/w7panel-sitemanager/common/service/zpk"
	"github.com/we7coreteam/w7-rangine-go/v2/src/console"
	v1 "k8s.io/api/apps/v1"
	v3 "k8s.io/api/core/v1"
	v2 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type DeployInfo struct {
	Name          string `json:"name"`
	NginxTemplate string `json:"nginx_template"`
	IngressName   string `json:"ingress_name"`
}

type YamlCopyRule struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type appCommandArgs struct {
	W7PanelDomain       string
	W7PanelToken        string
	AppName             string
	EnvironmentTitle    string
	EnvironmentName     string
	EnvironmentVersion  string
	EnvironmentLanguage string
	CodeDownloadUrl     string
	Cmd                 string
	Domain              string
	EnableSsl           bool
}

var argsValue appCommandArgs

type SiteCreate struct {
	console.Abstract
}

func (c SiteCreate) GetName() string {
	return "create:site"
}

func (c SiteCreate) Configure(cmd *cobra.Command) {
	cmd.Flags().StringVar(&argsValue.W7PanelDomain, "w7panel-domain", "", "w7panel domain")
	cmd.Flags().StringVar(&argsValue.W7PanelToken, "w7panel-token", "", "w7panel token")
	cmd.Flags().StringVar(&argsValue.AppName, "app_name", "", "app name")
	cmd.Flags().StringVar(&argsValue.EnvironmentTitle, "title", "", "environment title")
	cmd.Flags().StringVar(&argsValue.EnvironmentName, "name", "", "environment name")
	cmd.Flags().StringVar(&argsValue.EnvironmentLanguage, "language", "", "environment language")
	cmd.Flags().StringVar(&argsValue.EnvironmentVersion, "version", "", "environment version")
	cmd.Flags().StringVar(&argsValue.Domain, "domain", "", "site domain")
	cmd.Flags().StringVar(&argsValue.CodeDownloadUrl, "code-download-url", "", "code download url")
	cmd.Flags().StringVar(&argsValue.Cmd, "cmd", "", "command")
	cmd.Flags().BoolVar(&argsValue.EnableSsl, "ssl", false, "enable ssl")
}

func (c SiteCreate) GetDescription() string {
	return "create site"
}

func (c SiteCreate) Handle(cmd *cobra.Command, args []string) {
	commands := make([]string, 0)
	if argsValue.Cmd != "" && argsValue.Cmd != "[\"\"]" {
		err := json.Unmarshal([]byte(argsValue.Cmd), &commands)
		if err != nil {
			panic(err)
		}
	}

	urlInfo, err := url.Parse(argsValue.CodeDownloadUrl)
	if err != nil {
		panic(err)
	}

	info, err := createSiteK8sResource(strings.ReplaceAll(argsValue.EnvironmentName, "_", "-"), argsValue.EnvironmentVersion, commands)
	if err != nil {
		panic(err)
	}

	environment, err := getSiteManagerService().CreateEnvironment(site_manager.CreateEnvironmentReq{
		Title:              argsValue.EnvironmentTitle,
		Language:           argsValue.EnvironmentLanguage,
		Version:            argsValue.EnvironmentVersion,
		Group:              strings.ReplaceAll(argsValue.EnvironmentName, "_", "-"),
		AppName:            info.Name,
		NginxVhostTemplate: info.NginxTemplate,
	})
	if err != nil {
		err1 := getPanelService().DeleteDeploy(info.Name)
		if err1 != nil {
			slog.Error(err1.Error())
		}
		err1 = getPanelService().DeleteIngress(info.IngressName)
		if err1 != nil {
			slog.Error(err1.Error())
		}
		panic(err)
	}

	zpkService := zpk.ZpkService{
		BaseUrl: urlInfo.Scheme + "://" + urlInfo.Host,
	}
	zpkInfo, err := zpkService.GetZpkInfo(argsValue.AppName)
	slog.Info("get zpk info", "info", zpkInfo, "err", err, "name", argsValue.AppName)
	err = getSiteManagerService().CreateSite(site_manager.CreateSiteReq{
		Domain:          []string{argsValue.Domain},
		RootDir:         argsValue.Domain,
		EnvironmentId:   environment.Id,
		CodeDownloadUrl: argsValue.CodeDownloadUrl,
	})
	if err != nil {
		err1 := getSiteManagerService().DeleteEnvironment(environment.Id)
		if err1 != nil {
			slog.Error(err1.Error())
		}
		err1 = getPanelService().DeleteDeploy(info.Name)
		if err1 != nil {
			slog.Error(err1.Error())
		}
		err1 = getPanelService().DeleteIngress(info.IngressName)
		if err1 != nil {
			slog.Error(err1.Error())
		}
		panic(err)
	}

	err = getPanelService().RestartDeployByPatch("w7-sitemanager-site-manager-nginx")
	if err != nil {
		slog.Error(err.Error())
	}

	slog.Info("站点安装成功", "params", argsValue)
}

func getSiteManagerService() site_manager.SiteManagerService {
	return site_manager.SiteManagerService{
		BaseUrl: "http://w7-sitemanager-site-manager.default.svc.cluster.local:8000",
	}
}

func getPanelService() w7panel.W7PanelService {
	return w7panel.W7PanelService{
		BaseUrl: argsValue.W7PanelDomain,
		Token:   argsValue.W7PanelToken,
	}
}

func createSiteK8sResource(appName, version string, command []string) (*DeployInfo, error) {
	sourceDeployInfo, err := getPanelService().QueryDeploy(appName)
	if err != nil {
		return nil, err
	}

	nginxTemplate := ""
	imageTemplate := ""

	if sourceDeployInfo.Spec.Template.Annotations == nil {
		sourceDeployInfo.Spec.Template.Annotations = make(map[string]string)
	}
	if rules, ok := sourceDeployInfo.Spec.Template.Annotations["w7.cc/yaml_copy"]; ok && rules != "" {
		copyRules := make([]YamlCopyRule, 0)
		err := json.Unmarshal([]byte(rules), &copyRules)
		if err != nil {
			return nil, err
		}
		// 模拟获取 siteManagerData
		siteManagerData, err := getPanelService().QueryDeploy("w7-sitemanager-site-manager")
		if err != nil {
			return nil, err
		}

		sourceDeployData, err := deploymentToMap(sourceDeployInfo)
		if err != nil {
			return nil, err
		}
		siteManagerDeployData, err := deploymentToMap(siteManagerData)
		if err != nil {
			return nil, err
		}

		data := copyYamlData(siteManagerDeployData, sourceDeployData, copyRules)

		tmp, err := mapToDeployment(data)
		if err != nil {
			return nil, err
		}

		sourceDeployInfo = tmp
	}

	if val, ok := sourceDeployInfo.Spec.Template.Annotations["w7.cc/image_template"]; ok && val != "" {
		imageTemplate = val
	}

	if val, ok := sourceDeployInfo.Spec.Template.Annotations["w7.cc/nginx_vhost_template"]; ok && val != "" {
		nginxTemplate = val
	}

	// 5. 生成新名称
	newName := "copy-" + strings.ToLower(helper.GetRandomStringNotContainsNumber(4)) + "-" + strings.ReplaceAll(getVersionIdentifie(appName, version), "_", "-")

	sourceDeployInfo.Name = newName
	if sourceDeployInfo.Labels == nil {
		sourceDeployInfo.Labels = make(map[string]string)
	}
	if sourceDeployInfo.Annotations == nil {
		sourceDeployInfo.Annotations = make(map[string]string)
	}
	sourceDeployInfo.Annotations["w7.cc/create-svc"] = "true"
	sourceDeployInfo.Annotations["title"] = newName
	sourceDeployInfo.Labels["app"] = newName
	if sourceDeployInfo.Spec.Selector == nil {
		sourceDeployInfo.Spec.Selector = &metav1.LabelSelector{}
	}
	if sourceDeployInfo.Spec.Selector.MatchLabels == nil {
		sourceDeployInfo.Spec.Selector.MatchLabels = make(map[string]string)
	}
	sourceDeployInfo.Spec.Selector.MatchLabels["app"] = newName
	if sourceDeployInfo.Spec.Template.Labels == nil {
		sourceDeployInfo.Spec.Template.Labels = make(map[string]string)
	}
	sourceDeployInfo.Spec.Template.Labels["app"] = newName
	sourceDeployInfo.Spec.Template.Spec.Containers[0].Image = strings.ReplaceAll(imageTemplate, "{version}", version)
	sourceDeployInfo.Spec.Template.Spec.Containers[0].Name = newName
	if len(command) > 0 {
		sourceDeployInfo.Spec.Template.Spec.Containers[0].Command = command
	}
	for i, item := range sourceDeployInfo.Spec.Template.Spec.Containers[0].Env {
		if item.Name == "METADATA_NAME" {
			sourceDeployInfo.Spec.Template.Spec.Containers[0].Env[i].Value = newName
			sourceDeployInfo.Spec.Template.Spec.Containers[0].Env[i].ValueFrom = nil
		}
	}
	sourceDeployInfo.Spec.Template.Spec.Affinity = &v3.Affinity{
		PodAffinity: &v3.PodAffinity{
			RequiredDuringSchedulingIgnoredDuringExecution: []v3.PodAffinityTerm{
				v3.PodAffinityTerm{
					LabelSelector: &metav1.LabelSelector{
						MatchExpressions: []metav1.LabelSelectorRequirement{
							metav1.LabelSelectorRequirement{
								Key:      "w7.cc/identifie",
								Operator: metav1.LabelSelectorOpIn,
								Values:   []string{"w7-sitemanager"},
							},
						},
					},
					TopologyKey: "kubernetes.io/hostname",
				},
			},
		},
	}

	sourceDeployInfo.ResourceVersion = ""
	sourceDeployInfo.Generation = 0
	sourceDeployInfo.CreationTimestamp = metav1.Time{
		Time: time.Now(),
	}
	sourceDeployInfo.UID = ""
	sourceDeployInfo.Status = v1.DeploymentStatus{}

	err = getPanelService().CreateDeploy(sourceDeployInfo)
	if err != nil {
		return nil, err
	}

	ingressName := "ing-" + strings.ToLower(helper.GetRandomStringNotContainsNumber(12))
	pathType := v2.PathTypePrefix
	ingressInfo := v2.Ingress{
		TypeMeta: metav1.TypeMeta{
			Kind:       "Ingress",
			APIVersion: "networking.k8s.io/v1",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      ingressName,
			Namespace: "default",
			Annotations: map[string]string{
				"kubernetes.io/ingress.class": "higress",
				"higress.io/resource-definer": "higress",
			},
			Labels: map[string]string{
				"higress.io/resource-definer": "higress",
				"app":                         "w7-sitemanager-site-manager-nginx",
				"group":                       "w7-sitemanager",
			},
		},
		Spec: v2.IngressSpec{
			Rules: []v2.IngressRule{
				v2.IngressRule{
					Host: argsValue.Domain,
					IngressRuleValue: v2.IngressRuleValue{
						HTTP: &v2.HTTPIngressRuleValue{
							Paths: []v2.HTTPIngressPath{
								v2.HTTPIngressPath{
									Path:     "/",
									PathType: &pathType,
									Backend: v2.IngressBackend{
										Service: &v2.IngressServiceBackend{
											Name: "w7-sitemanager-site-manager-nginx",
											Port: v2.ServiceBackendPort{
												Number: 80,
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	if argsValue.EnableSsl {
		ingressInfo.Annotations["higress.io/ssl-redirect"] = "false"
		ingressInfo.Annotations["w7.cc/ssl-redirect"] = "false"
		ingressInfo.Annotations["cert-manager.io/cluster-issuer"] = "w7-letsencrypt-prod"
		ingressInfo.Annotations["cert-manager.io/renew-before"] = "30m"
		ingressInfo.Spec.TLS = []v2.IngressTLS{
			v2.IngressTLS{
				Hosts:      []string{argsValue.Domain},
				SecretName: argsValue.Domain + "-tls-secret",
			},
		}
	}

	err = getPanelService().CreateIngress(ingressInfo)
	if err != nil {
		getPanelService().DeleteDeploy(newName)
		return nil, err
	}

	return &DeployInfo{
		Name:          newName,
		NginxTemplate: nginxTemplate,
		IngressName:   ingressName,
	}, nil
}

func getVersionIdentifie(appName, version string) string {
	if version != "" {
		cleanVersion := strings.ReplaceAll(version, ".", "")
		return appName + "_" + cleanVersion
	}
	return appName
}

func copyYamlData(fromYamlData map[string]interface{}, toYamlData map[string]interface{}, rules []YamlCopyRule) map[string]interface{} {
	// 2. 遍历并应用每一条规则
	for _, rule := range rules {
		if rule.Source == "" || rule.Target == "" {
			continue
		}

		// 2.1 从 siteManagerData 中获取源值
		sourceValue, found := getValueByPath(fromYamlData, rule.Source)
		if !found {
			fmt.Printf("fillData: 源路径 '%s' 未找到，跳过此规则\n", rule.Source)
			continue
		}

		// 2.2 将源值设置到 data 的目标路径
		setValueByPath(toYamlData, rule.Target, sourceValue)
	}

	return toYamlData
}

// getValueByPath 根据点分隔的路径从嵌套的 map/slice 中获取值
// 例如: path = "spec.template.spec.containers[0].image"
func getValueByPath(root map[string]interface{}, path string) (interface{}, bool) {
	parts := parsePath(path)
	current := interface{}(root)

	for _, part := range parts {
		if current == nil {
			return nil, false
		}

		// 检查是否是数组索引，例如 "containers[0]"
		if strings.Contains(part, "[") {
			key, indexStr, ok := parseArrayPart(part)
			if !ok {
				return nil, false
			}

			// 获取 map 中的 slice
			m, isMap := current.(map[string]interface{})
			if !isMap {
				return nil, false
			}
			sliceVal, exists := m[key]
			if !exists {
				return nil, false
			}

			// 断言为 slice
			s, isSlice := sliceVal.([]interface{})
			if !isSlice {
				return nil, false
			}

			// 解析索引
			index, err := strconv.Atoi(indexStr)
			if err != nil || index < 0 || index >= len(s) {
				return nil, false
			}
			current = s[index]
		} else {
			// 普通 map 访问
			m, isMap := current.(map[string]interface{})
			if !isMap {
				return nil, false
			}
			var exists bool
			current, exists = m[part]
			if !exists {
				return nil, false
			}
		}
	}

	return current, true
}

// setValueByPath 根据点分隔的路径设置值到嵌套的 map/slice 中
// 注意：此函数会修改传入的 root map
func setValueByPath(root map[string]interface{}, path string, value interface{}) {
	parts := parsePath(path)
	// 导航到目标路径的父级
	current := interface{}(root)

	// 遍历到倒数第二个元素，因为它是我们需要设置的 key
	for i, part := range parts[:len(parts)-1] {
		if current == nil {
			return
		}

		if strings.Contains(part, "[") {
			// 处理数组路径，例如 "containers[0]"
			key, indexStr, ok := parseArrayPart(part)
			if !ok {
				return
			}

			m, isMap := current.(map[string]interface{})
			if !isMap {
				return
			}
			// 确保 map 中存在该 key，并且是一个 slice
			if _, exists := m[key]; !exists {
				m[key] = make([]interface{}, 0)
			}

			sliceVal, isSlice := m[key].([]interface{})
			if !isSlice {
				return
			}

			index, err := strconv.Atoi(indexStr)
			if err != nil {
				return
			}

			// 如果索引超出范围，则扩展 slice
			for len(sliceVal) <= index {
				sliceVal = append(sliceVal, make(map[string]interface{}))
			}
			m[key] = sliceVal
			current = sliceVal[index]

		} else {
			// 处理普通 map 路径
			m, isMap := current.(map[string]interface{})
			if !isMap {
				return
			}
			// 确保 map 中存在该 key
			if _, exists := m[part]; !exists {
				// 如果下一个部分是数组，则创建 slice，否则创建 map
				if i+1 < len(parts) && strings.Contains(parts[i+1], "[") {
					m[part] = make([]interface{}, 0)
				} else {
					m[part] = make(map[string]interface{})
				}
			}
			current = m[part]
		}
	}

	// 设置最终的值
	lastPart := parts[len(parts)-1]
	if m, ok := current.(map[string]interface{}); ok {
		if strings.Contains(lastPart, "[") {
			// 目标是数组中的元素，例如 "env[0].name"
			key, indexStr, ok := parseArrayPart(lastPart)
			if !ok {
				return
			}
			if _, exists := m[key]; !exists {
				m[key] = make([]interface{}, 0)
			}
			sliceVal, isSlice := m[key].([]interface{})
			if !isSlice {
				return
			}
			index, err := strconv.Atoi(indexStr)
			if err != nil {
				return
			}
			// 扩展 slice 如果需要
			for len(sliceVal) <= index {
				sliceVal = append(sliceVal, make(map[string]interface{}))
			}
			// 这里我们假设是设置整个元素，例如 env[0] = value
			// 如果是 env[0].name = value，逻辑会更复杂，需要再递归一次
			// 为了简化，这里处理 env[0] = value 的情况
			sliceVal[index] = value
			m[key] = sliceVal
		} else {
			// 目标是 map 的 key
			m[lastPart] = value
		}
	}
}

// parsePath 将路径字符串解析为部分列表
// "spec.template.spec.containers[0].image" -> ["spec", "template", "spec", "containers[0]", "image"]
func parsePath(path string) []string {
	return strings.Split(path, ".")
}

// parseArrayPart 解析数组部分，例如 "containers[0]" -> ("containers", "0", true)
func parseArrayPart(part string) (key string, index string, ok bool) {
	start := strings.Index(part, "[")
	end := strings.Index(part, "]")
	if start == -1 || end == -1 || start >= end {
		return "", "", false
	}
	return part[:start], part[start+1 : end], true
}

func deploymentToMap(deploy *v1.Deployment) (map[string]interface{}, error) {
	// 1. 序列化为 JSON 字节流
	// 注意：K8s 的结构体通常带有 json 标签，Marshal 会自动处理字段名转换
	jsonData, err := json.Marshal(deploy)
	if err != nil {
		return nil, fmt.Errorf("序列化失败: %v", err)
	}

	// 2. 反序列化为 map
	var result map[string]interface{}
	err = json.Unmarshal(jsonData, &result)
	if err != nil {
		return nil, fmt.Errorf("反序列化失败: %v", err)
	}

	return result, nil
}

func mapToDeployment(deploy map[string]interface{}) (*v1.Deployment, error) {
	// 1. 序列化为 JSON 字节流
	// 注意：K8s 的结构体通常带有 json 标签，Marshal 会自动处理字段名转换
	jsonData, err := json.Marshal(deploy)
	if err != nil {
		return nil, fmt.Errorf("序列化失败: %v", err)
	}

	// 2. 反序列化为 map
	var result v1.Deployment
	err = json.Unmarshal(jsonData, &result)
	if err != nil {
		return nil, fmt.Errorf("反序列化失败: %v", err)
	}

	return &result, nil
}
