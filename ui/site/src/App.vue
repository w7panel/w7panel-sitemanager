<template>
    <el-config-provider :locale="locale" style="min-height:100%;">
        <router-view v-if="authReady"></router-view>
    </el-config-provider>
</template>

<script>
import locale from 'element-plus/es/locale/lang/zh-cn'
import myAxios from './utils'
import { getWujieAccessToken, setSiteManagerToken } from './utils/auth-token'

export default {
    data() {
        return {
            locale,
            authReady: false
        }
    },
    async created(){
      window.$wujie?.bus.$on("routeChange",  (path) => {
        this.$router.push(path)
      });
      await this.loginWithWujieAccessToken()
      this.authReady = true
	},
    methods: {
        async loginWithWujieAccessToken() {
            const accessToken = getWujieAccessToken()
            if (!accessToken) {
                return
            }
            const response = await myAxios.post('/api/oidc/w7panel/login', { access_token: accessToken })
            setSiteManagerToken(response.data?.data?.token)
        }
    }
}
</script>

<style>
.create-item-menupopover{padding:0!important;}
.cursor{cursor:pointer;}
.el-form-item.is-success .el-input__inner,
.el-dialog .el-form-item.is-success .el-input__inner,
.content .el-form-item.is-success .el-input__inner{border:0;}
.el-dialog .el-dialog__header{border:0;}
.content{padding:20px;}
.content .el-table{--el-table-border-color:#eeeeee;}

.distance-checkbox .el-checkbox{margin-right:20px;}
.distance-checkbox .el-checkbox__label{padding-left:5px;}
.el-input-group__append{width:auto!important;}
.menu-popover.el-popover.el-popper{min-width:100px; box-sizing:border-box;}
.list-popover.el-popover.el-popper{min-width:100px; padding:12px 0; box-sizing:border-box;}

.bg-f2 .el-input.is-disabled .el-input__inner{background:transparent;}
.el-input .el-input-group__prepend{width:auto!important;}

.cluster-box{padding:10px 20px; height:60px;}
.refresh{margin:0 16px; cursor:pointer;}

.form .el-input-group__append{width:auto;}
.sbclass .el-message-box__content{padding:40px;}

.com-table-header{background-color:#F2F4F5;}
@-webkit-keyframes rotation{
    from {
		-webkit-transform: rotate(0deg);
		transform: rotate(0deg);
	}
    to {
		-webkit-transform: rotate(360deg);
		transform: rotate(360deg);
	}
}
@keyframes rotation{
    from {
		-webkit-transform: rotate(0deg);
		transform: rotate(0deg);
	}
    to {
		-webkit-transform: rotate(360deg);
		transform: rotate(360deg);
	}
}

.my-rotate{
    animation: rotation 2s linear infinite;
    -moz-animation: rotation 2s linear infinite;
    -webkit-animation: rotation 2s linear infinite;
    -o-animation: rotation 2s linear infinite;
}

.slotbtn .el-input-group__append button.el-button{
	display: inline-flex;
    justify-content: center;
    align-items: center;
    line-height: 1;
    height: 32px;
    white-space: nowrap;
    cursor: pointer;
    color: var(--el-button-text-color);
    text-align: center;
    box-sizing: border-box;
    outline: 0;
    transition: .1s;
    font-weight: var(--el-button-font-weight);
    -webkit-user-select: none;
    user-select: none;
    vertical-align: middle;
    appearance: none;
    background-color: var(--el-button-bg-color);
    border: var(--el-border);
    border-color: var(--el-button-border-color);
    padding: 8px 15px;
    font-size: var(--el-font-size-base);
    border-radius: 0 var(--el-border-radius-base) var(--el-border-radius-base) 0;
}
.slotbtn .el-input-group__append button.el-button:hover{
	color: var(--el-button-hover-text-color);
    border-color: var(--el-button-hover-border-color);
    background-color: var(--el-button-hover-bg-color);
    outline: 0;
}
</style>
