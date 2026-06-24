package command

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	v1 "k8s.io/api/apps/v1"
	v3 "k8s.io/api/core/v1"
)

func parseStartParamsEnv(raw string) ([]v3.EnvVar, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" || raw == "null" {
		return nil, nil
	}

	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, err
	}

	envMap := make(map[string]string)
	if err := json.Unmarshal(decoded, &envMap); err != nil {
		return nil, err
	}

	env := make([]v3.EnvVar, 0, len(envMap))
	for name, value := range envMap {
		if name == "" {
			continue
		}
		env = append(env, v3.EnvVar{
			Name:  name,
			Value: value,
		})
	}
	return env, nil
}

func parseCommands(raw, rawBase64 string) ([]string, error) {
	rawBase64 = strings.TrimSpace(rawBase64)
	if rawBase64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(rawBase64)
		if err != nil {
			return nil, err
		}
		raw = string(decoded)
	}

	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[\"\"]" {
		return nil, nil
	}

	commands := make([]string, 0)
	if err := json.Unmarshal([]byte(raw), &commands); err != nil {
		return nil, err
	}
	if len(commands) == 1 && commands[0] == "" {
		return nil, nil
	}
	return commands, nil
}

// parsePath 将路径字符串解析为部分列表
// "spec.template.spec.containers[0].image" -> ["spec", "template", "spec", "containers[0]", "image"]
func parsePath(path string) []string {
	return strings.Split(path, ".")
}

// parseArrayPart 解析数组部分，例如 "containers[0]" -> ("containers", "0", true)
func parseArrayPart(part string) (key string, index string, ok bool) {
	start := strings.Index(part, "[")
	end := strings.Index(part, "]")
	if start == -1 || end == -1 || start >= end {
		return "", "", false
	}
	return part[:start], part[start+1 : end], true
}

func deploymentToMap(deploy *v1.Deployment) (map[string]interface{}, error) {
	// 1. 序列化为 JSON 字节流
	// 注意：K8s 的结构体通常带有 json 标签，Marshal 会自动处理字段名转换
	jsonData, err := json.Marshal(deploy)
	if err != nil {
		return nil, fmt.Errorf("序列化失败: %v", err)
	}

	// 2. 反序列化为 map
	var result map[string]interface{}
	err = json.Unmarshal(jsonData, &result)
	if err != nil {
		return nil, fmt.Errorf("反序列化失败: %v", err)
	}

	return result, nil
}

func mapToDeployment(deploy map[string]interface{}) (*v1.Deployment, error) {
	// 1. 序列化为 JSON 字节流
	// 注意：K8s 的结构体通常带有 json 标签，Marshal 会自动处理字段名转换
	jsonData, err := json.Marshal(deploy)
	if err != nil {
		return nil, fmt.Errorf("序列化失败: %v", err)
	}

	// 2. 反序列化为 map
	var result v1.Deployment
	err = json.Unmarshal(jsonData, &result)
	if err != nil {
		return nil, fmt.Errorf("反序列化失败: %v", err)
	}

	return &result, nil
}

// getValueByPath 根据点分隔的路径从嵌套的 map/slice 中获取值
// 例如: path = "spec.template.spec.containers[0].image"
func getValueByPath(root map[string]interface{}, path string) (interface{}, bool) {
	parts := parsePath(path)
	current := interface{}(root)

	for _, part := range parts {
		if current == nil {
			return nil, false
		}

		// 检查是否是数组索引，例如 "containers[0]"
		if strings.Contains(part, "[") {
			key, indexStr, ok := parseArrayPart(part)
			if !ok {
				return nil, false
			}

			// 获取 map 中的 slice
			m, isMap := current.(map[string]interface{})
			if !isMap {
				return nil, false
			}
			sliceVal, exists := m[key]
			if !exists {
				return nil, false
			}

			// 断言为 slice
			s, isSlice := sliceVal.([]interface{})
			if !isSlice {
				return nil, false
			}

			// 解析索引
			index, err := strconv.Atoi(indexStr)
			if err != nil || index < 0 || index >= len(s) {
				return nil, false
			}
			current = s[index]
		} else {
			// 普通 map 访问
			m, isMap := current.(map[string]interface{})
			if !isMap {
				return nil, false
			}
			var exists bool
			current, exists = m[part]
			if !exists {
				return nil, false
			}
		}
	}

	return current, true
}

