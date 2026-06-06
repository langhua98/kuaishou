"""
视频搜索 - 个人学习用途
支持 B站 (bilibili) 和 快手 (Kuaishou) 双源搜索。
架构: FastAPI + curl_cffi (伪装 Chrome TLS 指纹绕过反爬)
"""

import hashlib
import os
import re
import time
import urllib.parse
from contextlib import asynccontextmanager

from curl_cffi.requests import AsyncSession
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

MAX_RESULTS = int(os.getenv("MAX_RESULTS", "20"))

BILI_HOME   = "https://www.bilibili.com/"
BILI_NAV    = "https://api.bilibili.com/x/web-interface/nav"
BILI_SEARCH = "https://api.bilibili.com/x/web-interface/search/type"

KUAISHOU_COOKIE = os.getenv("KUAISHOU_COOKIE", "")
_KS_GQL = "https://www.kuaishou.com/graphql"
_KS_QUERY = (
    "query visionSearchPhoto($keyword:String,$pcursor:String,$page:String){"
    "visionSearchPhoto(keyword:$keyword,pcursor:$pcursor,page:$page){"
    "result feeds{photo{"
    "...on PhotoEntity{id caption coverUrl photoUrl likeCount viewCount}"
    "...on recoPhotoEntity{id caption coverUrl photoUrl likeCount viewCount}"
    "}author{name}}}}"
)

_WBI_TAB = [
    46,47,18, 2,53, 8,23,32,15,50,10,31,58, 3,45,35,
    27,43, 5,49,33, 9,42,19,29,28,14,39,12,38,41,13,
    37,48, 7,16,24,55,40,61,26,17, 0, 1,60,51,30, 4,
    22,25,54,21,56,59, 6,63,57,62,11,36,20,34,44,52,
]

_session: AsyncSession | None = None
_wbi_img_key: str = ""
_wbi_sub_key: str = ""


def _mixin_key(img: str, sub: str) -> str:
    raw = img + sub
    return "".join(raw[i] for i in _WBI_TAB if i < len(raw))[:32]


def _sign(params: dict) -> dict:
    p = dict(params)
    p["wts"] = str(int(time.time()))
    items = sorted(p.items())
    qs = urllib.parse.urlencode([
        (k, re.sub(r"[!'()*]", "", str(v)))
        for k, v in items
    ])
    p["w_rid"] = hashlib.md5((qs + _mixin_key(_wbi_img_key, _wbi_sub_key)).encode()).hexdigest()
    return p


async def get_session() -> AsyncSession:
    global _session, _wbi_img_key, _wbi_sub_key
    if _session is None:
        _session = AsyncSession(impersonate="chrome124")
        try:
            await _session.get(BILI_HOME, headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9",
            })
            print("[bilibili] 首页预热完成")
        except Exception as e:
            print(f"[bilibili] 首页预热失败: {e}")
        try:
            r = await _session.get(BILI_NAV, headers={"Referer": BILI_HOME})
            wbi = r.json().get("data", {}).get("wbi_img", {})
            _wbi_img_key = wbi.get("img_url", "").rsplit("/", 1)[-1].split(".")[0]
            _wbi_sub_key = wbi.get("sub_url", "").rsplit("/", 1)[-1].split(".")[0]
            print("[bilibili] wbi keys 获取成功")
        except Exception as e:
            print(f"[bilibili] wbi keys 获取失败: {e}")
    return _session


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "")


