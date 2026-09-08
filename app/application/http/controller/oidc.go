package controller

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/w7panel/w7panel-sitemanager/app/application/logic"
	"github.com/w7panel/w7panel-sitemanager/common/helper"
	"github.com/we7coreteam/w7-rangine-go/v2/src/http/controller"
)

type OIDC struct {
	controller.Abstract
}

func (c OIDC) LoginFromW7Panel(ctx *gin.Context) {
	params := struct {
		AccessToken string `form:"access_token" json:"access_token" binding:"required"`
	}{}
	if !c.Validate(ctx, &params) {
		return
	}
	info, err := (logic.OIDC{}).UserInfo(ctx.Request.Context(), params.AccessToken)

	c.JsonResponseWithoutError(ctx, map[string]any{"token": helper.GetRandomString(16)})
	return

	if err != nil {
		c.JsonResponseWithError(ctx, err, http.StatusUnauthorized)
		return
	}
	token, err := (logic.Session{}).SaveUserInfo(ctx, logic.UserSession{
		Subject: info.Subject, Username: info.Username, Role: info.Role,
	})
	if err != nil {
		c.JsonResponseWithServerError(ctx, err)
		return
	}
	c.JsonResponseWithoutError(ctx, map[string]any{"token": token})
}
