const cloud = require('wx-server-sdk')
const https = require('https')
const querystring = require('querystring')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const COLLECTION = 'jobs'

// 每天定时从官方招聘门户的公开匿名 JSON 接口拉取真实岗位。
// 目前接入飞书 ATSX 门户（字节跳动、蔚来），覆盖校招与实习。
// 要接更多公司，复制一项并填对应 base/path 即可；社招源可另配 portal_type 或独立门户。
const SOURCES = [
  {
    id: 'bytedance',
    company: '字节跳动',
    base: 'https://jobs.bytedance.com',
    path: 'campus',
    portalType: 3,
    types: ['campus', 'intern'],
    pageSize: 1000
  },
  {
    id: 'nio',
    company: '蔚来',
    base: 'https://nio.jobs.feishu.cn',
    path: 'campus',
    portalType: 3,
    types: ['campus', 'intern'],
    pageSize: 1000
  },
  {
    id: 'xiaopeng',
    company: '小鹏汽车',
    base: 'https://xiaopeng.jobs.feishu.cn',
    path: 'index',
    portalType: 3,
    types: ['campus', 'intern', 'social'],
    pageSize: 1000
  },
  {
    id: 'momenta',
    company: 'Momenta',
    base: 'https://momenta.jobs.feishu.cn',
    path: 'campus',
    portalType: 3,
    types: ['campus', 'intern'],
    pageSize: 1000
  },
  {
    id: 'minimax',
    company: 'MiniMax',
    base: 'https://vrfi1sk8a0.jobs.feishu.cn',
    path: 'index',
    portalType: 3,
    types: ['campus', 'intern', 'social'],
    pageSize: 1000
  },
  {
    id: 'tarsrobot',
    company: '它石智航',
    base: 'https://tarsrobot.jobs.feishu.cn',
    path: 'index',
    portalType: 3,
    types: ['campus', 'intern', 'social'],
    pageSize: 1000
  },
  {
    id: 'flexivrobotics',
    company: '非夕机器人',
    base: 'https://flexivrobotics.jobs.feishu.cn',
    path: 'index',
    portalType: 3,
    types: ['campus', 'intern', 'social'],
    pageSize: 1000
  }
]

function nameOf(value) {
  if (value && typeof value === 'object') {
    return value.zh_cn || value.name || ''
  }
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
  if (!Number.isFinite(value) || value <= 0 || value > 2208988800000) return null
  const date = new Date(value)
  return isNaN(date.getTime()) ? null : date.toISOString()
}

function requestJson(options) {
  const {
    base,
    path,
    method,
    body,
    headers,
    params,
    timeoutMs
  } = options

  return new Promise((resolve, reject) => {
    const query = params ? `?${querystring.stringify(params)}` : ''
    const payload = body ? JSON.stringify(body) : null
    const reqHeaders = Object.assign({}, headers || {})
    if (payload) {
      reqHeaders['content-length'] = Buffer.byteLength(payload)
    }

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
            headers: res.headers,
            setCookies: res.headers['set-cookie'] || [],
            body: raw
          })
        })
      })

      req.setTimeout(timeoutMs || 20000, () => {
        req.destroy(new Error('request timeout'))
      })
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    }

    doRequest(`${base}${path}${query}`, 5)
  })
}

async function openFeishuSession(source) {
  const base = source.base
  const path = source.path
  const csrfResponse = await requestJson({
    base,
    path: '/api/v1/csrf/token',
    method: 'POST',
    body: { portal_entrance: 1 },
    headers: {
      'content-type': 'application/json',
      accept: 'application/json'
    },
    timeoutMs: 20000
  })
  let csrfData
  try {
    csrfData = JSON.parse(csrfResponse.body)
  } catch (e) {
    throw new Error(`${source.id}: csrf 返回非 JSON`)
  }
  const token = (csrfData.data || {}).token || ''
  if (!token) throw new Error(`${source.id}: 未返回 csrf token`)

  const cookie = csrfResponse.setCookies.map((item) => item.split(';')[0]).join('; ')
  return { base, path, token, cookie }
}

