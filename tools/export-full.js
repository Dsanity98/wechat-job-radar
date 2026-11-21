const fs = require('fs')
const path = require('path')
const https = require('https')
const querystring = require('querystring')
const crypto = require('crypto')

const SOURCES = [
  {
    id: 'bytedance',
    company: '字节跳动',
    base: 'https://jobs.bytedance.com',
    path: 'campus',
    portalType: 3,
    types: ['campus', 'intern']
  },
  {
    id: 'nio',
    company: '蔚来',
    base: 'https://nio.jobs.feishu.cn',
    path: 'campus',
    portalType: 3,
    types: ['campus', 'intern']
  },
  {
    id: 'xiaopeng',
    company: '小鹏汽车',
    base: 'https://xiaopeng.jobs.feishu.cn',
    path: 'index',
    portalType: 3,
    types: ['campus', 'intern', 'social']
  },
  {
    id: 'momenta',
    company: 'Momenta',
    base: 'https://momenta.jobs.feishu.cn',
    path: 'campus',
    portalType: 3,
    types: ['campus', 'intern']
  },
  {
    id: 'minimax',
    company: 'MiniMax',
    base: 'https://vrfi1sk8a0.jobs.feishu.cn',
    path: 'index',
    portalType: 3,
    types: ['campus', 'intern', 'social']
  },
  {
    id: 'tarsrobot',
    company: '它石智航',
    base: 'https://tarsrobot.jobs.feishu.cn',
    path: 'index',
    portalType: 3,
    types: ['campus', 'intern', 'social']
  },
  {
    id: 'flexivrobotics',
    company: '非夕机器人',
    base: 'https://flexivrobotics.jobs.feishu.cn',
    path: 'index',
    portalType: 3,
    types: ['campus', 'intern', 'social']
  }
]

function requestJson(options) {
  const { base, path, method, body, headers, params, timeoutMs } = options
  return new Promise((resolve, reject) => {
    const query = params ? `?${querystring.stringify(params)}` : ''
    const payload = body ? JSON.stringify(body) : null
    const reqHeaders = Object.assign({}, headers || {})
    if (payload) reqHeaders['content-length'] = Buffer.byteLength(payload)

    const doRequest = (url, redirectsLeft) => {
      const target = new URL(url)
      const requestOptions = {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: method || 'GET',
        headers: reqHeaders
      }
      const req = https.request(requestOptions, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location &&
            redirectsLeft > 0
          ) {
            const next = new URL(res.headers.location, target).toString()
            reqHeaders.referer = target.toString()
            doRequest(next, redirectsLeft - 1)
            return
          }
          resolve({
            statusCode: res.statusCode,
            setCookies: res.headers['set-cookie'] || [],
            body: raw
          })
        })
      })
      req.setTimeout(timeoutMs || 20000, () => req.destroy(new Error('request timeout')))
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    }

    doRequest(`${base}${path}${query}`, 5)
  })
}

function nameOf(value) {
  if (value && typeof value === 'object') return value.zh_cn || value.name || ''
  return value || ''
}

function recruitTypeOf(item) {
  const subject = nameOf((item.job_subject || {}).name)
  const rtype = item.recruit_type || {}
  let rtypeName = rtype.name
  if (rtypeName && typeof rtypeName === 'object') {
    rtypeName = nameOf(rtypeName.zh_cn) || String(rtypeName)
  }
  if (rtypeName == null) rtypeName = ''

  const text = `${subject} ${rtypeName}`
  if (/社招|社会招聘/.test(text)) return 'social'
  if (/实习|intern/i.test(text)) return 'intern'
  if (/校|届/.test(text)) return 'campus'

  const parent = rtype.parent || {}
  const parentText = `${parent.name || ''} ${nameOf(parent.i18n_name || parent.name)}`
  if (/社招|社会招聘/.test(parentText)) return 'social'
  if (/校招|校园招聘/.test(parentText)) return 'campus'
  if (/^(全职|Full-time|Full time|full_time)$/i.test(String(rtypeName).trim())) return 'social'
  return null
}

function citiesOf(item) {
  const out = []
  for (const city of item.city_list || []) {
    const name = city && city.name
    if (name && out.indexOf(name) < 0) out.push(name)
  }
  if (!out.length && (item.city_info || {}).name) out.push(item.city_info.name)
  return out
}

function publishDate(ms) {
  const value = Number(ms)
  if (!Number.isFinite(value) || value <= 0 || value > 2208988800000) return ''
  const date = new Date(value)
  return isNaN(date.getTime()) ? '' : date.toISOString()
}

function fingerprintOf(job) {
  const content = {
    title: job.title,
    company: job.company,
    type: job.type,
    city: job.city,
    cities: job.cities,
    salary: job.salary,
    degree: job.degree,
    experience: job.experience,
    category: job.category,
    tags: job.tags,
    deadline: job.deadline,
    publishAt: job.publishAt,
    description: job.description,
    requirements: job.requirements,
    sourceUrl: job.sourceUrl
  }
  return crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex')
}

