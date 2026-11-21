import glob
import hashlib
import json
import os
import sqlite3
import subprocess
from datetime import datetime, timezone

try:
    from jobradar.source_catalog import catalog
    OFFICIAL_POSITION_SOURCE_IDS = {
        source_id
        for source_id, meta in catalog().items()
        if meta.get("source_kind") == "official" and meta.get("record_kind") == "position"
    }
except Exception:
    OFFICIAL_POSITION_SOURCE_IDS = None


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data", "radar")
LAST_SYNC = os.path.join(DATA_DIR, ".last-sync.txt")
ENV_ID = os.environ.get("CLOUDBASE_ENV_ID", "cloud1-d5gozm7zv06d1d98f")
COLLECTION = "jobs"
CLI_DIR = os.path.join(ROOT, "tools", "cloudbase-cli")
CLI_BIN = os.environ.get(
    "CLOUDBASE_CLI_BIN",
    os.path.join(CLI_DIR, "node_modules", ".bin", "tcb"),
)
CLI_HOME = os.environ.get(
    "CLOUDBASE_HOME",
    os.path.join(ROOT, "tools", "cloudbase-home"),
)
CLI_CONFIG = os.environ.get(
    "CLOUDBASE_CONFIG",
    os.path.join(ROOT, "tools", "cloudbase-config"),
)
EXCLUDED_SOURCE_IDS = ("bytedance", "nio", "xpeng", "momenta", "vrfi1sk8a0", "flexivrobotics")
STORE_WORDS = ("门店", "店员", "导购", "收银", "服务员", "咖啡师", "店长", "值班主管")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def find_jobs_db():
    home = os.environ.get("JOBRADAR_HOME", os.path.expanduser("~/.cache/jobradar"))
    candidates = sorted(glob.glob(os.path.join(home, "snapshots", "*", "jobs.db")), reverse=True)
    if not candidates:
        raise SystemExit("找不到 jobradar 快照，先运行 jobradar update")
    return candidates[0]


def iso_date(value):
    if not value:
        return ""
    text = str(value).strip()
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        try:
            return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            return ""
    return ""


def parse_cities(raw):
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    out = []
    for item in data:
        if isinstance(item, str) and item and item not in out:
            out.append(item)
    return out


