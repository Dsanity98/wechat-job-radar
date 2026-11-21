import glob
import hashlib
import json
import os
import sqlite3
import sys
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


SNAPSHOT_HOME = os.environ.get("JOBRADAR_HOME", os.path.expanduser("~/.cache/jobradar"))
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "radar")
MAX_FILE_BYTES = 45 * 1024 * 1024
STORE_WORDS = ("门店", "店员", "导购", "收银", "服务员", "咖啡师", "店长", "值班主管")
EXCLUDED_SOURCE_IDS = ("bytedance", "nio", "xpeng", "momenta", "vrfi1sk8a0", "flexivrobotics")


def find_jobs_db():
    candidates = sorted(glob.glob(os.path.join(SNAPSHOT_HOME, "snapshots", "*", "jobs.db")), reverse=True)
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
        job_id,
        source_id,
        source_job_id,
        url,
        title,
        category,
        subcategory,
        recruit_type,
        grad_year,
        batch,
        cities_raw,
        degree_min,
        department,
        apply_end,
        publish_at,
        company,
    ) = row
    if not job_id or not title or not url:
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
        "publishAt": iso_date(publish_at) or datetime.now(timezone.utc).isoformat(),
        "description": "",
        "requirements": "",
        "source": "官方招聘",
        "sourceUrl": url,
        "fingerprint": "",
    }
    job["fingerprint"] = fingerprint(job)
    job["status"] = "open"
    job["updatedAt"] = datetime.now(timezone.utc).isoformat()
    job["isDemo"] = False
    return job


def main():
    db_path = find_jobs_db()
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    store_clause = " AND ".join(["title NOT LIKE ?"] * len(STORE_WORDS))
    exclude_source_clause = " AND ".join(["j.source_id != ?"] * len(EXCLUDED_SOURCE_IDS))
    sql = f"""
        SELECT
          j.id, j.source_id, j.source_job_id, j.url, j.title,
          j.category, j.subcategory, j.recruit_type, j.grad_year, j.batch,
          j.cities, j.degree_min, j.department, j.apply_end, j.publish_at,
          c.name
        FROM job j
        JOIN company c ON c.id = j.company_id
        WHERE j.closed_at IS NULL
          AND ({exclude_source_clause})
          AND ({store_clause})
        ORDER BY j.publish_at DESC, j.id
    """
    params = list(EXCLUDED_SOURCE_IDS) + [f"%{w}%" for w in STORE_WORDS]
    os.makedirs(OUT_DIR, exist_ok=True)

    part_no = 0
    current_size = 0
    handle = None
    total = 0

    for row in con.execute(sql, params):
        job = normalize(row)
        if not job:
            continue
        if OFFICIAL_POSITION_SOURCE_IDS is not None and row["source_id"] not in OFFICIAL_POSITION_SOURCE_IDS:
            continue
        line = json.dumps(job, ensure_ascii=False, separators=(",", ":")) + "\n"
        if handle is None or current_size + len(line.encode("utf-8")) > MAX_FILE_BYTES:
            if handle is not None:
                handle.close()
            part_no += 1
            path = os.path.join(OUT_DIR, f"radar-jobs-part-{part_no:03d}.json")
            handle = open(path, "w", encoding="utf-8")
            current_size = 0
        handle.write(line)
        current_size += len(line.encode("utf-8"))
        total += 1

    if handle is not None:
        handle.close()
    con.close()

    print(f"导出完成：{total} 条，共 {part_no} 个文件")
    print(OUT_DIR)


if __name__ == "__main__":
    main()
