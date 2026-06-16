package app

import (
	"github.com/gin-gonic/gin"
	"github.com/w7panel/w7panel-sitemanager/app/application/command"
	"github.com/w7panel/w7panel-sitemanager/app/application/http/controller"
	"github.com/w7panel/w7panel-sitemanager/app/application/http/middleware"
	"github.com/w7panel/w7panel-sitemanager/common/dao"
	"github.com/w7panel/w7panel-sitemanager/common/entity"
	"github.com/we7coreteam/w7-rangine-go/v2/pkg/support/console"
	"github.com/we7coreteam/w7-rangine-go/v2/pkg/support/facade"
	httpServer "github.com/we7coreteam/w7-rangine-go/v2/src/http/server"
	"gorm.io/gorm"
)

type Provider struct {
}

func (p Provider) Register(httpServer *httpServer.Server, consoleManager console.Console) {
	p.initDb()
	p.RegisterHttpRoutes(httpServer)

	consoleManager.RegisterCommand(new(command.SiteCreate))
}

func (p Provider) initDb() {
	runEnvType := facade.GetConfig().GetString("app.env")
	if runEnvType == "debug" {
		return
	}
	db, err := facade.GetDbFactory().Channel("default")
	if err != nil {
		panic(err)
	}
	// 同步数据库
	err = db.Migrator().AutoMigrate(
		&entity.Environment{},
		&entity.Site{},
		&entity.SiteSetting{},
	)
	if err != nil {
		panic(err)
	}

	_, err = dao.Q.Environment.Where(dao.Q.Environment.Group_.IsNull()).UpdateColumn(dao.Q.Environment.Group_, gorm.Expr("'w7-' || language"))
	if err != nil {
		panic(err)
	}
}

func (p Provider) RegisterHttpRoutes(server *httpServer.Server) {
	server.RegisterRouters(func(engine *gin.Engine) {
		engine.GET("/health", func(ctx *gin.Context) {
			ctx.JSON(200, gin.H{})
		})

		root := engine.Group("/api", middleware.Cors{}.Process)

		root.Any("/k8s/proxy/*path", middleware.Cors{}.Process, middleware.Auth{}.Process, controller.K8s{}.Proxy)

		root.Match([]string{"POST", "OPTIONS"}, "/site/list", middleware.Auth{}.Process, controller.Site{}.List)
		root.Match([]string{"POST", "OPTIONS"}, "/site/create", middleware.Auth{}.Process, controller.Site{}.Create)
		root.Match([]string{"POST", "OPTIONS"}, "/site/update", middleware.Auth{}.Process, controller.Site{}.Update)
		root.Match([]string{"POST", "OPTIONS"}, "/site/update-code", middleware.Auth{}.Process, controller.Site{}.UpdateCode)
		root.Match([]string{"POST", "OPTIONS"}, "/site/delete", middleware.Auth{}.Process, controller.Site{}.Delete)
		root.Match([]string{"POST", "OPTIONS"}, "/site/info", middleware.Auth{}.Process, controller.Site{}.Info)

		root.Match([]string{"POST", "OPTIONS"}, "/site-nginx/set-proxy-conf", middleware.Auth{}.Process, controller.SiteSetting{}.SetNginxVhostConf)
		root.Match([]string{"POST", "OPTIONS"}, "/site-nginx/get-proxy-conf", middleware.Auth{}.Process, controller.SiteSetting{}.GetNginxVhostConf)

		root.Match([]string{"POST", "OPTIONS"}, "/environment/create", middleware.Auth{}.Process, controller.SiteEnvironment{}.Create)
		root.Match([]string{"POST", "OPTIONS"}, "/environment/update", middleware.Auth{}.Process, controller.SiteEnvironment{}.Update)
		root.Match([]string{"POST", "OPTIONS"}, "/environment/list", middleware.Auth{}.Process, controller.SiteEnvironment{}.List)
		root.Match([]string{"POST", "OPTIONS"}, "/environment/delete", middleware.Auth{}.Process, controller.SiteEnvironment{}.Delete)
		root.Match([]string{"GET", "OPTIONS"}, "/environment/support-list", middleware.Auth{}.Process, controller.SiteEnvironment{}.GetSupportEnvironmentList)
	})
}
