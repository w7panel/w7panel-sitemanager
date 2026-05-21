package w7panel

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	v1 "k8s.io/api/apps/v1"
	v2 "k8s.io/api/networking/v1"
)

type ApiError struct {
	ErrorMsg string `json:"error"`
	Code     int    `json:"code"`
}

func (ve ApiError) Error() string {
	return ve.ErrorMsg
}

type W7PanelService struct {
	BaseUrl string
	Token   string
}

func (s W7PanelService) QueryDeploy(deployName string) (*v1.Deployment, error) {
	safeAppName := strings.ReplaceAll(deployName, "_", "-")
	req, err := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/k8s-proxy/apis/apps/v1/namespaces/default/deployments/%s", s.BaseUrl, safeAppName), nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.doPanelReq(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	deployInfo := &v1.Deployment{}
	err = json.Unmarshal(respBody, deployInfo)
	if err != nil {
		return nil, err
	}

	return deployInfo, nil
}

func (s W7PanelService) CreateDeploy(deployInfo *v1.Deployment) error {
	jsonData, err := json.Marshal(deployInfo)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/k8s-proxy/apis/apps/v1/namespaces/default/deployments", s.BaseUrl), bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.doPanelReq(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

func (s W7PanelService) RestartDeployByPatch(name string) error {
	// 构建 PATCH 请求的 JSON 数据
	// 这会模拟 kubectl rollout restart 的行为
	patchData := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"reload":"%s"}}}}}`, time.Now().Format(time.RFC3339))

	// 构建 URL: .../apis/apps/v1/namespaces/{namespace}/deployments/{name}
	url := fmt.Sprintf("%s/k8s-proxy/apis/apps/v1/namespaces/default/deployments/%s", s.BaseUrl, name)

	req, err := http.NewRequest(http.MethodPatch, url, bytes.NewBuffer([]byte(patchData)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/strategic-merge-patch+json")

	resp, err := s.doPanelReq(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

func (s W7PanelService) DeleteDeploy(name string) error {
	// 构建 URL: .../apis/apps/v1/namespaces/{namespace}/deployments/{name}
	url := fmt.Sprintf("%s/k8s-proxy/apis/apps/v1/namespaces/default/deployments/%s", s.BaseUrl, name)

	req, err := http.NewRequest(http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	// 设置请求头
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.doPanelReq(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

func (s W7PanelService) CreateIngress(ingressInfo v2.Ingress) error {
	jsonData, err := json.Marshal(ingressInfo)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/k8s-proxy/apis/networking.k8s.io/v1/namespaces/default/ingresses", s.BaseUrl), bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.doPanelReq(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

func (s W7PanelService) DeleteIngress(name string) error {
	url := fmt.Sprintf("%s/k8s-proxy/apis/networking.k8s.io/v1/namespaces/default/ingresses/%s", s.BaseUrl, name)

	req, err := http.NewRequest(http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	// 设置请求头
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.doPanelReq(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

func (s W7PanelService) doPanelReq(req *http.Request) (*http.Response, error) {
	req.Header.Add("Authorizationx", "Bearer "+s.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}

	if req.Method == http.MethodDelete && resp.StatusCode == http.StatusNotFound {
		return resp, nil
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get deployment, status: %d", resp.StatusCode, "response: %s", string(respBody))
	}

	return resp, nil
}
