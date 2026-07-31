<template>
  <div style="min-height:100%;">
    <div>
      <div>
        <div class="bg-white bg-padding pb-24" style="border-top:1px solid #EEEEEE;">
          <div class="df" style="justify-content: flex-start;">
            <el-button type="primary" icon="plus" @click="add">
              新建环境
            </el-button>
          </div>
          <el-table :data="tableData" class="mt-20 table-header" v-loading="loading">
            <el-table-column label="环境名称" prop="title" width="300">
              <template #default="scope">
                <div class="df ai-c">
                  {{ scope.row.title }}
                                    <el-icon class="show-when-tr-hover" style="cursor: pointer;margin-left: 5px;color: #2d5fff"
                    @click="edit(scope.row)">
                    <Edit />
                  </el-icon>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="类型" prop="language" />
            <el-table-column label="版本" prop="version" />
            <el-table-column label="站点数量" prop="used_num" />
            <el-table-column label="状态" prop="status">
              <template #default="scope">
                <div style="display: flex;align-items: center;">
                  <el-tag v-if="scope.row.status === 1" type="success">运行中</el-tag>
                  <el-tag v-else-if="scope.row.status === 2" type="warning">启动中</el-tag>
                  <el-tag v-else type="danger">已停止</el-tag>
                  <el-icon :size="16" color="#2d5fff" style="margin-left: 10px;cursor: pointer;"
                    v-if="scope.row.status === 1" class="show-when-tr-hover" type="text"
                    @click="changeStatus(scope.row, 0)">
                    <VideoPause />
                  </el-icon>
                  <el-icon :size="16" color="#2d5fff" style="margin-left: 10px;cursor: pointer;"
                    v-else-if="scope.row.status !== 2" class="show-when-tr-hover" type="text"
                    @click="changeStatus(scope.row, 1)">
                    <VideoPlay />
                  </el-icon>
                </div>
              </template>
            </el-table-column>
            <el-table-column align="left" label="操作" width="300">
              <template #default="scope">
                <div class="df ai-c">
                  <template v-if="scope.row.status === 1">
                    <tooltip-button content="环境配置">
                      <el-icon @click="config(scope.row)">
                        <Setting />
                      </el-icon>
                    </tooltip-button>
                    <tooltip-button content="终端命令">
                      <svg style="margin-top: -1px;" @click="terminal(scope.row)" fill="none" stroke="currentColor"
                        stroke-width="4" viewBox="0 0 48 48" aria-hidden="true" focusable="false" stroke-linecap="butt"
                        stroke-linejoin="miter" class="arco-icon arco-icon-code-square">
                        <path
                          d="M23.071 17 16 24.071l7.071 7.071m9.001-14.624-4.14 15.454M9 42h30a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v34a1 1 0 0 0 1 1Z">
                        </path>
                      </svg>
                    </tooltip-button>
                    <tooltip-button content="查看日志">
                      <el-icon @click="envLog(scope.row)">
                        <Document />
                      </el-icon>
                    </tooltip-button>
                    <tooltip-button content="重启环境">
                      <el-icon @click="reloadEnvironment(scope.row)">
                        <RefreshLeft />
                      </el-icon>
                    </tooltip-button>
                  </template>
                  <el-tooltip content="当前环境有站点正在使用，暂时无法删除！" v-if="scope.row.used_num > 0" placement="top">
                    <el-icon color="#2d5fff" size="16"
                      style="vertical-align: top;cursor: not-allowed;filter: opacity(0.5);">
                      <Delete />
                    </el-icon>
                  </el-tooltip>
                  <el-popconfirm v-else title="确认要删除环境吗？" icon="WarningFilled" confirm-button-type="danger"
                    icon-color="#f53f3f" width="180" @confirm="del(scope.row)">
                    <template #reference>
                      <el-icon color="#2d5fff" size="16" style="vertical-align: top;cursor: pointer;">
                        <Delete />
                      </el-icon>
                    </template>
                  </el-popconfirm>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="mt-20 df jc-e">
            <el-pagination v-model:page-size="paginate" :current-page="page" :page-count="last_page"
              :page-sizes="[10, 20, 30, 40]" background layout="sizes, prev, pager, next" @size-change="getData(1)"
              @current-change='getData'></el-pagination>
          </div>
        </div>
      </div>
    </div>
    <el-dialog v-model="visible" title="编辑环境名称" :width="500">
      <el-form ref="form" :model="form" label-position="left" label-width="80px">
        <el-form-item :rules="[{ required: true, message: '环境名称不能为空', trigger: 'manual' }]" label="环境名称" prop="title">
          <el-input v-model="form.title" placeholder="请输入环境名称" />
        </el-form-item>
        <el-form-item>
          <el-button size="large" type="primary" @click="onSubmit">确定</el-button>
          <el-button size="large" @click="visible = false">取消</el-button>
        </el-form-item>
      </el-form>
    </el-dialog>
        <el-dialog v-model="createVisible" title="新建新境" :width="700">
      <div style="padding: 20px;">
        <el-form ref="createFormRef" label-position="left" :rules="rules" :model="createForm" label-width="100px">
          <el-form-item label="环境名称" v-if="editId">
            <el-input v-model="createForm.title" placeholder="请输入环境名称" style="margin-bottom: 20px; width: 240px;" />
          </el-form-item>
          <el-form-item label="环境类型" prop="name" :rules="[{ required: true, message: '请选择环境类型', trigger: 'manual' }]">
            <div class="environment-type">
              <div class="environment-type-item"
                :class="createForm.name === item.name ? 'environment-type-item-active' : ''"
                v-for="item in environmentList" :key="item.name" @click="getEnvironmentVersionList(item.name)">
                <div class="environment-type-item-icon">
                  <img style="width: 40px;height: 40px" :src="'http://zpk.w7.cc' + item.icon" alt="">
                </div>
                <div class="environment-type-item-name">
                  {{ item.name }}
                </div>
              </div>
            </div>
          </el-form-item>
          <el-form-item label="环境版本" prop="version"
            :rules="[{ required: true, message: '请选择环境版本', trigger: 'manual' }]">
            <div v-if="!createForm.name">
              请选择环境类型
            </div>
            <div v-else-if="versionLoading">
              版本信息获取中
            </div>
            <div v-else-if="notInstalled">
              该环境尚未安装，请先安装后选择版本，<span style="color: #2d5fff; cursor: pointer;" @click="installEnvironment">点击安装</span>
            </div>
            <el-select v-else v-model="createForm.version" placeholder="请选择环境版本"
              style="margin-bottom: 20px; width: 240px;">
              <el-option v-for="item in environmentVersionList" :key="item" :label="item" :value="item" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <div class="df jc-c">
          <el-button type="primary" @click="createEnvironment" :loading="checkLoading">{{ checkLoading ? '环境初始化中，请勿关闭界面'
            : '确定' }}</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import myAxios from "@/utils/index";
