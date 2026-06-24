package command

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/w7panel/w7panel-sitemanager/common/accessor"
	"github.com/w7panel/w7panel-sitemanager/common/helper"
	"github.com/w7panel/w7panel-sitemanager/common/service/site_manager"
	"github.com/w7panel/w7panel-sitemanager/common/service/w7panel"
	"github.com/w7panel/w7panel-sitemanager/common/service/zpk"
	"github.com/we7coreteam/w7-rangine-go/v2/src/console"
	v1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
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
	W7PanelDomain        string
	W7PanelToken         string
	AppName              string
	EnvironmentTitle     string
	EnvironmentName      string
	EnvironmentVersion   string
	EnvironmentLanguage  string
	Operation            string
	CodeDownloadUrl      string
	Cmd                  string
	CmdBase64            string
	ShellsBase64         string
	Domain               string
	K8sAppName           string
	K8sEnvAppName        string
	StartParamsEnvBase64 string
	EnableSsl            bool
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
	cmd.Flags().StringVar(&argsValue.Operation, "operation", "install", "operation type")
	cmd.Flags().StringVar(&argsValue.Domain, "domain", "", "site domain")
	cmd.Flags().StringVar(&argsValue.K8sAppName, "k8s-app-name", "", "k8s app name")
	cmd.Flags().StringVar(&argsValue.K8sEnvAppName, "k8s-env-app-name", "", "k8s env app name")
	cmd.Flags().StringVar(&argsValue.CodeDownloadUrl, "code-download-url", "", "code download url")
	cmd.Flags().StringVar(&argsValue.Cmd, "cmd", "", "command")
	cmd.Flags().StringVar(&argsValue.CmdBase64, "cmd-base64", "", "base64 encoded command json")
	cmd.Flags().StringVar(&argsValue.ShellsBase64, "shells-base64", "", "base64 encoded shell json")
	cmd.Flags().StringVar(&argsValue.StartParamsEnvBase64, "start-params-env-base64", "", "base64 encoded start params env json")
	cmd.Flags().BoolVar(&argsValue.EnableSsl, "ssl", false, "enable ssl")
}

func (c SiteCreate) GetDescription() string {
	return "create site"
}

func (c SiteCreate) Handle(cmd *cobra.Command, args []string) {
	commands, err := parseCommands(argsValue.Cmd, argsValue.CmdBase64)
	if err != nil {
		panic(err)
	}
	shells, err := parseShells(argsValue.ShellsBase64)
	if err != nil {
		panic(err)
	}

	urlInfo, err := url.Parse(argsValue.CodeDownloadUrl)
	if err != nil {
		panic(err)
	}
	//触发 info 接口， 才能从 downloadurl 下载文件
	zpkService := zpk.ZpkService{
		BaseUrl: urlInfo.Scheme + "://" + urlInfo.Host,
	}
	zpkInfo, err := zpkService.GetZpkInfo(argsValue.AppName)
	slog.Info("get zpk info", "info", zpkInfo, "err", err, "name", argsValue.AppName)

	siteInfo, _ := getSiteManagerService().InfoSite(site_manager.SiteInfoReq{
		Domain: argsValue.Domain,
	})
	if argsValue.Operation == "upgrade" && siteInfo != nil {
		shellDeployName := siteInfo.SiteEnvironment.AppName
		if !isSameSiteEnvironment(siteInfo.SiteEnvironment) {
			environment, info, err := createEnvironmentForSite(commands, false)
			if err != nil {
				panic(err)
			}
			shellDeployName = info.Name

			err = getSiteManagerService().UpdateSite(site_manager.UpdateSiteReq{
				Id:            siteInfo.Site.Id,
				Domain:        strings.Split(siteInfo.Site.Domain, ","),
				RootDir:       siteInfo.Site.RootDir,
				Remark:        siteInfo.Site.Remark,
				EnvironmentId: environment.Id,
			})
			if err != nil {
				cleanupCreatedEnvironment(environment.Id, info)
				panic(err)
			}
			slog.Info("站点环境更新成功", "domain", argsValue.Domain, "environment_id", environment.Id)
		} else {
			err := applyStartupConfigToDeploy(siteInfo.SiteEnvironment.AppName, commands)
			if err != nil {
				panic(err)
			}
		}

		err := getSiteManagerService().UpdateSiteCode(site_manager.UpdateSiteCodeReq{
			Domain:          argsValue.Domain,
			CodeDownloadUrl: argsValue.CodeDownloadUrl,
			Ext: &accessor.SiteExt{
				AppIdentify: argsValue.AppName,
				K8sAppName:  argsValue.K8sAppName,
			},
		})
		if err != nil {
			panic(err)
		}
		if err := runSiteShellsByOperation(shells, argsValue.Operation, shellDeployName); err != nil {
			panic(err)
		}
		slog.Info("站点代码更新成功", "params", argsValue)
		return
	}

	environment, info, err := createEnvironmentForSite(commands, true)
	if err != nil {
		panic(err)
	}
	err = getSiteManagerService().CreateSite(site_manager.CreateSiteReq{
		Domain:          []string{argsValue.Domain},
		RootDir:         argsValue.Domain,
		EnvironmentId:   environment.Id,
		CodeDownloadUrl: argsValue.CodeDownloadUrl,
		Ext: accessor.SiteExt{
			AppIdentify: argsValue.AppName,
			K8sAppName:  argsValue.K8sAppName,
		},
	})
	if err != nil {
		cleanupCreatedEnvironment(environment.Id, info)
		panic(err)
	}

	if err := runSiteShellsByOperation(shells, argsValue.Operation, info.Name); err != nil {
		panic(err)
	}

	err = getPanelService().RestartDeployByPatch("w7-sitemanager-site-manager-nginx")
	if err != nil {
		slog.Error(err.Error())
	}

	slog.Info("站点安装成功", "params", argsValue)
}

