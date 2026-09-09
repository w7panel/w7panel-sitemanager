# 子应用获取 Environment 应用列表

本文说明 W7Panel 子应用如何通过宿主注入的 `k8sproxy` 获取当前命名空间的 AppGroup，并在子应用前端筛选出带有以下注解的环境类应用：

```yaml
metadata:
  annotations:
    w7.cc/manifest-type: environment
```

## 调用结论

AppGroup 使用 Kubernetes 原生列表接口获取：

```http
GET /apis/w7panel.w7.com/v1alpha1/namespaces/{namespace}/appgroups
```

子应用调用宿主 `k8sproxy` 时不要添加 `/k8s-proxy` 前缀。宿主会补充该前缀、注入当前面板 Token，并把请求转发给 Kubernetes API Server。

`w7.cc/manifest-type` 当前位于 `metadata.annotations`。Kubernetes 不支持按 annotation 使用 `labelSelector` 查询，因此调用方必须先获取 AppGroup 列表，再在子应用前端筛选。

## 前置条件

- 子应用运行在 W7Panel Wujie 容器或兼容的旧版微应用容器中。
- 宿主已注入 `k8sproxy` 函数。
- 当前用户有目标命名空间 AppGroup 的 `list` 权限。
- 调用方明确知道需要查询的命名空间；示例使用 `default`，实际调用时应传入业务命名空间。

## 获取宿主属性

同时兼容 Wujie 和旧版微应用接入方式：

```ts
type HostK8sProxy = (path: string, init?: RequestInit) => Promise<Response>

type HostProps = {
  k8sproxy?: HostK8sProxy
}

function getHostProps(): HostProps {
  if (window.__POWERED_BY_WUJIE__) {
    return window.$wujie?.props || {}
  }
  return window.microData?.cd || {}
}
```

如果项目启用了 TypeScript，可在项目自己的全局类型文件中补充：

```ts
export {}

declare global {
  interface Window {
    __POWERED_BY_WUJIE__?: boolean
    $wujie?: { props?: HostProps }
    microData?: { cd?: HostProps }
  }
}
```

## 完整调用与筛选示例

以下方法返回符合普通应用列表语义的 Environment AppGroup：

- `metadata.annotations["w7.cc/manifest-type"]` 必须精确等于 `environment`；
- 排除带 `metadata.labels["w7.cc/parent"]` 的子 AppGroup；
- 排除已经进入删除流程的 AppGroup；
- 按创建时间倒序排列。

```ts
const APPGROUP_API = '/apis/w7panel.w7.com/v1alpha1'
const MANIFEST_TYPE_ANNOTATION = 'w7.cc/manifest-type'
const ENVIRONMENT_MANIFEST_TYPE = 'environment'
const PARENT_LABEL = 'w7.cc/parent'

type AppGroup = {
  metadata?: {
    name?: string
    namespace?: string
    creationTimestamp?: string
    deletionTimestamp?: string
    labels?: Record<string, string>
    annotations?: Record<string, string>
  }
  spec?: {
    title?: string
    logo?: string
    isHelm?: boolean
  }
  status?: {
    ready?: boolean
    deployStatus?: string
    isZeroReplicas?: boolean
    items?: unknown[]
  }
}

type AppGroupList = {
  items?: AppGroup[]
  metadata?: {
    resourceVersion?: string
    continue?: string
  }
}

function isEnvironmentRootApp(group: AppGroup): boolean {
  const metadata = group.metadata
  return metadata?.annotations?.[MANIFEST_TYPE_ANNOTATION] === ENVIRONMENT_MANIFEST_TYPE
    && !metadata?.labels?.[PARENT_LABEL]
    && !metadata?.deletionTimestamp
}

function creationTime(group: AppGroup): number {
  const value = group.metadata?.creationTimestamp
  const timestamp = value ? Date.parse(value) : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

export async function listEnvironmentApps(
  namespace: string,
  signal?: AbortSignal,
): Promise<AppGroup[]> {
  const props = getHostProps()
  if (typeof props.k8sproxy !== 'function') {
    throw new Error('主面板未注入 k8sproxy，请升级主面板后重试')
  }

  const normalizedNamespace = namespace.trim()
  if (!normalizedNamespace) {
    throw new Error('namespace 不能为空')
  }

  const path = `${APPGROUP_API}/namespaces/${encodeURIComponent(normalizedNamespace)}/appgroups`
  const response = await props.k8sproxy(path, { method: 'GET', signal })
  const payload = await response.json().catch(() => null) as AppGroupList | null

  if (!response.ok) {
    const message = (payload as { message?: string } | null)?.message
    throw new Error(message || `获取应用列表失败 (${response.status})`)
  }

  const items = Array.isArray(payload?.items) ? payload.items : []
  return items
    .filter(isEnvironmentRootApp)
    .sort((left, right) => creationTime(right) - creationTime(left))
}
```

