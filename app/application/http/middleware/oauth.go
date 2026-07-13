package middleware

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/w7panel/w7panel-sitemanager/app/application/logic"
	"github.com/we7coreteam/w7-rangine-go/v2/src/http/middleware"
)

type Auth struct {
	middleware.Abstract
}

func (m Auth) Process(ctx *gin.Context) {
	token := ctx.GetHeader(logic.SiteManagerTokenHeader)
	if token == "" {
		m.JsonResponseWithError(ctx, errors.New("token 错误"), http.StatusUnauthorized)
		ctx.Abort()
		return
	}

	user, err := (logic.Session{}).GetUserInfo(ctx, token)
	if err != nil || user == nil || user.Subject == "" || user.Username == "" {
		m.JsonResponseWithError(ctx, errors.New("token 错误"), http.StatusUnauthorized)
		ctx.Abort()
		return
	}

	nextToken, err := (logic.Session{}).RefreshExpire(ctx)
	if err != nil {
		m.JsonResponseWithServerError(ctx, err)
		ctx.Abort()
		return
	}
	if nextToken != "" {
		ctx.Header(logic.SiteManagerTokenHeader, nextToken)
	}

	ctx.Set("user", user)
	ctx.Next()
}
