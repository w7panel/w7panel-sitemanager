package helper

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

func DownloadFile(url string, saveFilePath string) error {
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// 2. 创建请求对象 (方便添加 Header)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}

	// 伪装 User-Agent，防止被部分网站拦截
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Go-Downloader)")

	// 3. 发起请求
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载失败: %s", resp.Status)
	}

	// 4. 确保存放目录存在
	// 如果 filepath 是 "data/file.zip"，需要先创建 "data" 目录
	// os.MkdirAll 如果目录已存在不会报错
	// dir := filepath.Dir(filepath)
	// if err := os.MkdirAll(dir, 0755); err != nil { return err }

	// 5. 创建文件并写入
	out, err := os.Create(saveFilePath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}