调用示例：

```ts
const controller = new AbortController()

try {
  const applications = await listEnvironmentApps('default', controller.signal)
  console.log('Environment 应用列表', applications)
} catch (error) {
  if ((error as Error).name !== 'AbortError') {
    console.error(error)
  }
}

// 页面卸载或请求不再需要时执行
controller.abort()
```

## 常用展示字段

| 页面字段 | AppGroup 字段 | 说明 |
| --- | --- | --- |
| 应用标识 | `metadata.name` | AppGroup 唯一名称 |
| 应用名称 | `spec.title` | 为空时可回退到 `metadata.name` |
| 命名空间 | `metadata.namespace` | AppGroup 所在命名空间 |
| 应用图标 | `spec.logo` | 可能为空 |
| 创建时间 | `metadata.creationTimestamp` | Kubernetes RFC 3339 时间 |
| 就绪状态 | `status.ready` | AppGroup 聚合就绪状态 |
| 部署状态 | `status.deployStatus` | 可能为部署中或失败等状态 |
| 工作负载 | `status.items` | AppGroup 聚合的工作负载状态 |

如只需要页面模型，可以进一步转换：

```ts
const rows = applications.map(group => ({
  name: group.metadata?.name || '',
  title: group.spec?.title || group.metadata?.name || '',
  namespace: group.metadata?.namespace || '',
  logo: group.spec?.logo || '',
  ready: Boolean(group.status?.ready),
  deployStatus: group.status?.deployStatus || '',
  creationTimestamp: group.metadata?.creationTimestamp || '',
}))
```

## 返回与错误处理

`k8sproxy` 返回原生 Fetch `Response`，不会像 Axios 一样直接返回 `response.data`。调用方必须检查 `response.ok`，再解析 `response.json()`。

| HTTP 状态 | 常见原因 | 处理建议 |
| --- | --- | --- |
| `401` | 登录状态失效或宿主 Token 不可用 | 引导用户重新登录，不要自行保存或拼接 Token |
| `403` | 当前用户没有 AppGroup `list` 权限 | 提示联系管理员授权 |
| `404` | 集群尚未安装 AppGroup CRD，或 API group/version 不匹配 | 检查面板与集群版本 |
| `5xx` | Kubernetes API 或代理异常 | 展示错误信息，并允许用户重试 |

## 调用边界

- 使用 `k8sproxy`，不要使用 `panelProxy` 或 `microappProxy` 调用 AppGroup API。
- 传给 `k8sproxy` 的必须是相对代理路径，不要传完整域名。
- 不要在路径中重复添加 `/k8s-proxy`。
- 不要从 localStorage 读取 Token 并自行构造 Authorization；宿主会注入当前面板 Token。
- 不要传 `annotationSelector`，Kubernetes AppGroup 列表接口不支持该参数。
- `labelSelector=w7.cc/manifest-type=environment` 只有在该值同时写入 `metadata.labels` 后才有效；当前基于 annotation 的数据必须前端过滤。
