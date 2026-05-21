package logic

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/w7panel/w7panel-sitemanager/common/dao"
	"github.com/w7panel/w7panel-sitemanager/common/entity"
	"github.com/w7panel/w7panel-sitemanager/common/helper"
	"github.com/we7coreteam/w7-rangine-go/v2/pkg/support/facade"
)

const (
	SiteSettingNginxVhostKey = "nginx_vhost"
)

type SiteSetting struct {
	logic
}

func (l SiteSetting) GetSiteNginxVhostSetting(site entity.Site) *entity.SiteSetting {
	siteNginxVhost, _ := dao.Q.SiteSetting.Where(dao.Q.SiteSetting.SiteID.Eq(site.ID)).Where(dao.Q.SiteSetting.SettingKey.Eq(SiteSettingNginxVhostKey)).First()
	return siteNginxVhost
}

func (l SiteSetting) GetInstalledSiteNginxVhost(site entity.Site) string {
	content, err := os.ReadFile(l.GetSiteNginxVhostFilePath(site))
	if err != nil {
		slog.Error("GetInstalledSiteNginxVhost err", "site", site, "err", err)
		return ""
	}

	return string(content)
}

func (l SiteSetting) GetAbsoluteSiteRootDir(siteRootDir string) string {
	rootDir := facade.GetConfig().GetString("setting.nginx.web_root_dir")

	return filepath.Join(rootDir, siteRootDir)
}

func (l SiteSetting) GetSiteNginxVhostFilePath(site entity.Site) string {
	nginxVhostDir := facade.GetConfig().GetString("setting.nginx.vhost_dir")
	helper.CreateDirIfNotExist(nginxVhostDir, os.ModePerm)
	domain := strings.ReplaceAll(strings.ReplaceAll(site.Domain, "http://", ""), "https://", "")
	domains := strings.Split(domain, ",")
	return filepath.Join(nginxVhostDir, domains[0]+".conf")
}
