const jobsService = require('../../services/jobs')
const favorites = require('../../services/favorites')

Page({
  data: {
    id: '',
    job: null,
    loading: true,
    error: '',
    favorited: false
  },

  onLoad(options) {
    this.setData({ id: options.id || '' })
    this.load()
  },

  load() {
    this.setData({ loading: true, error: '' })
    jobsService.getJobById(this.data.id)
      .then((job) => {
        if (!job) {
          this.setData({ loading: false, error: '岗位不存在或已下架' })
          return
        }
        this.setData({
          job,
          loading: false,
          favorited: favorites.has(job.id)
        })
        if (job.title) {
          wx.setNavigationBarTitle({ title: job.title })
        }
      })
      .catch((err) => {
        this.setData({ loading: false, error: this.describeError(err) })
      })
  },

  describeError(err) {
    if (err && err.message === 'CLOUD_NOT_CONFIGURED') {
      return '尚未配置云环境，请在 miniprogram/config/index.js 填写云环境 ID'
    }
    return '岗位加载失败，请稍后重试'
  },

  toggleFavorite() {
    const job = this.data.job
    if (!job) return
    const favorited = favorites.toggle(job.id)
    this.setData({ favorited })
    wx.showToast({
      title: favorited ? '已收藏' : '已取消收藏',
      icon: 'none'
    })
  },

  copyLink() {
    const job = this.data.job
    if (!job || !job.sourceUrl) {
      wx.showToast({ title: '该岗位暂无官网链接', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: job.sourceUrl,
      success() {
        wx.showToast({ title: '链接已复制', icon: 'success' })
      }
    })
  },

  openOfficial() {
    const job = this.data.job
    if (!job || !job.sourceUrl) {
      wx.showToast({ title: '该岗位暂无官网链接', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: '/pages/webview/webview?url=' + encodeURIComponent(job.sourceUrl)
    })
  },

  onRetry() {
    this.load()
  }
})
