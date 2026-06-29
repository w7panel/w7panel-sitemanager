package helper

import (
	"math/rand"
	"os"

	"github.com/otiai10/copy"
)

func GetRandomString(n int) string {
	str := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789"
	bytes := []byte(str)
	var result []byte
	for i := 0; i < n; i++ {
		result = append(result, bytes[rand.Intn(len(bytes))])
	}
	return string(result)
}

func FileExists(path string) bool {
	_, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false
	}
	return true
}

func MoveDir(srcDir, dstDir string) error {
	// 检查源目录是否存在
	if _, err := os.Stat(srcDir); os.IsNotExist(err) {
		return nil
	}

	// 创建目标目录
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}

	// 使用第三方库复制目录内容
	if err := copy.Copy(srcDir, dstDir); err != nil {
		return err
	}

	// 删除源目录
	_ = os.RemoveAll(srcDir)

	return nil
}

func CreateDirIfNotExist(dirName string, perm os.FileMode) {
	if _, err := os.Stat(dirName); os.IsNotExist(err) {
		err := os.MkdirAll(dirName, perm)
		if err != nil {
			panic(err)
		}
	}
}
