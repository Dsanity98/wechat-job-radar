const jobsService = require('../../services/jobs')
const favorites = require('../../services/favorites')
const applications = require('../../services/applications')

Page({
  data: {
    id: '',
    job: null,
    loading: true,
    error: '',
    favorited: false,
    applied: false
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
          favorited: favorites.has(job.id),
          applied: applications.has(job.id)
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

  apply() {
    const job = this.data.job
    if (!job) return

    if (this.data.applied) {
      applications.unmark(job.id)
      this.setData({ applied: false })
      wx.showToast({ title: '已取消投递标记', icon: 'none' })
      return
    }

    applications.mark(job.id)
    let favorited = favorites.has(job.id)
    if (!favorited) {
      favorites.toggle(job.id)
      favorited = true
    }
    this.setData({ applied: true, favorited })

    if (job.sourceUrl) {
      wx.setClipboardData({
        data: job.sourceUrl,
        success() {
          wx.showToast({ title: '已标记投递，链接已复制', icon: 'none' })
        }
      })
    } else {
      wx.showToast({ title: '已标记投递', icon: 'none' })
    }
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

  onRetry() {
    this.load()
  }
})
