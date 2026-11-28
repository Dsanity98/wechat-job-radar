# 求职进度 · 个人求职进度管理小程序

原生微信小程序，帮助求职者管理自己的求职进度：记录岗位、投递状态、截止提醒与备注，可从岗位参考库检索并一键导入。岗位数据以用户自己添加为主，参考库仅作为检索来源。

## 目录

```text
wechat-job-radar/
  project.config.json
  miniprogram/          # 小程序源码
    pages/
      index/            # 我的求职（进度面板）
      edit/             # 添加 / 编辑岗位
      detail/           # 岗位详情与状态管理
      library/          # 岗位参考库
    components/         # job-card
    services/           # myjobs / jobs
    data/
    config/
  cloudfunctions/       # 云函数
    importJobs/
    syncjobs/           # 参考库数据定时更新
  docs/
```

## 导入运行

1. 用微信开发者工具「导入项目」，选择本目录 `wechat-job-radar`。
2. 当前 `miniprogram/config/index.js` 已配置为 `cloud` 模式，导入后连接云数据库；如需先看演示数据，把 `dataSource` 临时改为 `demo` 即可，无需后端。
3. `project.config.json` 的 `appid` 已填写，正式联调云开发前请确认它就是你自己的小程序 AppID。

## 添加岗位 · 投递状态 · 备注

- 首页「我的求职」集中展示求职进度，按待投递 / 已投递 / 面试中 / Offer / 已结束分类统计。
- 点击右下角「＋」手动添加岗位，或到「参考库」搜索后一键导入。
- 岗位详情可切换投递状态、填写备注、复制投递链接、编辑或删除。
- 截止日期临近时自动高亮提醒。

## 接入微信云开发

1. 在微信开发者工具中开通云开发环境，复制环境 ID。
2. 修改 `miniprogram/config/index.js`：
   - `cloudEnvId` 填入环境 ID；
   - `dataSource` 改为 `cloud`。
3. 在云数据库中创建集合 `jobs`（对应 `config.cloudCollection`）。
4. 设置集合权限为「所有用户可读，仅管理端可写」（岗位是公开内容，仅导入端写入）。
5. 在开发者工具中右键 `cloudfunctions/syncjobs` 和 `cloudfunctions/importJobs`，分别选择「上传并部署：云端安装依赖」。
6. 部署后确认 `syncjobs` 的超时时间不小于 60 秒。若手动运行提示 `statusCode 433`、`Invoking task timed out`，到云开发控制台把 `syncjobs` 的「超时时间」改为 60 秒后再重跑。

## 参考库数据同步（后台自动）

`syncjobs` 云函数已配置每天 08:00 的定时触发器，从公开招聘门户的匿名 JSON 接口拉取岗位并写入 `jobs` 集合，作为参考库的数据来源：

- 已接入：字节跳动（`jobs.bytedance.com/campus`）、蔚来（`nio.jobs.feishu.cn/campus`），覆盖校招与实习。
- 每条岗位保存 `sourceUrl` 具体投递链接，例如 `https://jobs.bytedance.com/campus/position/{id}/detail`。
- 按 `id` 幂等更新；当天接口不再返回的岗位自动标记 `status=closed` 下架，小程序 `cloud` 模式只读 `status=open`。
- 部署后会每天自动执行；也可以在云开发控制台手动运行 `syncjobs` 立即拉一次。

要新增公司或社招源，在 `cloudfunctions/syncjobs/index.js` 的 `SOURCES` 里复制一项并填对应 `base/path`。飞书 ATSX 这套接口是同一套格式，适配小鹏、Momenta、月之暗面等门户时只需改域名和路径。

> 说明：这些是招聘官网公开可读的匿名接口，不绕过登录、验证码或访问限制；但官网改版可能使适配器失效，需要维护。当前 `syncjobs` 默认覆盖校招/实习，社招需另行配置门户或接口。

## 用 GitHub Actions 定时更新 jobsearchradar 快照

仓库已包含 [.github/workflows/sync-radar.yml](.github/workflows/sync-radar.yml)，每天 07:30（北京时间）下载最新 `jobsearchradar` 快照，并把新增、变更、下架岗位增量写入云数据库。

首次启用：

1. 在云开发控制台创建「环境 API Key」。
2. 在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 添加 `CLOUDBASE_API_KEY`，值为上一步生成的 Key。
3. 推送仓库后，在 `Actions` 页手动运行一次 `Sync Job Radar`；首次只记录同步点，不写历史数据。

## 批量回填底库（可选）

`jobsearchradar`（job_radar）是中国校招/实习/社招岗位的开放数据集，MIT 许可，无需 API key。它在 GitHub Actions 定时采集并发布快照，适合作为稳定底库。

1. 准备本地环境并下载最新快照：

   ```bash
   pip install --upgrade "jobsearchradar[mcp]==2.2.1"
   jobradar update
   ```

2. 导出岗位 JSON（字段与筛选参数以 `jobradar --help` 为准）：

   ```bash
   jobradar search --type campus --limit 500 --no-dedupe > data/campus.json
   jobradar search --type intern --limit 500 --no-dedupe > data/intern.json
   jobradar search --type social --limit 500 --no-dedupe > data/social.json
   ```

3. 把导出的字段归一化为本项目的岗位结构（`id/type/title/company/city/salary/degree/experience/category/tags/deadline/publishAt/description/requirements/source/sourceUrl`），并补 `status: "open"`，再通过以下任一方式导入 `jobs` 集合：
   - 小批量：调用云函数 `importJobs`，传入 `{ "jobs": [...] }`；
   - 大批量：在云数据库控制台用「导入」上传 JSON/CSV。

> 注意：`jobsearchradar` 是定时更新的历史快照，不是秒级实时接口；导入前请核对 `data_as_of` 与原始链接。BOSS直聘、拉勾、智联、51job、猎聘、牛客、实习僧等平台没有面向个人的免费公开实时接口，请勿绕过登录、验证码或访问限制抓取。

## 字段口径

岗位对象示例：

```json
{
  "id": "campus-001",
  "type": "campus",
  "title": "后端开发工程师",
  "company": "腾讯",
  "city": "深圳",
  "salary": "22-30K·14薪",
  "degree": "本科",
  "experience": "应届",
  "category": "后端",
  "tags": ["Go", "分布式"],
  "deadline": "2026-12-31",
  "publishAt": "2026-11-18T09:00:00.000Z",
  "description": "岗位职责",
  "requirements": "任职要求",
  "source": "来源",
  "sourceUrl": "原文链接",
  "isDemo": false
}
```

`type` 取 `campus | intern | social`；`publishAt` 统一使用 ISO 字符串，保证列表排序稳定。

## 验证

- `node --check` 已用于检查各 JavaScript 文件的语法。
- WXML/WXSS 需在微信开发者工具中编译，真机能力需在设备上验证。
- 云数据库真实读写需在完成环境配置和部署后联调。
