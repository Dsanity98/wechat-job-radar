const myjobs = require('../../services/myjobs')
const { formatDate, daysLeft } = require('../../utils/format')

const TYPE_MAP = { campus: '校招', intern: '实习', social: '社招' }

function daysHint(deadline) {
  if (!deadline) return ''
  const left = daysLeft(deadline)
  if (left === null) return ''
  if (left < 0) return '已截止'
  if (left === 0) return '今天截止'
  return '还剩 ' + left + ' 天'
}

Page({
  data: {
    id: '',
    job: null,
    statusList: myjobs.STATUS
  },

  onLoad(options) {
    this.setData({ id: options.id || '' })
  },

  onShow() {
    this.load()
  },

  load() {
    const job = myjobs.get(this.data.id)
    if (!job) {
      this.setData({ job: null })
      return
    }
    const left = daysLeft(job.deadline)
    const decorated = Object.assign({}, job, {
      statusLabel: myjobs.STATUS_MAP[job.status] || '待投递',
      typeLabel: TYPE_MAP[job.type] || '',
      deadlineText: formatDate(job.deadline),
      daysHint: daysHint(job.deadline),
      deadlineWarn: left !== null && left <= 7
    })
    this.setData({ job: decorated })
    if (job.title) {
      wx.setNavigationBarTitle({ title: job.title })
    }
  },

  setStatus(e) {
    const status = e.currentTarget.dataset.status
    if (!status || status === this.data.job.status) return
    myjobs.update(this.data.id, { status })
    this.load()
  },

  copyLink() {
    const job = this.data.job
    if (!job || !job.applyUrl) {
      wx.showToast({ title: '暂无投递链接', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: job.applyUrl,
      success() {
        wx.showToast({ title: '已复制投递链接', icon: 'none' })
      }
    })
  },

  edit() {
    wx.navigateTo({ url: '/pages/edit/edit?id=' + this.data.id })
  },

  remove() {
    wx.showModal({
      title: '删除岗位',
      content: '删除后不可恢复，确定删除吗？',
      confirmColor: '#b42318',
      success: (res) => {
        if (res.confirm) {
          myjobs.remove(this.data.id)
          wx.navigateBack()
        }
      }
    })
  }
})
