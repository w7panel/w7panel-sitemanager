package zpk

import (
	"encoding/json"
	zpkmarket "github.com/w7panel/w7panel-sitemanager/common/service/zpk-market"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type SuccessResp struct {
	Data interface{} `json:"data"`
}

type ListReq struct {
	Status  []int  `json:"status"`
	Page    int    `json:"page"`
	Limit   int    `json:"limit"`
	Tag     string `json:"tag"`
	Keyword string `json:"keyword"`
}

type ApiError struct {
	ErrorMsg string `json:"error"`
	Code     int    `json:"code"`
}

func (ve ApiError) Error() string {
	return ve.ErrorMsg
}

type ZpkService struct {
	BaseUrl string
}

func (s ZpkService) GetEnvironmentZpkList() (*zpkmarket.ListResp, error) {
	return s.GetZpkList(ListReq{
		Status: []int{2, 99},
		Page:   1,
		Limit:  100,
		Tag:    "运行环境",
	})
}

func (s ZpkService) GetZpkList(listReq ListReq) (*zpkmarket.ListResp, error) {
	data := url.Values{}
	// 对于数组类型的字段，Go 的 Encode() 方法会自动处理为 key=val1&key=val2 的形式
	for _, status := range listReq.Status {
		data.Add("status", strconv.Itoa(status))
	}
	data.Add("page", strconv.Itoa(listReq.Page))
	data.Add("limit", strconv.Itoa(listReq.Limit))
	data.Add("tag", listReq.Tag)
	data.Add("keyword", listReq.Keyword)

	req, err := http.NewRequest(http.MethodGet, s.BaseUrl+"/zpk/respo/list?"+data.Encode(), nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
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

	listResp := &zpkmarket.ListResp{}
	successResp := &SuccessResp{
		Data: listResp,
	}

	err = json.Unmarshal(respBody, successResp)
	if err != nil {
		return nil, err
	}
	return successResp.Data.(*zpkmarket.ListResp), nil
}

func (s ZpkService) GetZpkInfo(name string) (*zpkmarket.ZpkInfo, error) {
	req, err := http.NewRequest(http.MethodGet, s.BaseUrl+"/zpk/respo/info/"+name, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
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

	info := &zpkmarket.ZpkInfo{}
	err = json.Unmarshal(respBody, info)
	if err != nil {
		return nil, err
	}
	return info, nil
}
