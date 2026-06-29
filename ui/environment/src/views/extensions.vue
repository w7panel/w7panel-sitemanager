<template>
    <div style="position: relative;display: flex;flex-direction: column;height: 500px;">
        <el-table ref="extensionsTable" style="flex: 1; overflow-y: auto;" :data="extensions" class="table-header"
            @selection-change="handleSelectionChange">
            <el-table-column type="selection" width="45" :selectable="isSelectableInstallExtension"></el-table-column>
            <el-table-column prop="name" label="名称"></el-table-column>
            <el-table-column label="状态">
                <template #default="scope">
                    <span v-if="scope.row.install_command && !scope.row.can_uninstall"
                        style="display: flex;align-items: center;"><el-icon>
                            <ElIconClose />
                        </el-icon></span>
                    <span v-else><el-icon>
                            <ElIconCheck />
                        </el-icon></span>
                </template>
            </el-table-column>
            <el-table-column prop="operation" label="操作">
                <template #default="scope">
                    <template v-if="scope.row.uninstall_command && scope.row.can_uninstall">
                        <el-button :loading="enableLoading === scope.row.name" type="success" link
                            @click="enableExtension(scope.row, 1)"
                            v-if="!installLoading && scope.row.enable_command && !scope.row.is_enabled">启用</el-button>
                        <el-button :loading="enableLoading === scope.row.name" type="danger" link
                            @click="enableExtension(scope.row, 2)"
                            v-if="!installLoading && scope.row.disable_command && scope.row.is_enabled">禁用</el-button>
                        <el-button type="danger" link @click="installExtension(scope.row, 2)" :disabled="installLoading"
                            :loading="installLoading === scope.row.name">{{ installLoading === scope.row.name ?
                                installLoadingText : '卸载' }}</el-button>
                    </template>
                    <span v-else>-</span>
                </template>
            </el-table-column>
        </el-table>
        <div class="df jc-c" style="margin-top: 20px">
            <el-button type="primary" @click="installSelectedExtensions"
                :disabled="!selectedInstallExtensions.length || !!installLoading"
                :loading="installLoading && installType === 1 && selectedInstallExtensions.length > 1">
                批量安装
            </el-button>
            <el-button type="primary" @click="openAddExtensionsDialog()">添加扩展</el-button>
        </div>

        <el-dialog v-model="addExtensionsDialogVisible" title="添加扩展" width="50%" :close-on-click-modal="false">
            <div style="width: 400px;margin: 0 auto;padding: 30px 0;">
                <el-form :model="addExtensionsForm" ref="addExtensionsForm" label-width="80px">
                    <el-form-item label="扩展文件" prop="file"
                        :rules="[{ required: true, message: '请选择扩展文件', trigger: 'change' }]">
                        <el-button type="text" @click="$refs.fileInput.click()">选择文件</el-button>
                        <span style="margin-left: 10px; color: #606266; font-size: 14px;">{{ addExtensionsForm.filename
                            ||
                            '未选择文件' }}</span>
                        <input type="file" ref="fileInput" @change="handleFileChange" accept=".so"
                            style="display: none;" />
                    </el-form-item>
                    <el-form-item label="配置文件" prop="iniContent"
                        :rules="[{ required: true, message: '请输入配置文件', trigger: 'blur' }]">
                        <el-input v-model="addExtensionsForm.iniContent" type="textarea" :rows="5"
                            placeholder="请输入配置文件" />
                    </el-form-item>
                </el-form>
            </div>

            <template #footer>
                <el-button @click="addExtensionsDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="addExtensions" :loading="addExtensionsLoading"
                    :disabled="!addExtensionsForm.file">确定</el-button>
            </template>
        </el-dialog>

    </div>
</template>

<script>
import panelAxios from "@/utils/panel";
import { buildWriteFileCommand } from "@/utils/shell";
import { parseExtensions, parseTemplate, appendUnlimitedStatus } from "./php_environment";
import { emitWujieEvent } from "./utils";
import { Check as ElIconCheck, Close as ElIconClose } from '@element-plus/icons-vue'

