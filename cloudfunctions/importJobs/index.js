const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLLECTION = 'jobs'

function isValid(job) {
  return !!(
    job &&
    job.id &&
    job.title &&
    job.company &&
    job.type &&
    ['campus', 'intern', 'social'].indexOf(job.type) >= 0
  )
}

function withDefaults(job) {
  return Object.assign(
    {
      status: 'open',
      updatedAt: new Date().toISOString(),
      isDemo: false
    },
    job
  )
}

exports.main = async (event) => {
  const jobs = Array.isArray(event) ? event : event && event.jobs
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { ok: false, message: '请传入 jobs 数组' }
  }

  const inserted = []
  const failed = []

  for (const job of jobs) {
    if (!isValid(job)) {
      failed.push({ id: job && job.id, error: '字段缺失或类型非法' })
      continue
    }
    try {
      const data = withDefaults(job)
      const existed = await db.collection(COLLECTION).where({ id: job.id }).get()
      if (existed.data.length > 0) {
        await db.collection(COLLECTION).doc(existed.data[0]._id).update({ data })
        inserted.push({ id: job.id, action: 'update' })
      } else {
        await db.collection(COLLECTION).add({ data })
        inserted.push({ id: job.id, action: 'insert' })
      }
    } catch (e) {
      failed.push({ id: job.id, error: e.message })
    }
  }

  return {
    ok: true,
    inserted: inserted.length,
    failed
  }
}