func createEnvironmentForSite(commands []string, createIngress bool) (*site_manager.CreateEnvironmentResp, *DeployInfo, error) {
	info, err := createSiteK8sResource(getDesiredEnvironmentGroup(), argsValue.EnvironmentVersion, commands, createIngress)
	if err != nil {
		return nil, nil, err
	}

	environment, err := getSiteManagerService().CreateEnvironment(site_manager.CreateEnvironmentReq{
		Title:              argsValue.EnvironmentTitle,
		Language:           argsValue.EnvironmentLanguage,
		Version:            argsValue.EnvironmentVersion,
		Group:              getDesiredEnvironmentGroup(),
		AppName:            info.Name,
		NginxVhostTemplate: info.NginxTemplate,
	})
	if err != nil {
		cleanupCreatedEnvironment(0, info)
		return nil, nil, err
	}

	return environment, info, nil
}

func createSiteK8sResource(appName, version string, command []string, createIngress bool) (*DeployInfo, error) {
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
	newName := argsValue.K8sEnvAppName

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
	startParamsEnv, err := parseStartParamsEnv(argsValue.StartParamsEnvBase64)
	if err != nil {
		return nil, err
	}
	applyStartupConfigToContainer(&sourceDeployInfo.Spec.Template.Spec.Containers[0], startParamsEnv, command)
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

	if !createIngress {
		return &DeployInfo{
			Name:          newName,
			NginxTemplate: nginxTemplate,
		}, nil
	}

	ingressName, err := createSiteIngress()
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

func cleanupCreatedEnvironment(environmentId int, info *DeployInfo) {
	if environmentId > 0 {
		if err := getSiteManagerService().DeleteEnvironment(environmentId); err != nil {
			slog.Error(err.Error())
		}
	}
	if info == nil {
		return
	}
	if err := getPanelService().DeleteDeploy(info.Name); err != nil {
		slog.Error(err.Error())
	}
	if info.IngressName != "" {
		if err := getPanelService().DeleteIngress(info.IngressName); err != nil {
			slog.Error(err.Error())
		}
	}
}

func isSameSiteEnvironment(environment site_manager.SiteEnvironmentResp) bool {
	if environment.Language != argsValue.EnvironmentLanguage || environment.Version != argsValue.EnvironmentVersion {
		return false
	}

	return environment.Group == getDesiredEnvironmentGroup()
}

func getDesiredEnvironmentGroup() string {
	return strings.ReplaceAll(argsValue.EnvironmentName, "_", "-")
}

func applyStartupConfigToDeploy(deployName string, command []string) error {
	startParamsEnv, err := parseStartParamsEnv(argsValue.StartParamsEnvBase64)
	if err != nil {
		return err
	}
	if len(startParamsEnv) == 0 && len(command) == 0 {
		return nil
	}

	deployInfo, err := getPanelService().QueryDeploy(deployName)
	if err != nil {
		return err
	}
	if len(deployInfo.Spec.Template.Spec.Containers) == 0 {
		return fmt.Errorf("deployment %s has no containers", deployName)
	}

	container := &deployInfo.Spec.Template.Spec.Containers[0]
	applyStartupConfigToContainer(container, startParamsEnv, command)
	return getPanelService().UpdateDeploy(deployInfo)
}

func applyStartupConfigToContainer(container *v3.Container, env []v3.EnvVar, command []string) {
	if len(command) > 0 {
		container.Command = command
	}
	upsertContainerEnv(container, env)
}

func upsertContainerEnv(container *v3.Container, env []v3.EnvVar) {
	for _, item := range env {
		exists := false
		for i, current := range container.Env {
			if current.Name == item.Name {
				container.Env[i] = item
				exists = true
				break
			}
		}
		if !exists {
			container.Env = append(container.Env, item)
		}
	}
}

func createSiteIngress() (string, error) {
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

	err := getPanelService().CreateIngress(ingressInfo)
	if err != nil {
		return "", err
	}

	return ingressName, nil
}

func runSiteShellsByOperation(shells []SiteShell, operation, deployName string) error {
	if len(shells) == 0 {
		return nil
	}

	allowedTypes := getShellTypesByOperation(operation)
	if len(allowedTypes) == 0 {
		return nil
	}

	if deployName == "" {
		siteInfo, _ := getSiteManagerService().InfoSite(site_manager.SiteInfoReq{
			Domain: argsValue.Domain,
		})
		if siteInfo != nil {
			deployName = siteInfo.SiteEnvironment.AppName
		}
	}
	if deployName == "" {
		return fmt.Errorf("empty deployment name for %s shell", operation)
	}

	deployInfo, err := getPanelService().QueryDeploy(deployName)
	if err != nil {
		return err
	}
	if len(deployInfo.Spec.Template.Spec.Containers) == 0 {
		return fmt.Errorf("deployment %s has no containers", deployName)
	}

	runnableShells := make([]SiteShell, 0, len(shells))
	for _, shell := range shells {
		if !allowedTypes[shell.Type] || strings.TrimSpace(shell.Shell) == "" {
			continue
		}
		runnableShells = append(runnableShells, shell)
	}
	sort.SliceStable(runnableShells, func(i, j int) bool {
		return shellExecutionWeight(runnableShells[i].Type) < shellExecutionWeight(runnableShells[j].Type)
	})

	for _, shell := range runnableShells {
		job := buildSiteShellJob(deployInfo, shell, operation)
		if err := getPanelService().CreateJob(job); err != nil {
			return err
		}
		if err := waitSiteShellJob(job.Name, 10*time.Minute); err != nil {
			return err
		}
	}

	return nil
}

func waitSiteShellJob(jobName string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		jobInfo, err := getPanelService().QueryJob(jobName)
		if err != nil {
			return err
		}

		for _, condition := range jobInfo.Status.Conditions {
			if condition.Type == batchv1.JobComplete && condition.Status == v3.ConditionTrue {
				return nil
			}
			if condition.Type == batchv1.JobFailed && condition.Status == v3.ConditionTrue {
				return fmt.Errorf("site shell job %s failed: %s", jobName, condition.Message)
			}
		}

		if time.Now().After(deadline) {
			return fmt.Errorf("site shell job %s timed out", jobName)
		}
		time.Sleep(2 * time.Second)
	}
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