async def search_bilibili(keyword: str) -> list:
    session = await get_session()
    params = _sign({
        "keyword": keyword,
        "search_type": "video",
        "page": 1,
        "pagesize": MAX_RESULTS,
        "order": "totalrank",
    })
    referer = f"https://search.bilibili.com/all?keyword={urllib.parse.quote(keyword)}&search_source=5"
    resp = await session.get(BILI_SEARCH, params=params, headers={
        "Referer": referer,
        "Origin": "https://search.bilibili.com",
    })
    if not resp.text.strip():
        raise ValueError(f"B站返回空响应 (HTTP {resp.status_code})")
    if not resp.text.strip().startswith("{"):
        raise ValueError(f"B站返回非JSON响应 (HTTP {resp.status_code}): {resp.text[:80]}")
    data = resp.json()
    if data.get("code") != 0:
        raise ValueError(f"B站 API code={data.get('code')}: {data.get('message')}")

    items = (data.get("data") or {}).get("result") or []
    results = []
    for item in items[:MAX_RESULTS]:
        bvid = item.get("bvid") or ""
        pic = item.get("pic", "")
        if pic.startswith("//"):
            pic = "https:" + pic
        results.append({
            "id": bvid,
            "caption": strip_html(item.get("title", "")),
            "author": item.get("author", ""),
            "cover": pic,
            "pageUrl": f"https://www.bilibili.com/video/{bvid}" if bvid else item.get("arcurl", ""),
            "play": item.get("play", 0),
            "duration": item.get("duration", ""),
        })
    return results


async def search_kuaishou(keyword: str) -> list:
    if not KUAISHOU_COOKIE:
        raise ValueError("KUAISHOU_COOKIE 未配置，请在 Railway 环境变量中设置")
    # Reuse the persistent bilibili session (Chrome124 TLS fingerprint, different domain so cookies don't mix)
    s = await get_session()
    resp = await s.post(
        _KS_GQL,
        json={
            "operationName": "visionSearchPhoto",
            "variables": {"keyword": keyword, "pcursor": "", "page": "search"},
            "query": _KS_QUERY,
        },
        headers={
            "Cookie": KUAISHOU_COOKIE,
            "Referer": "https://www.kuaishou.com/",
            "Origin": "https://www.kuaishou.com",
            "Content-Type": "application/json",
        },
        timeout=20,
    )
    data = resp.json()
    feeds = (data.get("data") or {}).get("visionSearchPhoto", {}).get("feeds") or []
    results = []
    for feed in feeds[:MAX_RESULTS]:
        photo = feed.get("photo") or {}
        vid = photo.get("id", "")
        if not vid:
            continue
        results.append({
            "id": vid,
            "caption": photo.get("caption", ""),
            "author": (feed.get("author") or {}).get("name", ""),
            "cover": photo.get("coverUrl", ""),
            "videoUrl": photo.get("photoUrl", ""),
            "likes": str(photo.get("likeCount", "")),
            "views": str(photo.get("viewCount", "")),
        })
    return results


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_session()
    yield
    if _session:
        await _session.close()


