package webhook

import (
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"github.com/w7panel/w7panel-sitemanager/app/webhook/http/controller"
	httpServer "github.com/we7coreteam/w7-rangine-go/v2/src/http/server"
)

type Provider struct {
}

func (p Provider) Register(server *httpServer.Server, config *viper.Viper) {
	if !config.GetBool("setting.webhook.enabled") {
		return
	}

	p.RegisterHttpRoutes(server)
}

func (p Provider) RegisterHttpRoutes(server *httpServer.Server) {
	server.RegisterRouters(func(engine *gin.Engine) {
		engine.POST("/webhook/appgroups/del", controller.AppGroup{}.Delete)
	})
}
