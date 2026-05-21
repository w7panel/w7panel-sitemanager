package logic

import (
	"os"
	"path/filepath"
	"time"

	copy2 "github.com/otiai10/copy"
	"github.com/patrickmn/go-cache"
	"github.com/w7panel/w7panel-sitemanager/common/dao"
	"github.com/w7panel/w7panel-sitemanager/common/entity"
	"github.com/w7panel/w7panel-sitemanager/common/helper"
	"github.com/w7panel/w7panel-sitemanager/common/service/zpk"
	"github.com/we7coreteam/w7-rangine-go/v2/pkg/support/facade"
)

var environmentListCache = cache.New(10*time.Minute, 15*time.Minute)

type SiteEnvironment struct {
	logic
}

func (l SiteEnvironment) GetEnvironmentById(id int32) *entity.Environment {
	siteEnvironment, _ := dao.Q.Environment.Where(dao.Q.Environment.ID.Eq(id)).First()

	return siteEnvironment
}

func (l SiteEnvironment) InstallSiteEnvironment(siteEnvironment entity.Environment) error {
	return l.installSiteEnvironmentTools(siteEnvironment)
}

func (l SiteEnvironment) UninstallSiteEnvironment(siteEnvironment entity.Environment) {
	rootDir := l.getSiteEnvironmentServerDir(siteEnvironment)
	os.RemoveAll(rootDir)
	go func() {
		//删除站点的时候，前端会检测是否有自定义命令，如果有会先把环境容器的命令改为调试命令，解除环境容器对站点目录的占用
		//考虑环境容器中对站点文件占用的情况，延时重新删除一次
		time.Sleep(10 * time.Second)
		_ = os.RemoveAll(rootDir)
	}()

}

func (l SiteEnvironment) installSiteEnvironmentTools(siteEnvironment entity.Environment) error {
	curEnvironmentToolsAttachDir := l.getSiteEnvironmentLocalToolsDir(siteEnvironment)
	environmentToolsDir := SiteEnvironment{}.getSiteEnvironmentServerToolsDir(siteEnvironment)
	err := copy2.Copy(curEnvironmentToolsAttachDir, environmentToolsDir)
	return err
}

func (l SiteEnvironment) getSiteEnvironmentServerDir(siteEnvironment entity.Environment) string {
	serverDir := facade.GetConfig().GetString("setting.environment_server_dir")
	return filepath.Join(serverDir, siteEnvironment.AppName)
}

func (l SiteEnvironment) getSiteEnvironmentServerToolsDir(siteEnvironment entity.Environment) string {
	toolsDir := filepath.Join(l.getSiteEnvironmentServerDir(siteEnvironment), "tools")
	helper.CreateDirIfNotExist(toolsDir, os.ModePerm)
	return toolsDir
}

func (l SiteEnvironment) getSiteEnvironmentLocalToolsDir(siteEnvironment entity.Environment) string {
	attachDir := facade.GetConfig().GetString("setting.environment_attach_dir")
	curEnvironmentToolsAttachDir := filepath.Join(attachDir, siteEnvironment.Language, "tools")
	helper.CreateDirIfNotExist(curEnvironmentToolsAttachDir, os.ModePerm)
	return curEnvironmentToolsAttachDir
}

func (l SiteEnvironment) GetSupportEnvironmentList() (*zpk.ListResp, error) {
	val, exists := environmentListCache.Get("site_environment_list_cache")
	if !exists {
		listResp, err := zpk.ZpkService{
			BaseUrl: "https://zpk.w7.cc",
		}.GetEnvironmentZpkList()
		if err != nil {
			return nil, err
		}
		environmentListCache.Set("site_environment_list_cache", listResp, cache.DefaultExpiration)
		return listResp, nil
	}
	return val.(*zpk.ListResp), nil
}