// setValueByPath 根据点分隔的路径设置值到嵌套的 map/slice 中
// 注意：此函数会修改传入的 root map
func setValueByPath(root map[string]interface{}, path string, value interface{}) {
	parts := parsePath(path)
	// 导航到目标路径的父级
	current := interface{}(root)

	// 遍历到倒数第二个元素，因为它是我们需要设置的 key
	for i, part := range parts[:len(parts)-1] {
		if current == nil {
			return
		}

		if strings.Contains(part, "[") {
			// 处理数组路径，例如 "containers[0]"
			key, indexStr, ok := parseArrayPart(part)
			if !ok {
				return
			}

			m, isMap := current.(map[string]interface{})
			if !isMap {
				return
			}
			// 确保 map 中存在该 key，并且是一个 slice
			if _, exists := m[key]; !exists {
				m[key] = make([]interface{}, 0)
			}

			sliceVal, isSlice := m[key].([]interface{})
			if !isSlice {
				return
			}

			index, err := strconv.Atoi(indexStr)
			if err != nil {
				return
			}

			// 如果索引超出范围，则扩展 slice
			for len(sliceVal) <= index {
				sliceVal = append(sliceVal, make(map[string]interface{}))
			}
			m[key] = sliceVal
			current = sliceVal[index]

		} else {
			// 处理普通 map 路径
			m, isMap := current.(map[string]interface{})
			if !isMap {
				return
			}
			// 确保 map 中存在该 key
			if _, exists := m[part]; !exists {
				// 如果下一个部分是数组，则创建 slice，否则创建 map
				if i+1 < len(parts) && strings.Contains(parts[i+1], "[") {
					m[part] = make([]interface{}, 0)
				} else {
					m[part] = make(map[string]interface{})
				}
			}
			current = m[part]
		}
	}

	// 设置最终的值
	lastPart := parts[len(parts)-1]
	if m, ok := current.(map[string]interface{}); ok {
		if strings.Contains(lastPart, "[") {
			// 目标是数组中的元素，例如 "env[0].name"
			key, indexStr, ok := parseArrayPart(lastPart)
			if !ok {
				return
			}
			if _, exists := m[key]; !exists {
				m[key] = make([]interface{}, 0)
			}
			sliceVal, isSlice := m[key].([]interface{})
			if !isSlice {
				return
			}
			index, err := strconv.Atoi(indexStr)
			if err != nil {
				return
			}
			// 扩展 slice 如果需要
			for len(sliceVal) <= index {
				sliceVal = append(sliceVal, make(map[string]interface{}))
			}
			// 这里我们假设是设置整个元素，例如 env[0] = value
			// 如果是 env[0].name = value，逻辑会更复杂，需要再递归一次
			// 为了简化，这里处理 env[0] = value 的情况
			sliceVal[index] = value
			m[key] = sliceVal
		} else {
			// 目标是 map 的 key
			m[lastPart] = value
		}
	}
}

func copyYamlData(fromYamlData map[string]interface{}, toYamlData map[string]interface{}, rules []YamlCopyRule) map[string]interface{} {
	// 2. 遍历并应用每一条规则
	for _, rule := range rules {
		if rule.Source == "" || rule.Target == "" {
			continue
		}

		// 2.1 从 siteManagerData 中获取源值
		sourceValue, found := getValueByPath(fromYamlData, rule.Source)
		if !found {
			fmt.Printf("fillData: 源路径 '%s' 未找到，跳过此规则\n", rule.Source)
			continue
		}

		// 2.2 将源值设置到 data 的目标路径
		setValueByPath(toYamlData, rule.Target, sourceValue)
	}

	return toYamlData
}
