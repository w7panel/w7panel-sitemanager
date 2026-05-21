package controller

import (
	"errors"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/w7panel/w7panel-sitemanager/app/application/logic"
	"github.com/w7panel/w7panel-sitemanager/common/dao"
	"github.com/w7panel/w7panel-sitemanager/common/entity"
	"github.com/we7coreteam/w7-rangine-go/v2/src/http/controller"
)

type SiteEnvironment struct {
	controller.Abstract
}

func (c SiteEnvironment) Create(ctx *gin.Context) {
	type ParamsValidate struct {
		Title              string `json:"title" binding:"required"`
		Language           string `json:"language" binding:"required"`
		Group              string `json:"group" binding:"required"`
		Version            string `json:"version" binding:"required"`
		AppName            string `json:"app_name" binding:"required"`
		NginxVhostTemplate string `json:"nginx_vhost_template" binding:"required"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}

	newEnvironment := &entity.Environment{
		Title:              params.Title,
		Language:           params.Language,
		Group_:             params.Group,
		Version:            params.Version,
		AppName:            params.AppName,
		NginxVhostTemplate: params.NginxVhostTemplate,
		UsedNum:            0,
	}
	err := dao.Q.Environment.Create(newEnvironment)
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}

	err = logic.SiteEnvironment{}.InstallSiteEnvironment(*newEnvironment)
	if err != nil {
		slog.ErrorContext(ctx, "install site environment error", "params", params, "err", err)
	}

	c.JsonResponseWithoutError(ctx, map[string]interface{}{
		"id": newEnvironment.ID,
	})
}

func (c SiteEnvironment) Update(ctx *gin.Context) {
	type ParamsValidate struct {
		Id                 int    `json:"id" binding:"required"`
		Title              string `json:"title"`
		Language           string `json:"language"`
		Version            string `json:"version"`
		AppName            string `json:"app_name"`
		NginxVhostTemplate string `json:"nginx_vhost_template"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}

	environment := logic.SiteEnvironment{}.GetEnvironmentById(int32(params.Id))
	if environment == nil {
		c.JsonResponseWithServerError(ctx, errors.New("environment  not found"))
		return
	}

	newEnvironment := &entity.Environment{}
	if params.Title != "" {
		newEnvironment.Title = params.Title
	}
	if params.Language != "" {
		newEnvironment.Language = params.Language
	}
	if params.Version != "" {
		newEnvironment.Version = params.Version
	}
	if params.AppName != "" {
		newEnvironment.AppName = params.AppName
	}
	if params.NginxVhostTemplate != "" {
		newEnvironment.NginxVhostTemplate = params.NginxVhostTemplate
	}

	_, err := dao.Q.Environment.Where(dao.Q.Environment.ID.Eq(int32(params.Id))).Updates(newEnvironment)
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}

	c.JsonSuccessResponse(ctx)
}

func (c SiteEnvironment) List(ctx *gin.Context) {
	type ParamsValidate struct {
		Page     int    `json:"page"`
		Group    string `json:"group"`
		PageSize int    `json:"page_size"`
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

	query := dao.Q.Environment.Order(dao.Q.Environment.CreatedAt.Desc())
	if params.Group != "" {
		query = query.Where(dao.Q.Environment.Group_.Eq(params.Group))
	}
	list, total, err := query.FindByPage((params.Page-1)*params.PageSize, params.PageSize)
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}

	c.JsonResponseWithoutError(ctx, map[string]interface{}{
		"list":      list,
		"total":     total,
		"page":      params.Page,
		"page_size": params.PageSize,
	})
}

func (c SiteEnvironment) Delete(ctx *gin.Context) {
	type ParamsValidate struct {
		Id int `json:"id" binding:"required"`
	}
	params := ParamsValidate{}
	if !c.Validate(ctx, &params) {
		return
	}

	environment := logic.SiteEnvironment{}.GetEnvironmentById(int32(params.Id))
	if environment == nil {
		c.JsonResponseWithServerError(ctx, errors.New("environment  not found"))
		return
	}

	if environment.UsedNum > 0 {
		c.JsonResponseWithServerError(ctx, errors.New("当前环境正在被使用，不可删除"))
		return
	}

	_, err := dao.Q.Environment.Where(dao.Q.Environment.ID.Eq(int32(params.Id))).Where(dao.Q.Environment.UsedNum.Lte(0)).Delete()
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}

	logic.SiteEnvironment{}.UninstallSiteEnvironment(*environment)

	c.JsonSuccessResponse(ctx)
}

func (c SiteEnvironment) GetSupportEnvironmentList(ctx *gin.Context) {
	list, err := logic.SiteEnvironment{}.GetSupportEnvironmentList()
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}

	c.JsonResponseWithoutError(ctx, list)
}
