const myjobs = require('../../services/myjobs')
const { CITIES, CATEGORIES } = require('../../services/jobs')

const TYPES = ['campus', 'intern', 'social']
const TYPE_LABELS = ['校招', '实习', '社招']

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function today() {
  const d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

Page({
  data: {
    id: '',
    company: '',
    title: '',
    cityIndex: 0,
    cityOptions: ['不限'].concat(CITIES),
    categoryIndex: 0,
    categoryOptions: ['不限'].concat(CATEGORIES),
    typeIndex: 0,
    typeOptions: TYPE_LABELS,
    deadline: '',
    applyUrl: '',
    note: '',
    today: '',
    isEdit: false
  },

  onLoad(options) {
    this.setData({ today: today() })
    if (options.id) {
      const job = myjobs.get(options.id)
      if (job) {
        this.setData({
          id: job.id,
          company: job.company || '',
          title: job.title || '',
          cityIndex: job.city ? CITIES.indexOf(job.city) + 1 : 0,
          categoryIndex: job.category ? CATEGORIES.indexOf(job.category) + 1 : 0,
          typeIndex: Math.max(0, TYPES.indexOf(job.type)),
          deadline: job.deadline || '',
          applyUrl: job.applyUrl || '',
          note: job.note || '',
          isEdit: true
        })
        wx.setNavigationBarTitle({ title: '编辑岗位' })
      }
    }
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value })
  },

  onCityChange(e) {
    this.setData({ cityIndex: Number(e.detail.value) })
  },

  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) })
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) })
  },

  onDeadlineChange(e) {
    this.setData({ deadline: e.detail.value })
  },

  save() {
    const company = this.data.company.trim()
    const title = this.data.title.trim()
    if (!company || !title) {
      wx.showToast({ title: '请填写公司和岗位名称', icon: 'none' })
      return
    }
    const payload = {
      company,
      title,
      city: this.data.cityIndex === 0 ? '' : CITIES[this.data.cityIndex - 1],
      category: this.data.categoryIndex === 0 ? '' : CATEGORIES[this.data.categoryIndex - 1],
      type: TYPES[this.data.typeIndex] || 'campus',
      deadline: this.data.deadline,
      applyUrl: this.data.applyUrl.trim(),
      note: this.data.note.trim()
    }
    if (this.data.id) {
      myjobs.update(this.data.id, payload)
    } else {
      myjobs.add(payload)
    }
    wx.showToast({ title: this.data.id ? '已保存' : '已添加', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 600)
  }
})
