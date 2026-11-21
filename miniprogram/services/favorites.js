const STORAGE_KEY = 'job_radar_favorites'

function read() {
  try {
    return wx.getStorageSync(STORAGE_KEY) || []
  } catch (e) {
    return []
  }
}

function write(list) {
  wx.setStorageSync(STORAGE_KEY, list)
}

function list() {
  return read()
}

function has(id) {
  return read().indexOf(id) >= 0
}

function toggle(id) {
  const items = read()
  const index = items.indexOf(id)
  if (index >= 0) {
    items.splice(index, 1)
  } else {
    items.unshift(id)
  }
  write(items)
  return items.indexOf(id) >= 0
}

module.exports = {
  list,
  has,
  toggle
}
