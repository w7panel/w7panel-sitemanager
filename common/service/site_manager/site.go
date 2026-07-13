package site_manager

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/w7panel/w7panel-sitemanager/common/accessor"
)

type SuccessResp struct {
	Data interface{} `json:"data"`
}

type ApiError struct {
	ErrorMsg string `json:"error"`
	Code     int    `json:"code"`
}

func (ve ApiError) Error() string {
	return ve.ErrorMsg
}

type SiteManagerService struct {
	BaseUrl string
	Token   string
}

const TokenHeader = "X-Site-Manager-Token"

// LoginFromW7Panel exchanges a W7Panel access token for a site-manager session token.
func (s SiteManagerService) LoginFromW7Panel(accessToken string) (string, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return "", errors.New("access token is required")
	}

	payload, err := json.Marshal(map[string]string{"access_token": accessToken})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, s.BaseUrl+"/api/oidc/w7panel/login", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		var apiError ApiError
		if err := json.Unmarshal(respBody, &apiError); err != nil {
			return "", err
		}
		if apiError.ErrorMsg == "" {
			apiError.ErrorMsg = string(respBody)
			apiError.Code = resp.StatusCode
		}
		return "", apiError
	}

	loginResp := struct {
		Token string `json:"token"`
	}{}
	successResp := SuccessResp{Data: &loginResp}
	if err := json.Unmarshal(respBody, &successResp); err != nil {
		return "", err
	}
	loginResp.Token = strings.TrimSpace(loginResp.Token)
	if loginResp.Token == "" {
		return "", errors.New("site manager login returned an empty token")
	}
	return loginResp.Token, nil
}

