package helper

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func Unzip(zipFile string, destDir string) error {
	reader, err := zip.OpenReader(zipFile)
	if err != nil {
		return err
	}
	defer reader.Close()

	// 2. 遍历压缩包内的所有文件
	for _, file := range reader.File {
		// --- 安全检查：防止 Zip Slip 漏洞 ---
		// 确保解压路径不包含 ".."，防止恶意文件跳出目标目录
		if strings.Contains(file.Name, "..") {
			return fmt.Errorf("illegal file path: %s", file.Name)
		}

		// 拼接目标路径
		filePath := filepath.Join(destDir, file.Name)

		// 3. 处理目录
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(filePath, os.ModePerm); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(filePath), os.ModePerm); err != nil {
			return err
		}

		rc, err := file.Open()
		if err != nil {
			return err
		}

		dstFile, err := os.OpenFile(filePath, os.O_CREATE|os.O_RDWR|os.O_TRUNC, file.Mode())
		if err != nil {
			rc.Close() // 记得关闭源文件
			return err
		}

		_, err = io.Copy(dstFile, rc)

		dstFile.Close()
		rc.Close()

		if err != nil {
			return err
		}
	}

	return nil
}
