const myjobs = require('../../services/myjobs')
const { formatDate, daysLeft, isExpiring } = require('../../utils/format')

const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待投递' },
  { key: 'applied', label: '已投递' },
  { key: 'interview', label: '面试中' },
  { key: 'offer', label: 'Offer' },
  { key: 'closed', label: '已结束' }
]

const STAT_CARDS = [
  { key: 'pending', label: '待投递' },
  { key: 'applied', label: '已投递' },
  { key: 'interview', label: '面试中' },
  { key: 'offer', label: 'Offer' }
]

const TYPE_MAP = { campus: '校招', intern: '实习', social: '社招' }

function deadlineHint(deadline) {
  if (!deadline) return ''
  const left = daysLeft(deadline)
  if (left === null) return ''
  if (left < 0) return '已截止'
  if (left === 0) return '今天截止'
  return left + ' 天后截止'
}

Page({
  data: {
    tabs: STATUS_TABS,
    statCards: STAT_CARDS,
    activeStatus: 'all',
    jobs: [],
    stats: { all: 0, pending: 0, applied: 0, interview: 0, offer: 0, closed: 0 }
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const active = this.data.activeStatus
    const jobs = myjobs.list()
      .filter((job) => active === 'all' || job.status === active)
      .map((job) => Object.assign({}, job, {
        statusLabel: myjobs.STATUS_MAP[job.status] || '待投递',
        typeLabel: TYPE_MAP[job.type] || '',
        deadlineText: formatDate(job.deadline),
        deadlineHint: deadlineHint(job.deadline),
        expiring: isExpiring(job.deadline)
      }))
    this.setData({ jobs, stats: myjobs.stats() })
  },

  onStatusTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeStatus) return
    this.setData({ activeStatus: key })
    this.load()
  },

  onStatTap(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeStatus: key })
    this.load()
  },

  onJobTap(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  addJob() {
    wx.navigateTo({ url: '/pages/edit/edit' })
  },

  goLibrary() {
    wx.switchTab({ url: '/pages/library/library' })
  }
})
