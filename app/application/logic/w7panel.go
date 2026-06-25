package logic

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/w7panel/w7panel-sitemanager/common/helper"
	"github.com/w7panel/w7panel-sitemanager/common/service/w7panel"
	v1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	v3 "k8s.io/api/core/v1"
	v2 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type SiteShell struct {
	Shell string `json:"shell"`
	Title string `json:"title"`
	Type  string `json:"type"`
	Image string `json:"image"`
}

func GetPanelService(domain, token string) w7panel.W7PanelService {
	return w7panel.W7PanelService{
		BaseUrl: domain,
		Token:   token,
	}
}

func CopySiteK8sEnvironmentDeployment(w7panelService w7panel.W7PanelService, sourceDeployInfo *v1.Deployment, targetK8sAppName, version string) error {
	imageTemplate := ""

	if sourceDeployInfo.Spec.Template.Annotations == nil {
		sourceDeployInfo.Spec.Template.Annotations = make(map[string]string)
	}
	if rules, ok := sourceDeployInfo.Spec.Template.Annotations["w7.cc/yaml_copy"]; ok && rules != "" {
		copyRules := make([]helper.YamlCopyRule, 0)
		err := json.Unmarshal([]byte(rules), &copyRules)
		if err != nil {
			return err
		}
		// 模拟获取 siteManagerData
		siteManagerData, err := w7panelService.QueryDeploy("w7-sitemanager-site-manager")
		if err != nil {
			return err
		}

		sourceDeployData, err := helper.DeploymentToMap(sourceDeployInfo)
		if err != nil {
			return err
		}
		siteManagerDeployData, err := helper.DeploymentToMap(siteManagerData)
		if err != nil {
			return err
		}

		data := helper.CopyYamlData(siteManagerDeployData, sourceDeployData, copyRules)

		tmp, err := helper.MapToDeployment(data)
		if err != nil {
			return err
		}

		sourceDeployInfo = tmp
	}

	if val, ok := sourceDeployInfo.Spec.Template.Annotations["w7.cc/image_template"]; ok && val != "" {
		imageTemplate = val
	}

	// 5. 生成新名称
	newName := targetK8sAppName

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

	return w7panelService.CreateDeploy(sourceDeployInfo)
}

func CreateSiteIngress(w7panelService w7panel.W7PanelService, domain string, enableSsl bool) (string, error) {
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
					Host: domain,
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

	if enableSsl {
		ingressInfo.Annotations["higress.io/ssl-redirect"] = "false"
		ingressInfo.Annotations["w7.cc/ssl-redirect"] = "false"
		ingressInfo.Annotations["cert-manager.io/cluster-issuer"] = "w7-letsencrypt-prod"
		ingressInfo.Annotations["cert-manager.io/renew-before"] = "30m"
		ingressInfo.Spec.TLS = []v2.IngressTLS{
			v2.IngressTLS{
				Hosts:      []string{domain},
				SecretName: domain + "-tls-secret",
			},
		}
	}

	err := w7panelService.CreateIngress(ingressInfo)
	if err != nil {
		return "", err
	}

	return ingressName, nil
}

func RunSiteShellsByOperation(w7panelService w7panel.W7PanelService, targetK8sAppName, operation string, envs []v3.EnvVar, shells []SiteShell) error {
	allowedTypes := getShellTypesByOperation(operation)
	if len(allowedTypes) == 0 {
		slog.Info("skip site shell run: unsupported operation", "operation", operation, "deploy", targetK8sAppName, "shell_count", len(shells))
		return nil
	}

	slog.Info("query site shell deployment", "operation", operation, "deploy", targetK8sAppName, "shell_count", len(shells))
	deployInfo, err := w7panelService.QueryDeploy(targetK8sAppName)
	if err != nil {
		slog.Error("query site shell deployment failed", "operation", operation, "deploy", targetK8sAppName, "err", err)
		return err
	}
	if len(deployInfo.Spec.Template.Spec.Containers) == 0 {
		slog.Error("site shell deployment has no containers", "operation", operation, "deploy", targetK8sAppName)
		return fmt.Errorf("deployment %s has no containers", targetK8sAppName)
	}

	runnableShells := make([]SiteShell, 0, len(shells))
	for _, shell := range shells {
		if !allowedTypes[shell.Type] || strings.TrimSpace(shell.Shell) == "" {
			continue
		}
		runnableShells = append(runnableShells, shell)
	}
	slog.Info("site shell runnable list prepared", "operation", operation, "deploy", targetK8sAppName, "shell_count", len(shells), "runnable_count", len(runnableShells))
	sort.SliceStable(runnableShells, func(i, j int) bool {
		return shellExecutionWeight(runnableShells[i].Type) < shellExecutionWeight(runnableShells[j].Type)
	})

	for _, shell := range runnableShells {
		job := buildSiteShellJob(deployInfo, targetK8sAppName, shell, envs)
		slog.Info("create site shell job", "domain", "operation", operation, "deploy", targetK8sAppName, "job", job.Name, "shell_type", shell.Type, "shell_title", shell.Title)
		if err := w7panelService.CreateJob(job); err != nil {
			slog.Error("create site shell job failed", "operation", operation, "deploy", targetK8sAppName, "job", job.Name, "shell_type", shell.Type, "shell_title", shell.Title, "err", err)
			return err
		}
		slog.Info("wait site shell job", "operation", operation, "deploy", targetK8sAppName, "job", job.Name, "shell_type", shell.Type, "shell_title", shell.Title)
		if err := waitSiteShellJob(w7panelService, job.Name, 10*time.Minute); err != nil {
			slog.Error("site shell job failed", "operation", operation, "deploy", targetK8sAppName, "job", job.Name, "shell_type", shell.Type, "shell_title", shell.Title, "err", err)
			return err
		}
		slog.Info("site shell job completed", "operation", operation, "deploy", targetK8sAppName, "job", job.Name, "shell_type", shell.Type, "shell_title", shell.Title)
	}

	slog.Info("site shell run finished", "operation", operation, "deploy", targetK8sAppName, "runnable_count", len(runnableShells))
	return nil
}