import panelAxios from "@/utils/panel"
import TooltipButton from "@/components/TooltipButton.vue"
import { reloadEnvironment, envLog, terminal, getPods, fillData, emitWujieEvent, getEnvironmentStatus } from "./utils"
export default {
  name: "zpk_registry",
  data() {
    return {
      versionLoading: false,
      notInstalled: false,
      type: '',
      rules: [
        {
          required: true,
          message: '环境名称不能为空',
          trigger: 'blur'
        },
        {
          required: true,
          message: '环境类型不能为空',
          trigger: 'blur'
        },
        {
          required: true,
          message: '环境版本不能为空',
          trigger: 'blur'
        }
      ],
      checkLoading: false,
      createForm: {
        title: '',
        language: '',
        version: '',
        app_name: '',
        name: ''
      },
      environmentList: [],
      environmentVersionList: [],
      createVisible: false,
      form: {
        title: ''
      },
      editId: '',
      visible: false,
      page: 1,
      paginate: 10,
      last_page: 1,
      tableData: [],
      versionImageTemplate: '',
      loading: true,
      appGroup: '',
      appLanguage: '',
      environmentStatusTimers: {},
      environmentStatusFetchVersion: 0
    }
  },
  created() {
    this.getData(1);
    this.getEnvironmentList()
  },
  beforeUnmount() {
    this.clearEnvironmentStatusTimers()
  },
  components: {
    TooltipButton
  },
  methods: {
    clearEnvironmentStatusTimers() {
      Object.values(this.environmentStatusTimers).forEach(timer => {
        clearInterval(timer)
      })
      this.environmentStatusTimers = {}
    },
    updateEnvironmentItem(item, deployment, pods) {
      item.imageName = deployment?.spec?.template?.spec?.containers?.[0]?.image || ''
      item.containers = deployment?.spec?.template?.spec?.containers || []
      item.group = deployment?.metadata?.annotations?.["w7.cc/group-name"] || ''
      item.status = deployment ? getEnvironmentStatus(deployment, pods) : 0
      return item
    },
    pollEnvironmentStatus(item, fetchVersion) {
      const key = item.id || item.app_name
      if (this.environmentStatusTimers[key]) {
        return
      }

      const timer = setInterval(() => {
        Promise.allSettled([
          panelAxios.get('/apis/apps/v1/namespaces/default/deployments/' + item.app_name.replace(/_/g, '-')),
          getPods(item.app_name.replace(/_/g, '-'))
        ]).then(([deploymentRes, podRes]) => {
          if (fetchVersion !== this.environmentStatusFetchVersion) {
            if (this.environmentStatusTimers[key] === timer) {
              clearInterval(timer)
              delete this.environmentStatusTimers[key]
            }
            return
          }

          const deployment = deploymentRes?.status === 'fulfilled' ? deploymentRes.value?.data : null
          const pods = podRes?.status === 'fulfilled' ? podRes.value?.data?.items || [] : []
          const status = deployment ? getEnvironmentStatus(deployment, pods) : 0

          if (status !== 2) {
            const index = this.tableData.findIndex(data => data.id === item.id)
            if (index !== -1) {
              this.tableData[index] = this.updateEnvironmentItem({
                ...this.tableData[index]
              }, deployment, pods)
            }
            if (this.environmentStatusTimers[key] === timer) {
              clearInterval(timer)
              delete this.environmentStatusTimers[key]
            }
          }
        })
      }, 3000)
      this.environmentStatusTimers[key] = timer
    },
    terminal(row) {
      getPods(row.app_name.replace(/_/g, '-')).then(res => {
        terminal(row.app_name.replace(/_/g, '-'), res.data.items[0].metadata.name)
      })
    },
    envLog(row) {
      getPods(row.app_name.replace(/_/g, '-')).then(res => {
        envLog(res.data.items[0].metadata.name, res.data.items[0].spec.containers[0].name, res.data.items[0].spec.containers)
      })
    },
    reloadEnvironment(row) {
      reloadEnvironment(row.app_name.replace(/_/g, '-')).then(() => {
        this.$message.success('重启成功')
      })
    },
    add() {
      this.createForm.name = ''
      this.createForm.version = ''
      this.createForm.title = ''
      this.createForm.language = ''
      this.createForm.app_name = ''
      this.versionLoading = false
      this.notInstalled = false
      this.environmentVersionList = []
      this.createVisible = true
    },
    createEnvironment() {
      this.$refs.createFormRef.validate(async (valid) => {
        if (!valid) {
          return
        }

        const data = {
          ...this.createForm
        }

        const version_name = await this.copy(this.type.replace(/_/g, "-"), this.createForm.version)

        if (!version_name) {
          this.$message.error('创建环境失败')
          return
        }

        data.app_name = version_name


        myAxios.post('/api/environment/create', { ...data, nginx_vhost_template: this.nginxVhostTemplate, title: this.createForm.name + '-' + this.createForm.version, language: this.appLanguage || this.createForm.name, group: this.appGroup }).then(() => {
          this.createVisible = false
          this.getData(1)
        })
      })

    },
    getEnvironmentList() {
      myAxios.get('/api/environment/support-list').then(res => {
        const environmentList = res.data.data.list
        environmentList.sort((a, b) => {
          if (a.name.toLowerCase() === 'php') {
            return -1
          } else if (b.name.toLowerCase() === 'php') {
            return 1
          }
          return 0
        })
        this.environmentList = environmentList
      })
    },
    async getEnvironmentVersionList(name) {
      this.versionLoading = true
      this.createForm.name = name
      const environment = this.environmentList.find(item => item.name === name)
      this.type = environment.identifie
      const res = await this.checkEnvironmentStatus(environment.identifie)
      if (res === 1) {
        this.versionLoading = false
        this.notInstalled = true
      } else {
        this.appGroup = res.data.metadata.annotations['w7.cc/group-name']
        const manifest = res.data.spec.template.metadata.annotations

        const versionList = manifest['w7.cc/image_version'].split(',') || []

        this.environmentVersionList = versionList
        this.versionImageTemplate = manifest['w7.cc/image_template']
        this.defaultVersion = manifest['w7.cc/image_version_default']
        this.nginxVhostTemplate = manifest['w7.cc/nginx_vhost_template']
        this.appLanguage = manifest['w7.cc/image_language']
        this.versionLoading = false
        this.notInstalled = false

      }
    },
    getVersionIdentifie(app_name, version) {
      return app_name + (version ? '_' + version.replace(/\./g, '') : '')
    },
    getAppConfig(app_name, version) {
      return panelAxios.get("/apis/apps/v1/namespaces/default/deployments/" + this.getVersionIdentifie(app_name, version).replace(/_/g, '-'))
    },
    checkEnvironmentStatus(name) {
      return new Promise((resolve) => {
        this.getAppConfig(name).then(res => {
          resolve(res)
        }).catch(() => {
          resolve(1)
        })
      })
    },
    installEnvironment() {
      emitWujieEvent('toStoreInstall', `https://zpk.w7.cc/zpk/respo/info/${this.type}`)
      return new Promise((res) => {
        let timer = null
        timer = setInterval(() => {
          this.checkEnvironmentStatus(this.type).then(status => {
            if (status !== 1) {
              clearInterval(timer)
              this.appGroup = status.data.metadata.annotations['w7.cc/group-name']
              const manifest = status.data.spec.template.metadata.annotations
              const versionList = manifest['w7.cc/image_version'].split(',') || []
              this.environmentVersionList = versionList
              this.versionImageTemplate = manifest['w7.cc/image_template']
              this.defaultVersion = manifest['w7.cc/image_version_default']
              this.nginxVhostTemplate = manifest['w7.cc/nginx_vhost_template']
              this.appLanguage = manifest['w7.cc/image_language']
              this.versionLoading = false
              this.notInstalled = false
              res()
            }
          })
        }, 1000)
      })
    },
    changeStatus(row, replicas) {
      panelAxios.patch("/apis/apps/v1/namespaces/default/deployments/" + row.app_name.replace(/_/g, '-'), {
        spec: {
          replicas
        }
      }, {
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
      }).then(() => {
        this.$message.success('状态修改成功');
        const index = this.tableData.findIndex(item => item.id === row.id)
        this.tableData[index].status = replicas
      })
    },
    createName(len) {
      len = len || 8;
      let s = 'abcdefghijklmnopqrstuvwxyz';
      let p = '';
      for (var i = 0; i < len; i++) {
        p = p + s[parseInt(Math.random() * s.length)]
      }
      return p;
    },
    getAutoFillRules(data) {
      const volumeMounts = data?.spec?.template?.spec?.containers?.[0]?.volumeMounts
      const volumes = data?.spec?.template?.spec?.volumes
      const volumeMountIndex = Array.isArray(volumeMounts) ? volumeMounts.length : 0
      const volumeIndex = Array.isArray(volumes) ? volumes.length : 0

      return [
        {
          source: 'spec.template.spec.containers[0].volumeMounts[2]',
          target: `spec.template.spec.containers[0].volumeMounts[${volumeMountIndex}]`
        },
        {
          source: 'spec.template.spec.containers[0].volumeMounts[3]',
          target: `spec.template.spec.containers[0].volumeMounts[${volumeMountIndex + 1}]`
        },
        {
          source: 'spec.template.spec.volumes[0]',
          target: `spec.template.spec.volumes[${volumeIndex}]`
        }
      ]
    },
    copy(app_name, version) {
      let name
      return new Promise((resolve) => {
        panelAxios.get("/apis/apps/v1/namespaces/default/deployments/" + app_name.replace(/_/g, '-')).then(async res => {
          if (!res?.data) { return }
          let data = res?.data;
          const autoFillRules = this.getAutoFillRules(data)
          if (autoFillRules) {
            const siteManagerData = await this.getAppConfig((window.$wujie?.props?.group || window.$wujie?.props?.releaseName) + '-site-manager')
            data = fillData(data, autoFillRules, siteManagerData.data)
          }

          name = this.getVersionIdentifie(app_name, version).replace(/_/g, '-') + '-' + this.createName(4);
          data.metadata.name = name;
          data.metadata.labels.app = name;
          data.metadata.annotations['w7.cc/create-svc'] = 'true';
          data.metadata.annotations.title = name;
          data?.spec?.selector?.matchLabels && (data.spec.selector.matchLabels.app = name);
          data?.spec?.template?.metadata?.labels && (data.spec.template.metadata.labels.app = name);
          data?.spec?.template?.spec?.containers?.[0]?.name && (data.spec.template.spec.containers[0].name = name)

          data?.spec?.template?.spec?.containers?.[0]?.image && (data.spec.template.spec.containers[0].image = this.versionImageTemplate.replace('{version}', version))

          if (data.spec.template.spec.containers[0].env) {
            data.spec.template.spec.containers[0].env = data.spec.template.spec.containers[0].env.map(item => {
              if (item.name === 'METADATA_NAME') {
                return {
                  name: 'METADATA_NAME',
                  value: name
                }
              }
              return item
            })
          }

          data?.spec?.template?.spec && (data.spec.template.spec.affinity = {
            "podAffinity": {
              "requiredDuringSchedulingIgnoredDuringExecution": [
                {
                  "labelSelector": {
                    "matchExpressions": [
                      {
                        "key": "w7.cc/identifie",
                        "operator": "In",
                        "values": [
                          "w7-sitemanager"
                        ]
                      }
                    ]
                  },
                  "topologyKey": "kubernetes.io/hostname"
                }
              ]
            }
          })

          delete data.metadata.resourceVersion;
          delete data.metadata.generation;
          delete data.metadata.creationTimestamp;
          delete data.metadata.uid;
          delete data.status;
          return data
        }).then(data => {
          if (!data) { return }
          panelAxios.post("/apis/apps/v1/namespaces/default/deployments", data)
          resolve(name)
        }).catch(() => {
          resolve(false)
        })
      })
    },
    async deleteEnvironmentResources(row) {
      const appName = row.app_name?.replace(/_/g, '-')
      if (!appName) {
        return
      }

      const resources = [
        {
          name: '环境应用',
          request: panelAxios.delete("/apis/apps/v1/namespaces/default/deployments/" + appName)
        },
        {
          name: '环境服务',
          request: panelAxios.delete("/api/v1/namespaces/default/services/" + appName + '-lb')
        }
      ]
      const results = await Promise.all(resources.map(item => {
        return item.request.then(() => {
          return { name: item.name, error: null }
        }).catch(error => {
          return { name: item.name, error }
        })
      }))
      const failed = results.filter(item => item.error && item.error?.response?.status !== 404)
      if (failed.length > 0) {
        throw new Error(failed.map(item => item.name).join('、') + '清理失败')
      }
    },
    async del(row) {
      let environmentDeleted = false
      try {
        await myAxios.post('/api/environment/delete', {
          id: row.id
        })
        environmentDeleted = true
        await this.deleteEnvironmentResources(row)
        this.$message.success('删除成功');
      } catch (error) {
        const message = error?.response?.data?.error || error?.message || '删除失败'
        this.$message.error(environmentDeleted ? '环境记录已删除，但' + message : message)
      } finally {
        if (environmentDeleted) {
          this.getData(1, true);
          this.checkLanguage(row.group)
        }
      }
    },
    config(row) {
      const formatIMageName = row.imageName.replace(/\//g, 'W7IMAGENAMESLASH')
      emitWujieEvent('openApp', {
        title: '环境配置',
        appgroup: row.group,
        path: `#/${row.app_name.replace(/_/g, '-')}/${formatIMageName}/${row.version}`,
      })
    },
    checkLanguage(group) {
      myAxios.post("/api/environment/list", {
        page: 1,
        page_size: 1,
        group
      }).then(res => {
        if (res.data.data.total === 0) {
          panelAxios.delete("/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups/" + group.replace(/_/g, '-'))
        }
      })
    },
    getData(p, notChangePage) {
      this.clearEnvironmentStatusTimers()
      const fetchVersion = ++this.environmentStatusFetchVersion
      this.loading = true
      if (!notChangePage) {
        this.page = p
      }
      myAxios.post("/api/environment/list", {
        page: this.page,
        page_size: this.paginate
      }).then(res => {
        let data = res.data?.data?.list ?? [];
        this.last_page = Math.ceil(res.data.data.total / this.paginate);
        this.tableData = data

        Promise.all([
          Promise.allSettled(data.map(item => {
            return panelAxios.get('/apis/apps/v1/namespaces/default/deployments/' + item.app_name.replace(/_/g, '-'))
          })),
          Promise.allSettled(data.map(item => {
            return getPods(item.app_name.replace(/_/g, '-'))
          }))
        ]).then(([deploymentRes, podRes]) => {
          if (fetchVersion !== this.environmentStatusFetchVersion) {
            return
          }
          this.tableData = this.tableData.map((item, index) => {
            const deployment = deploymentRes[index]?.value?.data
            const pods = podRes[index]?.value?.data?.items || []

            item = this.updateEnvironmentItem(item, deploymentRes[index]?.status === 'fulfilled' ? deployment : null, pods)
            if (item.status === 2) {
              this.pollEnvironmentStatus(item, fetchVersion)
            }
            return item
          })
          this.loading = false
        })

      }).catch(() => {
        this.loading = false
      });
    },
    edit(row) {
      this.editId = row.id
      this.form.title = row.title
      this.visible = true
    },
    onSubmit() {
      this.$refs.form.validate((valid) => {
        if (!valid) {
          return
        }
        myAxios.post('/api/environment/update', { id: this.editId, ...this.form }).then(() => {
          this.$message.success('操作成功');
          this.getData(1, true);
          this.visible = false
        })
      })
    }
  }
}
</script>

<style scoped>
.environment-type {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-bottom: 30px;
}

.environment-type-item {
  padding: 10px 20px;
  border-radius: 10px;
  background-color: #f5f7fa;
  cursor: pointer;
  text-align: center;
  line-height: 1;
}

.environment-type-item:hover {
  background-color: #e9e9e9;
}

.environment-type-item-active {
  box-shadow: 0 0 3px 1px #badefd;
  background-color: #f0f2fb;
}

.environment-type-item-icon img {
  width: 40px;
  height: 40px;
}

.loading-icon {
  animation: rotate 1s linear infinite;
  color: #2d5fff;
  font-size: 24px;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
