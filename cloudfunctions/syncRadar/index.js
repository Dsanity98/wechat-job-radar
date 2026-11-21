const cloud = require('wx-server-sdk')
const https = require('https')
const http = require('http')
const zlib = require('zlib')
const path = require('path')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const COLLECTION = 'jobs'
const STATE_COLLECTION = 'sync_state'
const STATE_ID = 'jobradar'
const COLLECTION_NAME = 'jobs'

const OFFICIAL_POSITION_SOURCE_IDS = new Set(require('./official-position-source-ids.json'))
const EXCLUDED_SOURCE_IDS = new Set(['bytedance', 'nio', 'xpeng', 'momenta', 'vrfi1sk8a0', 'flexivrobotics'])
const STORE_WORDS = ['门店', '店员', '导购', '收银', '服务员', '咖啡师', '店长', '值班主管']

const ASSET_URLS = [
  'https://gitee.com/qgauss/job_radar/releases/download/data-latest/jobs.db.gz',
  'https://github.com/lijiaqi-AI-Product-Manager/job_radar/releases/download/data-latest/jobs.db.gz'
]

function nowIso() {
  return new Date().toISOString()
}

function requestBinary(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const transport = target.protocol === 'http:' ? http : https
    const req = transport.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { 'user-agent': 'Mozilla/5.0 (jobradar-cloud-sync)' }
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume()
          const next = new URL(res.headers.location, target).toString()
          requestBinary(next, redirectsLeft - 1).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`下载失败 HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      }
    )
    req.setTimeout(55000, () => req.destroy(new Error('download timeout')))
    req.on('error', reject)
    req.end()
  })
}

async function downloadJobsDb() {
  let lastError = null
  for (const url of ASSET_URLS) {
    try {
      return await requestBinary(url)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError || new Error('下载 jobradar 快照失败')
}

async function openSqlite(gzBuffer) {
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  })
  const raw = zlib.gunzipSync(gzBuffer)
  return new SQL.Database(raw)
}

function nameOf(value) {
  if (value && typeof value === 'object') return value.zh_cn || value.name || ''
  return value || ''
}

function parseCities(raw) {
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    const out = []
    for (const item of data) {
      if (typeof item === 'string' && item && out.indexOf(item) < 0) out.push(item)
    }
    return out
  } catch (e) {
    return []
  }
}

function toIsoDate(value) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`
  return ''
}

function fingerprint(job) {
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

function normalizeJob(row) {
  if (!row || !row.id || !row.title || !row.url) return null
  if (!OFFICIAL_POSITION_SOURCE_IDS.has(row.source_id)) return null
  if (EXCLUDED_SOURCE_IDS.has(row.source_id)) return null
  if (STORE_WORDS.some((word) => String(row.title).includes(word))) return null

  const cities = parseCities(row.cities)
  const tags = []
  for (const value of [row.subcategory, row.department, row.batch]) {
    if (value) tags.push(String(value))
  }
  if (row.grad_year) tags.push(String(row.grad_year))

  const job = {
    id: row.id,
    sourceId: 'jobradar',
    sourceJobId: String(row.source_job_id || ''),
    type: row.recruit_type,
    title: row.title,
    company: row.company || '',
    city: cities[0] || '',
    cities,
    salary: '',
    degree: row.degree_min || '',
    experience: row.recruit_type === 'intern' ? '在校生' : '不限',
    category: row.category || '其他',
    tags,
    deadline: String(row.apply_end || ''),
    publishAt: toIsoDate(row.publish_at) || nowIso(),
    description: '',
    requirements: '',
    source: '官方招聘',
    sourceUrl: row.url,
    fingerprint: ''
  }
  job.fingerprint = fingerprint(job)
  job.status = 'open'
  job.updatedAt = nowIso()
  job.isDemo = false
  return job
}

async function getLastSync() {
  try {
    const res = await db.collection(STATE_COLLECTION).doc(STATE_ID).get()
    return res.data && res.data.lastEventTs ? res.data.lastEventTs : ''
  } catch (e) {
    return ''
  }
}

async function saveLastSync(value) {
  try {
    await db.collection(STATE_COLLECTION).doc(STATE_ID).set({
      data: { lastEventTs: value, updatedAt: nowIso() }
    })
  } catch (e) {
    await db.collection(STATE_COLLECTION).add({
      data: { _id: STATE_ID, lastEventTs: value, updatedAt: nowIso() }
    })
  }
}

async function fetchExistingMap(ids) {
  const map = new Map()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const res = await db.collection(COLLECTION)
      .where({ id: _.in(chunk) })
      .field({ id: true })
      .limit(100)
      .get()
    for (const doc of res.data || []) {
      map.set(doc.id, doc._id)
    }
  }
  return map
}

