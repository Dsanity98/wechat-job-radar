const STORAGE_KEY = 'job_radar_myjobs'

const STATUS = [
  { key: 'pending', label: '待投递' },
  { key: 'applied', label: '已投递' },
  { key: 'interview', label: '面试中' },
  { key: 'offer', label: 'Offer' },
  { key: 'closed', label: '已结束' }
]

const STATUS_MAP = {}
STATUS.forEach((item) => { STATUS_MAP[item.key] = item.label })

function read() {
  try {
    const data = wx.getStorageSync(STORAGE_KEY)
    return Array.isArray(data) ? data : []
  } catch (e) {
    return []
  }
}

function write(list) {
  wx.setStorageSync(STORAGE_KEY, list)
}

function uid() {
  return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function list() {
  return read().slice().sort((a, b) => {
    const aClosed = a.status === 'closed' ? 1 : 0
    const bClosed = b.status === 'closed' ? 1 : 0
    if (aClosed !== bClosed) return aClosed - bClosed
    const ad = a.deadline || '9999-12-31'
    const bd = b.deadline || '9999-12-31'
    if (ad !== bd) return ad < bd ? -1 : 1
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })
}

function get(id) {
  return read().find((item) => item.id === id) || null
}

function add(data) {
  const now = Date.now()
  const job = Object.assign({
    company: '',
    title: '',
    city: '',
    type: 'campus',
    category: '',
    applyUrl: '',
    deadline: '',
    note: '',
    status: 'pending',
    source: '手动添加',
    sourceUrl: '',
    description: '',
    requirements: ''
  }, data, {
    id: uid(),
    createdAt: now,
    updatedAt: now
  })
  const list = read()
  list.unshift(job)
  write(list)
  return job
}

function update(id, patch) {
  const list = read()
  const index = list.findIndex((item) => item.id === id)
  if (index < 0) return null
  const next = Object.assign({}, list[index], patch, { updatedAt: Date.now() })
  list[index] = next
  write(list)
  return next
}

function remove(id) {
  write(read().filter((item) => item.id !== id))
}

function stats() {
  const counts = { all: 0, pending: 0, applied: 0, interview: 0, offer: 0, closed: 0 }
  read().forEach((item) => {
    counts.all += 1
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1
  })
  return counts
}

module.exports = {
  STATUS,
  STATUS_MAP,
  list,
  get,
  add,
  update,
  remove,
  stats
}
