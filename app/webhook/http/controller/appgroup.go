package controller

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"

	"github.com/gin-gonic/gin"
	"github.com/w7panel/w7panel-sitemanager/app/application/logic"
	"github.com/w7panel/w7panel-sitemanager/common/dao"
	abstractController "github.com/we7coreteam/w7-rangine-go/v2/src/http/controller"
	admissionv1 "k8s.io/api/admission/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
)

type appGroupObject struct {
	Metadata struct {
		Name        string            `json:"name"`
		Namespace   string            `json:"namespace"`
		Labels      map[string]string `json:"labels"`
		Annotations map[string]string `json:"annotations"`
	} `json:"metadata"`
	Spec struct {
		Type      string `json:"type"`
		Identifie string `json:"identifie"`
		Title     string `json:"title"`
	} `json:"spec"`
}

type AppGroup struct {
	abstractController.Abstract
}

func (c AppGroup) Delete(ctx *gin.Context) {
	body, err := io.ReadAll(ctx.Request.Body)
	if err != nil {
		writeAdmissionError(ctx, "", fmt.Errorf("read admission review: %w", err))
		return
	}

	review := admissionv1.AdmissionReview{}
	if err := json.Unmarshal(body, &review); err != nil {
		writeAdmissionError(ctx, "", fmt.Errorf("decode admission review: %w", err))
		return
	}
	if review.Request == nil {
		writeAdmissionError(ctx, "", fmt.Errorf("empty admission request"))
		return
	}

	response := &admissionv1.AdmissionResponse{
		UID:     review.Request.UID,
		Allowed: true,
	}
	req := *review.Request
	go func() {
		if _, err := handleDelete(&req); err != nil {
			slog.Error("handle appgroup delete webhook error", "err", err)
		}
	}()

	ctx.JSON(200, admissionv1.AdmissionReview{
		TypeMeta: metav1.TypeMeta{
			APIVersion: admissionv1.SchemeGroupVersion.String(),
			Kind:       "AdmissionReview",
		},
		Response: response,
	})
}

func handleDelete(req *admissionv1.AdmissionRequest) ([]string, error) {
	group, err := decodeAppGroup(req.OldObject)
	if err != nil {
		return nil, err
	}
	if group.Metadata.Name == "" {
		return nil, fmt.Errorf("appgroup oldObject metadata.name is empty")
	}

	count, err := deleteSitesByAppGroup(group.Metadata.Name)
	if err != nil {
		return nil, err
	}
	slog.Info("handled appgroup delete", "namespace", group.Metadata.Namespace, "name", group.Metadata.Name, "sites", count)
	return nil, nil
}

func decodeAppGroup(raw runtime.RawExtension) (appGroupObject, error) {
	group := appGroupObject{}
	if len(raw.Raw) == 0 {
		return group, fmt.Errorf("appgroup delete admission oldObject is empty")
	}
	if err := json.Unmarshal(raw.Raw, &group); err != nil {
		return group, fmt.Errorf("decode appgroup oldObject: %w", err)
	}
	return group, nil
}

func deleteSitesByAppGroup(appGroupName string) (int, error) {
	sites, err := dao.Q.Site.Find()
	if err != nil {
		return 0, err
	}

	deletedCount := 0
	for _, site := range sites {
		if site.Ext.K8sAppName != appGroupName {
			continue
		}
		if err := (logic.Site{}).DeleteSite(*site, true); err != nil {
			return deletedCount, err
		}
		deletedCount++
	}

	return deletedCount, nil
}

func writeAdmissionError(ctx *gin.Context, uid string, err error) {
	ctx.JSON(200, admissionv1.AdmissionReview{
		TypeMeta: metav1.TypeMeta{
			APIVersion: admissionv1.SchemeGroupVersion.String(),
			Kind:       "AdmissionReview",
		},
		Response: &admissionv1.AdmissionResponse{
			UID:     types.UID(uid),
			Allowed: true,
			Warnings: []string{
				err.Error(),
			},
		},
	})
}
