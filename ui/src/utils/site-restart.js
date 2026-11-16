export const RESTART_ID = 'w7.cc/site-restart-id'
const RESTARTED_AT = 'kubectl.kubernetes.io/restartedAt'
export const RESTART_PATCH_OPTIONS = { headers: { 'Content-Type': 'application/json-patch+json' } }

export function restartBlockReason(deployment) {
  if (!deployment?.metadata?.uid || !deployment.metadata.resourceVersion) return '应用信息不完整，请刷新后重试'
  if (deployment.spec?.paused) return '应用已暂停，请先在面板恢复应用'
  if (deployment.spec?.replicas === 0) return '应用已停止，请先启动应用'
  return ''
}

export function restartPatch(deployment, operation) {
  const reason = restartBlockReason(deployment)
  if (reason) throw new Error(reason)
  const metadata = deployment.spec.template.metadata
  const annotations = { ...metadata?.annotations, [RESTART_ID]: operation.id, [RESTARTED_AT]: operation.startedAt }
  return [
    { op: 'test', path: '/metadata/uid', value: deployment.metadata.uid },
    { op: 'test', path: '/metadata/resourceVersion', value: deployment.metadata.resourceVersion },
    metadata ? { op: 'add', path: '/spec/template/metadata/annotations', value: annotations }
      : { op: 'add', path: '/spec/template/metadata', value: { annotations } }
  ]
}

export function restartState(deployment, operation) {
  const changed = message => Object.assign(new Error(message), { restartChanged: true })
  if (deployment?.metadata?.uid !== operation.uid) throw changed('应用已被重新创建，请刷新检查')
  if (deployment.spec?.template?.metadata?.annotations?.[RESTART_ID] !== operation.id) throw changed('未发现本次重启标记，或标记已被其他操作更改，请刷新检查')
  if (operation.generation && deployment.metadata.generation !== operation.generation) throw changed('应用配置在重启后已被其他操作修改，请刷新检查')
  const blocked = restartBlockReason(deployment)
  if (blocked) throw Object.assign(new Error(blocked), { restartChanged: true })
  const status = deployment.status || {}, desired = deployment.spec.replicas ?? 1
  // Old conditions and replica counts can still describe the previous Pod template.
  const observed = status.observedGeneration >= (operation.generation || deployment.metadata.generation)
  const failed = (status.conditions || []).find(item => item.type === 'Progressing' && item.status === 'False' && item.reason === 'ProgressDeadlineExceeded')
  if (observed && failed) throw Object.assign(new Error(failed.message || '重启后应用启动失败，请查看运行日志'), { restartFailed: true })
  return observed && ['replicas', 'updatedReplicas', 'readyReplicas', 'availableReplicas'].every(key => (status[key] || 0) === desired)
}

export async function waitForRestart(api, url, operation, { onObserved = () => {}, timeoutMs = 15 * 60 * 1000, pollMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const current = (await api.get(url)).data
    onObserved(current)
    if (restartState(current, operation)) return current
    if (Date.now() >= deadline) throw new Error('重启已提交，但应用在 15 分钟内未就绪。请检查重启状态或查看日志，勿重复发起。')
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
}
