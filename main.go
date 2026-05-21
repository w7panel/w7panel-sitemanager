package main

import (
	"bytes"
	_ "embed"

	"github.com/spf13/viper"
	app2 "github.com/w7panel/w7panel-sitemanager/app/application"
	"github.com/w7panel/w7panel-sitemanager/common/dao"
	"github.com/we7coreteam/w7-rangine-go/v2/pkg/support/facade"
	app "github.com/we7coreteam/w7-rangine-go/v2/src"
	"github.com/we7coreteam/w7-rangine-go/v2/src/core/helper"
	"github.com/we7coreteam/w7-rangine-go/v2/src/http"
	"github.com/we7coreteam/w7-rangine-go/v2/src/http/middleware"
)

//go:embed config.yaml
var ConfigFileContent []byte

func main() {
	newApp := app.NewApp(app.Option{
		DefaultConfigLoader: func(config *viper.Viper) {
			config.SetConfigType("yaml")
			err := config.MergeConfig(bytes.NewReader(helper.ParseConfigContentEnv(ConfigFileContent)))
			if err != nil {
				panic(err)
			}
		},
	})

	db, err := facade.GetDbFactory().Channel("default")
	if err != nil {
		panic(err)
	}
	dao.SetDefault(db)

	httpServer := new(http.Provider).Register(newApp.GetConfig(), newApp.GetConsole(), newApp.GetServerManager()).Export()
	httpServer.Use(middleware.GetPanicHandlerMiddleware())
	new(app2.Provider).Register(httpServer, newApp.GetConsole())

	newApp.RunConsole()
}
