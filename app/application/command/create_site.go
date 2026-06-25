package command

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strings"

	"github.com/spf13/cobra"
	"github.com/w7panel/w7panel-sitemanager/app/application/logic"
	"github.com/w7panel/w7panel-sitemanager/common/accessor"
	"github.com/w7panel/w7panel-sitemanager/common/service/site_manager"
	"github.com/w7panel/w7panel-sitemanager/common/service/w7panel"
	"github.com/w7panel/w7panel-sitemanager/common/service/zpk"
	"github.com/we7coreteam/w7-rangine-go/v2/src/console"
	v3 "k8s.io/api/core/v1"
)

type DeployInfo struct {
	Name          string `json:"name"`
	NginxTemplate string `json:"nginx_template"`
	IngressName   string `json:"ingress_name"`
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
	startParamsEnv, err := parseStartParamsEnv(argsValue.StartParamsEnvBase64)
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

	w7panelService := logic.GetPanelService(argsValue.Domain, argsValue.W7PanelToken)
	siteManagerService := getSiteManagerService()

	needRestartNginx := false
	siteInfo, _ := siteManagerService.InfoSite(site_manager.SiteInfoReq{
		Domain: argsValue.Domain,
	})
	shellDeployName := ""
	if argsValue.Operation == "upgrade" && siteInfo != nil {
		shellDeployName = siteInfo.SiteEnvironment.AppName
		if !isSameSiteEnvironment(siteInfo.SiteEnvironment) {
			info, err := createSiteK8sResource(w7panelService, false)
			if err != nil {
				panic(err)
			}

			environment, err := siteManagerService.CreateEnvironment(site_manager.CreateEnvironmentReq{
				Title:              argsValue.EnvironmentTitle,
				Language:           argsValue.EnvironmentLanguage,
				Version:            argsValue.EnvironmentVersion,
				Group:              getDesiredEnvironmentGroup(),
				AppName:            info.Name,
				NginxVhostTemplate: info.NginxTemplate,
			})
			if err != nil {
				cleanupCreatedEnvironment(w7panelService, 0, info)
				panic(err)
			}

			shellDeployName = info.Name
			err = siteManagerService.UpdateSite(site_manager.UpdateSiteReq{
				Id:            siteInfo.Site.Id,
				Domain:        strings.Split(siteInfo.Site.Domain, ","),
				RootDir:       siteInfo.Site.RootDir,
				Remark:        siteInfo.Site.Remark,
				EnvironmentId: environment.Id,
			})
			if err != nil {
				cleanupCreatedEnvironment(w7panelService, environment.Id, info)
				panic(err)
			}
			needRestartNginx = true
			slog.Info("站点环境更新成功", "domain", argsValue.Domain, "environment_id", environment.Id)
		}
		slog.Info("站点代码更新成功", "params", argsValue)
	} else {
		info, err := createSiteK8sResource(w7panelService, true)
		if err != nil {
			panic(err)
		}

		environment, err := siteManagerService.CreateEnvironment(site_manager.CreateEnvironmentReq{
			Title:              argsValue.EnvironmentTitle,
			Language:           argsValue.EnvironmentLanguage,
			Version:            argsValue.EnvironmentVersion,
			Group:              getDesiredEnvironmentGroup(),
			AppName:            info.Name,
			NginxVhostTemplate: info.NginxTemplate,
		})
		if err != nil {
			cleanupCreatedEnvironment(w7panelService, 0, info)
			panic(err)
		}

		err = siteManagerService.CreateSite(site_manager.CreateSiteReq{
			Domain:        []string{argsValue.Domain},
			RootDir:       argsValue.Domain,
			EnvironmentId: environment.Id,
			Ext: accessor.SiteExt{
				AppIdentify: argsValue.AppName,
				K8sAppName:  argsValue.K8sAppName,
			},
		})
		if err != nil {
			cleanupCreatedEnvironment(w7panelService, environment.Id, info)
			panic(err)
		}
		needRestartNginx = true
		shellDeployName = info.Name
	}

	shells = append(shells, getRestartContainerShellCommand(argsValue.W7PanelDomain, argsValue.W7PanelToken, shellDeployName, "default", shellDeployName, commands))
	shells = append(shells, getDownloadCodeShellCommand(argsValue.CodeDownloadUrl))
	err = logic.RunSiteShellsByOperation(w7panelService, shellDeployName, argsValue.Operation, startParamsEnv, shells)
	if err != nil {
		slog.Error(err.Error())
		panic(err)
	}

	if needRestartNginx {
		err = w7panelService.RestartDeployByPatch("w7-sitemanager-site-manager-nginx")
		if err != nil {
			slog.Error(err.Error())
		}
	}

	slog.Info("站点安装成功", "params", argsValue)
}

