const jobsService = require('../../services/jobs')
const favorites = require('../../services/favorites')

Page({
  data: {
    jobs: [],
    loading: true,
    error: ''
  },

  onShow() {
    this.load()
  },

  load() {
    const ids = favorites.list()
    this.setData({ loading: true, error: '' })
    if (!ids.length) {
      this.setData({ jobs: [], loading: false })
      return
    }
    jobsService.getJobsByIds(ids)
      .then((list) => {
        const map = {}
        list.forEach((job) => {
          map[job.id] = job
        })
        const ordered = ids.map((id) => map[id]).filter(Boolean)
        this.setData({ jobs: ordered, loading: false })
      })
      .catch((err) => {
        this.setData({ loading: false, error: this.describeError(err) })
      })
  },

  describeError(err) {
    if (err && err.message === 'CLOUD_NOT_CONFIGURED') {
      return '尚未配置云环境，请在 miniprogram/config/index.js 填写云环境 ID'
    }
    return '收藏加载失败，请稍后重试'
  },

  onJobTap(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.detail.id })
  },

  goBrowse() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onRetry() {
    this.load()
  }
})