async function applyUpserts(jobs) {
  const existing = await fetchExistingMap(jobs.map((job) => job.id))
  const tasks = []
  for (const job of jobs) {
    const docId = existing.get(job.id)
    if (docId) {
      tasks.push(async () => {
        await db.collection(COLLECTION).doc(docId).update({ data: job })
      })
    } else {
      tasks.push(async () => {
        await db.collection(COLLECTION).add({ data: job })
      })
    }
  }
  await runPool(tasks, 20)
}

async function applyCloses(ids) {
  const existing = await fetchExistingMap(ids)
  const updatedAt = nowIso()
  const tasks = []
  for (const id of ids) {
    const docId = existing.get(id)
    if (!docId) continue
    tasks.push(async () => {
      await db.collection(COLLECTION).doc(docId).update({
        data: { status: 'closed', updatedAt }
      })
    })
  }
  await runPool(tasks, 20)
}

async function runPool(tasks, concurrency) {
  const queue = tasks.slice()
  const workers = []
  const count = Math.max(1, Math.min(concurrency || 12, queue.length))
  for (let i = 0; i < count; i++) {
    workers.push(
      (async () => {
        while (queue.length) {
          await queue.shift()()
        }
      })()
    )
  }
  await Promise.all(workers)
}

async function getAffectedIds(sqlite, lastSync) {
  const sql = `SELECT job_id AS id, type, MAX(ts) AS ts
    FROM job_event
    WHERE ts > '${lastSync}'
    GROUP BY job_id`
  const res = sqlite.exec(sql)
  if (!res.length || !res[0].values.length) return { events: {}, latestTs: lastSync }
  const events = {}
  let latestTs = lastSync
  const columns = res[0].columns
  for (const values of res[0].values) {
    const row = {}
    columns.forEach((column, index) => {
      row[column] = values[index]
    })
    events[row.id] = row.type
    if (row.ts > latestTs) latestTs = row.ts
  }
  return { events, latestTs }
}

async function getJobRow(sqlite, id) {
  const sql = `
    SELECT j.id, j.source_id, j.source_job_id, j.url, j.title,
           j.category, j.subcategory, j.recruit_type, j.grad_year, j.batch,
           j.cities, j.degree_min, j.department, j.apply_end, j.publish_at,
           c.name AS company
    FROM job j JOIN company c ON c.id = j.company_id
    WHERE j.id = ?
  `
  const stmt = sqlite.prepare(sql)
  stmt.bind([id])
  let row = null
  if (stmt.step()) row = stmt.getAsObject()
  stmt.free()
  return row
}

exports.main = async () => {
  const gz = await downloadJobsDb()
  const sqlite = await openSqlite(gz)
  const maxTs = sqlite.exec('SELECT MAX(ts) AS ts FROM job_event')[0].values[0][0]
  const lastSync = await getLastSync()

  if (!lastSync) {
    await saveLastSync(maxTs)
    return { ok: true, firstRun: true, syncPoint: maxTs }
  }

  const { events, latestTs } = await getAffectedIds(sqlite, lastSync)
  const upserts = []
  const closes = []

  for (const [id, type] of Object.entries(events)) {
    const row = await getJobRow(sqlite, id)
    if (type === 'close' || !row) {
      closes.push(id)
    } else {
      const job = normalizeJob(row)
      if (job) upserts.push(job)
    }
  }

  await applyUpserts(upserts)
  await applyCloses(closes)

  await saveLastSync(latestTs)
  return {
    ok: true,
    upserted: upserts.length,
    closed: closes.length,
    syncPoint: latestTs
  }
}