def fingerprint(job):
    content = {
        "title": job["title"],
        "company": job["company"],
        "type": job["type"],
        "city": job["city"],
        "cities": job["cities"],
        "salary": job["salary"],
        "degree": job["degree"],
        "experience": job["experience"],
        "category": job["category"],
        "tags": job["tags"],
        "deadline": job["deadline"],
        "publishAt": job["publishAt"],
        "description": job["description"],
        "requirements": job["requirements"],
        "sourceUrl": job["sourceUrl"],
    }
    return hashlib.sha1(json.dumps(content, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def normalize(row):
    (
        job_id, source_id, source_job_id, url, title, category, subcategory,
        recruit_type, grad_year, batch, cities_raw, degree_min, department,
        apply_end, publish_at, company,
    ) = row
    if not job_id or not title or not url:
        return None
    if OFFICIAL_POSITION_SOURCE_IDS is not None and source_id not in OFFICIAL_POSITION_SOURCE_IDS:
        return None
    if source_id in EXCLUDED_SOURCE_IDS:
        return None
    if any(word in title for word in STORE_WORDS):
        return None

    cities = parse_cities(cities_raw)
    tags = []
    for value in (subcategory, department, batch):
        if value:
            tags.append(str(value))
    if grad_year:
        tags.append(str(grad_year))

    job = {
        "id": job_id,
        "sourceId": "jobradar",
        "sourceJobId": str(source_job_id or ""),
        "type": recruit_type,
        "title": title,
        "company": company or "",
        "city": cities[0] if cities else "",
        "cities": cities,
        "salary": "",
        "degree": degree_min or "",
        "experience": "在校生" if recruit_type == "intern" else "不限",
        "category": category or "其他",
        "tags": tags,
        "deadline": str(apply_end or ""),
        "publishAt": iso_date(publish_at) or now_iso(),
        "description": "",
        "requirements": "",
        "source": "官方招聘",
        "sourceUrl": url,
        "fingerprint": "",
    }
    job["fingerprint"] = fingerprint(job)
    job["status"] = "open"
    job["updatedAt"] = now_iso()
    job["isDemo"] = False
    return job


def load_last_sync():
    if os.path.exists(LAST_SYNC):
        return open(LAST_SYNC, encoding="utf-8").read().strip()
    return None


def save_last_sync(value):
    os.makedirs(DATA_DIR, exist_ok=True)
    open(LAST_SYNC, "w", encoding="utf-8").write(value)


def cli(command_json):
    env = os.environ.copy()
    env["HOME"] = CLI_HOME
    env["XDG_CONFIG_HOME"] = CLI_CONFIG
    proc = subprocess.run(
        [
            CLI_BIN,
            "db",
            "nosql",
            "execute",
            "-e",
            ENV_ID,
            "--json",
            "--command",
            command_json,
        ],
        cwd=CLI_DIR,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or f"CLI 返回 {proc.returncode}")


def batch(items, size=80):
    out = []
    for i in range(0, len(items), size):
        out.append(items[i : i + size])
    return out


def apply_upserts(jobs):
    inserted = 0
    for chunk in batch(jobs):
        command = {
            "update": COLLECTION,
            "updates": [
                {
                    "q": {"id": job["id"]},
                    "u": {"$set": job},
                    "upsert": True,
                    "multi": False,
                }
                for job in chunk
            ],
        }
        wrapper = json.dumps(
            [{"TableName": COLLECTION, "CommandType": "UPDATE", "Command": json.dumps(command, ensure_ascii=False)}],
            ensure_ascii=False,
        )
        cli(wrapper)
        inserted += len(chunk)
    return inserted


def apply_closes(ids):
    closed = 0
    updated_at = now_iso()
    for chunk in batch(ids):
        command = {
            "update": COLLECTION,
            "updates": [
                {
                    "q": {"id": job_id},
                    "u": {"$set": {"status": "closed", "updatedAt": updated_at}},
                    "upsert": False,
                    "multi": False,
                }
                for job_id in chunk
            ],
        }
        wrapper = json.dumps(
            [{"TableName": COLLECTION, "CommandType": "UPDATE", "Command": json.dumps(command, ensure_ascii=False)}],
            ensure_ascii=False,
        )
        cli(wrapper)
        closed += len(chunk)
    return closed


def main():
    con = sqlite3.connect(find_jobs_db())
    con.row_factory = sqlite3.Row

    max_event = con.execute("select max(ts) from job_event").fetchone()[0]
    last_sync = load_last_sync()
    if not last_sync:
        save_last_sync(max_event or now_iso())
        print(f"首次运行：已记录当前快照时间 {max_event}，不做回放")
        con.close()
        return

    events = con.execute("select job_id, type, max(ts) as ts from job_event where ts > ? group by job_id", (last_sync,)).fetchall()
    latest_by_job = {}
    latest_ts = last_sync
    for event in events:
        latest_by_job[event["job_id"]] = event["type"]
        if event["ts"] > latest_ts:
            latest_ts = event["ts"]

    upserts = []
    closes = []
    for job_id, event_type in latest_by_job.items():
        row = con.execute(
            """
            SELECT j.id, j.source_id, j.source_job_id, j.url, j.title,
                   j.category, j.subcategory, j.recruit_type, j.grad_year, j.batch,
                   j.cities, j.degree_min, j.department, j.apply_end, j.publish_at,
                   c.name
            FROM job j JOIN company c ON c.id = j.company_id
            WHERE j.id = ?
            """,
            (job_id,),
        ).fetchone()
        if event_type == "close" or row is None or row["closed_at"]:
            closes.append(job_id)
            continue
        job = normalize(row)
        if job:
            upserts.append(job)

    upsert_count = apply_upserts(upserts)
    close_count = apply_closes(closes)
    save_last_sync(latest_ts)
    print(f"增量完成：新增/更新 {upsert_count} 条，下架 {close_count} 条；同步点 {latest_ts}")
    con.close()


if __name__ == "__main__":
    main()
