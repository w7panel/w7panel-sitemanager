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
	consoleManager.RegisterCommand(new(command.SiteInfo))
	consoleManager.RegisterCommand(new(command.SiteProvision))
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
		root.Match([]string{"POST", "OPTIONS"}, "/oidc/w7panel/login", controller.OIDC{}.LoginFromW7Panel)

		api := root.Group("/", middleware.Auth{}.Process)

		api.Any("/k8s/proxy/*path", controller.K8s{}.Proxy)

		api.POST("/site/list", controller.Site{}.List)
		api.POST("/site/create", controller.Site{}.Create)
		api.POST("/site/update", controller.Site{}.Update)
		api.POST("/site/delete", controller.Site{}.Delete)
		api.POST("/site/info", controller.Site{}.Info)

		api.POST("/site-nginx/set-proxy-conf", controller.SiteSetting{}.SetNginxVhostConf)
		api.POST("/site-nginx/get-proxy-conf", controller.SiteSetting{}.GetNginxVhostConf)

		api.POST("/environment/create", controller.SiteEnvironment{}.Create)
		api.POST("/environment/update", controller.SiteEnvironment{}.Update)
		api.POST("/environment/list", controller.SiteEnvironment{}.List)
		api.POST("/environment/delete", controller.SiteEnvironment{}.Delete)
		api.GET("/environment/support-list", controller.SiteEnvironment{}.GetSupportEnvironmentList)
	})
}