export default {
    components: {
        ElIconCheck,
        ElIconClose
    },
    props: {
        version: {
            type: String,
            default: ''
        },
        allExtensions: {
            type: String,
            default: ''
        },
        customExtensions: {
            type: Array,
            default: () => []
        },
        environment_id: {
            type: Number,
            default: 0
        },
        name: {
            type: String,
            default: ''
        },
        podsName: {
            type: String,
            default: ''
        },
        extensionsDir: {
            type: String,
            default: ''
        },
        hostIP: {
            type: String,
            default: ''
        },
        containerId: {
            type: String,
            default: ''
        }
    },
    name: "extensions-list",
    data() {
        return {
            tab: 'extensions',
            extensions: [],
            installLoading: false,
            installType: 0,
            installStage: '',
            enableLoading: '',
            selectedExtensions: [],
            addExtensionsDialogVisible: false,
            addExtensionsForm: {
                file: null,
                name: '',
                filename: '',
                iniContent: ''
            },
            commandTemplate: '',
            unlimitedNames: [],
            addExtensionsLoading: false
        }
    },
    computed: {
        selectedInstallExtensions() {
            return this.selectedExtensions.filter(item => this.isSelectableInstallExtension(item))
        },
        installLoadingText() {
            if (this.installStage === 'build') {
                return '容器启动中...'
            }
            if (this.installType === 2) {
                return '正在卸载中，请勿关闭当前窗口...'
            }
            return '正在安装中，请勿关闭当前窗口...'
        }
    },
    created() {
        if (this.allExtensions) {
            this.getAllExtensions()
        }
    },
    watch: {
        environment_id() {
            this.getAllExtensions()
        },
        allExtensions() {
            this.getAllExtensions()
        },
        customExtensions() {
            this.getAllExtensions()
        },
        installLoading(val) {
            if (window.__WUJIE_RAW_WINDOW__) {
                if (val) {
                    window.__WUJIE_RAW_WINDOW__.localStorage.setItem('microDialogCloseAlertText', '任务正在执行中，关闭窗口会导致任务进度丢失，确认要关闭吗？')
                } else if (this.installStage !== 'build') {
                    window.__WUJIE_RAW_WINDOW__.localStorage.removeItem('microDialogCloseAlertText')
                }
            }
        }
    },
    methods: {
        handleFileChange(data) {
            const file = data.target?.files?.[0]
            if (!file) {
                return
            }
            this.addExtensionsForm.file = file
            this.addExtensionsForm.filename = file.name
            this.addExtensionsForm.name = file.name.replace('.so', '')
            this.addExtensionsForm.iniContent = 'extension=' + file.name
        },
        enableExtension(extension, type) {
            this.enableLoading = extension.name
            let command = ''
            command = type === 1 ? extension.enable_command : extension.disable_command

            panelAxios.wsExec(this.name, this.podsName, command, () => {

            }, () => {
                this.enableLoading = ''
                this.getAllExtensions()
            }, () => {
                this.$message.error("操作失败")
                this.enableLoading = ''
            })
        },
        addExtensions() {
            this.$refs.addExtensionsForm.validate(async (valid) => {
                if (!valid) {
                    return
                }
                this.addExtensionsLoading = true
                try {
                    await new Promise((resolve) => {
                        emitWujieEvent('uploadFile', {
                            pid: {
                                namespace: 'default',
                                HostIp: this.hostIP,
                                containerId: this.containerId,
                                containerName: this.name,
                                podName: this.podsName
                            },
                            file: this.addExtensionsForm.file,
                            path: this.extensionsDir + '/'
                        }, (e) => {
                            resolve(e)
                        })
                    })
                    const iniPath = `/usr/local/etc/php/conf.d/docker-php-ext-${this.addExtensionsForm.name}.ini`
                    await panelAxios.exec(this.name, this.podsName, buildWriteFileCommand(iniPath, this.addExtensionsForm.iniContent))
                    this.$emit('addExtensions', {
                        name: this.addExtensionsForm.name,
                        is_custom: true
                    })
                    this.addExtensionsDialogVisible = false
                } catch {
                    this.$message.error('添加扩展失败')
                } finally {
                    this.addExtensionsLoading = false
                }
            })
        },
        removeExtension(extension) {
            this.$emit('removeExtension', extension.name)
        },
        openAddExtensionsDialog() {
            this.addExtensionsForm = {
                file: null,
                name: '',
                iniContent: ''
            }
            this.addExtensionsDialogVisible = true
            this.$nextTick(() => {
                this.$refs.fileInput.value = ''
            })
        },
        handleSelectionChange(val) {
            this.selectedExtensions = val
        },
        isSelectableInstallExtension(row) {
            return !!(row.install_command && !row.can_uninstall)
        },
        installSelectedExtensions() {
            const extensions = this.selectedInstallExtensions
            if (!extensions.length) {
                this.$message.warning('请选择要安装的扩展')
                return
            }
            this.installExtensionsBatch(extensions, 1)
        },
        installExtension(extension, type) {
            this.installExtensionsBatch([extension], type)
        },
        installExtensionsBatch(extensions, type) {
            const targets = extensions.filter(Boolean)
            if (!targets.length) {
                return
            }
            this.installLoading = targets.length > 1 ? `批量安装${targets.length}个扩展` : targets[0].name
            this.installType = type
            this.installStage = 'command'
            let command = ''
            if (type === 1) {
                command = this.commandTemplate.install_command.replace(/\$extension_name/g, targets.map(item => item.name).join(' '))
            } else {
                command = targets.map(item => item.uninstall_command).join(';')
            }
            this.startSilentBuild(command)
        },
        startSilentBuild(installCommand) {
            this.installStage = 'build'
            this.$emit('silentBuild', {
                installCommand,
                onSuccess: () => {
                    this.finishInstallTask()
                    this.getAllExtensions()
                },
                onError: () => {
                    this.finishInstallTask()
                    this.getAllExtensions()
                }
            })
        },
        finishInstallTask() {
            this.installLoading = false
            this.installType = 0
            this.installStage = ''
            if (window.__WUJIE_RAW_WINDOW__) {
                window.__WUJIE_RAW_WINDOW__.localStorage.removeItem('microDialogCloseAlertText')
            }
        },
        getAllExtensions() {
            const [template, extensions, unlimitedNames] = parseTemplate(this.allExtensions, this.version)
            this.commandTemplate = template
            this.unlimitedNames = unlimitedNames
            const c = extensions.concat(this.customExtensions.map(item => ({
                ...item,
                uninstall_command: this.commandTemplate.uninstall_command.replace(/\$extension_name/g, item.name),
                enable_command: this.commandTemplate.enable_command.replace(/\$extension_name/g, item.name),
                disable_command: this.commandTemplate.disable_command.replace(/\$extension_name/g, item.name)
            })))
            this.getInstallExtensions(c.map(item => ({
                ...item,
                name: item.name.toLowerCase()
            })))
        },
        getInstallExtensions(supportExtensions) {
            panelAxios.exec(this.name, this.podsName, 'php -m').then(async res => {
                let extensionsList = await panelAxios.exec(this.name, this.podsName, `ls ${this.extensionsDir}`)
                extensionsList = extensionsList?.data?.split('\n').filter(item => !!item).map(item => item.trim().replace('.so', '')).filter(item => !!item) || []
                const enabledExtensions = parseExtensions(res.data) || []
                const uninstallExtensions = supportExtensions.filter(item => !(extensionsList?.includes(item.name)))
                this.extensions = [...extensionsList.map(item => {
                    const data = supportExtensions.find(j => j.name === item) || this.customExtensions?.find(j => j.name === item)
                    if (data) {
                        return appendUnlimitedStatus({
                            ...data,
                            can_uninstall: true,
                            is_enabled: enabledExtensions.includes(item)
                        }, this.unlimitedNames)
                    }
                    return {
                        name: item,
                        is_unlimited: true,
                        can_uninstall: false
                    }
                }), ...uninstallExtensions.map(item => appendUnlimitedStatus({
                    ...item,
                    can_uninstall: false,
                    is_enabled: false
                }, this.unlimitedNames)), ...enabledExtensions.filter(item => !extensionsList?.includes(item)).map(item => ({
                    name: item,
                    is_unlimited: true,
                    can_uninstall: false,
                    is_enabled: true
                }))]
            }).catch(() => {
                this.extensions = []
            })
        }
    }
}
</script>
