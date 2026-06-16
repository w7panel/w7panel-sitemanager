package controller

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/w7panel/w7panel-sitemanager/app/application/logic"
	"github.com/w7panel/w7panel-sitemanager/common/accessor"
	"github.com/w7panel/w7panel-sitemanager/common/dao"
	"github.com/w7panel/w7panel-sitemanager/common/entity"
	"github.com/we7coreteam/w7-rangine-go/v2/src/http/controller"
)

type Site struct {
	controller.Abstract
}

func (c Site) Create(ctx *gin.Context) {
	type ParamsValidate struct {
		Domain          []string         `json:"domain" binding:"required"`
		RootDir         string           `json:"root_dir" binding:"required"`
		Remark          string           `json:"remark"`
		EnvironmentId   int              `json:"environment_id" binding:"required"`
		CodeDownloadUrl string           `json:"code_download_url"`
		Ext             accessor.SiteExt `json:"ext"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}

	slog.Info("create site", "params", params)

	domain := strings.Join(params.Domain, ",")
	existsSite, _ := dao.Q.Site.Where(dao.Q.Site.Domain.Eq(domain)).First()
	if existsSite != nil {
		c.JsonResponseWithServerError(ctx, errors.New("site domain already exists"))
		return
	}
	setEnvironment := logic.SiteEnvironment{}.GetEnvironmentById(int32(params.EnvironmentId))
	if setEnvironment == nil {
		c.JsonResponseWithServerError(ctx, errors.New("environment not found"))
		return
	}

	var curSite *entity.Site
	err := dao.Q.Transaction(func(tx *dao.Query) error {
		curSite = &entity.Site{
			Domain:        domain,
			RootDir:       params.RootDir,
			Remark:        params.Remark,
			EnvironmentID: setEnvironment.ID,
			Ext:           params.Ext,
		}
		err := tx.Site.Create(curSite)
		if err != nil {
			return err
		}

		_, err = tx.Environment.Where(tx.Environment.ID.Eq(setEnvironment.ID)).Update(tx.Environment.UsedNum, tx.Environment.UsedNum.Add(1))
		if err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}

	err = logic.Site{}.InstallSite(*curSite, params.CodeDownloadUrl)
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("install site failed: %v", err), "params", params)
	}

	c.JsonResponseWithoutError(ctx, map[string]interface{}{
		"site_environment": setEnvironment,
		"site_id":          curSite.ID,
	})
}

func (c Site) Update(ctx *gin.Context) {
	type ParamsValidate struct {
		Id            int      `json:"id" binding:"required"`
		Domain        []string `json:"domain" binding:"required"`
		RootDir       string   `json:"root_dir" binding:"required"`
		Remark        string   `json:"remark"`
		EnvironmentId int      `json:"environment_id" binding:"required"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}
	domain := strings.Join(params.Domain, ",")

	curSite := logic.Site{}.GetSiteById(int32(params.Id))
	if curSite == nil {
		c.JsonResponseWithServerError(ctx, errors.New("site not found"))
		return
	}
	updatedSite := *curSite
	existsSite, _ := dao.Q.Site.Where(dao.Q.Site.Domain.Eq(domain)).Where(dao.Q.Site.ID.Neq(curSite.ID)).First()
	if existsSite != nil {
		c.JsonResponseWithServerError(ctx, errors.New("site domain already exists"))
		return
	}
	setEnvironment := logic.SiteEnvironment{}.GetEnvironmentById(int32(params.EnvironmentId))
	if setEnvironment == nil {
		c.JsonResponseWithServerError(ctx, errors.New("environment not found"))
		return
	}

	err := dao.Q.Transaction(func(tx *dao.Query) error {
		updatedSite.Domain = domain
		updatedSite.RootDir = params.RootDir
		updatedSite.Remark = params.Remark
		updatedSite.EnvironmentID = setEnvironment.ID

		_, err := tx.Site.Where(tx.Site.ID.Eq(curSite.ID)).Updates(entity.Site{
			Domain:        domain,
			RootDir:       params.RootDir,
			EnvironmentID: setEnvironment.ID,
		})
		if err != nil {
			return err
		}

		//remark 零值问题， 只能这样来更新
		_, err = tx.Site.Where(tx.Site.ID.Eq(curSite.ID)).Update(tx.Site.Remark, params.Remark)
		if err != nil {
			return err
		}

		if curSite.EnvironmentID != setEnvironment.ID {
			_, err = tx.Environment.Where(tx.Environment.ID.Eq(setEnvironment.ID)).Update(tx.Environment.UsedNum, tx.Environment.UsedNum.Add(1))
			if err != nil {
				return err
			}

			_, err = tx.Environment.Where(tx.Environment.ID.Eq(curSite.EnvironmentID)).Update(tx.Environment.UsedNum, tx.Environment.UsedNum.Add(-1))
			if err != nil {
				return err
			}
		}

		return nil
	})
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}

	err = logic.Site{}.ReInstallSite(*curSite, updatedSite)
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("install site failed: %v", err), "params", params)
	}

	c.JsonResponseWithoutError(ctx, map[string]interface{}{
		"site_environment": setEnvironment,
		"site_id":          curSite.ID,
	})
}

