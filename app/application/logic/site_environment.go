package logic

import (
	"os"
	"path/filepath"
	"time"

	"github.com/w7panel/w7panel-sitemanager/common/dao"
	"github.com/w7panel/w7panel-sitemanager/common/entity"
	zpkmarket "github.com/w7panel/w7panel-sitemanager/common/service/zpk-market"
	"github.com/we7coreteam/w7-rangine-go/v2/pkg/support/facade"
)

type SiteEnvironment struct {
	logic
}

func (l SiteEnvironment) GetEnvironmentById(id int32) *entity.Environment {
	siteEnvironment, _ := dao.Q.Environment.Where(dao.Q.Environment.ID.Eq(id)).First()

	return siteEnvironment
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

func (l SiteEnvironment) getSiteEnvironmentServerDir(siteEnvironment entity.Environment) string {
	serverDir := facade.GetConfig().GetString("setting.environment_server_dir")
	return filepath.Join(serverDir, siteEnvironment.AppName)
}

func (l SiteEnvironment) GetSupportEnvironmentList() (*zpkmarket.ListResp, error) {
	const baseURL = "https://zpk.w7.cc"
	environments := []struct {
		identifier  string
		name        string
		description string
	}{
		{"w7-php", "php", "php 运行环境"},
		{"w7-go", "go", "golang 运行环境"},
		{"w7-nodejs", "nodejs", "nodejs运行环境"},
		{"w7-python", "python", "python 运行环境"},
		{"w7-prosenv", "php_微擎", "微擎系统专用运行环境，默认安装了必要的PHP扩展"},
	}
	list := make([]zpkmarket.ZpkInfo, 0, len(environments))
	for _, environment := range environments {
		list = append(list, zpkmarket.ZpkInfo{
			Name:           environment.name,
			Identifier:     environment.identifier,
			Identifie:      environment.identifier,
			Icon:           baseURL + "/zpk/zip/icon/" + environment.identifier,
			Description:    environment.description,
			FormulaURL:     baseURL + "/zpk/respo/info/" + environment.identifier,
			SupportVersion: []string{},
		})
	}
	return &zpkmarket.ListResp{Limit: 100, Page: 1, Total: len(list), List: list}, nil
}
