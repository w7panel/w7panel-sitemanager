<template>
    <main class="home-page">
        <section class="guide" aria-labelledby="guide-title">
            <div class="guide-icon" aria-hidden="true">
                <el-icon><Setting /></el-icon>
            </div>
            <h1 id="guide-title">请在站点管理中配置环境</h1>
            <p>进入站点管理 -> 环境管理，点击对应环境后的齿轮按钮，进行环境配置。</p>
        </section>
    </main>
</template>

<script>
import { Setting } from '@element-plus/icons-vue'

export default {
    name: 'HomeView',
    components: {
        Setting
    }
}
</script>

<style scoped>
.home-page {
    display: grid;
    min-height: 100%;
    padding: 40px 24px;
    place-items: center;
    background: #fff;
}

.guide {
    max-width: 480px;
    text-align: center;
}

.guide-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    margin-bottom: 20px;
    color: var(--el-color-primary);
    font-size: 30px;
    background: var(--el-color-primary-light-9);
    border-radius: 50%;
}

.guide h1 {
    margin: 0;
    color: #303133;
    font-size: 20px;
    font-weight: 500;
    line-height: 28px;
}

.guide p {
    margin: 12px 0 0;
    color: #909399;
    font-size: 14px;
    line-height: 22px;
}
</style>
