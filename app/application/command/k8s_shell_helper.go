package command

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/w7panel/w7panel-sitemanager/common/helper"
	v1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	v3 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type SiteShell struct {
	Shell string `json:"shell"`
	Title string `json:"title"`
	Type  string `json:"type"`
	Image string `json:"image"`
}

func parseShells(rawBase64 string) ([]SiteShell, error) {
	rawBase64 = strings.TrimSpace(rawBase64)
	if rawBase64 == "" || rawBase64 == "{}" || rawBase64 == "null" {
		slog.Info("site shell config empty", "domain", argsValue.Domain, "operation", argsValue.Operation)
		return nil, nil
	}

	decoded, err := base64.StdEncoding.DecodeString(rawBase64)
	if err != nil {
		slog.Error("decode site shell config failed", "domain", argsValue.Domain, "operation", argsValue.Operation, "err", err)
		return nil, err
	}

	shells := make([]SiteShell, 0)
	if err := json.Unmarshal(decoded, &shells); err != nil {
		slog.Error("parse site shell config failed", "domain", argsValue.Domain, "operation", argsValue.Operation, "err", err)
		return nil, err
	}
	slog.Info("site shell config parsed", "domain", argsValue.Domain, "operation", argsValue.Operation, "shell_count", len(shells))
	return shells, nil
}

func getShellTypesByOperation(operation string) map[string]bool {
	switch operation {
	case "install":
		return map[string]bool{
			"requireinstall": true,
			"pre-install":    true,
			"install":        true,
			"custom":         true,
		}
	case "upgrade":
		return map[string]bool{
			"upgrade": true,
			"custom":  true,
		}
	default:
		return nil
	}
}

func shellExecutionWeight(shellType string) int {
	switch shellType {
	case "requireinstall":
		return -5
	case "pre-install":
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

func buildSiteShellJob(deployInfo *v1.Deployment, shell SiteShell, operation string) *batchv1.Job {
	podSpec := deployInfo.Spec.Template.Spec
	sourceContainer := podSpec.Containers[0]
	image := shell.Image
	if image == "" {
		image = sourceContainer.Image
	}

	backoffLimit := int32(2)
	ttlSecondsAfterFinished := int32(60)
	jobName := sanitizeK8sName(deployInfo.Name + "-shell-" + operation + "-" + shell.Type + "-" + helper.GetRandomStringNotContainsNumber(8))
	containerName := sanitizeK8sName(deployInfo.Name + "-shell")
	annotations := map[string]string{
		"w7.cc/shell-type": shell.Type,
		"w7.cc/title":      shell.Title,
	}
	if shell.Type == "custom" {
		annotations["w7.cc/custom-hook"] = "true"
	}

	slog.Info("build site shell job",
		"domain", argsValue.Domain,
		"operation", operation,
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
				"group":            argsValue.K8sAppName,
				"w7.cc/job-source": "tradition-site",
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
						"group":            argsValue.K8sAppName,
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
							Env:             sourceContainer.Env,
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

func sanitizeK8sName(name string) string {
	name = strings.ToLower(strings.ReplaceAll(name, "_", "-"))
	var builder strings.Builder
	lastDash := false
	for _, ch := range name {
		valid := (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
		if valid {
			builder.WriteRune(ch)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteByte('-')
			lastDash = true
		}
	}

	cleaned := strings.Trim(builder.String(), "-")
	if cleaned == "" {
		cleaned = "site"
	}
	if len(cleaned) > 63 {
		cleaned = strings.Trim(cleaned[:63], "-")
	}
	if cleaned == "" {
		return "site"
	}
	return cleaned
}
