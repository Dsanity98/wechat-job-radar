const config = require('./config/index')

App({
  globalData: {
    config
  },

  onLaunch() {
    if (config.dataSource === 'cloud' && config.cloudEnvId) {
      if (wx.cloud) {
        wx.cloud.init({
          env: config.cloudEnvId,
          traceUser: false
        })
      }
    }
  }
})