function normalize(item, source) {
  const title = (item.title || '').trim()
  const jid = item.id
  if (!jid || !title) return null
  const type = recruitTypeOf(item)
  if (!type || source.types.indexOf(type) < 0) return null
  const cities = citiesOf(item)
  const category = nameOf((item.job_category || {}).name) || '其他'
  const subject = nameOf((item.job_subject || {}).name)
  const job = {
    id: `${source.id}-${jid}`,
    sourceId: source.id,
    sourceJobId: String(jid),
    type,
    title,
    company: source.company,
    city: cities[0] || '',
    cities,
    salary: '',
    degree: '',
    experience: type === 'intern' ? '在校生' : '应届',
    category,
    tags: subject ? [subject] : [],
    deadline: '',
    publishAt: publishDate(item.publish_time) || '',
    description: (item.description || '').trim(),
    requirements: (item.requirement || '').trim(),
    source: `${source.company}招聘官网`,
    sourceUrl: `${source.base}/${source.path}/position/${jid}/detail`
  }
  job.fingerprint = fingerprintOf(job)
  job.publishAt = job.publishAt || new Date().toISOString()
  job.status = 'open'
  job.updatedAt = new Date().toISOString()
  job.isDemo = false
  return job
}

async function openSession(source) {
  const response = await requestJson({
    base: source.base,
    path: '/api/v1/csrf/token',
    method: 'POST',
    body: { portal_entrance: 1 },
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    timeoutMs: 20000
  })
  const data = JSON.parse(response.body)
  const token = (data.data || {}).token || ''
  if (!token) throw new Error(`${source.id}: 未返回 csrf token`)
  return {
    base: source.base,
    path: source.path,
    token,
    cookie: response.setCookies.map((item) => item.split(';')[0]).join('; ')
  }
}

function headersOf(session) {
  const headers = {
    'x-csrf-token': session.token,
    accept: 'application/json, text/plain, */*',
    'portal-channel': session.path,
    'portal-platform': 'pc',
    origin: session.base,
    referer: `${session.base}/${session.path}`,
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (wechat-miniprogram-sync)'
  }
  if (session.cookie) headers.cookie = session.cookie
  if (session.path !== 'index') headers['website-path'] = session.path
  return headers
}

async function fetchAll(source) {
  const limit = 1000
  const portalType = source.portalType || 3
  let offset = 0
  let total = null
  let session = await openSession(source)
  const items = []

  while (true) {
    const body = {
      keyword: '',
      limit,
      offset,
      job_category_id_list: [],
      tag_id_list: [],
      location_code_list: [],
      subject_id_list: [],
      recruitment_id_list: [],
      portal_type: portalType,
      job_function_id_list: [],
      storefront_id_list: [],
      portal_entrance: 1
    }
    const params = { portal_type: portalType, limit, offset, portal_entrance: 1 }
    const response = await requestJson({
      base: session.base,
      path: '/api/v1/search/job/posts',
      method: 'POST',
      body,
      headers: headersOf(session),
      params,
      timeoutMs: 25000
    })
    const data = JSON.parse(response.body)
    const payload = data.data || {}
    const pageItems = payload.job_post_list || []
    if (total === null) total = Number(payload.count) || null
    items.push.apply(items, pageItems)
    offset += pageItems.length
    if (!pageItems.length) break
    if (total !== null && offset >= total) break
    if (offset % (limit * 20) === 0) session = await openSession(source)
  }

  return items
}

async function main() {
  const jobs = []
  for (const source of SOURCES) {
    process.stdout.write(`拉取 ${source.company}...\n`)
    const items = await fetchAll(source)
    let accepted = 0
    for (const item of items) {
      const job = normalize(item, source)
      if (job) {
        jobs.push(job)
        accepted++
      }
    }
    process.stdout.write(`${source.company}: 原始 ${items.length} 条，归一化 ${accepted} 条\n`)
  }

  const root = path.resolve(__dirname, '..')
  const dataDir = path.join(root, 'data')
  fs.mkdirSync(dataDir, { recursive: true })

  const jsonPath = path.join(dataDir, 'jobs-full.json')
  const jsonlPath = path.join(dataDir, 'jobs-full.jsonl')
  fs.writeFileSync(jsonPath, JSON.stringify(jobs, null, 2), 'utf8')
  fs.writeFileSync(jsonlPath, jobs.map((job) => JSON.stringify(job)).join('\n') + '\n', 'utf8')

  process.stdout.write(`写入 ${jobs.length} 条到:\n`)
  process.stdout.write(`${jsonPath}\n`)
  process.stdout.write(`${jsonlPath}\n`)
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err)
  process.exit(1)
})