func createSiteK8sResource(w7panelService w7panel.W7PanelService, createIngress bool) (*DeployInfo, error) {
	sourceDeployInfo, err := w7panelService.QueryDeploy(getDesiredEnvironmentGroup())
	if err != nil {
		return nil, err
	}

	err = logic.CopySiteK8sEnvironmentDeployment(w7panelService, sourceDeployInfo, argsValue.K8sEnvAppName, argsValue.EnvironmentVersion)
	if err != nil {
		return nil, err
	}

	nginxTemplate := ""
	ingressName := ""
	if createIngress {
		if sourceDeployInfo.Spec.Template.Annotations == nil {
			sourceDeployInfo.Spec.Template.Annotations = make(map[string]string)
		}
		if val, ok := sourceDeployInfo.Spec.Template.Annotations["w7.cc/nginx_vhost_template"]; ok && val != "" {
			nginxTemplate = val
		}

		ingressName, err = logic.CreateSiteIngress(w7panelService, argsValue.Domain, argsValue.EnableSsl)
		if err != nil {
			w7panelService.DeleteDeploy(argsValue.K8sEnvAppName)
			return nil, err
		}
	}

	return &DeployInfo{
		Name:          argsValue.K8sEnvAppName,
		NginxTemplate: nginxTemplate,
		IngressName:   ingressName,
	}, nil
}

func cleanupCreatedEnvironment(w7panelService w7panel.W7PanelService, environmentId int, info *DeployInfo) {
	if environmentId > 0 {
		if err := getSiteManagerService().DeleteEnvironment(environmentId); err != nil {
			slog.Error(err.Error())
		}
	}
	if info == nil {
		return
	}
	if err := w7panelService.DeleteDeploy(info.Name); err != nil {
		slog.Error(err.Error())
	}
	if info.IngressName != "" {
		if err := w7panelService.DeleteIngress(info.IngressName); err != nil {
			slog.Error(err.Error())
		}
	}
}

func getDownloadCodeShellCommand(codeDownloadUrl string) logic.SiteShell {
	command := fmt.Sprintf(`
# 1. 环境变量检查
              if [ -z "$DOMAIN_URL" ]; then
                echo "错误: 环境变量 DOMAIN_URL 未设置或为空"
                exit 1
              fi
              echo "使用环境变量 DOMAIN_URL: $DOMAIN_URL"
              
              # 2. 基础路径与文件定义
              WEB_BASE_PATH="/www/wwwroot/$DOMAIN_URL"
              ZIP_URL="%s"  # 建议将下载地址放在 values.yaml 中
              ZIP_FILE="/tmp/code.zip"
              
              # 3. 创建目标目录
              echo "创建目标目录: $WEB_BASE_PATH"
              mkdir -p "$WEB_BASE_PATH"
              
              # 4. 下载代码包
              echo "开始下载代码包: $ZIP_URL"
              if ! wget -q -O "$ZIP_FILE" "$ZIP_URL"; then
                echo "错误: 代码包下载失败"
                exit 1
              fi
              
              # 5. 解压到指定目录
              echo "解压代码到: $WEB_BASE_PATH"
              if ! unzip -q -o "$ZIP_FILE" -d "$WEB_BASE_PATH"; then
                echo "错误: 代码包解压失败"
                exit 1
              fi
              
              # 6. 清理临时文件
              rm -f "$ZIP_FILE"
              echo "代码下载并解压成功！"`, codeDownloadUrl)

	return logic.SiteShell{
		Shell: command,
		Title: "code-download",
		Type:  "fix-first",
		Image: "alpine:3.18",
	}
}

