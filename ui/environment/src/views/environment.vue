<template>
    <div v-loading="loading" element-loading-text="数据加载中..." style="flex: 1;overflow: hidden">
        <template v-if="podName">
            <div>
                <div class="df" style="overflow: hidden;margin: 20px 20px 20px 0;">
                    <div class="w-200">
                        <el-tabs style="height: 100%" tab-position="left" @tab-change="handleTabChange" v-model="tab">
                            <template v-if="isPHP">
                                <el-tab-pane name="extensions" label="安装扩展"></el-tab-pane>
                                <el-tab-pane name="fpm" label="FPM配置"></el-tab-pane>
                                <el-tab-pane name="config_file" label="配置文件"></el-tab-pane>
                                <el-tab-pane name="config_modify" label="配置修改"></el-tab-pane>
                                <el-tab-pane name="performance" label="性能调整"></el-tab-pane>
                                <el-tab-pane name="disable_functions" label="禁用函数"></el-tab-pane>
                                <el-tab-pane name="access_log" label="日志"></el-tab-pane>
                                <el-tab-pane name="slow_log" label="慢日志"></el-tab-pane>
                                <el-tab-pane name="load_status" label="负载状态"></el-tab-pane>
                            </template>
                            <el-tab-pane name="custom_commands" label="自定义环境"></el-tab-pane>
                        </el-tabs>
                    </div>
                    <div style="flex: 1;padding-left: 20px;min-height: 490px;overflow: hidden;">
                        <Extensions ref="extensions" @silentBuild="silentBuildExtensions" @kill="kill"
                            @addExtensions="addExtensions" @removeExtension="removeExtension"
                            v-show="tab === 'extensions'"
                            v-if="['extensions', 'custom_commands'].includes(tab) && extensionsDir"
                            :extensionsDir="extensionsDir" :environment_id="editId" :name="containerName"
                            :podsName="podName" :hostIP="hostIP" :containerId="containerId" :version="version"
                            :allExtensions="allExtensions" :customExtensions="customExtensions" />
                        <Editor v-else-if="tab === 'fpm'" :key="tab" v-model:content="content" language="ini" />
                        <Editor v-else-if="tab === 'config_file'" :key="tab" v-model:content="iniContent"
                            language="ini" />
                        <div v-else-if="tab === 'config_modify'">
                            <el-form :model="iniSettings" label-width="200px">
                                <el-row :gutter="20">
                                    <el-col v-for="item in iniSettingDefs" :key="item.key" :span="item.span || 12">
                                        <el-form-item :label="item.label">
                                            <el-input v-if="item.type === 'text'" v-model="iniSettings[item.key]"
                                                :placeholder="item.placeholder || ''" />
                                            <el-select v-else-if="item.type === 'select'"
                                                v-model="iniSettings[item.key]" style="width: 100%;">
                                                <el-option v-for="option in item.options" :key="option" :label="option"
                                                    :value="option" />
                                            </el-select>
                                        </el-form-item>
                                    </el-col>
                                </el-row>
                            </el-form>
                        </div>
                        <div v-else-if="tab === 'performance'">
                            <el-form :model="performanceSettings" label-width="200px">
                                <el-row :gutter="20">
                                    <el-col v-for="item in performanceSettingDefs" :key="item.key" :span="24">
                                        <el-form-item :label="item.label">
                                            <div style="width: 200px">
                                                <el-input v-if="item.type === 'text'"
                                                    v-model="performanceSettings[item.key]"
                                                    :placeholder="item.placeholder || ''" />
                                                <el-select v-else-if="item.type === 'select'"
                                                    v-model="performanceSettings[item.key]" style="width: 100%;"
                                                    @change="item.key === 'memory_plan' ? adjustPerformanceByMemory($event) : null">
                                                    <el-option v-for="option in item.options" :key="option"
                                                        :label="option.label || option"
                                                        :value="option.value || option" />
                                                </el-select>
                                            </div>
                                        </el-form-item>
                                    </el-col>
                                </el-row>
                            </el-form>
                        </div>
                        <DisableFunctions v-else-if="tab === 'disable_functions'"
                            v-model:disableFunctions="disableFunctions" />
                        <div v-else-if="tab === 'access_log'" class="log-container">
                            <div class="log-header">
                                <div class="log-switch">
                                    <span>配置开关</span>
                                    <el-switch v-model="accessLogEnabled" @change="toggleAccessLog"
                                        :loading="accessLogSwitchLoading" />
                                </div>
                                <span class="log-path"></span>
                                <div class="log-actions">
                                    <el-button size="small" @click="loadAccessLog(true)"
                                        :loading="accessLogLoading">刷新</el-button>
                                    <el-input-number size="small" v-model="logLines" :min="50" :max="5000" :step="50"
                                        style="width: 120px; margin-left: 10px;" />
                                    <span style="margin-left: 5px; color: #999;">行</span>
                                </div>
                            </div>
                            <div class="log-content" ref="accessLogRef">
                                <pre>{{ accessLogContent || '暂无日志内容' }}</pre>
                            </div>
                        </div>
                        <div v-else-if="tab === 'slow_log'" class="log-container">
                            <div class="log-header">
                                <div class="log-switch">
                                    <span>配置开关</span>
                                    <el-switch v-model="slowLogEnabled" @change="toggleSlowLog"
                                        :loading="slowLogSwitchLoading" />
                                </div>
                                <span class="log-path"></span>
                                <div class="log-actions">
                                    <el-button size="small" @click="loadSlowLog(true)"
                                        :loading="slowLogLoading">刷新</el-button>
                                    <el-input-number size="small" v-model="logLines" :min="50" :max="5000" :step="50"
                                        style="width: 120px; margin-left: 10px;" />
                                    <span style="margin-left: 5px; color: #999;">行</span>
                                </div>
                            </div>
                            <div class="log-content" ref="slowLogRef">
                                <pre>{{ slowLogContent || '暂无慢日志内容' }}</pre>
                            </div>
                        </div>
                        <div v-if="tab === 'load_status'" class="load-status">
                            <div class="load-status-header">
                                <div class="log-switch">
                                    <span>配置开关</span>
                                    <el-switch v-model="loadStatusEnabled" @change="toggleLoadStatus"
                                        :loading="loadStatusSwitchLoading" />
                                </div>
                                <el-button size="small" @click="loadLoadStatus(true)"
                                    :loading="loadStatusLoading">刷新</el-button>
                            </div>
                            <el-descriptions label-width="200px" :column="1" border>
                                <el-descriptions-item label="应用池">{{ loadStatusContent.pool ?? '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="进程管理方式">{{ {
                                    static: '静态', dynamic: '动态', ondemand: '按需'
                                }[loadStatusContent['process manager']] ?? '-' }}</el-descriptions-item>
                                <el-descriptions-item label="启动日期">{{ loadStatusContent['start time'] ?? '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="请求数">{{ loadStatusContent['accepted conn'] ?? '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="请求队列">{{ loadStatusContent['listen queue'] ?? '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="最大等待队列">{{ loadStatusContent['max listen queue'] ?? '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="socket队列长度">{{ loadStatusContent['listen queue len'] ?? '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="空闲进程数量">{{ loadStatusContent['idle processes'] ?? '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="活跃进程数量">{{ loadStatusContent['active processes'] ?? '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="总进程数量">{{ loadStatusContent['total processes'] ?? '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="最大活跃进程数量">{{ loadStatusContent['max active processes'] ??
                                    '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="到达进程上限次数">{{ loadStatusContent['max children reached'] ??
                                    '-'
                                    }}</el-descriptions-item>
                                <el-descriptions-item label="慢请求数量">{{ loadStatusContent['slow requests'] ?? '-'
                                    }}</el-descriptions-item>
                            </el-descriptions>
                        </div>
                        <div v-if="tab === 'custom_commands'">
                            <el-alert type="primary" show-icon :closable="false" style="margin-bottom: 10px;">
                                <div>1.当前环境为 Alpine 系统，系统包管理工具使用示例:apk add --no-cache &lt;package_name&gt;</div>
                            </el-alert>
                            <el-input type="textarea" v-model="customCommands" :rows="10"></el-input>
                        </div>
                    </div>
                </div>
                <div class="df jc-c" style="margin-top: 20px">
                    <el-button type="primary" :loading="buildLoading" @click="saveCustomCommands"
                        v-if="tab === 'custom_commands'">保存</el-button>
                    <el-button type="primary" @click="saveConfig"
                        v-else-if="!['extensions', 'load_status', 'access_log', 'slow_log'].includes(tab)">保存</el-button>
                </div>
            </div>
        </template>
    </div>
</template>
<script>
import { defineAsyncComponent } from 'vue'
import Extensions from './extensions.vue';
import DisableFunctions from './disable-functions.vue';
import panelAxios from "@/utils/panel";
import { buildSedUpdateCommand, buildWriteFileCommand } from "@/utils/shell";
import { reloadEnvironment } from './utils'
import { applyEnvironmentBuildImage } from "./json";
const Editor = defineAsyncComponent(() => import('./editor.vue'))
export default {
    name: 'EnvironmentView',
    components: {
        Editor,
        Extensions,
        DisableFunctions
    },
    beforeUnmount() {
        clearInterval(this.podPollTimer)
    },
    data() {
        const numberFormat = (value) => parseInt(value) || 0
        const iniSettingDefs = [
            { key: 'short_open_tag', label: '短标签支持', type: 'select', options: ['On', 'Off'], default: 'On' },
            { key: 'max_execution_time', label: '最大脚本运行时间', type: 'text', value: 30, placeholder: '例如 30', format: numberFormat },
            { key: 'max_input_time', label: '最大输入时间', type: 'text', value: 60, placeholder: '例如 60', format: numberFormat },
            { key: 'memory_limit', label: '脚本内存限制', type: 'text', value: 128, placeholder: '例如 128M', format: numberFormat },
            { key: 'post_max_size', label: 'POST数据最大尺寸', type: 'text', placeholder: '例如 64M' },
            { key: 'file_uploads', label: '是否允许上传文件', type: 'select', options: ['On', 'Off'], default: 'On' },
            { key: 'upload_max_filesize', label: '允许上传文件的最大尺寸', type: 'text', placeholder: '例如 64M' },
            { key: 'max_file_uploads', label: '允许同时上传文件的最大数量', type: 'text', placeholder: '例如 20' },
            { key: 'default_socket_timeout', label: 'Socket超时时间', type: 'text', placeholder: '例如 60' },
            { key: 'max_input_vars', label: '最大输入变量', type: 'text', placeholder: '例如 1000' },
            { key: 'error_reporting', label: '错误级别', type: 'text', placeholder: '例如 E_ALL & ~E_DEPRECATED & ~E_STRICT', span: 24 },
            { key: 'display_errors', label: '是否输出详细错误信息', type: 'select', options: ['On', 'Off'], default: 'On' },
            { key: 'cgi.fix_pathinfo', label: '是否开启pathinfo', type: 'select', options: ['On', 'Off'], default: 'On' },
            { key: 'date.timezone', label: '时区', type: 'text', placeholder: '例如 Asia/Shanghai' },
        ]
        const performanceSettingDefs = [
            { key: 'memory_plan', label: '并发方案', type: 'select', options: ['1', '2', '4', '8', '16', '32'].map(item => ({ label: item + 'GB内存', value: item })), default: '2', span: 24 },
            { key: 'pm', label: '运行模式', type: 'select', options: [{ label: '静态', value: 'static' }, { label: '动态', value: 'dynamic' }, { label: '按需', value: 'ondemand' }], default: 'dynamic', span: 24 },
            { key: 'pm_max_children', label: '最大子进程数', type: 'text', placeholder: '例如 5' },
            { key: 'pm_start_servers', label: '起始进程数', type: 'text', placeholder: '例如 2' },
            { key: 'pm_min_spare_servers', label: '最小空闲进程数', type: 'text', placeholder: '例如 1' },
            { key: 'pm_max_spare_servers', label: '最大空闲进程数', type: 'text', placeholder: '例如 3' }
        ]
        const iniSettings = {}
        iniSettingDefs.forEach(item => {
            iniSettings[item.key] = item.default || ''
        })

        const defaultFpmSettings = {
            access_log: '/var/log/php-fpm/access.log',
            access_format: '',
            slowlog: '/var/log/php-fpm/slow.log',
            request_slowlog_timeout: '5s',
            pm_status_path: '/status',
            pm: 'dynamic',
            pm_max_children: '5',
            pm_start_servers: '2',
            pm_min_spare_servers: '1',
            pm_max_spare_servers: '3',
        }
        return {
            loadStatusContent: {},
            loading: true,
            version: '8.0',
            containerName: '',
            podName: '',
            imageName: '',
            tab: 'custom_commands',
            content: '',
            editId: 0,
            hostIP: '',
            containerId: '',
            pushImageName: '',
            extensionsDir: '',
            iniContent: '',
            iniSettingDefs,
            iniSettings,
            performanceSettingDefs,
            disableFunctions: '',
            performanceSettings: {
                pm: defaultFpmSettings.pm,
                memory_plan: '1',
                pm_max_children: defaultFpmSettings.pm_max_children,
                pm_start_servers: defaultFpmSettings.pm_start_servers,
                pm_min_spare_servers: defaultFpmSettings.pm_min_spare_servers,
                pm_max_spare_servers: defaultFpmSettings.pm_max_spare_servers,
            },
            defaultFpmSettings,
            accessLogContent: '',
            accessLogLoading: false,
            slowLogContent: '',
            slowLogLoading: false,
            slowLogEnabled: false,
            slowLogSwitchLoading: false,
            accessLogEnabled: false,
            accessLogSwitchLoading: false,
            loadStatusEnabled: false,
            loadStatusSwitchLoading: false,
            loadStatusLoading: false,
            fpmConfigContentCache: '',
            fpmConfigContentLoaded: false,
            logLines: 200,
            allExtensions: [],
            customExtensions: [],
            appName: '',
            customCommands: '',
            isPHP: false,
            podPollTimer: null,
            podPollStartedAt: 0,
            podPollTimeoutMs: 180000,
            buildLoading: false,
            silentBuildCallback: null,
            currentImageName: '',
        }
    },
    async created() {
        if (process.env.NODE_ENV === 'development') {
            this.containerName = 'copy-cnae-w7-php-74'
            this.imageName = 'php:7.4-fpm-alpine-1769073749'
            this.version = '7.4'
        } else {
            this.containerName = this.$route.params.containerName
            let imageName = this.$route.params.imageName.replace(/W7IMAGENAMESLASH/g, "/").replace(/woyouyitouxiaomaolv/g, "/")
            this.currentImageName = imageName

            if (imageName.includes('registry.local.w7.cc')) {
                imageName = imageName.replace('registry.local.w7.cc/', '')
                imageName = imageName.replace(/-\d+$/, '')
            }
            this.imageName = imageName
            this.version = this.$route.params.version
        }

        try {
            await this.getYamlInfo()
            await this.getAppYamlInfo()
            const res = await this.getDefaultPod()
            const pod = this.findDefaultPod(res.data?.items || [])
            if (!pod) {
                this.$message.error("获取默认Pod失败")
                return
            }
            this.updatePodInfo(pod)
            this.loading = false
            if (this.isPHP) {
                this.getExtensionsDir()
            }
        } catch {
            this.$message.error("获取默认Pod失败")
        } finally {
            this.loading = false
        }
    },
    methods: {
        async addExtensions(form) {
            this.customExtensions = [...this.customExtensions, form]
            try {
                await this.changeContainerYaml('custom_php_extensions', JSON.stringify(this.customExtensions))
                this.build()
            } catch {
                this.customExtensions = this.customExtensions.filter(item => item.name !== form.name)
                this.$message.error('保存扩展配置失败')
            }
        },
        async removeExtension(extension) {
            const nextExtensions = this.customExtensions.filter(item => item.name !== extension)
            const previousExtensions = this.customExtensions
            this.customExtensions = nextExtensions
            try {
                await this.changeContainerYaml('custom_php_extensions', JSON.stringify(nextExtensions))
                this.build()
            } catch {
                this.customExtensions = previousExtensions
                this.$message.error('保存扩展配置失败')
            }
        },
        getExtensionsDir() {
            panelAxios.exec(this.containerName, this.podName, "php-config --extension-dir").then(res => {
                this.extensionsDir = res.data.trim()
            })
        },
        getAppYamlInfo() {
            return panelAxios.get(`/apis/apps/v1/namespaces/default/deployments/${this.appName}`).then(res => {
                this.allExtensions = res.data.spec.template.metadata.annotations['w7.cc/php_extensions']
                this.isPHP = res.data.spec.template.metadata.annotations['w7.cc/image_language'] === 'php'
                this.tab = this.isPHP ? 'extensions' : 'custom_commands'
            })
        },
        saveCustomCommands() {
            this.changeContainerYaml('dockerfile_custom_commands', this.customCommands).then(() => {
                this.build()
            }).catch(() => {
                this.$message.error('保存失败')
            })
        },
        getYamlInfo() {
            return this.getContainerYaml().then(res => {
                this.pushImageName = res.data.metadata.annotations['w7.cc/push-image-name']
                this.customCommands = res.data.metadata.annotations['w7.cc/dockerfile_custom_commands'] || ''
                this.customExtensions = res.data.metadata.annotations['w7.cc/custom_php_extensions'] ? JSON.parse(res.data.metadata.annotations['w7.cc/custom_php_extensions']) : []
                this.appName = res.data.metadata.annotations['w7.cc/group-name']
            })
        },
        kill() {
            this.getDefaultPod().then(res => {
                const items = res.data?.items || []
                panelAxios.execall(this.containerName, items.map(item => item.metadata.name), "kill -USR2 1")
            })
        },
        getContainerYaml() {
            return panelAxios.get(`/apis/apps/v1/namespaces/default/deployments/${this.containerName}`)
        },
        changeContainerYaml(key, value) {
            return panelAxios.patch(`/apis/apps/v1/namespaces/default/deployments/${this.containerName}`, {
                "metadata": {
                    "annotations": {
                        ['w7.cc/' + key]: value
                    }
                }
            }, {
                headers: { 'Content-Type': 'application/strategic-merge-patch+json' },
            })
        },
        normalizeDisableFunctions(value) {
            if (!value) {
                return ''
            }
            return value
                .split(/[\n,]+/)
                .map(item => item.trim())
                .filter(Boolean)
                .join(',')
        },
        parseIniOutput(output) {
            const data = {}
            output.split('\n').forEach(line => {
                if (!line) {
                    return
                }
                const [key, ...rest] = line.split('|')
                data[key] = rest.join('|')
            })
            return data
        },
        parseFpmOutput(output) {
            const data = {}
            output.split('\n').forEach(line => {
                if (!line) {
                    return
                }
                const [key, state, ...rest] = line.split('|')
                data[key] = {
                    state,
                    value: rest.join('|')
                }
            })
            return data
        },
        invalidateFpmConfigCache() {
            this.fpmConfigContentCache = ''
            this.fpmConfigContentLoaded = false
        },
        getFpmConfigContent(force = false) {
            if (!force && this.fpmConfigContentLoaded) {
                return Promise.resolve(this.fpmConfigContentCache)
            }
            return panelAxios.exec(this.containerName, this.podName, 'cat /usr/local/etc/php-fpm.d/www.conf').then(res => {
                this.fpmConfigContentCache = res.data || ''
                this.fpmConfigContentLoaded = true
                return this.fpmConfigContentCache
            })
        },
        loadFpmContent() {
            this.getFpmConfigContent(true).then(content => {
                this.content = content
            })
        },
        loadPhpIniContent() {
            const command = 'if [ -s /usr/local/etc/php/php.ini ]; then cat /usr/local/etc/php/php.ini; else cat /usr/local/etc/php/php.ini-production; fi'
            panelAxios.exec(this.containerName, this.podName, command).then(res => {
                this.iniContent = res.data || ''
            })
        },
        loadIniSettings() {
            const keys = this.iniSettingDefs.map(item => item.key)
            const keyLines = keys.map(key => `keys["${key}"]=1;`).join(' ')
            const command = `FILE=/usr/local/etc/php/php.ini; if [ ! -s "$FILE" ]; then FILE=/usr/local/etc/php/php.ini-production; fi; awk -F'=' 'BEGIN{${keyLines}} {line=$0; sub(/^[ \\t]+/, "", line); if (line ~ /^;/) {sub(/^;/, "", line)} split(line, parts, "="); key=parts[1]; gsub(/[ \\t]+$/, "", key); keyLower=tolower(key); if (keyLower in keys) { if (!(keyLower in found)) { value=line; sub(/^[^=]*=/, "", value); gsub(/^[ \\t]+|[ \\t]+$/, "", value); print keyLower "|" value; found[keyLower]=1 } } } END{for (k in keys) if (!(k in found)) print k "|"}' "$FILE"`
            panelAxios.exec(this.containerName, this.podName, command).then(res => {
                const parsed = this.parseIniOutput(res.data || '')
                this.iniSettingDefs.forEach(item => {
                    if (parsed[item.key] !== undefined && parsed[item.key] !== '') {
                        this.iniSettings[item.key] = parsed[item.key]
                    }
                })
            })
        },
        loadDisableFunctions() {
            const command = `FILE=/usr/local/etc/php/php.ini; if [ ! -s "$FILE" ]; then FILE=/usr/local/etc/php/php.ini-production; fi; awk -F'=' '{line=$0; sub(/^[ \\t]+/, "", line); if (line ~ /^;/) {sub(/^;/, "", line)} split(line, parts, "="); key=parts[1]; gsub(/[ \\t]+$/, "", key); if (tolower(key) == "disable_functions") { value=line; sub(/^[^=]*=/, "", value); gsub(/^[ \\t]+|[ \\t]+$/, "", value); print value; exit } }' "$FILE"`
            panelAxios.exec(this.containerName, this.podName, command).then(res => {
                this.disableFunctions = res.data ? res.data.trim() : ''
            })
        },
        loadFpmSettings() {
            const keys = [
                'access.log',
                'access.format',
                'slowlog',
                'request_slowlog_timeout',
                'pm.status_path',
                'pm',
                'pm.max_children',
                'pm.start_servers',
                'pm.min_spare_servers',
                'pm.max_spare_servers',
                'pm.max_requests',
                'process.priority'
            ]
            const keyLines = keys.map(key => `keys["${key}"]=1;`).join(' ')
            const command = `FILE=/usr/local/etc/php-fpm.d/www.conf; if [ ! -f "$FILE" ]; then exit 0; fi; awk -F'=' 'BEGIN{${keyLines}} {line=$0; sub(/^[ \\t]+/, "", line); commented=(line ~ /^;/); if (commented) {sub(/^;/, "", line)} split(line, parts, "="); key=parts[1]; gsub(/[ \\t]+$/, "", key); keyLower=tolower(key); if (keyLower in keys) { if (!(keyLower in found)) { value=line; sub(/^[^=]*=/, "", value); gsub(/^[ \\t]+|[ \\t]+$/, "", value); state=commented ? "commented" : "active"; print keyLower "|" state "|" value; found[keyLower]=1 } } } END{for (k in keys) if (!(k in found)) print k "|missing|"}' "$FILE"`
            panelAxios.exec(this.containerName, this.podName, command).then(res => {
                const parsed = this.parseFpmOutput(res.data || '')

                const setValue = (key, targetKey, fallback) => {
                    if (parsed[key]?.value) {
                        this.performanceSettings[targetKey] = parsed[key].value
                    } else if (fallback !== undefined) {
                        this.performanceSettings[targetKey] = fallback
                    }
                }
                setValue('pm', 'pm', this.defaultFpmSettings.pm)
                setValue('pm.max_children', 'pm_max_children', this.defaultFpmSettings.pm_max_children)
                setValue('pm.start_servers', 'pm_start_servers', this.defaultFpmSettings.pm_start_servers)
                setValue('pm.min_spare_servers', 'pm_min_spare_servers', this.defaultFpmSettings.pm_min_spare_servers)
                setValue('pm.max_spare_servers', 'pm_max_spare_servers', this.defaultFpmSettings.pm_max_spare_servers)
            })
        },
        adjustPerformanceByMemory(memory) {
            const memoryConfig = {
                '1': { max_children: 30, start: 5, min: 5, max: 20 },
                '2': { max_children: 50, start: 5, min: 5, max: 30 },
                '4': { max_children: 80, start: 10, min: 10, max: 30 },
                '8': { max_children: 120, start: 10, min: 10, max: 30 },
                '16': { max_children: 200, start: 15, min: 15, max: 50 },
                '32': { max_children: 300, start: 20, min: 20, max: 50 }
            }
            const config = memoryConfig[memory]
            if (config) {
                this.performanceSettings.pm_max_children = String(config.max_children)
                this.performanceSettings.pm_start_servers = String(config.start)
                this.performanceSettings.pm_min_spare_servers = String(config.min)
                this.performanceSettings.pm_max_spare_servers = String(config.max)
            }
        },
        build(options = {}) {
            this.buildLoading = true
            this.silentBuildCallback = options.onComplete || null
            const pushImageName = applyEnvironmentBuildImage('registry.local.w7.cc', this.imageName);
            this.pushImageName = pushImageName
            window.$wujie.bus.$emit('buildContainerImage', {
                podName: this.podName,
                cmd: (this.customCommands ? "sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories; " + this.customCommands + ';' : '') + (options.installCommand || ''),
                containerName: this.containerName,
                imageName: pushImageName,
                updateImage: true
            }, () => {
                this.currentImageName = this.pushImageName
                setTimeout(() => {
                    this.pollRunningDefaultPod(true)
                }, 3000)
            }, () => {
                reloadEnvironment(this.containerName.replace(/_/g, '-'))
                this.pushImageName = this.currentImageName
                setTimeout(async () => {
                    this.pollRunningDefaultPod(false)
                }, 3000)

            })
        },
        getDefaultPod() {
            return panelAxios.get("/api/v1/namespaces/default/pods?labelSelector=app=" + this.containerName)
        },
        getTargetContainerSpec(pod) {
            return pod?.spec?.containers?.find(item => item.name === this.containerName)
                || pod?.spec?.containers?.[0]
                || null
        },
        getTargetContainerStatus(pod) {
            return pod?.status?.containerStatuses?.find(item => item.name === this.containerName)
                || pod?.status?.containerStatuses?.[0]
                || null
        },
        findDefaultPod(items = []) {
            const activePods = items.filter(item => !item?.metadata?.deletionTimestamp)
            const runningPod = activePods.find(item => {
                const containerStatus = this.getTargetContainerStatus(item)
                return item?.status?.phase === 'Running' && containerStatus?.ready
            })
            if (runningPod) {
                return runningPod
            }
            return activePods.find(item => item?.status?.phase === 'Running')
                || activePods[0]
                || null
        },
        findRunningPod(items = []) {
            return items.find(item => {
                const container = this.getTargetContainerSpec(item)
                const containerStatus = this.getTargetContainerStatus(item)
                return container?.image === this.pushImageName
                    && item?.status?.phase === 'Running'
                    && containerStatus?.ready
                    && !item?.metadata?.deletionTimestamp
            })
        },
        updatePodInfo(pod) {
            this.podName = pod?.metadata?.name || ''
            this.containerId = this.getTargetContainerStatus(pod)?.containerID || ''
            this.hostIP = pod?.status?.hostIP || ''
        },
        pollRunningDefaultPod(result = true) {
            clearInterval(this.podPollTimer)
            this.podPollStartedAt = Date.now()

            const finishPoll = (success, message) => {
                clearInterval(this.podPollTimer)
                this.podPollTimer = null
                this.buildLoading = false
                if (this.isPHP) {
                    this.editId++
                }
                if (success) {
                    this.$message.success(message || '镜像构建成功')
                } else {
                    this.$message.error(message || '镜像构建失败')
                }
                if (this.silentBuildCallback) {
                    this.silentBuildCallback(success)
                    this.silentBuildCallback = null
                }
            }

            const syncPod = () => {
                if (Date.now() - this.podPollStartedAt > this.podPollTimeoutMs) {
                    finishPoll(false, result ? '等待容器启动超时' : '等待容器恢复超时')
                    return
                }
                this.getDefaultPod().then(res => {
                    const runningPod = this.findRunningPod(res.data?.items || [])
                    if (!runningPod) {
                        return
                    }
                    this.updatePodInfo(runningPod)
                    finishPoll(result)
                }).catch(() => {})
            }

            syncPod()
            this.podPollTimer = setInterval(syncPod, 2000)
        },
        handleTabChange(name) {
            if (!this.podName) {
                return
            }
            const tabLoaders = {
                fpm: this.loadFpmContent,
                config_file: this.loadPhpIniContent,
                config_modify: this.loadIniSettings,
                disable_functions: this.loadDisableFunctions,
                performance: this.loadFpmSettings,
                access_log: this.loadAccessLog,
                slow_log: this.loadSlowLog,
                load_status: this.loadLoadStatus
            }
            tabLoaders[name]?.call(this)
        },
        parseLogPathFromFpm(output, key) {
            const lines = output.split('\n')
            for (const line of lines) {
                const trimmed = line.trim()
                if (trimmed.startsWith(';')) continue
                if (trimmed.toLowerCase().startsWith(key.toLowerCase())) {
                    const match = trimmed.match(/=\s*(.+)/)
                    if (match) {
                        return match[1].trim()
                    }
                }
            }
            return ''
        },
        checkConfigEnabled(content, key) {
            const lines = content.split('\n')
            const escapedKey = key.replace(/\./g, '\\.')
            const activePattern = new RegExp(`^\\s*${escapedKey}\\s*=`, 'i')
            const commentedPattern = new RegExp(`^\\s*;\\s*${escapedKey}\\s*=`, 'i')

            for (const line of lines) {
                if (activePattern.test(line)) {
                    return true
                }
                if (commentedPattern.test(line)) {
                    return false
                }
            }
            return false
        },
        executeFpmToggleCommand({ cmd, value, loadingKey, enabledKey, successText, failureText, reload }) {
            this[loadingKey] = true
            return panelAxios.exec(this.containerName, this.podName, cmd).then(() => {
                this.$message.success(value ? successText.enabled : successText.disabled)
                this.invalidateFpmConfigCache()
                this.kill()
                reload()
            }).catch(() => {
                this.$message.error(failureText)
                this[enabledKey] = !value
            }).finally(() => {
                this[loadingKey] = false
            })
        },
        toggleAccessLog(value) {
            const fpmConfFile = '/usr/local/etc/php-fpm.d/www.conf'
            const defaultErrorLog = '/var/log/error.log'

            let cmd
            if (value) {
                cmd = `
                    if ! grep -q "^\\[global\\]" ${fpmConfFile}; then
                        sed -i "1i[global]\\nerror_log = ${defaultErrorLog}\\n" ${fpmConfFile}
                    else
                        if grep -q "^[[:space:]]*;[[:space:]]*error_log[[:space:]]*=" ${fpmConfFile}; then
                            sed -i "s/^[[:space:]]*;[[:space:]]*\\(error_log[[:space:]]*=\\)/\\1/" ${fpmConfFile}
                        elif ! grep -q "^[[:space:]]*error_log[[:space:]]*=" ${fpmConfFile}; then
                            sed -i "/^\\[global\\]/a error_log = ${defaultErrorLog}" ${fpmConfFile}
                        fi
                    fi
                `
            } else {
                cmd = `
                    sed -i "s/^[[:space:]]*\\(error_log[[:space:]]*=\\)/;\\1/" ${fpmConfFile}
                `
            }

            this.executeFpmToggleCommand({
                cmd,
                value,
                loadingKey: 'accessLogSwitchLoading',
                enabledKey: 'accessLogEnabled',
                successText: { enabled: '日志已开启', disabled: '日志已关闭' },
                failureText: '配置修改失败',
                reload: () => this.loadAccessLog(true)
            })
        },
        toggleSlowLog(value) {
            const wwwConfFile = '/usr/local/etc/php-fpm.d/www.conf'
            const defaultSlowlog = '/var/log/www.log.slow'
            const defaultTimeout = '5s'

            let cmd
            if (value) {
                cmd = `
                    sed -i "s/^[[:space:]]*;[[:space:]]*\\(slowlog[[:space:]]*=\\)/\\1/" ${wwwConfFile}
                    sed -i "s/^[[:space:]]*;[[:space:]]*\\(request_slowlog_timeout[[:space:]]*=\\)/\\1/" ${wwwConfFile}
                    if ! grep -q "^[[:space:]]*slowlog[[:space:]]*=" ${wwwConfFile}; then
                        echo "slowlog = ${defaultSlowlog}" >> ${wwwConfFile}
                    fi
                    if ! grep -q "^[[:space:]]*request_slowlog_timeout[[:space:]]*=" ${wwwConfFile}; then
                        echo "request_slowlog_timeout = ${defaultTimeout}" >> ${wwwConfFile}
                    fi
                `
            } else {
                cmd = `
                    sed -i "s/^[[:space:]]*\\(slowlog[[:space:]]*=\\)/;\\1/" ${wwwConfFile}
                    sed -i "s/^[[:space:]]*\\(request_slowlog_timeout[[:space:]]*=\\)/;\\1/" ${wwwConfFile}
                `
            }

            this.executeFpmToggleCommand({
                cmd,
                value,
                loadingKey: 'slowLogSwitchLoading',
                enabledKey: 'slowLogEnabled',
                successText: { enabled: '慢日志已开启', disabled: '慢日志已关闭' },
                failureText: '配置修改失败',
                reload: () => this.loadSlowLog(true)
            })
        },
        toggleLoadStatus(value) {
            const wwwConfFile = '/usr/local/etc/php-fpm.d/www.conf'
            const defaultStatusPath = '/status'

            let cmd
            if (value) {
                cmd = `
                    sed -i "s/^[[:space:]]*;[[:space:]]*\\(pm\\.status_path[[:space:]]*=\\)/\\1/" ${wwwConfFile}
                    if ! grep -q "^[[:space:]]*pm\\.status_path[[:space:]]*=" ${wwwConfFile}; then
                        echo "pm.status_path = ${defaultStatusPath}" >> ${wwwConfFile}
                    fi
                `
            } else {
                cmd = `
                    sed -i "s/^[[:space:]]*\\(pm\\.status_path[[:space:]]*=\\)/;\\1/" ${wwwConfFile}
                `
            }

            this.executeFpmToggleCommand({
                cmd,
                value,
                loadingKey: 'loadStatusSwitchLoading',
                enabledKey: 'loadStatusEnabled',
                successText: { enabled: '负载状态已开启', disabled: '负载状态已关闭' },
                failureText: '配置修改失败',
                reload: () => this.loadLoadStatus(true)
            })
        },
        loadLoadStatus(force = false) {
            this.loadStatusLoading = true
            this.getFpmConfigContent(force).then(fpmContent => {
                this.loadStatusEnabled = this.checkConfigEnabled(fpmContent, 'pm.status_path')

                panelAxios.exec(this.containerName, this.podName, String.raw`php -r '
            $host = "127.0.0.1";
            $port = 9000;
            $path = "/status";
            $fp = fsockopen($host, $port, $errno, $errstr, 2);
            if (!$fp) die(json_encode(["error" => $errstr]));
            $params = "";
            $paramsData = ["SCRIPT_NAME" => $path, "SCRIPT_FILENAME" => $path, "REQUEST_METHOD" => "GET", "QUERY_STRING" => ""];
            foreach ($paramsData as $k => $v) {
            $params .= chr(strlen($k)) . chr(strlen($v)) . $k . $v;
            }
            fwrite($fp, "\x01\x01\x00\x01\x00\x08\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00");
            fwrite($fp, "\x01\x04\x00\x01" . pack("n", strlen($params)) . "\x00\x00" . $params);
            fwrite($fp, "\x01\x04\x00\x01\x00\x00\x00\x00\x01\x05\x00\x01\x00\x00\x00\x00");
            $res = "";
            stream_set_timeout($fp, 2);
            while (!feof($fp)) $res .= fread($fp, 8192);
            fclose($fp);
            if (empty($res)) {
            echo json_encode([], JSON_PRETTY_PRINT);
            exit;
            }
            $text = "";
            for ($i = 0; $i < strlen($res); $i++) {
            $char = $res[$i];
            $ord = ord($char);
            if ($ord >= 32 || $ord == 10 || $ord == 13 || $ord == 9) {
            $text .= $char;
            }
            }
            function textToJson($newText) {
            $lines = explode("\n", trim($newText));
            $result = [];
            foreach ($lines as $line) {
            $line = trim($line);
            if (empty($line) || strpos($line, ":") === false) continue;
            list($key, $value) = explode(":", $line, 2);
            $key = trim($key);
            $value = trim($value);
            if ($value === "yes") {
            $value = true;
            } elseif ($value === "no") {
            $value = false;
            } elseif (is_numeric($value)) {
            if ((string)(int)$value === $value) {
            $value = (int)$value;
            } else {
            $value = (float)$value;
            }
            }
            $result[$key] = $value;
            }
            return $result;
            }
            if (($pos = strpos($text, "pool:")) !== false) {
            echo json_encode(textToJson(substr($text, $pos)), JSON_PRETTY_PRINT);
            } else {
            echo json_encode([], JSON_PRETTY_PRINT);
            }'`).then(res => {
                    this.loadStatusContent = res.data || {}
                    if (this.loadStatusContent['start time']) {
                        const utcDate = new Date(this.loadStatusContent['start time'].replace(':', ' ').replace('/', ' '));
                        this.loadStatusContent['start time'] = utcDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
                    }
                    this.loadStatusLoading = false
                }).catch(() => {
                    this.loadStatusContent = {}
                    this.loadStatusLoading = false
                })
            }).catch(() => {
                this.loadStatusLoading = false
            })
        },
        scrollLogToBottom(refName) {
            this.$nextTick(() => {
                const logRef = this.$refs[refName]
                if (logRef) {
                    logRef.scrollTop = logRef.scrollHeight
                }
            })
        },
        loadFpmLog(options, force = false) {
            this[options.loadingKey] = true
            return this.getFpmConfigContent(force).then(fpmContent => {
                let logPath = this.parseLogPathFromFpm(fpmContent, options.pathKey)
                if (options.normalizePath) {
                    logPath = options.normalizePath(logPath)
                }
                this[options.enabledKey] = options.isEnabled
                    ? options.isEnabled(fpmContent)
                    : this.checkConfigEnabled(fpmContent, options.pathKey)
                if (!logPath) {
                    this[options.contentKey] = options.emptyPathMessage
                    return null
                }
                return panelAxios.exec(this.containerName, this.podName, `tail -n ${this.logLines} ${logPath} 2>&1 || echo '${options.unreadableText}'`).then(logRes => {
                    this[options.contentKey] = options.formatContent
                        ? options.formatContent(logRes.data)
                        : (logRes.data || options.emptyContent)
                    this.scrollLogToBottom(options.refName)
                }).catch(() => {
                    this[options.contentKey] = options.readErrorMessage
                })
            }).catch(() => {
                this[options.contentKey] = options.configErrorMessage
            }).finally(() => {
                this[options.loadingKey] = false
            })
        },
        loadAccessLog(force = false) {
            return this.loadFpmLog({
                pathKey: 'error_log',
                enabledKey: 'accessLogEnabled',
                loadingKey: 'accessLogLoading',
                contentKey: 'accessLogContent',
                refName: 'accessLogRef',
                emptyPathMessage: '日志路径未在FPM配置中设置，请开启日志功能',
                emptyContent: '暂无日志内容',
                unreadableText: '无法读取日志文件',
                readErrorMessage: '读取日志文件失败',
                configErrorMessage: '获取FPM配置失败'
            }, force)
        },
        loadSlowLog(force = false) {
            return this.loadFpmLog({
                pathKey: 'slowlog',
                enabledKey: 'slowLogEnabled',
                loadingKey: 'slowLogLoading',
                contentKey: 'slowLogContent',
                refName: 'slowLogRef',
                emptyPathMessage: '慢日志路径未在FPM配置中设置',
                emptyContent: '暂无慢日志内容',
                unreadableText: '无法读取慢日志文件',
                readErrorMessage: '读取慢日志文件失败',
                configErrorMessage: '获取FPM配置失败',
                normalizePath: (path) => {
                    const normalizedPath = path.replace('$pool', 'www')
                    return normalizedPath.startsWith('log') ? '/var/' + normalizedPath : normalizedPath
                },
                isEnabled: (fpmContent) => {
                    return this.checkConfigEnabled(fpmContent, 'slowlog') && this.checkConfigEnabled(fpmContent, 'request_slowlog_timeout')
                },
                formatContent: (content) => {
                    return content?.includes('无法读取慢日志文件') ? '暂无慢日志内容' : content
                }
            }, force)
        },
        executeSaveCommand(cmd, options = {}) {
            return panelAxios.exec(this.containerName, this.podName, cmd).then(() => {
                this.$message.success('保存成功')
                options.onSuccess?.()
                this.kill()
            }).catch(() => {
                this.$message.error('保存失败')
            })
        },
        getSaveConfigCommand() {
            if (this.tab === 'fpm') {
                return {
                    cmd: buildWriteFileCommand('/usr/local/etc/php-fpm.d/www.conf', this.content),
                    onSuccess: () => {
                        this.fpmConfigContentCache = this.content
                        this.fpmConfigContentLoaded = true
                    }
                }
            }
            if (this.tab === 'config_file') {
                return {
                    cmd: buildWriteFileCommand('/usr/local/etc/php/php.ini', this.iniContent)
                }
            }
            if (this.tab === 'config_modify') {
                const entries = this.iniSettingDefs.filter(item => this.iniSettings[item.key]).map(item => ({
                    key: item.key,
                    value: this.iniSettings[item.key]
                }))
                const sedCmd = buildSedUpdateCommand('php.ini', entries)
                return {
                    cmd: 'cd /usr/local/etc/php; if [ ! -s php.ini ]; then cp php.ini-production php.ini; fi; ' + sedCmd
                }
            }
            if (this.tab === 'disable_functions') {
                const value = this.normalizeDisableFunctions(this.disableFunctions)
                const sedCmd = buildSedUpdateCommand('/usr/local/etc/php/php.ini', [{
                    key: 'disable_functions',
                    value
                }])
                return {
                    cmd: 'if [ ! -s /usr/local/etc/php/php.ini ]; then cp /usr/local/etc/php/php.ini-production /usr/local/etc/php/php.ini; fi; ' + sedCmd
                }
            }
            if (this.tab === 'performance') {
                const entries = [
                    { key: 'pm', value: this.performanceSettings.pm },
                    { key: 'pm.max_children', value: this.performanceSettings.pm_max_children },
                    { key: 'pm.start_servers', value: this.performanceSettings.pm_start_servers },
                    { key: 'pm.min_spare_servers', value: this.performanceSettings.pm_min_spare_servers },
                    { key: 'pm.max_spare_servers', value: this.performanceSettings.pm_max_spare_servers },
                ].filter(item => item.value !== undefined && item.value !== '')
                const sedCmd = buildSedUpdateCommand('/usr/local/etc/php-fpm.d/www.conf', entries)
                return {
                    cmd: sedCmd,
                    onSuccess: () => this.invalidateFpmConfigCache()
                }
            }
            return null
        },
        saveConfig() {
            const saveConfig = this.getSaveConfigCommand()
            if (!saveConfig?.cmd) {
                return
            }
            this.executeSaveCommand(saveConfig.cmd, saveConfig)
        },
        silentBuildExtensions({ onSuccess, onError, installCommand }) {
            this.build({
                installCommand: installCommand,
                onComplete: (success) => {
                    if (success) {
                        onSuccess && onSuccess()
                    } else {
                        onError && onError()
                    }
                }
            })
        },
    }
}
</script>
<style scoped>
.loading-icon {
    animation: rotate 2s linear infinite;
    color: #2d5fff;
    font-size: 16px;
}

.success-icon {
    color: #67c23a;
    font-size: 16px;
}

.error-icon {
    color: #f56c6c;
    font-size: 16px;
}

@keyframes rotate {
    from {
        transform: rotate(0deg);
    }

    to {
        transform: rotate(360deg);
    }
}

.log-container {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 5px;
}

.log-path {
    color: #666;
    font-size: 14px;
}

.log-actions {
    display: flex;
    align-items: center;
}

.log-content {
    flex: 1;
    overflow: auto;
    background-color: #1e1e1e;
    border-radius: 4px;
    padding: 15px;
    max-height: 420px;
}

.log-content pre {
    margin: 0;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.5;
    color: #d4d4d4;
    white-space: pre-wrap;
    word-break: break-all;
}

.log-switch {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #666;
    font-size: 14px;
}

.load-status-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 5px;
}
</style>