func (c Site) UpdateCode(ctx *gin.Context) {
	type ParamsValidate struct {
		Domain          string            `json:"domain" binding:"required"`
		CodeDownloadUrl string            `json:"code_download_url" binding:"required"`
		Ext             *accessor.SiteExt `json:"ext"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}

	curSite, _ := dao.Q.Site.Where(dao.Q.Site.Domain.Eq(params.Domain)).First()
	if curSite == nil {
		c.JsonResponseWithServerError(ctx, errors.New("site not found"))
		return
	}

	err := logic.Site{}.InstallSiteCode(*curSite, params.CodeDownloadUrl)
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}

	if params.Ext != nil {
		_, err = dao.Q.Site.Where(dao.Q.Site.ID.Eq(curSite.ID)).Update(dao.Q.Site.Ext, *params.Ext)
		if err != nil {
			c.JsonResponseWithServerError(ctx, err)
			return
		}
	}

	c.JsonSuccessResponse(ctx)
}

func (c Site) Delete(ctx *gin.Context) {
	type ParamsValidate struct {
		Id                int  `json:"id" binding:"required"`
		RemoveSiteRootDir bool `json:"remove_root_dir"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}

	site := logic.Site{}.GetSiteById(int32(params.Id))
	if site == nil {
		c.JsonSuccessResponse(ctx)
		return
	}

	err := dao.Q.Transaction(func(tx *dao.Query) error {
		_, err := tx.Site.Where(tx.Site.ID.Eq(int32(params.Id))).Delete()
		if err != nil {
			return err
		}

		_, err = tx.SiteSetting.Where(tx.SiteSetting.SiteID.Eq(int32(params.Id))).Delete()
		if err != nil {
			return err
		}

		_, err = tx.Environment.Where(tx.Environment.ID.Eq(int32(site.EnvironmentID))).Update(tx.Environment.UsedNum, tx.Environment.UsedNum.Add(-1))
		if err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}
	if site != nil {
		logic.Site{}.UnInstallSite(*site, params.RemoveSiteRootDir)
	}

	c.JsonSuccessResponse(ctx)
}

func (c Site) Info(ctx *gin.Context) {
	type ParamsValidate struct {
		Id     int    `json:"id"`
		Domain string `json:"domain"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}

	var curSite *entity.Site
	if params.Id > 0 {
		curSite = logic.Site{}.GetSiteById(int32(params.Id))
	} else if params.Domain != "" {
		curSite, _ = dao.Q.Site.Where(dao.Q.Site.Domain.Eq(params.Domain)).First()
	} else {
		c.JsonResponseWithServerError(ctx, errors.New("site id or domain required"))
		return
	}
	if curSite == nil {
		c.JsonResponseWithServerError(ctx, errors.New("site not found"))
		return
	}
	siteEnvironment := logic.SiteEnvironment{}.GetEnvironmentById(curSite.EnvironmentID)
	if siteEnvironment == nil {
		c.JsonResponseWithServerError(ctx, errors.New("environment not found"))
		return
	}

	c.JsonResponseWithoutError(ctx, map[string]interface{}{
		"site_environment": siteEnvironment,
		"site":             curSite,
	})
}

func (c Site) List(ctx *gin.Context) {
	type ParamsValidate struct {
		Page     int    `json:"page"`
		PageSize int    `json:"page_size"`
		Group    string `json:"group"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}
	if params.Page <= 0 {
		params.Page = 1
	}
	if params.PageSize <= 0 {
		params.PageSize = 10
	}

	type SiteInfo struct {
		ID                 int32            `json:"id"`
		Domain             []string         `json:"domain"`
		RootDir            string           `json:"root_dir"`
		Remark             string           `json:"remark"`
		EnvironmentID      int32            `json:"environment_id"`
		Ext                accessor.SiteExt `json:"ext"`
		EnvironmentName    string           `json:"environment_name"`
		EnvironmentAppName string           `json:"environment_app_name"`
		CreatedAt          time.Time        `json:"created_at"`
		UpdatedAt          time.Time        `json:"updated_at"`
	}

	query := dao.Q.Site.Preload(dao.Q.Site.Environment).Join(dao.Q.Environment, dao.Q.Site.EnvironmentID.EqCol(dao.Q.Environment.ID))
	if params.Group != "" {
		query = query.Where(dao.Q.Environment.Group_.Eq(params.Group))
	}
	list, total, err := query.Order(dao.Q.Site.CreatedAt.Desc()).FindByPage((params.Page-1)*params.PageSize, params.PageSize)
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}

	retList := make([]SiteInfo, len(list))
	for i := range list {
		retList[i] = SiteInfo{
			ID:                 list[i].ID,
			Domain:             strings.Split(list[i].Domain, ","),
			RootDir:            list[i].RootDir,
			Remark:             list[i].Remark,
			Ext:                list[i].Ext,
			CreatedAt:          list[i].CreatedAt,
			UpdatedAt:          list[i].UpdatedAt,
			EnvironmentName:    list[i].Environment.Title,
			EnvironmentAppName: list[i].Environment.AppName,
			EnvironmentID:      list[i].EnvironmentID,
		}
	}

	c.JsonResponseWithoutError(ctx, map[string]interface{}{
		"list":      retList,
		"total":     total,
		"page":      params.Page,
		"page_size": params.PageSize,
	})
}
