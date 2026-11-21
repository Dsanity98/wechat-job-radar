const STORAGE_KEY = 'job_radar_applications'

function read() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || {}
  } catch (e) {
    return {}
  }
}

function write(map) {
  wx.setStorageSync(STORAGE_KEY, map)
}

function has(id) {
  return !!read()[id]
}

function get(id) {
  return read()[id] || null
}

function mark(id) {
  const map = read()
  if (!map[id]) {
    map[id] = { appliedAt: Date.now() }
    write(map)
  }
  return map[id]
}

function unmark(id) {
  const map = read()
  if (map[id]) {
    delete map[id]
    write(map)
  }
}

function listIds() {
  return Object.keys(read())
}

module.exports = {
  has,
  get,
  mark,
  unmark,
  listIds
}
