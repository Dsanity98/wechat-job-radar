const config = require('../config/index')
const seedJobs = require('../data/seed-jobs')
const companyLinks = require('../data/company-links')
const { timeAgo, formatDate, isExpiring } = require('../utils/format')

const TYPE_MAP = {
  campus: '校招',
  intern: '实习',
  social: '社招'
}

const CATEGORIES = [
  '算法',
  '后端',
  '前端',
  '客户端',
  '数据',
  '测试',
  '产品',
  '运营',
  '设计',
  '市场',
  '财务',
  '人力资源',
  '销售',
  '硬件',
  '职能',
  '其他'
]

const CITIES = [
  '北京',
  '上海',
  '深圳',
  '广州',
  '杭州',
  '成都',
  '武汉',
  '南京',
  '苏州',
  '西安',
  '长沙',
  '合肥',
  '宁德',
  '其他'
]

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalize(job) {
  if (!job) return null
  let source = job.source
  let sourceUrl = job.sourceUrl
  if (job.isDemo && job.company && companyLinks[job.company] && !job.sourceUrl) {
    source = companyLinks[job.company].source
    sourceUrl = companyLinks[job.company].sourceUrl
  }
  return Object.assign({}, job, {
    source,
    sourceUrl,
    typeLabel: TYPE_MAP[job.type] || job.type,
    publishText: timeAgo(job.publishAt),
    deadlineText: job.deadline ? formatDate(job.deadline) : '',
    expiring: isExpiring(job.deadline)
  })
}

function containsKeyword(job, keyword) {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  const haystack = [
    job.title,
    job.company,
    job.city,
    job.category,
    (job.tags || []).join(' ')
  ].join(' ').toLowerCase()
  return haystack.indexOf(kw) >= 0
}

function filterDemo(params) {
  const page = params.page || 1
  const pageSize = params.pageSize || config.pageSize
  let list = seedJobs.slice()

  if (params.type && params.type !== 'all') {
    list = list.filter((job) => job.type === params.type)
  }
  if (params.city) {
    list = list.filter((job) => job.city === params.city)
  }
  if (params.category) {
    list = list.filter((job) => job.category === params.category)
  }
  if (params.keyword) {
    list = list.filter((job) => containsKeyword(job, params.keyword))
  }

  list.sort((a, b) => new Date(b.publishAt).getTime() - new Date(a.publishAt).getTime())

  const total = list.length
  const start = (page - 1) * pageSize
  const items = list.slice(start, start + pageSize).map(normalize)
  return Promise.resolve({
    items,
    total,
    hasMore: start + items.length < total
  })
}

function buildCloudQuery(params) {
  const db = wx.cloud.database()
  const _ = db.command
  const conditions = [{ status: 'open' }]

  if (params.type && params.type !== 'all') conditions.push({ type: params.type })
  if (params.city) conditions.push({ city: params.city })
  if (params.category) conditions.push({ category: params.category })
  if (params.keyword) {
    const kw = escapeRegExp(params.keyword.trim())
    conditions.push(_.or([
      { title: db.RegExp({ regexp: kw, options: 'i' }) },
      { company: db.RegExp({ regexp: kw, options: 'i' }) }
    ]))
  }

  let query = db.collection(config.cloudCollection)
  if (conditions.length === 1) {
    query = query.where(conditions[0])
  } else if (conditions.length > 1) {
    query = query.where(_.and(conditions))
  }
  return query
}

function listCloud(params) {
  if (!config.cloudEnvId) {
    return Promise.reject(new Error('CLOUD_NOT_CONFIGURED'))
  }
  const page = params.page || 1
  const pageSize = params.pageSize || config.pageSize
  const base = buildCloudQuery(params)
  const pageQuery = base
    .orderBy('publishAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
  return Promise.all([pageQuery.get(), base.count()])
    .then(([pageRes, countRes]) => {
      const items = pageRes.data.map(normalize)
      const total = countRes.total || 0
      return {
        items,
        total,
        hasMore: (page - 1) * pageSize + items.length < total
      }
    })
}

function listJobs(params) {
  if (config.dataSource === 'cloud') return listCloud(params)
  return filterDemo(params)
}

function getJobById(id) {
  if (!id) return Promise.resolve(null)
  if (config.dataSource === 'cloud') {
    if (!config.cloudEnvId) return Promise.reject(new Error('CLOUD_NOT_CONFIGURED'))
    const db = wx.cloud.database()
    return db.collection(config.cloudCollection)
      .where({ id })
      .limit(1)
      .get()
      .then((res) => normalize(res.data[0]))
  }
  const job = seedJobs.find((item) => item.id === id)
  return Promise.resolve(normalize(job))
}

function getJobsByIds(ids) {
  if (!ids || !ids.length) return Promise.resolve([])
  if (config.dataSource === 'cloud') {
    if (!config.cloudEnvId) return Promise.reject(new Error('CLOUD_NOT_CONFIGURED'))
    const db = wx.cloud.database()
    const _ = db.command
    // 小程序端单次 get 最多 20 条，按 20 一组分批拉取，避免收藏超过 20 条时被截断。
    const chunks = []
    for (let i = 0; i < ids.length; i += 20) {
      chunks.push(ids.slice(i, i + 20))
    }
    return Promise.all(chunks.map((chunk) =>
      db.collection(config.cloudCollection)
        .where({ id: _.in(chunk) })
        .limit(20)
        .get()
    )).then((results) => results.reduce((all, res) => all.concat(res.data), []).map(normalize))
  }
  return Promise.resolve(seedJobs.filter((job) => ids.indexOf(job.id) >= 0).map(normalize))
}

module.exports = {
  TYPE_MAP,
  CATEGORIES,
  CITIES,
  listJobs,
  getJobById,
  getJobsByIds
}
