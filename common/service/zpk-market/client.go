// Package zpkmarket provides access to the ZPK market API.
package zpkmarket

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const DefaultBaseURL = "https://api.zm.w7.com"

type FormulaListRequest struct {
	Page    int    `json:"page"`
	Limit   int    `json:"limit"`
	Tag     string `json:"tag"`
	Keyword string `json:"keyword"`
}

type Label struct {
	ID    int    `json:"id"`
	Title string `json:"title"`
}

type Formula struct {
	Name            string  `json:"name"`
	Description     string  `json:"description"`
	Identify        string  `json:"identify"`
	LatestVersion   string  `json:"latest_version"`
	Icon            string  `json:"icon"`
	AuditStatus     int     `json:"audit_status"`
	AuditRemark     string  `json:"audit_remark"`
	GoodsID         int     `json:"goods_id"`
	Labels          []Label `json:"labels"`
	InstallTotal    int     `json:"install_total"`
	FormulaURL      string  `json:"formula_url"`
	ApplicationType string  `json:"application_type"`
	PluginType      string  `json:"plugin_type"`
	SupportVersion  string  `json:"support_version"`
}

// ZpkInfo is the compact ZPK representation consumed by site management.
type ZpkInfo struct {
	Name string `json:"name"`
	// Identifier is the canonical Go field. Identifie keeps compatibility with
	// the existing UI contract, which historically used this misspelling.
	Identifier  string `json:"identify"`
	Identifie   string `json:"identifie"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
	FormulaURL  string `json:"formula_url"`
}

type ListResp struct {
	Limit int       `json:"limit"`
	Page  int       `json:"page"`
	Total int       `json:"total"`
	List  []ZpkInfo `json:"list"`
}

type FormulaList struct {
	Limit int       `json:"limit"`
	Page  int       `json:"page"`
	Total int       `json:"total"`
	List  []Formula `json:"list"`
}

type response struct {
	Code int          `json:"code"`
	Msg  string       `json:"msg"`
	Data *FormulaList `json:"data"`
}

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

func (c Client) ListFormulas(reqBody FormulaListRequest) (*FormulaList, error) {
	baseURL := c.BaseURL
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, baseURL+"/zpk-market/formula/list", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Referer", "https://zm.w7.com/")
	req.Header.Set("User-Agent", "Mozilla/5.0")
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
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
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("zpk market API returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var result response
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, err
	}
	if result.Code != 0 && result.Code != 200 {
		return nil, fmt.Errorf("zpk market API returned code %d: %s", result.Code, result.Msg)
	}
	if result.Data == nil {
		return nil, fmt.Errorf("zpk market API returned empty data")
	}
	return result.Data, nil
}
