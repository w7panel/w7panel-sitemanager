<template>
  <div style="min-height:100%;">
    <div>
      <div>
        <div class="bg-white bg-padding pb-24" style="border-top:1px solid #EEEEEE;">
          <div class="lang-tab">
            <el-tabs @tab-change="handleHeaderTabChange" :default-value="activeLangName">
              <el-tab-pane v-for="(item, index) in environmentList" :key="index" :label="item.name"
                :name="item.name"></el-tab-pane>
            </el-tabs>
          </div>
          <template v-if="activeLang.status === 1">
            <div class="df jc-b">
              <el-button type="primary" icon="plus" @click="add">
                新建站点
              </el-button>
              <div></div>
            </div>
            <el-table :data="tableData" class="mt-20 table-header" v-loading="loading">
              <el-table-column label="域名" prop="domain">
                <template #default="scope">
                  <div v-if="scope.row?.domain">
                    <a style="color: #0052d9"
                      :href="(scope.row.domain[0]?.isSSL ? 'https://' : 'http://') + scope.row.domain[0]?.domain"
                      target="_blank">{{ (scope.row.domain[0]?.isSSL ? 'https://' : 'http://') +
                        scope.row.domain[0]?.domain }}</a>
                  </div>
                  <div v-if="scope.row?.domain?.length > 1">
                    <el-popover width="200">
                      <template #reference>
                        <span style="color: #0052d9;font-size: 12px">等{{ scope.row.domain?.length }}个域名</span>
                      </template>
                      <div>
                        <div v-for="(item, index) in scope.row.domain" :key="item"
                          style="word-break: keep-all;white-space: nowrap;text-overflow: ellipsis;overflow: hidden;">
                          <a v-if="index !== 0" style="color: #0052d9"
                            :href="(item.isSSL ? 'https://' : 'http://') + item.domain" target="_blank">{{ (item.isSSL ?
                              'https://' : 'http://') + item.domain }}</a>
                        </div>
                      </div>
                    </el-popover>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="目录" prop="root_dir">
                <template #default="scope">
                  <el-button type="text" @click="toFile(scope.row)">/www/wwwroot/{{ scope.row.root_dir }}</el-button>
                  <div style="color: #999;margin-top: -4px;font-size: 12px">
                    {{ scope.row.remark || '-' }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="环境" prop="environment_name" width="120" />
              <el-table-column align="left" label="操作" width="300">
                <template #default="scope">
                  <el-button type="text" @click="edit(scope.row)">编辑</el-button>
                  <el-button type="text" @click="shortcut(scope.row)">https配置</el-button>
                  <el-button  v-if="scope.row.ext?.k8s_app_name" type="text" @click="appManage(scope.row.ext?.k8s_app_name)">应用管理</el-button>
                  <el-popconfirm title="确认要删除站点吗？" icon="WarningFilled" confirm-button-type="danger"
                    icon-color="#f53f3f" width="180" @confirm="del(scope.row)">
                    <template #reference>
                      <el-button type="text">删除</el-button>
                    </template>
                    <template #actions="{ confirm, cancel }">
                      <div style="text-align: left;">
                        <div>
                          <el-checkbox checked disabled>删除站点配置</el-checkbox>
                        </div>
                        <div>
                          <el-checkbox v-model="deleteSiteConfig">删除站点文件</el-checkbox>
                        </div>
                      </div>
                      <el-button size="small" @click="deleteSiteConfig = false; cancel()">取消</el-button>
                      <el-button type="primary" size="small" @click="confirm">
                        确认
                      </el-button>
                    </template>
                  </el-popconfirm>
                </template>
              </el-table-column>
            </el-table>
            <div class="mt-20 df jc-e">
              <el-pagination v-model:page-size="paginate" :current-page="page" :page-count="last_page"
                :page-sizes="[10, 20, 30, 40]" background layout="sizes, prev, pager, next" @size-change="getData(1)"
                @current-change='getData'></el-pagination>
            </div>
          </template>
          <template v-else>
            <div class="df jc-c">
              <el-empty>
                <template #description>
                  该环境尚未安装，<span style="color: #2d5fff; cursor: pointer;" @click="installEnvironment">点击安装</span>
                </template>
              </el-empty>
            </div>
          </template>
        </div>
      </div>
    </div>
    <el-dialog v-model="visible" :title="editId ? '编辑站点' : '添加站点'" :width="editId ? 900 : 700">
      <div class="df" style="overflow: hidden;">
        <div class="w-200" style="margin-right: 20px" v-if="editId">
          <el-tabs style="height: 100%" tab-position="left" @tab-change="handleTabChange" v-model="tab">
            <el-tab-pane name="base" label="基础配置"></el-tab-pane>
            <el-tab-pane name="nginx" label="Nginx配置"></el-tab-pane>
          </el-tabs>
        </div>
        <div v-if="tab === 'base'" style="flex: 1;min-height: 300px;">
          <el-form ref="form" :model="form" label-position="left" label-width="80px">
                        <el-form-item :rules="[{ required: true, message: '域名不能为空', trigger: 'manual' }]" label="域名" prop="domain">
              <div style="width: 100%">
                <el-alert style="margin-bottom: 10px" title="添加域名后，请在您持有域名的DNS解析后台添加对应的域名解析记录："
                  :description="domainTips" type="primary" show-icon :closable="false" />
                <div style="display: flex;align-items: center;margin-bottom: 20px" v-for="(item, index) in form.domain"
                  :key="index">
                  <el-input style="flex: 1;margin-right: 10px" v-model="form.domain[index].domain" placeholder="请输入域名"
                    @change="changeDir">
                    <template #prepend>
                      {{ form.domain[index].isSSL ? 'https://' : 'http://' }}
                    </template>
                  </el-input>
                  <el-checkbox v-model="form.domain[index].isSSL" label="自动https" />
                  <div style="flex: 0 0 30px;text-align: center">
                    <el-button icon="delete" link type="danger" v-if="index !== 0"
                      @click="removeDomain(index)"></el-button>
                  </div>
                </div>
                <el-button icon="plus" type="primary" style="background: #fff;color: #0052d9;width: 100%"
                  @click="form.domain.push({ domain: '', isSSL: true })">添加域名
                </el-button>
              </div>

            </el-form-item>
            <el-form-item :rules="[{ required: true, message: '目录不能为空', trigger: 'manual' }]" label="目录"
              prop="root_dir">
              <el-input v-model="form.root_dir">
                <template #prepend>/www/wwwroot/</template>
              </el-input>
            </el-form-item>
            <el-form-item :rules="[{ required: true, message: '请选择环境', trigger: 'manual' }]" label="环境"
              prop="environment_id">
              <el-select v-model="form.environment_id" :options="formSelectImages" @change="checkEnvironment"
                style="width: 200px" />
              <span v-if="isNewEnv" style="color: #2d5fff;margin-left: 5px;"><el-icon>
                  <check />
                </el-icon>新建环境</span>

              <div style="color: #999;margin-top: 5px;flex: 0 0 100%;">
                {{ activeLang.share ? '该语言类型，允许多个站点共用一套环境' : '该语言类型，只能一个站点对应一套环境' }}
              </div>
              <div class="enviroment-options" style="display: flex;align-items: center;flex: 0 0 100%;">
                <span v-if="activeLang.share === false" style="margin-right: 10px;user-select: none;">
                  <el-switch class="custom-el-switch" v-model="form.debug" active-text="调试模式" />
                </span>
                <template v-if="activeEnvironment">
                  <tooltip-button content="终端命令" @click="terminal(activeEnvironment)">
                    <svg style="margin-top: -1px;" fill="none" stroke="currentColor" stroke-width="4"
                      viewBox="0 0 48 48" aria-hidden="true" focusable="false" stroke-linecap="butt"
                      stroke-linejoin="miter" class="arco-icon arco-icon-code-square">
                      <path
                        d="M23.071 17 16 24.071l7.071 7.071m9.001-14.624-4.14 15.454M9 42h30a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v34a1 1 0 0 0 1 1Z">
                      </path>
                    </svg>
                    <span>终端命令</span>
                  </tooltip-button>
                  <tooltip-button content="查看日志" @click="envLog(activeEnvironment)">
                    <el-icon>
                      <Document />
                    </el-icon>
                    <span>查看日志</span>
                  </tooltip-button>
                  <tooltip-button content="重启环境" @click="reloadEnvironment(activeEnvironment)">
                    <el-icon>
                      <RefreshLeft />
                    </el-icon>
                    <span>重启环境</span>
                  </tooltip-button>
                </template>
              </div>
            </el-form-item>
            <template v-if="activeLang.share === false">

              <el-form-item
                :rules="[{ required: true, message: '请填写启动命令', trigger: 'manual', validator: validateCommand }]"
                label="启动命令" prop="command">
                <el-input type="textarea" value="tail -f /dev/null" v-if="form.debug" disabled />
                <el-input type="textarea" v-model="form.command[2]" v-else />
              </el-form-item>
            </template>
            <el-form-item label="备注" prop="remark">
              <el-input v-model="form.remark" :rows="5" type="textarea" />
            </el-form-item>
            <el-form-item>
              <el-button size="large" type="primary" @click="onSubmit" :loading="submitLoading">
                {{ newEnvironmentStarting ? '环境创建中' : '确定' }}
              </el-button>
            </el-form-item>
          </el-form>
        </div>
        <div style="flex: 1;min-height: 300px;overflow: hidden;" v-else>
          <Editor :key="tab" v-model:content="nginxConfig" language="nginx" />
          <div style="display: flex;justify-content: center;margin-top: 20px">
            <el-button size="large" type="primary" @click="nginxSave">应用</el-button>
          </div>
        </div>
      </div>
    </el-dialog>
    <el-dialog v-model="shortcutVisible" :width="400" title="域名管理">
      <div>
        <div v-for="(domain, index) in domainList" :key="index"
          style="display: flex;align-items: stretch;margin-bottom: 10px">
          <el-input v-model="domainList[index]" style="width: 340px"></el-input>
          <div style="flex: 1;display:flex;align-items: center;justify-content: center;cursor: pointer">
            <el-icon @click="domainList.splice(index, 1)">
              <CloseBold />
            </el-icon>
          </div>
        </div>
      </div>
      <div>
        <el-button icon="plus" type="primary" style="background: #fff;color: #0052d9;width: 100%"
          @click="domainList.push('')">添加域名
        </el-button>
      </div>
      <template #footer>
        <el-button size="large" type="primary" @click="onDomainSave">确定</el-button>
        <el-button size="large" @click="shortcutVisible = false">取消</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue';
import myAxios from "@/utils/index";
import panelAxios from "@/utils/panel"
import { ElMessage } from 'element-plus';
import { reloadEnvironment, envLog, terminal, getPods, fillData, emitWujieEvent, getEnvironmentStatus } from "./utils";
import TooltipButton from "@/components/TooltipButton";

const defaultLang = window.__WUJIE_RAW_WINDOW__?.localStorage.getItem('activeLangName') || 'php'
const Editor = defineAsyncComponent(() => import("./editor.vue"));

export default {
  name: "zpk_registry",
  components: { Editor, TooltipButton },
  data() {
    return {
      deleteSiteConfig: false,
      loading: true,
      submitLoading: false,
      newEnvironmentStarting: false,
      activeLang: { name: defaultLang },
      activeLangName: defaultLang,
      tab: 'base',
      domainList: [],
      shortcutVisible: false,
      images: [],
      form: {
        domain: [],
        root_dir: '',
        old_environment_id: '',
        remark: '',
        debug: false,
        environment_id: '',
        command: []
      },
      editId: '',
      visible: false,
      page: 1,
      paginate: 10,
      last_page: 1,
      tableData: [],
      panelDomainList: [],
      environmentList: [],
      isNewEnv: false,
      formSelectImages: [],
      allImages: [],
      activeEnvironment: null,
      domainTips: ''
    }
  },
  created() {
    this.getLangList()
    this.getPanelDomainList()
    this.getDomainTips()
  },
  methods: {
    appManage(appgroup) {
      window.open('/app/appgroup/' + appgroup + '/micro')
    },
    getDomainTips() {
      panelAxios.get('/api/v1/namespaces/default/configmaps/domain-parse').then(res => {
        if (res.data.data.type === 'cname') {
          this.domainTips = `记录类型：cname，记录值：${res.data.data.cname}`
        } else {
          this.domainTips = `记录类型：${res.data.data.type}，记录值：${res.data.data.ips}`
        }
      })
    },
    validateCommand(rule, value, callback) {
      if (!value[2] && !this.form.debug) {
        callback(new Error('请填写启动命令'))
      } else {
        callback()
      }
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
    checkEnvironment(value) {
      if (typeof value === 'string') {
        this.$confirm('为站点创建全新环境，确定创建吗？', '提示', {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning',
        }).then(() => {
          this.isNewEnv = true
        }).catch(() => {
          this.form.environment_id = this.form.old_environment_id
        })
      } else {
        this.isNewEnv = false
      }
      this.loadEnvStatus(value)
    },
    loadEnvStatus(value) {
      const selectEnv = this.allImages.find(item => item.id === value)
      if (!selectEnv) {
        this.activeEnvironment = null
        return false
      }
      return this.getAppConfig(selectEnv.app_name).then(res => {
        this.activeEnvironment = selectEnv
        return res
      }).catch(() => {
        this.activeEnvironment = null
        return false
      })
    },
    handleHeaderTabChange(name) {
      this.activeLang = this.environmentList.find(item => item.name === name)
      window.__WUJIE_RAW_WINDOW__?.localStorage.setItem('activeLangName', this.activeLang.name)
      this.getData(1)
    },
    installEnvironment() {
      emitWujieEvent('toStoreInstall', `https://zpk.w7.cc/zpk/respo/info/${this.activeLang.identifie}`)
      let timer = null
      timer = setInterval(() => {
        this.getAppConfig(this.activeLang.identifie).then(res => {
          clearInterval(timer)
          this.activeLang.status = 1
          this.activeLang.group = res.metadata?.annotations?.['w7.cc/group-name']
          this.activeLang.language = res.spec?.template?.metadata?.annotations?.['w7.cc/image_language']
          this.activeLang.share = res.spec?.template?.metadata?.annotations?.['w7.cc/image_is_share'] === 'true'
          this.activeLang.nginxTemplate = res.spec?.template?.metadata?.annotations?.['w7.cc/nginx_vhost_template']
          this.activeLang.versionTemplate = res.spec?.template?.metadata?.annotations['w7.cc/image_template']
          this.activeLang.versionList = res.spec?.template?.metadata?.annotations['w7.cc/image_version']?.split(',') ?? []
        })
      }, 1000)
    },
    getAppConfig(name) {
      return new Promise((resolve, reject) => {
        panelAxios.get("/apis/apps/v1/namespaces/default/deployments/" + name.replace(/_/g, '-')).then(res => {
          resolve(res.data)
        }).catch(err => {
          reject(err)
        })
      })
    },
    getLangList() {
      myAxios.get('/api/environment/support-list').then(res => {
        this.getLangStatus(res.data.data.list.sort((a, b) => {
          if (a.name.toLowerCase() === 'php') {
            return -1
          } else if (b.name.toLowerCase() === 'php') {
            return 1
          }
          return 0
        }))
      })
    },
    getLangStatus(list) {
      Promise.allSettled(list.map(item => this.getAppConfig(item.identifie))).then(res => {
        res.forEach((item, index) => {
          list[index].status = item.status === 'fulfilled' ? 1 : 0
          list[index].share = item.status === 'fulfilled' ? item.value?.spec?.template?.metadata?.annotations?.['w7.cc/image_is_share'] === 'true' : false
          list[index].nginxTemplate = item.status === 'fulfilled' ? item.value?.spec?.template?.metadata?.annotations?.['w7.cc/nginx_vhost_template'] : ''
          list[index].versionTemplate = item.status === 'fulfilled' ? item.value?.spec?.template?.metadata?.annotations['w7.cc/image_template'] : ''
          list[index].versionList = item.status === 'fulfilled' ? item.value?.spec?.template?.metadata?.annotations['w7.cc/image_version']?.split(',') ?? [] : []
          list[index].language = item.status === 'fulfilled' ? item.value?.spec?.template?.metadata?.annotations?.['w7.cc/image_language'] : ''
          list[index].group = item.status === 'fulfilled' ? item.value?.metadata?.annotations?.['w7.cc/group-name'] : ''
        })
        const localActiveLang = list.find(item => item.name === this.activeLangName)
        if(localActiveLang) {
          this.activeLang = localActiveLang
        }
        this.environmentList = list
        if(this.activeLang) {
          this.getData(1)
        }
      })
    },
    nginxSave() {
      myAxios.post('/api/site-nginx/set-proxy-conf', {
        site_id: this.editId,
        nginx_vhost_conf: this.nginxConfig
      }).then(() => {
        this.$message.success('操作成功')
        this.reload()
      })
    },
    async toFile(site) {
      const envData = await panelAxios.get('/apis/apps/v1/namespaces/default/deployments/' + site.environment_app_name.replace(/_/g, '-'))
      if (envData?.data?.spec?.replicas <= 0) {
        this.$message.warning('环境未启动，请检查站点启动命令')
        return
      }
      emitWujieEvent("openFile", {
        kind: 'deployments',
        appname: site.environment_app_name?.replace(/_/g, '-'),
        path: '/www/wwwroot/' + site.root_dir
      });
    },
    changeDir(value) {
      if (value && !this.form.root_dir) {
        const domains = value.split('\n').filter(item => !!item)
        this.form.root_dir = domains[0]
      }
    },
    shortcut(data) {
      const name = this.panelDomainList.find(item => item.domain === data.domain[0].domain)?.name
      emitWujieEvent("domainCert", {
        domainName: name
      });
    },
    onDomainSave() {
      const domainData = this.tableData.find(item => item.id === this.editId)
      if (domainData) {
        myAxios.post('/api/site/update', {
          ...domainData,
          domain: [domainData.domain[0], ...this.domainList.filter(item => !!item)].join()
        }).then(() => {
          this.$message.success('操作成功');
          this.updateDomainChild(domainData.domain[0], this.domainList.filter(item => !!item))
          this.getData(1, true);
          this.shortcutVisible = false
        })
      }
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
    domainToname(str) {
      return str.replace(/\*/g, 'x').replace(/(\.|\/|_)/g, '-').toLowerCase();
    },
    getListData(data) {
      this.panelDomainList = data?.filter(i => {
        if (!i?.metadata?.labels?.parents) { return true; }
        let find = data.find(p => p.metadata.name == i.metadata.labels.parents);
        if (!find) { return true; }
        return false;
      })?.map(i => {
        return {
          name: i.metadata.name,
          domain: i?.spec?.rules?.[0]?.host,
        }
      });
    },
    getPanelDomainList() {
      panelAxios.get('/apis/networking.k8s.io/v1/namespaces/default/ingresses?labelSelector=group=' + (window.$wujie?.props?.group || window.$wujie?.props?.releaseName), { loading: true }).then(res => {
        let data = res?.data?.items || [];
        this.panelData = data
        this.getListData(data);
      });
    },
    addDomain(domains) {
      const [mainDomain, ...childDomains] = domains
      let backend = {
        service: {
          name: (window.$wujie?.props?.group || window.$wujie?.props?.releaseName) + '-site-manager-nginx',
          port: { number: 80 }
        }
      }

      let data = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: {
          name: 'ing-' + this.createName(),
          namespace: 'default',
          annotations: {
            'kubernetes.io/ingress.class': 'higress',
            'higress.io/resource-definer': 'higress',
          },
          labels: {
            'higress.io/resource-definer': 'higress',
            app: (window.$wujie?.props?.group || window.$wujie?.props?.releaseName) + '-site-manager-nginx',
            group: window.$wujie?.props?.group || window.$wujie?.props?.releaseName,
          },
        },
        spec: {
          rules: [
            {
              host: mainDomain.domain,
              http: {
                paths: [
                  {
                    path: '/',
                    pathType: 'Prefix',
                    backend,
                  },
                ],
              },
            },
          ],
        },
      }
      if (childDomains?.length) {
        data.metadata.annotations['w7.cc/child-hosts'] = JSON.stringify(childDomains.map(childDomain => {
          return {
            name: this.createName(),
            host: childDomain.domain,
            autoSsl: childDomain.isSSL,
            sslRedirect: false
          }
        }))
      }
      data = this.makeSSLInfo(data, mainDomain.isSSL)

      return panelAxios.post("/apis/networking.k8s.io/v1/namespaces/default/ingresses", data).then(() => {
        this.getPanelDomainList()
      })
    },
    deleteDomain(domain) {
      const name = this.panelDomainList.find(item => item.domain === domain)?.name
      if (!name) {
        return
      }
      return panelAxios.delete("/apis/networking.k8s.io/v1/namespaces/default/ingresses/" + name).then(() => {
        this.getPanelDomainList()
      })
    },
    getNamespace() {
      return myAxios.post("/api/environment/list", {
        page: 1,
        page_size: 1000,
        group: this.activeLang.group
      }).then(res => {
        let hasImages = res.data?.data?.list || []
        this.allImages = hasImages
        if (this.activeLang.share === false) {
          hasImages = hasImages.filter(item => item.used_num === 0 || item.id === this.form.environment_id)
        }
        const result = []
        if (hasImages.length) {
          result.push({
            label: '已创建环境',
            options: hasImages.map(item => {
              return {
                label: item.title,
                value: item.id
              }
            })
          })
        }
        result.push({
          label: '新建环境',
          options: this.activeLang.versionList.map(item => {
            return {
              label: item,
              value: item
            }
          })
        })
        this.formSelectImages = result
        this.images = hasImages

      });
    },
    getData(p, notChangePage) {
      this.loading = true
      if (!notChangePage) {
        this.page = p
      }
      myAxios.post("/api/site/list", {
        page: this.page,
        page_size: this.paginate,
        group: this.activeLang?.group
      }).then(res => {
        let data = res.data?.data?.list ?? [];
        this.tableData = data.map(item => {
          item.domain = item.domain.map(domain => {
            return {
              domain: domain.replace(/(http|https):\/\//, ''),
              isSSL: domain.startsWith('https://')
            }
          })
          return item
        });
        this.last_page = Math.ceil(res.data.data.total / this.paginate);
        this.loading = false
      }).catch(() => {
        this.loading = false
      });
    },
    add() {
      this.loading = false
      this.editId = ''
      this.tab = 'base'
      this.form.domain = [
        {
          domain: '',
          isSSL: true
        }
      ]
      this.form.root_dir = ''
      this.form.debug = false
      this.form.old_environment_id = ''
      this.form.environment_id = ''
      this.activeEnvironment = null
      this.form.remark = ''
      this.isNewEnv = false
      this.submitLoading = false
      this.newEnvironmentStarting = false
      this.nginxConfig = ''
      this.visible = true
      this.form.command = ['sh', '-c', '']
      this.getNamespace()
    },
    makeSSLInfo(data, isSSL) {
      if (!isSSL) {
        delete data.metadata.annotations['higress.io/ssl-redirect']
        delete data.metadata.annotations['w7.cc/ssl-redirect']
        delete data.metadata.annotations['cert-manager.io/cluster-issuer']
        delete data.metadata.annotations['cert-manager.io/renew-before']
        delete data.spec.tls
      } else {
        data.metadata.annotations['higress.io/ssl-redirect'] = 'false';
        data.metadata.annotations['w7.cc/ssl-redirect'] = 'false';
        data.metadata.annotations['cert-manager.io/cluster-issuer'] = 'w7-letsencrypt-prod';
        data.metadata.annotations['cert-manager.io/renew-before'] = '30m';
        data.spec.tls = [{
          hosts: [data.spec.rules[0].host],
          secretName: this.domainToname(data.spec.rules[0].host) + "-tls-secret"
        }]
      }
      return data
    },
    updateDomain(oldDomain, newDomain) {
      let postData = this.panelData.find(item => item?.spec?.rules?.[0]?.host === oldDomain.domain)
      if (!postData) {
        this.addDomain(newDomain)
        return
      }
      const [mainDomain, ...childDomains] = newDomain
      postData.spec.rules[0].host = mainDomain.domain
      postData = this.makeSSLInfo(postData, mainDomain.isSSL)
      postData.metadata.annotations['w7.cc/child-hosts'] = JSON.stringify(childDomains.map(childDomain => {
        return {
          name: this.createName(),
          host: childDomain.domain,
          autoSsl: childDomain.isSSL,
          sslRedirect: false
        }
      }))
      panelAxios.put("/apis/networking.k8s.io/v1/namespaces/default/ingresses/" + postData.metadata.name, postData).then(() => {
        this.getPanelDomainList();
      })
    },
    updateDomainChild(domain, child) {
      const postData = this.panelData.find(item => item?.spec?.rules?.[0]?.host === domain)
      const isSSL = this.tableData.find(item => item.domain === domain)?.isSSL
      if (!postData) {
        this.addDomain(domain, isSSL, child)
        return
      }
      postData.metadata.annotations['w7.cc/child-hosts'] = JSON.stringify(child.map(childDomain => {
        return {
          name: this.createName(),
          host: childDomain,
          autoSsl: isSSL,
          sslRedirect: false
        }
      }))
      panelAxios.put("/apis/networking.k8s.io/v1/namespaces/default/ingresses/" + postData.metadata.name, postData).then(() => {
        this.getPanelDomainList();
      })
    },
    removeDomain(index) {
      this.form.domain.splice(index, 1)
    },
    getVersionIdentifie(app_name, version) {
      return app_name + (version ? '_' + version.replace(/\./g, '') : '')
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
        this.getAppConfig(app_name).then(async res => {

          if (!res) { return }
          let data = res;
          const autoFillRules = this.getAutoFillRules(data)
          if (autoFillRules) {
            const siteManagerData = await this.getAppConfig((window.$wujie?.props?.group || window.$wujie?.props?.releaseName) + '-site-manager')
            data = fillData(data, autoFillRules, siteManagerData)
          }
          name = this.getVersionIdentifie(app_name, version).replace(/_/g, '-') + '-' + this.createName(4);

          data.metadata.name = name;
          data.metadata.labels.app = name;
          data.metadata.annotations['w7.cc/create-svc'] = 'true';
          data.metadata.annotations.title = name;

          data.metadata.annotations['w7.cc/image_used'] = 'true'



          data?.spec?.selector?.matchLabels && (data.spec.selector.matchLabels.app = name);
          data?.spec?.template?.metadata?.labels && (data.spec.template.metadata.labels.app = name);

          if (this.activeLang.share === false) {
            data = this.attachCommandToEnvironment(data)
          }

          data?.spec?.template?.spec?.containers?.[0]?.name && (data.spec.template.spec.containers[0].name = name)

          data?.spec?.template?.spec?.containers?.[0]?.image && (data.spec.template.spec.containers[0].image = this.activeLang.versionTemplate.replace('{version}', version))

          data.spec.template.spec.containers[0].env = data.spec.template.spec.containers[0].env.map(item => {
            if (item.name === 'METADATA_NAME') {
              return {
                name: 'METADATA_NAME',
                value: name
              }
            }
            return item
          })

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
    createEnvironment(data) {
      return myAxios.post('/api/environment/create', data)
    },
    clearOldEnvironmentAnnotation(appName) {
      return this.patchImageConfig(appName, {
        spec: {
          template: {
            metadata: {
              annotations: {
                'w7.cc/image_used': 'false',
                'w7.cc/debug_mode': 'false',
                'w7.cc/debug_mode_command_backup': '',
              }
            }
          }
        }

      })
    },
    attachCommandToEnvironment(config) {
      if (this.form.debug) {
        config.spec.template.spec.containers[0].command = ['sh', '-c', 'tail -f /dev/null']
        config.spec.template.metadata.annotations['w7.cc/debug_mode'] = 'true'
        config.spec.template.metadata.annotations['w7.cc/debug_mode_command_backup'] = this.form.command[2]
      } else {
        config.spec.template.spec.containers[0].command = this.form.command
        config.spec.template.metadata.annotations['w7.cc/debug_mode'] = 'false'
        config.spec.template.metadata.annotations['w7.cc/debug_mode_command_backup'] = ''
      }
      return config
    },
    storeDebugConfig(config) {
      return this.patchImageConfig(config.metadata.name, {
        spec: {
          template: {
            metadata: {
              annotations: {
                'w7.cc/image_used': 'true',
                'w7.cc/debug_mode': 'true',
                'w7.cc/debug_mode_command_backup': this.form.command[2],
              }
            }
          }
        }
      })
    },
    waitEnvironmentStarted(appName) {
      const deploymentName = appName.replace(/_/g, '-')

      return new Promise((resolve) => {
        const checkStatus = () => {
          Promise.allSettled([
            panelAxios.get('/apis/apps/v1/namespaces/default/deployments/' + deploymentName),
            getPods(deploymentName)
          ]).then(([deploymentRes, podRes]) => {
            const deployment = deploymentRes?.status === 'fulfilled' ? deploymentRes.value?.data : null
            const pods = podRes?.status === 'fulfilled' ? podRes.value?.data?.items || [] : []

            if (deployment && getEnvironmentStatus(deployment, pods) === 1) {
              resolve()
              return
            }

            setTimeout(checkStatus, 3000)
          })
        }

        checkStatus()
      })
    },
    onSubmit() {
      this.$refs.form.validate(async (valid) => {
        if (!valid) {
          return
        }
        this.submitLoading = true
        this.newEnvironmentStarting = !this.editId && this.isNewEnv

        try {
          let selectImage = this.images.find(item => item.id === this.form.environment_id)

          let preDomainList = []
          if (this.editId) {
            if (this.isNewEnv) {
              const name = await this.jobCopyEnv(this.activeLang.name + '-' + this.form.environment_id, this.activeLang.identifie, this.form.environment_id)
              selectImage = this.images.find(item => item.app_name === name)
              if (!selectImage) {
                throw new Error('创建环境失败')
              }
              this.form.environment_id = selectImage.id
            }
            let imageInfo = await this.getAppConfig(selectImage.app_name)
            preDomainList = [...this.tableData.find(item => item.id === this.editId).domain]
            const oldDomain = preDomainList[0]
            if (this.form.old_environment_id !== this.form.environment_id && this.activeLang.share === false) {
              const oldImage = this.allImages.find(item => item.id === this.form.old_environment_id)
              if (oldImage) {
                await this.clearOldEnvironmentAnnotation(oldImage.app_name)
              }
              if (!this.isNewEnv) {
                const name = await this.jobCopyEnv(selectImage.title, this.activeLang.identifie, selectImage.version)
                selectImage = this.allImages.find(item => item.app_name === name)
                if (!selectImage) {
                  throw new Error('创建环境失败')
                }
                this.form.environment_id = selectImage.id
              }
            } else if (this.activeLang.share === false) {
              imageInfo = this.attachCommandToEnvironment(imageInfo)
              await panelAxios.put("/apis/apps/v1/namespaces/default/deployments/" + selectImage.app_name.replace(/_/g, '-'), imageInfo)
            }
            await myAxios.post('/api/site/update', { id: this.editId, ...this.form, domain: this.form.domain.map(item => (item.isSSL ? 'https://' : 'http://') + item.domain) })
            this.$message.success('操作成功');
            this.getData(1, true);
            this.visible = false
            this.updateDomain(oldDomain, this.form.domain)
            this.reload()
            return
          }


          if (this.isNewEnv) {
            const name = await this.jobCopyEnv(this.activeLang.name + '-' + this.form.environment_id, this.activeLang.identifie, this.form.environment_id)
            selectImage = this.images.find(item => item.app_name === name)
            if (!selectImage) {
              throw new Error('创建环境失败')
            }
            this.form.environment_id = selectImage.id
            await this.waitEnvironmentStarted(selectImage.app_name)
          } else if (this.activeLang.share === false) {
            let imageInfo = await this.getAppConfig(selectImage.app_name)
            if (imageInfo?.spec?.template?.metadata?.annotations?.['w7.cc/image_used'] === 'true') {
              const name = await this.jobCopyEnv(selectImage.title, this.activeLang.identifie, selectImage.version)
              selectImage = this.images.find(item => item.app_name === name)
              if (!selectImage) {
                throw new Error('创建环境失败')
              }
              this.form.environment_id = selectImage.id
            } else {
              imageInfo = this.attachCommandToEnvironment(imageInfo)
              await panelAxios.put("/apis/apps/v1/namespaces/default/deployments/" + selectImage.app_name.replace(/_/g, '-'), imageInfo)
            }
          }



          await myAxios.post('/api/site/create', { ...this.form, domain: this.form.domain.map(item => (item.isSSL ? 'https://' : 'http://') + item.domain) })
          this.$message.success('操作成功');
          this.addDomain(this.form.domain, this.form.isSSL)
          this.getData(1, false);
          this.visible = false
          this.reload()
        } catch (error) {
          this.$message.error(error?.message || '操作失败')
        } finally {
          this.submitLoading = false
          this.newEnvironmentStarting = false
        }
      })
    },
    reload() {
      panelAxios.patch("/apis/apps/v1/namespaces/default/deployments/" + (window.$wujie?.props?.group || window.$wujie?.props?.releaseName) + '-site-manager-nginx', {
        spec: {
          template: {
            metadata: { labels: { reload: String(Date.now()) } }
          }
        }
      }, {
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
      })
    },
    patchImageConfig(image, data) {
      panelAxios.patch("/apis/apps/v1/namespaces/default/deployments/" + image.replace(/_/g, '-'), data, {
        headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
      })
    },
    async jobCopyEnv(title, identifie, version) {
      const name = await this.copy(identifie, version)
      if (!name) {
        throw new Error('创建环境失败')
      }
      await this.createEnvironment({
        title: title + '-副本',
        language: this.activeLang.language || this.activeLang.name,
        group: this.activeLang.group,
        nginx_vhost_template: this.activeLang.nginxTemplate,
        app_name: name,
        version
      })
      await this.getNamespace()
      return name
    },
    async edit(row) {
      this.loading = false
      this.editId = row.id
      this.tab = 'base'
      this.isNewEnv = false
      this.form.domain = JSON.parse(JSON.stringify(row.domain))
      this.form.root_dir = row.root_dir
      this.form.environment_id = row.environment_id
      this.form.old_environment_id = row.environment_id
      this.form.remark = row.remark
      await myAxios.post('/api/site-nginx/get-proxy-conf', { site_id: row.id }).then(res => {
        this.nginxConfig = res.data?.data?.nginx_vhost_conf
      })
      this.getNamespace().then(async () => {
        const res = await this.loadEnvStatus(row.environment_id)
        if (this.activeLang.share === false) {
          if (!res) {
            this.$message.error('站点环境服务丢失')
            return
          }
          this.form.debug = res?.spec?.template?.metadata?.annotations?.['w7.cc/debug_mode'] === 'true'
          this.form.command = this.form.debug ? ['sh', '-c', res?.spec?.template?.metadata?.annotations?.['w7.cc/debug_mode_command_backup']] : res?.spec?.template?.spec?.containers?.[0]?.command
          this.visible = true
        } else {
          this.visible = true
        }
      })
    },
    getSiteDetail(id) {
      return myAxios.post('/api/site/info', { id })
    },
    async del(row) {

      const detail = await this.getSiteDetail(row.id)
      const environment = detail.data?.data?.site_environment

      if (this.deleteSiteConfig && this.activeLang.share === false) {
        const imageData = await this.getAppConfig(environment.app_name)
        imageData.spec.template.spec.containers[0].command = ['sh', '-c', 'tail -f /dev/null']
        imageData.spec.template.metadata.annotations['w7.cc/debug_mode'] = 'true'
        imageData.spec.template.metadata.annotations['w7.cc/debug_mode_command_backup'] = ''
        await this.patchImageConfig(environment.app_name, imageData)
      }

      myAxios.post("/api/site/delete", { id: row.id, remove_root_dir: this.deleteSiteConfig }).then(res => {
        if (!res) {
          return
        }
        if(row.ext?.k8s_app_name){
          this.deleteApp(row.ext?.k8s_app_name)
        }
        this.patchImageConfig(environment.app_name, {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'w7.cc/image_used': 'false'
                }
              }
            }
          }
        })
        this.getData(1, true);
        ElMessage({
          message: '删除成功',
          type: 'success',
        })
        this.deleteDomain(row.domain[0].domain)
        this.reload()
      }).finally(() => {
        this.deleteSiteConfig = false
      })
    },
    async deleteApp(name){
      return panelAxios.delete("/apis/w7panel.w7.com/v1alpha1/namespaces/default/appgroups/" + name.replace(/_/g, '-'))
    }
  }
}
</script>
<style scoped></style>
