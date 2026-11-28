const jobsService = require('../../services/jobs')
const myjobs = require('../../services/myjobs')
const config = require('../../config/index')

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'campus', label: '校招' },
  { key: 'intern', label: '实习' },
  { key: 'social', label: '社招' }
]

Page({
  data: {
    tabs: TABS,
    activeType: 'all',
    keyword: '',
    showSearchClear: false,
    cityOptions: ['全部'].concat(jobsService.CITIES),
    categoryOptions: ['全部'].concat(jobsService.CATEGORIES),
    cityIndex: 0,
    categoryIndex: 0,
    cityLabel: '城市',
    categoryLabel: '岗位',
    jobs: [],
    total: 0,
    page: 1,
    hasMore: true,
    loading: false,
    loadingMore: false,
    error: ''
  },

  onLoad() {
    this._jobMap = {}
    this.searchTimer = null
    this.load(true)
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadMore()
  },

  buildParams(page) {
    const cityIndex = this.data.cityIndex
    const categoryIndex = this.data.categoryIndex
    return {
      type: this.data.activeType,
      keyword: this.data.keyword.trim(),
      city: cityIndex === 0 ? '' : jobsService.CITIES[cityIndex - 1],
      category: categoryIndex === 0 ? '' : jobsService.CATEGORIES[categoryIndex - 1],
      page,
      pageSize: config.pageSize
    }
  },

  load(reset) {
    if (reset) {
      this._jobMap = {}
      this.setData({ page: 1, jobs: [], total: 0, hasMore: true, loading: true, error: '' })
    }
    return jobsService.listJobs(this.buildParams(this.data.page))
      .then((res) => {
        res.items.forEach((item) => { this._jobMap[item.id] = item })
        this.setData({
          jobs: reset ? res.items : this.data.jobs.concat(res.items),
          total: res.total,
          hasMore: res.hasMore,
          loading: false,
          loadingMore: false,
          error: ''
        })
      })
      .catch((err) => {
        this.setData({ loading: false, loadingMore: false, error: this.describeError(err) })
      })
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return
    this.setData({ loadingMore: true, page: this.data.page + 1 })
    jobsService.listJobs(this.buildParams(this.data.page))
      .then((res) => {
        res.items.forEach((item) => { this._jobMap[item.id] = item })
        this.setData({
          jobs: this.data.jobs.concat(res.items),
          total: res.total,
          hasMore: res.hasMore,
          loadingMore: false
        })
      })
      .catch((err) => {
        this.setData({ loadingMore: false, page: this.data.page - 1, error: this.describeError(err) })
      })
  },

  describeError(err) {
    if (err && err.message === 'CLOUD_NOT_CONFIGURED') {
      return '尚未配置云环境，请在 miniprogram/config/index.js 填写云环境 ID'
    }
    return '数据加载失败，请稍后重试'
  },

  onTypeTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeType) return
    this.setData({ activeType: key })
    this.load(true)
  },

  onSearchInput(e) {
    const keyword = e.detail.value
    this.setData({ keyword, showSearchClear: !!keyword })
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchTimer = setTimeout(() => this.load(true), 300)
  },

  onSearchConfirm() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.load(true)
  },

  onSearchClear() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.setData({ keyword: '', showSearchClear: false })
    this.load(true)
  },

  onCityChange(e) {
    const cityIndex = Number(e.detail.value)
    this.setData({
      cityIndex,
      cityLabel: cityIndex === 0 ? '城市' : jobsService.CITIES[cityIndex - 1]
    })
    this.load(true)
  },

  onCategoryChange(e) {
    const categoryIndex = Number(e.detail.value)
    this.setData({
      categoryIndex,
      categoryLabel: categoryIndex === 0 ? '岗位' : jobsService.CATEGORIES[categoryIndex - 1]
    })
    this.load(true)
  },

  resetFilters() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.setData({
      activeType: 'all',
      keyword: '',
      showSearchClear: false,
      cityIndex: 0,
      categoryIndex: 0,
      cityLabel: '城市',
      categoryLabel: '岗位'
    })
    this.load(true)
  },

  onRetry() {
    this.load(true)
  },

  onJobTap(e) {
    const job = this._jobMap[e.detail.id]
    if (!job) return
    wx.showModal({
      title: '加入我的求职',
      content: '将「' + job.company + ' · ' + job.title + '」加入我的求职？',
      confirmText: '加入',
      success: (res) => {
        if (res.confirm) {
          myjobs.add({
            company: job.company,
            title: job.title,
            city: job.city,
            type: job.type,
            category: job.category,
            applyUrl: job.sourceUrl || '',
            deadline: job.deadline || '',
            description: job.description || '',
            requirements: job.requirements || '',
            source: job.source || '参考库',
            sourceUrl: job.sourceUrl || ''
          })
          wx.showToast({ title: '已加入我的求职', icon: 'success' })
        }
      }
    })
  }
})