function feishuHeaders(session) {
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

async function fetchFeishu(source) {
  const portalType = source.portalType || 3
  const limit = source.pageSize || 100
  const items = []
  let total = null
  let offset = 0
  let session = await openFeishuSession(source)

  while (true) {
    const body = {
      keyword: source.keyword || '',
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
      headers: feishuHeaders(session),
      params,
      timeoutMs: 20000
    })
    let responseData
    try {
      responseData = JSON.parse(response.body)
    } catch (e) {
      throw new Error(`${source.id}: 搜索接口返回非 JSON（HTTP ${response.statusCode}）`)
    }
    const payload = responseData.data || {}
    const pageItems = payload.job_post_list || []
    if (total === null) total = Number(payload.count) || null
    items.push.apply(items, pageItems)
    offset += pageItems.length

    if (!pageItems.length) break
    if (total !== null && offset >= total) break
    // token 有寿命，翻页较多时定期换新会话，避免中途失效。
    if (offset % (limit * 20) === 0) session = await openFeishuSession(source)
  }

  return { items, total: total === null ? items.length : total }
}

function normalizeFeishu(item, source) {
  const title = (item.title || '').trim()
  const jid = item.id
  if (!jid || !title) return null

  const type = recruitTypeOf(item)
  if (!type || !source.types || source.types.indexOf(type) < 0) return null

  const cities = citiesOf(item)
  const category = nameOf((item.job_category || {}).name) || '其他'
  const subject = nameOf((item.job_subject || {}).name)

  return {
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

function finalizeJob(job) {
  return Object.assign({}, job, {
    publishAt: job.publishAt || new Date().toISOString(),
    status: 'open',
    updatedAt: new Date().toISOString(),
    isDemo: false
  })
}

async function fetchExisting(sourceId) {
  const map = new Map()
  const limit = 1000
  let skip = 0
  while (true) {
    const res = await db.collection(COLLECTION)
      .where({ sourceId })
      .field({ id: true, fingerprint: true })
      .limit(limit)
      .skip(skip)
      .get()
    const docs = res.data || []
    for (const doc of docs) {
      map.set(doc.id, { _id: doc._id, fingerprint: doc.fingerprint || '' })
    }
    skip += docs.length
    if (docs.length < limit) break
  }
  return map
}

async function runPool(tasks, concurrency) {
  const queue = tasks.slice()
  const workerCount = Math.max(1, Math.min(concurrency || 8, queue.length))
  const workers = []
  for (let i = 0; i < workerCount; i++) {
    workers.push((async () => {
      while (queue.length) {
        const task = queue.shift()
        await task()
      }
    })())
  }
  await Promise.all(workers)
}

async function closeMissing(sourceId, seenIds) {
  const limit = 1000
  let skip = 0
  let closed = 0
  while (true) {
    const res = await db.collection(COLLECTION)
      .where({ sourceId, status: 'open' })
      .limit(limit)
      .skip(skip)
      .get()
    const docs = res.data || []
    if (!docs.length) break
    for (const doc of docs) {
      if (!seenIds.has(doc.id)) {
        await db.collection(COLLECTION).doc(doc._id).update({
          data: { status: 'closed', updatedAt: new Date().toISOString() }
        })
        closed++
      }
    }
    skip += docs.length
    if (docs.length < limit) break
  }
  return closed
}

async function syncSource(source) {
  const { items, total } = await fetchFeishu(source)
  const existing = await fetchExisting(source.id)
  const seen = new Set()
  const jobs = []
  let skipped = 0

  for (const item of items) {
    const job = normalizeFeishu(item, source)
    if (!job) {
      skipped++
      continue
    }
    job.fingerprint = fingerprintOf(job)
    seen.add(job.id)
    jobs.push(job)
  }

  let inserted = 0
  let updated = 0
  let unchanged = 0
  const tasks = []
  for (const job of jobs) {
    const old = existing.get(job.id)
    if (!old) {
      tasks.push(async () => {
        await db.collection(COLLECTION).add({ data: finalizeJob(job) })
        inserted++
      })
    } else if (old.fingerprint !== job.fingerprint) {
      tasks.push(async () => {
        await db.collection(COLLECTION).doc(old._id).update({ data: finalizeJob(job) })
        updated++
      })
    } else {
      unchanged++
    }
  }

  await runPool(tasks, 12)
  const closed = await closeMissing(source.id, seen)
  return {
    fetched: items.length,
    total,
    inserted,
    updated,
    unchanged,
    skipped,
    closed
  }
}

exports.main = async (event) => {
  let sources = event && event.sources ? event.sources : SOURCES
  if (event && event.sourceId) {
    sources = sources.filter((source) => source.id === event.sourceId)
  }
  const summary = {}
  await Promise.all(sources.map(async (source) => {
    try {
      summary[source.id] = await syncSource(source)
    } catch (err) {
      summary[source.id] = { error: err && err.message ? err.message : String(err) }
    }
  }))
  return { ok: true, summary }
}
