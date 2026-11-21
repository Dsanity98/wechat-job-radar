const cloud = require('wx-server-sdk')
const https = require('https')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ASSET_URLS = [
  'https://gitee.com/qgauss/job_radar/releases/download/data-latest/jobs.db.gz',
  'https://github.com/lijiaqi-AI-Product-Manager/job_radar/releases/download/data-latest/jobs.db.gz'
]

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
        headers: { 'user-agent': 'Mozilla/5.0 (jobradar-cloud-fetch)' }
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume()
          requestBinary(new URL(res.headers.location, target).toString(), redirectsLeft - 1).then(resolve, reject)
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

async function downloadGz() {
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

exports.main = async () => {
  const gz = await downloadGz()
  const local = path.join(os.tmpdir(), `jobs-${Date.now()}.db.gz`)
  fs.writeFileSync(local, gz)

  const cloudPath = 'radar-snapshot/jobs.db.gz'
  const res = await cloud.uploadFile({
    cloudPath,
    fileContent: fs.createReadStream(local)
  })

  await cloud.database().collection('sync_state').doc('radarAsset').set({
    data: {
      fileID: res.fileID,
      bytes: gz.length,
      updatedAt: new Date().toISOString()
    }
  })

  fs.unlinkSync(local)
  return { ok: true, fileID: res.fileID, bytes: gz.length }
}
