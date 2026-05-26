<template>
  <div class="disable-functions">
    <div class="input-section">
      <el-input
        v-model="inputValue"
        placeholder="请输入要禁用的函数名"
        style="flex: 1; margin-right: 10px"
        @keyup.enter="addFunction"
      />
      <el-button type="primary" @click="addFunction">添加</el-button>
    </div>

    <el-table :data="functionList" class="mt-20 table-header">
      <el-table-column label="函数名" prop="name" />
      <el-table-column label="操作" width="100" align="center">
        <template #default="scope">
          <el-button type="text" @click="deleteFunction(scope.$index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script>
export default {
  name: 'DisableFunctions',
  props: {
    disableFunctions: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      inputValue: '',
      functionList: []
    }
  },
  watch: {
    disableFunctions: {
      immediate: true,
      handler(val) {
        this.parseFunctions(val)
      }
    }
  },
  methods: {
    parseFunctions(str) {
      if (!str) {
        this.functionList = []
        return
      }
      this.functionList = str
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(name => ({ name }))
    },
    addFunction() {
      const funcName = this.inputValue.trim()
      if (!funcName) {
        this.$message.warning('请输入函数名')
        return
      }

      if (this.functionList.some(item => item.name === funcName)) {
        this.$message.warning('该函数已存在')
        return
      }

      this.functionList.push({ name: funcName })
      this.inputValue = ''
      this.emitUpdate()
    },
    deleteFunction(index) {
      this.functionList.splice(index, 1)
      this.emitUpdate()
    },
    emitUpdate() {
      const str = this.functionList.map(item => item.name).join(',')
      this.$emit('update:disableFunctions', str)
    }
  }
}
</script>

<style scoped>
.disable-functions {
  max-height: 500px;
  overflow-y: auto;
  width: 100%;
}

.input-section {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}

.mt-20 {
  margin-top: 20px;
}
</style>
