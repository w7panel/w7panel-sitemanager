package logic

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/we7coreteam/w7-rangine-go/v2/pkg/support/facade"
	ranginesession "github.com/we7coreteam/w7-rangine-go/v2/src/http/session"
	"golang.org/x/sync/singleflight"
)

const SiteManagerTokenHeader = "X-Site-Manager-Token"

const sessionRefreshAtKey = "site_manager_session_refresh_at"
const defaultSessionRefreshInterval = 5 * time.Minute

var sessionRefreshGroup singleflight.Group

type Session struct{}

type UserSession struct {
	Subject  string `json:"subject"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

func (Session) SaveUserInfo(ctx *gin.Context, user UserSession) (string, error) {
	content, err := json.Marshal(user)
	if err != nil {
		return "", err
	}
	current := sessions.Default(ctx)
	current.Set("user", string(content))
	current.Set(sessionRefreshAtKey, time.Now().Unix())
	if err := current.Save(); err != nil {
		return "", err
	}
	token := responseSessionToken(ctx)
	if token == "" {
		return "", errors.New("session token is empty")
	}
	return token, nil
}

func (Session) GetUserInfo(ctx *gin.Context, token string) (*UserSession, error) {
	injectRequestToken(ctx, token)
	value := sessions.Default(ctx).Get("user")
	if value == nil {
		return nil, nil
	}
	content, ok := value.(string)
	if !ok {
		return nil, errors.New("invalid user session")
	}
	user := new(UserSession)
	if err := json.Unmarshal([]byte(content), user); err != nil {
		return nil, err
	}
	return user, nil
}

func (Session) RefreshExpire(ctx *gin.Context) (string, error) {
	current := sessions.Default(ctx)
	now := time.Now().Unix()
	if now-sessionRefreshAt(current.Get(sessionRefreshAtKey)) < int64(defaultSessionRefreshInterval/time.Second) {
		return "", nil
	}
	result, err, _ := sessionRefreshGroup.Do("session:"+current.ID(), func() (any, error) {
		now := time.Now().Unix()
		if now-sessionRefreshAt(current.Get(sessionRefreshAtKey)) < int64(defaultSessionRefreshInterval/time.Second) {
			return "", nil
		}
		current.Set(sessionRefreshAtKey, now)
		current.Options(ranginesession.BuildOptions(facade.GetConfig()))
		if err := current.Save(); err != nil {
			return "", err
		}
		return responseSessionToken(ctx), nil
	})
	if err != nil {
		return "", err
	}
	token, _ := result.(string)
	return token, nil
}

func sessionRefreshAt(value any) int64 {
	refreshAt, _ := value.(int64)
	return refreshAt
}

func responseSessionToken(ctx *gin.Context) string {
	name := sessionName()
	for _, rawCookie := range ctx.Writer.Header().Values("Set-Cookie") {
		nameValue := strings.SplitN(rawCookie, ";", 2)[0]
		cookieName, value, ok := strings.Cut(nameValue, "=")
		if ok && cookieName == name {
			return value
		}
	}
	return ""
}

func injectRequestToken(ctx *gin.Context, token string) {
	token = strings.TrimSpace(token)
	if token != "" {
		ctx.Request.AddCookie(&http.Cookie{Name: sessionName(), Value: token})
	}
}

func sessionName() string {
	name := facade.GetConfig().GetString("session.name")
	if name == "" {
		return "SITE_MANAGER_SESSION_ID"
	}
	return name
}