func (s SiteManagerService) newJSONRequest(path string, payload []byte) (*http.Request, error) {
	req, err := http.NewRequest(http.MethodPost, s.BaseUrl+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(TokenHeader, s.Token)
	return req, nil
}

type CreateEnvironmentReq struct {
	Title              string `json:"title" binding:"required"`
	Group              string `json:"group" binding:"required"`
	Language           string `json:"language" binding:"required"`
	Version            string `json:"version" binding:"required"`
	AppName            string `json:"app_name" binding:"required"`
	NginxVhostTemplate string `json:"nginx_vhost_template" binding:"required"`
}
type CreateEnvironmentResp struct {
	Id int `json:"id"`
}

type CreateSiteReq struct {
	Domain          []string         `json:"domain" binding:"required"`
	RootDir         string           `json:"root_dir" binding:"required"`
	Remark          string           `json:"remark"`
	EnvironmentId   int              `json:"environment_id" binding:"required"`
	CodeDownloadUrl string           `json:"code_download_url"`
	Ext             accessor.SiteExt `json:"ext"`
}

type UpdateSiteReq struct {
	Id              int      `json:"id" binding:"required"`
	Domain          []string `json:"domain" binding:"required"`
	RootDir         string   `json:"root_dir" binding:"required"`
	Remark          string   `json:"remark"`
	EnvironmentId   int      `json:"environment_id" binding:"required"`
	CodeDownloadUrl string   `json:"code_download_url"`
}

type SiteInfoReq struct {
	Id     int    `json:"id"`
	Domain string `json:"domain"`
}

type SiteInfoResp struct {
	SiteEnvironment SiteEnvironmentResp `json:"site_environment"`
	Site            SiteResp            `json:"site"`
}

type SiteEnvironmentResp struct {
	Id                 int    `json:"id"`
	Title              string `json:"title"`
	Name               string `json:"name"`
	AppName            string `json:"app_name"`
	Group              string `json:"group"`
	Language           string `json:"language"`
	NginxVhostTemplate string `json:"nginx_vhost_template"`
	Version            string `json:"version"`
}

type SiteResp struct {
	Id            int    `json:"id"`
	Domain        string `json:"domain"`
	RootDir       string `json:"root_dir"`
	Remark        string `json:"remark"`
	EnvironmentId int    `json:"environment_id"`
}

type UpdateSiteCodeReq struct {
	Domain          string            `json:"domain" binding:"required"`
	CodeDownloadUrl string            `json:"code_download_url" binding:"required"`
	Ext             *accessor.SiteExt `json:"ext,omitempty"`
}

func (s SiteManagerService) CreateEnvironment(createReq CreateEnvironmentReq) (*CreateEnvironmentResp, error) {
	payload, err := json.Marshal(createReq)
	if err != nil {
		return nil, err
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := s.newJSONRequest("/api/environment/create", payload)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	statusCode := resp.StatusCode
	if statusCode != 200 {
		var apiError ApiError
		err = json.Unmarshal(respBody, &apiError)
		if err != nil {
			return nil, err
		}

		if apiError.ErrorMsg == "" {
			apiError.ErrorMsg = string(respBody)
			apiError.Code = 500
		}

		return nil, apiError
	}

	createResp := &CreateEnvironmentResp{}
	successResp := &SuccessResp{
		Data: createResp,
	}

	err = json.Unmarshal(respBody, successResp)
	if err != nil {
		return nil, err
	}
	return successResp.Data.(*CreateEnvironmentResp), nil
}

func (s SiteManagerService) CreateSite(createReq CreateSiteReq) error {
	payload, err := json.Marshal(createReq)
	if err != nil {
		return err
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := s.newJSONRequest("/api/site/create", payload)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	statusCode := resp.StatusCode
	if statusCode != 200 {
		var apiError ApiError
		err = json.Unmarshal(respBody, &apiError)
		if err != nil {
			return err
		}

		if apiError.ErrorMsg == "" {
			apiError.ErrorMsg = string(respBody)
			apiError.Code = 500
		}

		return apiError
	}

	return nil
}

func (s SiteManagerService) UpdateSite(updateReq UpdateSiteReq) error {
	payload, err := json.Marshal(updateReq)
	if err != nil {
		return err
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := s.newJSONRequest("/api/site/update", payload)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	statusCode := resp.StatusCode
	if statusCode != 200 {
		var apiError ApiError
		err = json.Unmarshal(respBody, &apiError)
		if err != nil {
			return err
		}

		if apiError.ErrorMsg == "" {
			apiError.ErrorMsg = string(respBody)
			apiError.Code = 500
		}

		return apiError
	}

	return nil
}

func (s SiteManagerService) InfoSite(infoReq SiteInfoReq) (*SiteInfoResp, error) {
	payload, err := json.Marshal(infoReq)
	if err != nil {
		return nil, err
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := s.newJSONRequest("/api/site/info", payload)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	statusCode := resp.StatusCode
	if statusCode != 200 {
		var apiError ApiError
		err = json.Unmarshal(respBody, &apiError)
		if err != nil {
			return nil, err
		}

		if apiError.ErrorMsg == "" {
			apiError.ErrorMsg = string(respBody)
			apiError.Code = 500
		}

		return nil, apiError
	}

	infoResp := &SiteInfoResp{}
	successResp := &SuccessResp{
		Data: infoResp,
	}

	err = json.Unmarshal(respBody, successResp)
	if err != nil {
		return nil, err
	}
	return successResp.Data.(*SiteInfoResp), nil
}

func (s SiteManagerService) UpdateSiteCode(updateReq UpdateSiteCodeReq) error {
	payload, err := json.Marshal(updateReq)
	if err != nil {
		return err
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := s.newJSONRequest("/api/site/update-code", payload)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	statusCode := resp.StatusCode
	if statusCode != 200 {
		var apiError ApiError
		err = json.Unmarshal(respBody, &apiError)
		if err != nil {
			return err
		}

		if apiError.ErrorMsg == "" {
			apiError.ErrorMsg = string(respBody)
			apiError.Code = 500
		}

		return apiError
	}

	return nil
}

func (s SiteManagerService) DeleteEnvironment(id int) error {
	payload, err := json.Marshal(map[string]int{"id": id})
	if err != nil {
		return err
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	req, err := s.newJSONRequest("/api/environment/delete", payload)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK {
		var apiError ApiError
		err = json.Unmarshal(respBody, &apiError)
		if err != nil {
			return err
		}

		if apiError.ErrorMsg == "" {
			apiError.ErrorMsg = string(respBody)
			apiError.Code = 500
		}

		return apiError
	}

	return nil
}
