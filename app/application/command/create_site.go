package command

import (
	"errors"
	"log/slog"
	"net/url"
	"strings"

	"github.com/spf13/cobra"
	"github.com/w7panel/w7panel-sitemanager/common/accessor"
	"github.com/w7panel/w7panel-sitemanager/common/service/site_manager"
	"github.com/w7panel/w7panel-sitemanager/common/service/zpk"
	"github.com/we7coreteam/w7-rangine-go/v2/src/console"
)

type appCommandArgs struct {
	AppName             string
	EnvironmentTitle    string
	EnvironmentName     string
	EnvironmentVersion  string
	EnvironmentLanguage string
	CodeDownloadUrl     string
	Domain              string
	K8sAppName          string
	K8sEnvAppName       string
	NginxVhostTemplate  string
	EnableSsl           bool
	Token               string
}

var argsValue appCommandArgs

type SiteCreate struct {
	console.Abstract
}

func (c SiteCreate) GetName() string {
	return "create:site"
}

func (c SiteCreate) Configure(cmd *cobra.Command) {
	cmd.Flags().StringVar(&argsValue.AppName, "app_name", "", "app name")
	cmd.Flags().StringVar(&argsValue.EnvironmentTitle, "title", "", "environment title")
	cmd.Flags().StringVar(&argsValue.EnvironmentName, "name", "", "environment name")
	cmd.Flags().StringVar(&argsValue.EnvironmentLanguage, "language", "", "environment language")
	cmd.Flags().StringVar(&argsValue.EnvironmentVersion, "version", "", "environment version")
	cmd.Flags().StringVar(&argsValue.CodeDownloadUrl, "code-download-url", "", "code download url")
	cmd.Flags().StringVar(&argsValue.Domain, "domain", "", "site domain")
	cmd.Flags().StringVar(&argsValue.K8sAppName, "k8s-app-name", "", "k8s app name")
	cmd.Flags().StringVar(&argsValue.K8sEnvAppName, "k8s-env-app-name", "", "k8s env app name")
	cmd.Flags().StringVar(&argsValue.NginxVhostTemplate, "nginx-vhost-template", "", "nginx vhost template")
	cmd.Flags().BoolVar(&argsValue.EnableSsl, "ssl", false, "enable ssl")
	cmd.Flags().StringVar(&argsValue.Token, "token", "", "W7Panel access token used to log in to site manager")
}

func (c SiteCreate) GetDescription() string {
	return "create site"
}

func (c SiteCreate) Handle(cmd *cobra.Command, args []string) {
	if err := createSite(argsValue); err != nil {
		panic(err)
	}
}

func createSite(argsValue appCommandArgs) error {
	slog.Info("create_site", "app_name", argsValue.AppName, "domain", argsValue.Domain)

	siteManagerService, err := getSiteManagerService(argsValue.Token)
	if err != nil {
		return err
	}
	if argsValue.K8sEnvAppName == "" {
		return errors.New("k8s-env-app-name is required")
	}

	siteInfo, _ := siteManagerService.InfoSite(site_manager.SiteInfoReq{
		Domain: argsValue.Domain,
	})
	environmentId, createdEnvironment, err := resolveEnvironmentId(siteManagerService, siteInfo, argsValue)
	if err != nil {
		return err
	}

	urlInfo, err := url.Parse(argsValue.CodeDownloadUrl)
	if err != nil {
		return err
	}
	//触发 info 接口， 才能从 downloadurl 下载文件
	zpkService := zpk.ZpkService{
		BaseUrl: urlInfo.Scheme + "://" + urlInfo.Host,
	}
	zpkInfo, err := zpkService.GetZpkInfo(argsValue.AppName)
	slog.Info("get zpk info", "info", zpkInfo, "err", err, "name", argsValue.AppName)

	if siteInfo != nil {
		err := siteManagerService.UpdateSite(site_manager.UpdateSiteReq{
			Id:              siteInfo.Site.Id,
			Domain:          strings.Split(siteInfo.Site.Domain, ","),
			RootDir:         siteInfo.Site.RootDir,
			Remark:          siteInfo.Site.Remark,
			EnvironmentId:   environmentId,
			CodeDownloadUrl: argsValue.CodeDownloadUrl,
		})
		if err != nil {
			if createdEnvironment {
				if cleanupErr := siteManagerService.DeleteEnvironment(environmentId); cleanupErr != nil {
					slog.Error(cleanupErr.Error())
				}
			}
			return err
		}
		slog.Info("站点已存在，更新站点环境成功", "domain", argsValue.Domain, "environment_id", environmentId)
	} else {
		err := siteManagerService.CreateSite(site_manager.CreateSiteReq{
			Domain:          []string{argsValue.Domain},
			RootDir:         argsValue.Domain,
			EnvironmentId:   environmentId,
			CodeDownloadUrl: argsValue.CodeDownloadUrl,
			Ext: accessor.SiteExt{
				AppIdentify: argsValue.AppName,
				K8sAppName:  argsValue.K8sAppName,
			},
		})
		if err != nil {
			if createdEnvironment {
				if cleanupErr := siteManagerService.DeleteEnvironment(environmentId); cleanupErr != nil {
					slog.Error(cleanupErr.Error())
				}
			}
			return err
		}
	}

	slog.Info("站点安装成功", "app_name", argsValue.AppName, "domain", argsValue.Domain)
	return nil
}

func resolveEnvironmentId(siteManagerService site_manager.SiteManagerService, siteInfo *site_manager.SiteInfoResp, argsValue appCommandArgs) (int, bool, error) {
	if siteInfo != nil && isSameSiteEnvironment(siteInfo.SiteEnvironment, argsValue) && siteInfo.SiteEnvironment.Id > 0 {
		return siteInfo.SiteEnvironment.Id, false, nil
	}

	title := argsValue.EnvironmentTitle
	if title == "" {
		title = argsValue.K8sEnvAppName
	}
	environment, err := siteManagerService.CreateEnvironment(site_manager.CreateEnvironmentReq{
		Title:              title,
		Group:              getDesiredEnvironmentGroup(argsValue),
		Language:           argsValue.EnvironmentLanguage,
		Version:            argsValue.EnvironmentVersion,
		AppName:            argsValue.K8sEnvAppName,
		NginxVhostTemplate: argsValue.NginxVhostTemplate,
	})
	if err != nil {
		return 0, false, err
	}
	return environment.Id, true, nil
}

func getSiteManagerService(accessToken string) (site_manager.SiteManagerService, error) {
	service := site_manager.SiteManagerService{
		BaseUrl: "http://w7-sitemanager-site-manager.default.svc.cluster.local:8000",
	}
	token, err := service.LoginFromW7Panel(accessToken)
	if err != nil {
		return site_manager.SiteManagerService{}, err
	}
	service.Token = token
	return service, nil
}

func isSameSiteEnvironment(environment site_manager.SiteEnvironmentResp, argsValue appCommandArgs) bool {
	if environment.Language != argsValue.EnvironmentLanguage || environment.Version != argsValue.EnvironmentVersion {
		return false
	}

	return environment.Group == getDesiredEnvironmentGroup(argsValue)
}

func getDesiredEnvironmentGroup(argsValue appCommandArgs) string {
	return strings.ReplaceAll(argsValue.EnvironmentName, "_", "-")
}
