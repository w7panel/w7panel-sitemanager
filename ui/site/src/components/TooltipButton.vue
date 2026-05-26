<template>
    <el-tooltip :content="content" :disabled="disabled" placement="top">
        <span class="tooltip-button-span color-primary" @click="click">
            <slot></slot>
        </span>
    </el-tooltip>
</template>
<script>
export default {
    name: 'TooltipButton',
    props: {
        content: {
            type: String,
            default: ''
        },
        disabled: {
            type: Boolean,
            default: false
        }
    },
    methods: {
        click() {
            this.$emit('click');
        }
    }
}
</script>
<style>
.tooltip-button-span {
    cursor: pointer;
    line-height: 1;
    font-size: 16px;
    height: 16px;
    vertical-align: top;
    display: inline-flex;
    align-items: center;
}

.tooltip-button-span {
    margin-right: 10px;
}

.tooltip-button-span.color-primary svg{
    color: #2d5fff;
    font-size: 16px;
    height: 16px;
}
.tooltip-button-span.color-primary span{
    color: #2d5fff;
    font-size: 14px;
    margin-left: 2px;
}
</style>