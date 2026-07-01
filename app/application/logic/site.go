package logic

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/w7panel/w7panel-sitemanager/common/dao"
	"github.com/w7panel/w7panel-sitemanager/common/entity"
	"github.com/w7panel/w7panel-sitemanager/common/helper"
)

type Site struct {
	logic
}

func (l Site) GetSiteById(id int32) *entity.Site {
	curSite, _ := dao.Q.Site.Where(dao.Q.Site.ID.Eq(id)).First()
	return curSite
}

func (l Site) InstallSite(site entity.Site) error {
	environment := SiteEnvironment{}.GetEnvironmentById(site.EnvironmentID)
	if environment == nil {
		return errors.New("站点环境异常")
	}
	err := l.InstallSiteNginxVhost(site, l.buildSiteNginxVhostConf(site, *environment))
	if err != nil {
		return err
	}

	return nil
}

func (l Site) InstallSiteCode(site entity.Site, codeDownloadUrl string) error {
	absoluteRootDir := SiteSetting{}.GetAbsoluteSiteRootDir(site.RootDir)
	helper.CreateDirIfNotExist(absoluteRootDir, os.ModePerm)
	if codeDownloadUrl == "" {
		defaultFilePath := filepath.Join(absoluteRootDir, "index.html")
		if helper.FileExists(defaultFilePath) {
			return nil
		}
		return os.WriteFile(defaultFilePath, []byte(""), os.ModePerm)
	} else {
		savePath := filepath.Join(absoluteRootDir, helper.GetRandomString(8)+"_code.zip")
		err := helper.DownloadFile(codeDownloadUrl, savePath)
		if err != nil {
			return err
		}
		slog.Info("download code_download_url:", "path", codeDownloadUrl, "save_path", savePath, "absolute_root_dir", absoluteRootDir)
		defer os.Remove(savePath)
		err = helper.Unzip(savePath, absoluteRootDir)
		if err != nil {
			return err
		}
	}
	return nil
}

func (l Site) ReInstallSite(oldSite entity.Site, updatedSite entity.Site) error {
	if oldSite.RootDir != updatedSite.RootDir {
		oldSiteRootDir := SiteSetting{}.GetAbsoluteSiteRootDir(oldSite.RootDir)
		updatedSiteRootDir := SiteSetting{}.GetAbsoluteSiteRootDir(updatedSite.RootDir)
		err := helper.MoveDir(oldSiteRootDir, updatedSiteRootDir)
		if err != nil {
			slog.Error(fmt.Sprintf("move dir failed: %v", err), "from", oldSite.RootDir, "to", updatedSite.RootDir)
			return err
		}
	}

	return l.modifyNginx(oldSite, updatedSite)
}

func (l Site) modifyNginx(oldSite entity.Site, updatedSite entity.Site) error {
	curNginxVhost := SiteSetting{}.GetInstalledSiteNginxVhost(oldSite)
	if curNginxVhost == "" {
		return errors.New("站点 nginx 配置异常")
	}

	oldSiteRootDir := SiteSetting{}.GetAbsoluteSiteRootDir(oldSite.RootDir)
	updatedSiteRootDir := SiteSetting{}.GetAbsoluteSiteRootDir(updatedSite.RootDir)

	oldSiteEnvironment := SiteEnvironment{}.GetEnvironmentById(oldSite.EnvironmentID)
	updatedSiteEnvironment := SiteEnvironment{}.GetEnvironmentById(updatedSite.EnvironmentID)
	if oldSiteEnvironment == nil || updatedSiteEnvironment == nil {
		return errors.New("站点环境异常")
	}

	if oldSite.Domain != updatedSite.Domain {
		updatedSiteName := strings.ReplaceAll(strings.ReplaceAll(updatedSite.Domain, "http://", ""), "https://", "")

		serverNamePattern := `(?m)^\s*server_name\s+[^;]+;`
		serverNameRe := regexp.MustCompile(serverNamePattern)
		if !serverNameRe.MatchString(curNginxVhost) {
			return fmt.Errorf("server_name directive not found")
		}

		newServerNameLine := "    server_name " + strings.ReplaceAll(updatedSiteName, ",", " ") + ";"
		curNginxVhost = serverNameRe.ReplaceAllString(curNginxVhost, newServerNameLine)
	}

	if oldSiteRootDir != updatedSiteRootDir {
		var rootDirReplaced bool
		curNginxVhost, rootDirReplaced = replaceNginxRootDirReferences(curNginxVhost, oldSiteRootDir, updatedSiteRootDir)
		if !rootDirReplaced {
			return fmt.Errorf("old root directory not found in config")
		}
	}

	curNginxVhost = strings.ReplaceAll(curNginxVhost, oldSiteEnvironment.AppName, updatedSiteEnvironment.AppName)

	err := l.InstallSiteNginxVhost(updatedSite, curNginxVhost)
	if err != nil {
		return err
	}

	oldSiteNginxPath := SiteSetting{}.GetSiteNginxVhostFilePath(oldSite)
	updatedSiteNginxPath := SiteSetting{}.GetSiteNginxVhostFilePath(updatedSite)
	if oldSiteNginxPath != updatedSiteNginxPath {
		os.Remove(oldSiteNginxPath)
	}

	return nil
}

func replaceNginxRootDirReferences(config string, oldRootDir string, updatedRootDir string) (string, bool) {
	if oldRootDir == "" {
		return config, false
	}

	rootDirRe := regexp.MustCompile(`(^|[^A-Za-z0-9._/-])` + regexp.QuoteMeta(oldRootDir) + `(/|[:;"'\s]|$)`)
	updatedConfig := rootDirRe.ReplaceAllString(config, "${1}"+updatedRootDir+"${2}")
	return updatedConfig, updatedConfig != config
}

func (l Site) UnInstallSite(site entity.Site, removeSiteRootDir bool) {
	_ = os.Remove(SiteSetting{}.GetSiteNginxVhostFilePath(site))
	if removeSiteRootDir {
		rootDir := SiteSetting{}.GetAbsoluteSiteRootDir(site.RootDir)
		_ = os.RemoveAll(rootDir)
		go func() {
			//删除站点的时候，前端会检测是否有自定义命令，如果有会先把环境容器的命令改为调试命令，解除环境容器对站点目录的占用
			//考虑环境容器中对站点文件占用的情况，延时重新删除一次
			time.Sleep(5 * time.Second)
			_ = os.RemoveAll(rootDir)
		}()
	}
}

func (l Site) buildSiteNginxVhostConf(site entity.Site, siteEnvironment entity.Environment) string {
	k8sDomain := siteEnvironment.AppName + ".default.svc.cluster.local"
	domain := strings.ReplaceAll(strings.ReplaceAll(site.Domain, "http://", ""), "https://", "")
	templateData := map[string]string{
		"{UPSTREAM_APP_NAME}": helper.GetRandomString(16),
		"{SERVER_NAME}":       strings.ReplaceAll(domain, ",", " "),
		"{LOG_DIR}":           strings.Split(domain, ",")[0],
		"{ROOT_DIR}":          SiteSetting{}.GetAbsoluteSiteRootDir(site.RootDir),
		"{K8S_DOMAIN}":        k8sDomain,
	}

	vhostTemplate := siteEnvironment.NginxVhostTemplate
	for key, value := range templateData {
		vhostTemplate = strings.ReplaceAll(vhostTemplate, key, value)
	}

	return vhostTemplate
}

func (l Site) InstallSiteNginxVhost(site entity.Site, config string) error {
	return os.WriteFile(SiteSetting{}.GetSiteNginxVhostFilePath(site), []byte(config), os.ModePerm)
}
