package logic

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/we7coreteam/w7-rangine-go/v2/pkg/support/facade"
)

const oidcUserInfoPath = "/panel-api/v1/oidc/userinfo"

type OIDC struct{}

type OIDCUserInfo struct {
	Subject  string
	Username string
	Role     string
}

func (OIDC) UserInfo(ctx context.Context, accessToken string) (*OIDCUserInfo, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(facade.GetConfig().GetString("setting.oidc.base_url")), "/")
	if baseURL == "" {
		return nil, errors.New("setting.oidc.base_url is required")
	}
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return nil, errors.New("access_token is required")
	}
	form := url.Values{"access_token": []string{accessToken}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+oidcUserInfoPath, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("userinfo request failed with status %d", resp.StatusCode)
	}
	claims := map[string]any{}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&claims); err != nil {
		return nil, err
	}
	return userInfoFromClaims(claims)
}

func userInfoFromClaims(claims map[string]any) (*OIDCUserInfo, error) {
	subject, _ := claims["sub"].(string)
	username, _ := claims["preferred_username"].(string)
	if username == "" {
		username, _ = claims["username"].(string)
	}
	if username == "" {
		username, _ = claims["name"].(string)
	}
	if username == "" {
		username = subject
	}
	role, _ := claims["role"].(string)
	if founder, ok := claims["is_founder"].(bool); ok && founder {
		role = "founder"
	}
	if subject == "" || username == "" {
		return nil, errors.New("userinfo subject and username are required")
	}
	return &OIDCUserInfo{Subject: subject, Username: username, Role: role}, nil
}
