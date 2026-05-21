package controller

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/w7panel/w7panel-sitemanager/app/application/logic"
	"github.com/w7panel/w7panel-sitemanager/common/dao"
	"github.com/w7panel/w7panel-sitemanager/common/entity"
	"github.com/we7coreteam/w7-rangine-go/v2/src/http/controller"
)

type SiteSetting struct {
	controller.Abstract
}

func (c SiteSetting) SetNginxVhostConf(ctx *gin.Context) {
	type ParamsValidate struct {
		SiteId         int    `json:"site_id" binding:"required"`
		NginxVhostConf string `json:"nginx_vhost_conf" binding:"required"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}

	curSite := logic.Site{}.GetSiteById(int32(params.SiteId))
	if curSite == nil {
		c.JsonResponseWithServerError(ctx, errors.New("site not found"))
		return
	}
	siteNginxVhost := logic.SiteSetting{}.GetSiteNginxVhostSetting(*curSite)

	err := dao.Q.Transaction(func(tx *dao.Query) error {
		if siteNginxVhost == nil {
			err := tx.SiteSetting.Create(&entity.SiteSetting{
				SiteID:       curSite.ID,
				SettingKey:   logic.SiteSettingNginxVhostKey,
				SettingValue: params.NginxVhostConf,
			})
			if err != nil {
				return err
			}
		} else {
			_, err := tx.SiteSetting.Where(tx.SiteSetting.ID.Eq(siteNginxVhost.ID)).Update(tx.SiteSetting.SettingValue, params.NginxVhostConf)
			if err != nil {
				return err
			}
		}

		return logic.Site{}.InstallSiteNginxVhost(*curSite, params.NginxVhostConf)
	})

	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}

	c.JsonSuccessResponse(ctx)
}

func (c SiteSetting) GetNginxVhostConf(ctx *gin.Context) {
	type ParamsValidate struct {
		SiteId int `json:"site_id" binding:"required"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}

	curSite := logic.Site{}.GetSiteById(int32(params.SiteId))
	if curSite == nil {
		c.JsonResponseWithServerError(ctx, errors.New("site not found"))
		return
	}

	nginxVhostConf := logic.SiteSetting{}.GetInstalledSiteNginxVhost(*curSite)

	c.JsonResponseWithoutError(ctx, map[string]interface{}{"nginx_vhost_conf": nginxVhostConf})
}
