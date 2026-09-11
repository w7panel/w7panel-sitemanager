const { defineConfig } = require('@vue/cli-service')

module.exports = defineConfig({
  transpileDependencies: true,
  productionSourceMap: false,
  outputDir: 'dist',
  publicPath: process.env.NODE_ENV === 'production' ? '' : '/',
  devServer: {
    host: '0.0.0.0',
    port: 8080,
    allowedHosts: 'all',
    client: {
      overlay: false
    },
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  }
})
