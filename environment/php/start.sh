# 检查 php-fpm 是否存在
if ! command -v php-fpm >/dev/null 2>&1; then
  echo "php-fpm 不存在，pause 容器将保持空闲状态"
  tail -f /dev/null
fi

echo "init开始运行..."

# 环境变量检查
if [ -z "$METADATA_NAME" ]; then
  echo "错误: 环境变量 METADATA_NAME 未设置或为空"
  exit 1
fi

echo "使用环境变量 METADATA_NAME: $METADATA_NAME"

# 基础路径
BASE_PATH="/www/server/$METADATA_NAME"

# --- 定义路径映射 ---
# 源路径 (持久化存储)
SRC_PHP_DIR="$BASE_PATH/etc/php"
SRC_FPM_CONF_DIR="$BASE_PATH/etc/php-fpm/conf.d"
TOOLS_DIR="$BASE_PATH/tools"

# 目标路径 (系统默认位置)
TGT_PHP_DIR="/usr/local/etc/php"
TGT_FPM_CONF_DIR="/usr/local/etc/php-fpm.d"

# --- 第一步：初始化持久化存储 (如果为空) ---
# 防止首次启动时因持久化目录为空导致配置丢失
# 1. 初始化 php 配置目录
mkdir -p "$SRC_PHP_DIR"
# 假设镜像默认配置在 /usr/local/etc/php，先临时备份一下再复制，或者直接拷贝内容
# 注意：此时 TGT_PHP_DIR 还存在，我们直接拷贝里面的内容到 SRC
if [ -d "$TGT_PHP_DIR" ]; then
  cp -a "$TGT_PHP_DIR"/. "$SRC_PHP_DIR"/
  echo "已初始化 PHP 配置到: $SRC_PHP_DIR"
fi

# 2. 初始化 php-fpm 配置目录
mkdir -p "$SRC_FPM_CONF_DIR"
if [ -d "$TGT_FPM_CONF_DIR" ]; then
  cp -a "$TGT_FPM_CONF_DIR"/. "$SRC_FPM_CONF_DIR"/
  echo "已初始化 FPM 配置到: $SRC_FPM_CONF_DIR"
fi

# --- 第二步：执行目录级软链接替换 ---

echo "正在替换系统配置目录为持久化存储的软链接..."

# 1. 替换 PHP 配置目录
if [ -e "$TGT_PHP_DIR" ] || [ -L "$TGT_PHP_DIR" ]; then
  rm -rf "$TGT_PHP_DIR"
fi
ln -s "$SRC_PHP_DIR" "$TGT_PHP_DIR"
echo "已链接: $TGT_PHP_DIR -> $SRC_PHP_DIR"

# 2. 替换 FPM 配置目录
if [ -e "$TGT_FPM_CONF_DIR" ] || [ -L "$TGT_FPM_CONF_DIR" ]; then
  rm -rf "$TGT_FPM_CONF_DIR"
fi
ln -s "$SRC_FPM_CONF_DIR" "$TGT_FPM_CONF_DIR"
echo "已链接: $TGT_FPM_CONF_DIR -> $SRC_FPM_CONF_DIR"


# 添加自定义全局tools
mkdir -p "$TOOLS_DIR"
echo "[INFO] Creating symlinks in /usr/local/bin..."
if [ -d "$TOOLS_DIR" ]; then
  for file in "$TOOLS_DIR"/*; do
    if [ -f "$file" ] && [ -x "$file" ]; then
      filename=$(basename "$file")
      target="/usr/local/bin/${filename}"
      if [ ! -e "$target" ]; then
        ln -s "$file" "$target"
        # echo "  -> Linked: $filename"
      fi
    fi
  done
fi

echo "init任务完成，即将启动 php-fpm..."

sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# 启动
php-fpm -F