app = FastAPI(title="视频搜索", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/search")
async def api_search(keyword: str = Query(..., min_length=1)):
    try:
        results = await search_bilibili(keyword)
        return JSONResponse({"ok": True, "count": len(results), "results": results})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/ks/debug")
async def api_ks_debug(keyword: str = Query(..., min_length=1)):
    if not KUAISHOU_COOKIE:
        return JSONResponse({"error": "no cookie"})
    s = await get_session()
    resp = await s.post(
        _KS_GQL,
        json={"operationName": "visionSearchPhoto",
              "variables": {"keyword": keyword, "pcursor": "", "page": "search"},
              "query": _KS_QUERY},
        headers={"Cookie": KUAISHOU_COOKIE, "Referer": "https://www.kuaishou.com/",
                 "Origin": "https://www.kuaishou.com", "Content-Type": "application/json"},
        timeout=20,
    )
    return JSONResponse(resp.json())


@app.get("/api/ks/search")
async def api_ks_search(keyword: str = Query(..., min_length=1)):
    try:
        results = await search_kuaishou(keyword)
        return JSONResponse({"ok": True, "count": len(results), "results": results})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTML_PAGE


HTML_PAGE = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>视频搜索</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
body { font-family: -apple-system, "PingFang SC", sans-serif; background: #f2f2f7; color: #1c1c1e; min-height: 100vh; }
header { position: sticky; top: 0; z-index: 100; background: rgba(255,255,255,.95); backdrop-filter: blur(12px); border-bottom: 1px solid #e5e5ea; padding: 10px 14px 8px; }
.tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.tab { flex: 1; padding: 8px; border: 1.5px solid #d1d1d6; border-radius: 20px; font-size: 14px; font-weight: 600; background: #f2f2f7; color: #8e8e93; cursor: pointer; }
.tab.active { background: #fb7299; border-color: #fb7299; color: #fff; }
.search-row { display: flex; gap: 8px; }
.search-row input { flex: 1; padding: 10px 16px; border: 1.5px solid #d1d1d6; border-radius: 24px; font-size: 15px; outline: none; background: #f2f2f7; }
.search-row input:focus { border-color: #fb7299; background: #fff; }
.search-row button { padding: 10px 18px; background: #fb7299; color: #fff; border: none; border-radius: 24px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.search-row button:disabled { opacity: .45; }
.status { padding: 10px 14px; font-size: 13px; color: #8e8e93; min-height: 36px; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 0 10px 30px; }
.card { background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); cursor: pointer; }
.card img { width: 100%; aspect-ratio: 16/10; object-fit: cover; display: block; background: #eee; }
.card .info { padding: 8px 10px 10px; }
.card .cap { font-size: 13px; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.card .meta { font-size: 11px; color: #aeaeb2; margin-top: 4px; }
.card .open { display: inline-block; margin-top: 6px; font-size: 12px; color: #fb7299; text-decoration: none; }
.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #e5e5ea; border-top-color: #fb7299; border-radius: 50%; animation: spin .7s linear infinite; vertical-align: middle; margin-right: 6px; }
@keyframes spin { to { transform: rotate(360deg); } }
#player-modal { display: none; position: fixed; inset: 0; z-index: 300; background: #000; flex-direction: column; }
#player-modal.open { display: flex; }
#player-bar { display: flex; align-items: center; padding: 10px 14px; background: #111; flex-shrink: 0; }
#player-bar span { color: #fff; font-size: 14px; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#player-bar button { background: none; border: none; color: #fb7299; font-size: 15px; font-weight: 600; cursor: pointer; padding: 4px 10px; flex-shrink: 0; }
#player-frame { flex: 1; width: 100%; border: none; }
#ks-modal { display: none; position: fixed; inset: 0; z-index: 300; background: #000; flex-direction: column; }
#ks-modal.open { display: flex; }
#ks-bar { display: flex; align-items: center; padding: 10px 14px; background: #111; flex-shrink: 0; }
#ks-bar span { color: #fff; font-size: 14px; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#ks-bar button { background: none; border: none; color: #fb7299; font-size: 15px; font-weight: 600; cursor: pointer; padding: 4px 10px; flex-shrink: 0; }
#ks-video { flex: 1; width: 100%; background: #000; }
</style>
</head>
<body>
<header>
  <div class="tabs">
    <button class="tab active" id="tab-bili" onclick="setSource('bili')">📺 B站</button>
    <button class="tab" id="tab-ks" onclick="setSource('ks')">🎬 快手</button>
  </div>
  <div class="search-row">
    <input id="kw" type="search" placeholder="搜索视频…" enterkeyhint="search">
    <button id="btn" onclick="doSearch()">搜索</button>
  </div>
</header>
<div class="status" id="status">输入关键词开始搜索，无需登录。</div>
<div class="grid" id="grid"></div>

<div id="player-modal">
  <div id="player-bar">
    <span id="player-title"></span>
    <button onclick="closePlayer()">✕ 关闭</button>
  </div>
  <iframe id="player-frame" src="" allowfullscreen allow="autoplay; fullscreen"></iframe>
</div>

<div id="ks-modal">
  <div id="ks-bar">
    <span id="ks-title"></span>
    <button onclick="closeKs()">✕ 关闭</button>
  </div>
  <video id="ks-video" controls playsinline autoplay style="flex:1;width:100%;background:#000"></video>
</div>

<script>
const esc = s => (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
let source = 'bili';

function setSource(s) {
  source = s;
  document.getElementById('tab-bili').classList.toggle('active', s === 'bili');
  document.getElementById('tab-ks').classList.toggle('active', s === 'ks');
  document.getElementById('grid').innerHTML = '';
  document.getElementById('status').textContent = s === 'bili' ? '输入关键词开始搜索，无需登录。' : '输入关键词搜索快手视频。';
}

document.getElementById("kw").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); doSearch(); }
});

function openPlayer(bvid, title) {
  document.getElementById("player-title").textContent = title || "";
  document.getElementById("player-frame").src = "https://player.bilibili.com/player.html?bvid=" + bvid + "&autoplay=1&danmaku=0&high_quality=1";
  document.getElementById("player-modal").classList.add("open");
}
function closePlayer() {
  document.getElementById("player-frame").src = "";
  document.getElementById("player-modal").classList.remove("open");
}

function openKs(videoUrl, title) {
  document.getElementById("ks-title").textContent = title || "";
  document.getElementById("ks-video").src = videoUrl;
  document.getElementById("ks-modal").classList.add("open");
}
function closeKs() {
  const v = document.getElementById("ks-video");
  v.pause(); v.src = "";
  document.getElementById("ks-modal").classList.remove("open");
}

async function doSearch() {
  const kw = document.getElementById("kw").value.trim();
  if (!kw) return;
  const btn = document.getElementById("btn");
  const status = document.getElementById("status");
  const grid = document.getElementById("grid");
  btn.disabled = true; grid.innerHTML = "";
  status.innerHTML = '<span class="spinner"></span>搜索中…';
  try {
    const url = source === 'bili'
      ? "/api/search?keyword=" + encodeURIComponent(kw)
      : "/api/ks/search?keyword=" + encodeURIComponent(kw);
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) { status.textContent = "出错：" + (data.error || JSON.stringify(data)); return; }
    status.textContent = data.count > 0 ? "找到 " + data.count + " 条结果" : "未找到结果";
    for (const v of data.results) {
      const card = document.createElement("div");
      card.className = "card";
      const cover = v.cover
        ? '<img src="' + esc(v.cover) + '" referrerpolicy="no-referrer" loading="lazy">'
        : '<div style="aspect-ratio:16/10;background:#eee"></div>';
      if (source === 'bili') {
        card.onclick = () => openPlayer(v.id, v.caption);
        const playNum = typeof v.play === "number" ? v.play.toLocaleString() + " 播放" : "";
        card.innerHTML = cover +
          '<div class="info">' +
            '<div class="cap">' + esc(v.caption || "(无标题)") + '</div>' +
            '<div class="meta">' + esc(v.author || "") + (playNum ? " · " + playNum : "") + (v.duration ? " · " + esc(v.duration) : "") + '</div>' +
            (v.pageUrl ? '<a class="open" href="' + esc(v.pageUrl) + '" target="_blank" onclick="event.stopPropagation()">去B站看 ↗</a>' : '') +
          '</div>';
      } else {
        card.onclick = () => openKs(v.videoUrl, v.caption);
        card.innerHTML = cover +
          '<div class="info">' +
            '<div class="cap">' + esc(v.caption || "(无标题)") + '</div>' +
            '<div class="meta">' + esc(v.author || "") + (v.views ? " · " + esc(v.views) + "次看" : "") + '</div>' +
          '</div>';
      }
      grid.appendChild(card);
    }
  } catch(e) {
    status.textContent = "请求失败：" + e.message;
  } finally {
    btn.disabled = false;
  }
}
</script>
</body>
</html>
"""