func getRestartContainerShellCommand(k8sApiUrl, authToken, deploymentName, namespace, containerName string, newCommand []string) logic.SiteShell {
	cmdJsonStr := ""
	if len(newCommand) > 0 {
		cmdBytes, _ := json.Marshal(newCommand)
		cmdJsonStr = string(cmdBytes)
	}

	// 2. 所有参数全部通过 fmt.Sprintf 的占位符直接替换到 Shell 脚本中
	command := fmt.Sprintf(`
echo "正在准备处理 Deployment: %s/%s"

# 2. 基础路径与文件定义
URL="%s/apis/apps/v1/namespaces/%s/deployments/%s"
AUTH_TOKEN="%s"
TIMESTAMP=$(date -u +"%%Y-%%m-%%dT%%H:%%M:%%SZ")

# 3. 动态构建 JSON Payload
# 判断传入的 command JSON 字符串是否为空
if [ -n "%s" ]; then
  echo "检测到新 command 数组: %s"
  PAYLOAD=$(jq -n \
    --arg name "%s" \
    --argjson cmd '%s' \
    --arg ts "$TIMESTAMP" \
    '{
      "spec": {
        "template": {
          "metadata": {
            "annotations": {
              "kubectl.kubernetes.io/restartedAt": $ts
            }
          },
          "spec": {
            "containers": [
              {
                "name": $name,
                "command": $cmd
              }
            ]
          }
        }
      }
    }')
else
  echo "未提供新 command，仅触发滚动重启..."
  PAYLOAD=$(jq -n \
    --arg ts "$TIMESTAMP" \
    '{
      "spec": {
        "template": {
          "metadata": {
            "annotations": {
              "kubectl.kubernetes.io/restartedAt": $ts
            }
          }
        }
      }
    }')
fi

# 4. 执行 PATCH 请求
echo "发送 PATCH 请求..."
RESPONSE=$(curl -s -k -X PATCH \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/merge-patch+json" \
  -d "$PAYLOAD" \
  "$URL")

# 5. 检查响应状态
STATUS=$(echo "$RESPONSE" | jq -r '.metadata.generation // empty' 2>/dev/null)
if [ -n "$STATUS" ]; then
  echo "Deployment %s 处理成功！Generation: $STATUS"
else
  echo "API 响应错误: $RESPONSE"
  exit 1
fi`,
		namespace, deploymentName, // 日志输出
		k8sApiUrl, namespace, deploymentName, // URL 拼接
		authToken,              // Token
		cmdJsonStr, cmdJsonStr, // Command 判空及日志
		containerName,  // jq --arg name
		cmdJsonStr,     // jq --argjson cmd (直接替换 JSON 数组)
		deploymentName, // 成功日志
	)

	return logic.SiteShell{
		Shell: command,
		Title: "restart-container",
		Type:  "fix-install",
		Image: "curlimages/curl:8.7.1",
	}
}

func getSiteManagerService() site_manager.SiteManagerService {
	return site_manager.SiteManagerService{
		BaseUrl: "http://w7-sitemanager-site-manager.default.svc.cluster.local:8000",
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

func parseStartParamsEnv(raw string) ([]v3.EnvVar, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" || raw == "null" {
		return nil, nil
	}

	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, err
	}

	envMap := make(map[string]string)
	if err := json.Unmarshal(decoded, &envMap); err != nil {
		return nil, err
	}

	env := make([]v3.EnvVar, 0, len(envMap))
	for name, value := range envMap {
		if name == "" {
			continue
		}
		env = append(env, v3.EnvVar{
			Name:  name,
			Value: value,
		})
	}
	return env, nil
}

func parseCommands(raw, rawBase64 string) ([]string, error) {
	rawBase64 = strings.TrimSpace(rawBase64)
	if rawBase64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(rawBase64)
		if err != nil {
			return nil, err
		}
		raw = string(decoded)
	}

	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[\"\"]" {
		return nil, nil
	}

	commands := make([]string, 0)
	if err := json.Unmarshal([]byte(raw), &commands); err != nil {
		return nil, err
	}
	if len(commands) == 1 && commands[0] == "" {
		return nil, nil
	}
	return commands, nil
}

func parseShells(rawBase64 string) ([]logic.SiteShell, error) {
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

	shells := make([]logic.SiteShell, 0)
	if err := json.Unmarshal(decoded, &shells); err != nil {
		slog.Error("parse site shell config failed", "domain", argsValue.Domain, "operation", argsValue.Operation, "err", err)
		return nil, err
	}
	slog.Info("site shell config parsed", "domain", argsValue.Domain, "operation", argsValue.Operation, "shell_count", len(shells))
	return shells, nil
}