func waitSiteShellJob(w7panelService w7panel.W7PanelService, jobName string, timeout time.Duration) error {
	slog.Info("start polling site shell job", "job", jobName, "timeout", timeout.String())
	deadline := time.Now().Add(timeout)
	for {
		jobInfo, err := w7panelService.QueryJob(jobName)
		if err != nil {
			slog.Error("query site shell job failed", "job", jobName, "err", err)
			return err
		}

		for _, condition := range jobInfo.Status.Conditions {
			if condition.Type == batchv1.JobComplete && condition.Status == v3.ConditionTrue {
				slog.Info("site shell job condition complete", "job", jobName, "succeeded", jobInfo.Status.Succeeded, "failed", jobInfo.Status.Failed)
				return nil
			}
			if condition.Type == batchv1.JobFailed && condition.Status == v3.ConditionTrue {
				slog.Error("site shell job condition failed", "job", jobName, "message", condition.Message, "reason", condition.Reason, "succeeded", jobInfo.Status.Succeeded, "failed", jobInfo.Status.Failed)
				return fmt.Errorf("site shell job %s failed: %s", jobName, condition.Message)
			}
		}

		if time.Now().After(deadline) {
			slog.Error("site shell job wait timed out", "job", jobName, "active", jobInfo.Status.Active, "succeeded", jobInfo.Status.Succeeded, "failed", jobInfo.Status.Failed)
			return fmt.Errorf("site shell job %s timed out", jobName)
		}
		time.Sleep(2 * time.Second)
	}
}

func buildSiteShellJob(deployInfo *v1.Deployment, targetK8sAppName string, shell SiteShell, envs []v3.EnvVar) *batchv1.Job {
	podSpec := deployInfo.Spec.Template.Spec
	sourceContainer := podSpec.Containers[0]
	image := shell.Image
	if image == "" {
		image = sourceContainer.Image
	}

	backoffLimit := int32(2)
	ttlSecondsAfterFinished := int32(60)
	jobName := helper.SanitizeK8sName(deployInfo.Name + "-shell-" + "-" + shell.Type + "-" + helper.GetRandomStringNotContainsNumber(8))
	containerName := helper.SanitizeK8sName(deployInfo.Name + "-shell")
	annotations := map[string]string{
		"w7.cc/shell-type": shell.Type,
		"w7.cc/title":      shell.Title,
	}
	if shell.Type == "custom" {
		annotations["w7.cc/custom-hook"] = "true"
	}

	slog.Info("build site shell job",
		"deploy", deployInfo.Name,
		"job", jobName,
		"shell_type", shell.Type,
		"shell_title", shell.Title,
		"image", image,
		"shell_length", len(shell.Shell),
	)

	return &batchv1.Job{
		TypeMeta: metav1.TypeMeta{
			Kind:       "Job",
			APIVersion: "batch/v1",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      jobName,
			Namespace: "default",
			Labels: map[string]string{
				"app":              deployInfo.Name,
				"group":            targetK8sAppName,
				"w7.cc/job-source": "appgroup",
			},
			Annotations: annotations,
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoffLimit,
			TTLSecondsAfterFinished: &ttlSecondsAfterFinished,
			Template: v3.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app":              jobName,
						"group":            targetK8sAppName,
						"w7.cc/job-source": "tradition-site",
					},
				},
				Spec: v3.PodSpec{
					RestartPolicy:                 v3.RestartPolicyNever,
					ServiceAccountName:            podSpec.ServiceAccountName,
					AutomountServiceAccountToken:  podSpec.AutomountServiceAccountToken,
					ImagePullSecrets:              podSpec.ImagePullSecrets,
					NodeSelector:                  podSpec.NodeSelector,
					Affinity:                      podSpec.Affinity,
					Tolerations:                   podSpec.Tolerations,
					SecurityContext:               podSpec.SecurityContext,
					Volumes:                       podSpec.Volumes,
					TerminationGracePeriodSeconds: podSpec.TerminationGracePeriodSeconds,
					Containers: []v3.Container{
						{
							Name:            containerName,
							Image:           image,
							ImagePullPolicy: sourceContainer.ImagePullPolicy,
							Command:         []string{"/bin/sh", "-c"},
							Args:            []string{shell.Shell},
							Env:             envs,
							Resources:       sourceContainer.Resources,
							VolumeMounts:    sourceContainer.VolumeMounts,
							SecurityContext: sourceContainer.SecurityContext,
						},
					},
				},
			},
		},
	}
}

func getShellTypesByOperation(operation string) map[string]bool {
	switch operation {
	case "install":
		return map[string]bool{
			"fix-first":      true,
			"requireinstall": true,
			"pre-install":    true,
			"install":        true,
			"fix-install":    true,
			"custom":         true,
		}
	case "upgrade":
		return map[string]bool{
			"fix-first": true,
			"upgrade":   true,
			"custom":    true,
		}
	default:
		return nil
	}
}

func shellExecutionWeight(shellType string) int {
	switch shellType {
	case "fix-first":
		return -7
	case "requireinstall":
		return -6
	case "pre-install":
		return -5
	case "fix-install":
		return -4
	case "install":
		return -3
	case "upgrade":
		return -2
	case "custom":
		return 0
	default:
		return 100
	}
}
