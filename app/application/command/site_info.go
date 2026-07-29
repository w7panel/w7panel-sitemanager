package command

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/spf13/cobra"
	"github.com/w7panel/w7panel-sitemanager/common/service/site_manager"
	"github.com/we7coreteam/w7-rangine-go/v2/src/console"
)

type siteInfoCommandArgs struct {
	Domain string
	Token  string
}

var siteInfoArgsValue siteInfoCommandArgs

type SiteInfo struct {
	console.Abstract
}

func (SiteInfo) GetName() string {
	return "info:site"
}

func (SiteInfo) Configure(cmd *cobra.Command) {
	cmd.Flags().StringVar(&siteInfoArgsValue.Domain, "domain", "", "site domain")
	cmd.Flags().StringVar(&siteInfoArgsValue.Token, "token", "", "W7Panel access token used to log in to site manager")
}

func (SiteInfo) GetDescription() string {
	return "get site information"
}

func (SiteInfo) Handle(cmd *cobra.Command, _ []string) {
	domain := strings.TrimSpace(siteInfoArgsValue.Domain)
	if domain == "" {
		panic(errors.New("domain is required"))
	}

	service, err := getSiteManagerService(siteInfoArgsValue.Token)
	if err != nil {
		panic(err)
	}
	info, err := service.InfoSite(site_manager.SiteInfoReq{Domain: domain})
	if err != nil {
		panic(err)
	}
	if err = json.NewEncoder(cmd.OutOrStdout()).Encode(info); err != nil {
		panic(err)
	}
}
