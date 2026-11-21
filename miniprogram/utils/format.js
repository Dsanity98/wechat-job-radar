function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return isNaN(date.getTime()) ? null : date
}

function timeAgo(value) {
  const date = toDate(value)
  if (!date) return ''
  const diff = Date.now() - date.getTime()
  if (diff < 0) return '刚刚'
  const minute = Math.floor(diff / 60000)
  if (minute < 1) return '刚刚'
  if (minute < 60) return minute + '分钟前'
  const hour = Math.floor(minute / 60)
  if (hour < 24) return hour + '小时前'
  const day = Math.floor(hour / 24)
  if (day < 30) return day + '天前'
  const month = Math.floor(day / 30)
  if (month < 12) return month + '个月前'
  return Math.floor(day / 365) + '年前'
}

function formatDate(value) {
  const date = toDate(value)
  if (!date) return ''
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

function daysLeft(value) {
  const date = toDate(value)
  if (!date) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function isExpiring(value) {
  const left = daysLeft(value)
  return left !== null && left >= 0 && left <= 7
}

module.exports = {
  timeAgo,
  formatDate,
  daysLeft,
  isExpiring
}
