# `openStoreInstall` 调用说明

`openStoreInstall` 用于从 Wujie 微应用打开主面板的 ZPK 应用安装抽屉。调用方可以只传制品安装地址，也可以预设域名、安装名称、启动参数和存储配置。

## 推荐调用方式

```js
window.$wujie.bus.$emit(
  'openStoreInstall',
  {
    path: 'https://zpk.w7.cc/zpk/respo/info/example',
    orderSn: 'ORDER-20260907-001',
    domain: 'https://app.example.com',
    releaseName: 'example-app',
    pvcName: 'example-data',
    preSubPath: 'example-app',
    startParams: {
      IMAGE_VERSION: '1.2.3',
      APP_ENV: 'production',
    },
    modules: {
      example_worker: {
        enabled: true,
        pvcName: 'worker-data',
        preSubPath: 'worker',
        startParams: {
          WORKER_COUNT: 2,
        },
      },
    },
    clusterId: 'cluster-id',
    thirdpartyCDToken: 'thirdparty-cd-token',
  },
  moduleName => {
    console.log('应用部署完成：', moduleName)
  }
)
```

## 兼容签名

```js
// 原调用方式：只传安装地址
window.$wujie.bus.$emit('openStoreInstall', path, callback)

// 推荐方式：使用结构化参数
window.$wujie.bus.$emit('openStoreInstall', options, callback)

// 兼容方式：安装地址与其他参数分开传递
window.$wujie.bus.$emit('openStoreInstall', path, options, callback)
```

`path` 与 `options.path` 同时存在时，第三种签名中的 `options.path` 优先。

## 顶层参数

| 参数 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `path` | `string` | 是 | ZPK 制品安装地址，例如 `https://zpk.w7.cc/zpk/respo/info/example`。支持原始 URL 和经过 `encodeURIComponent` 编码的 HTTP(S) URL。|
| `repoUrl` | `string` | 否 | `path` 的别名，仅在未提供 `path` 时使用。|
| `orderSn` | `string` | 否 | 制品订单号。主面板会把它写入安装地址的 `order_sn` 查询参数；若地址中已经存在 `order_sn`，则覆盖原值。|
| `order_sn` | `string` | 否 | `orderSn` 的兼容别名。|
| `domain` | `string` | 否 | 应用域名。建议传完整地址，例如 `https://app.example.com`；协议为 `https://` 时会开启 HTTPS。传入后安装表单中的域名会被锁定。|
| `releaseName` | `string` | 否 | Helm/AppGroup release name。新安装时可固定安装名称；更新应用时用于定位已有 release。|
| `releasename` | `string` | 否 | `releaseName` 的兼容别名。|
| `startParams` | `Record<string, unknown>` | 否 | 全局启动参数。键必须与 ZPK 配置中的 `startParams[].name` 完全一致；匹配到的值会转成字符串并锁定输入框。|
| `start_params` | `Record<string, unknown>` | 否 | `startParams` 的兼容别名。|
| `pvcName` | `string` | 否 | 为 ZPK 第一个模块选择已有存储分区/PVC，并锁定存储选择。它不是容器内的 `mountPath`。|
| `preSubPath` | `string` | 否 | ZPK 第一个模块的存储子目录前缀，最终作为该模块安装选项中的 `preSubPath` 提交。|
| `modules` | `Record<string, ModuleOptions>` | 否 | 模块级安装配置。对象键必须是 ZPK 模块的 `identifie`，详细字段见下表。|
| `clusterId` | `string` | 否 | 第三方交付场景的目标集群 ID，安装时作为 `clusterId` 提交。|
| `insClusterId` | `string` | 否 | `clusterId` 的兼容别名；两者同时存在时 `insClusterId` 优先。|
| `thirdpartyCDToken` | `string` | 否 | 第三方交付令牌，用于读取 ZPK 配置和提交安装。未传时使用当前主面板控制台信息中的令牌。|
| `isTrandition` | `boolean` | 否 | 是否按传统应用包模式安装。字段名沿用现有接口拼写。启用后需要同时提供 `zipUrl`。|
| `zipUrl` | `string` | 条件必填 | 传统应用包的下载地址，仅在 `isTrandition` 为真时提交。|

## `modules` 模块参数

```js
modules: {
  // 此处必须使用 ZPK 返回的模块 identifie
  example_worker: {
    enabled: true,
    pvcName: 'worker-data',
    preSubPath: 'worker',
    startParams: {
      WORKER_COUNT: 2,
    },
  },
}
```

| 参数 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 是否安装该模块。只要模块出现在 `modules` 中，就会作为显式模块配置处理；设置为 `false` 可保持该可选模块不安装。强制安装模块仍受 ZPK 配置约束。|
| `pvcName` | `string` | - | 当前模块使用的已有存储分区/PVC。|
| `preSubPath` | `string` | - | 当前模块的存储子目录前缀。|
| `startParams` | `Record<string, unknown>` | `{}` | 当前模块的启动参数，键必须匹配该模块的 `startParams[].name`。模块级值优先于同名顶层 `startParams`。|
| `start_params` | `Record<string, unknown>` | `{}` | `startParams` 的兼容别名。|

对于第一个模块，如果同时传入顶层和模块级 `pvcName` 或 `preSubPath`，当前实现以顶层参数为准。建议同一项只使用一种写法。

## 启动参数规则

启动参数不会直接作为安装接口的顶层字段发送，而会转换为对应模块的 `installOptions[].envKv`：

```js
startParams: {
  IMAGE_VERSION: '1.2.3',
  WORKER_COUNT: 2,
}
```

对应的安装数据为：

```json
{
  "envKv": [
    { "name": "IMAGE_VERSION", "value": "1.2.3" },
    { "name": "WORKER_COUNT", "value": "2" }
  ]
}
```

只有制品已经声明的启动参数才能被覆盖；传入未声明的键不会新增环境变量。制品使用 `%STORAGE_SIZE%`、`%STORAGE_CLASS_NAME%`、`%STORAGE_RW_MODE%` 特殊值声明存储参数时，仍应使用对应配置项的 `name` 作为 `startParams` 的键。其中存储大小传数字或数字字符串，安装时会追加 `Gi`。

## 域名、存储和版本

- 域名使用顶层 `domain`，不要通过 `%DOMAIN_HOST%`、`%DOMAIN_URL%` 等隐藏启动参数传递。
- `pvcName` 表示已有 PVC/存储分区；`preSubPath` 表示存储子目录前缀；容器内 `mountPath` 仍由 ZPK 制品定义。
- 顶层没有通用的 `version` 参数。应用镜像版本应通过制品实际声明的启动参数传递，例如 `startParams.IMAGE_VERSION`。
- ZPK 制品自身的版本由 `path` 指向的安装地址决定；若市场提供指定版本的部署地址，应直接把该地址作为 `path`。

## 回调

```js
moduleName => {
  console.log(moduleName)
}
```

回调在主应用部署状态变为 `deployed` 后执行，参数 `moduleName` 是主模块的 ZPK `identifie`。关闭抽屉、读取配置失败或部署失败不会调用成功回调；调用方如需失败通知，应在自身业务中另行处理超时或状态查询。

