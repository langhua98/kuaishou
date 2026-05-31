"""
B站搜索 - 个人学习用途
====================================================
使用哔哩哔哩公开搜索 API，无需登录，直接返回视频列表。
架构: FastAPI + httpx (纯 HTTP，无需浏览器)
"""

import hashlib
import os
import re
import time
import urllib.parse
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

MAX_RESULTS = int(os.getenv("MAX_RESULTS", "20"))

BILI_SEARCH  = "https://api.bilibili.com/x/web-interface/search/type"
BILI_NAV     = "https://api.bilibili.com/x/web-interface/nav"
BILI_FINGER  = "https://api.bilibili.com/x/frontend/finger/spi"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bilibili.com",
    "Origin":  "https://www.bilibili.com",
}

# B站 wbi 签名用的乱序表
_WBI_TAB = [
    46,47,18, 2,53, 8,23,32,15,50,10,31,58, 3,45,35,
    27,43, 5,49,33, 9,42,19,29,28,14,39,12,38,41,13,
    37,48, 7,16,24,55,40,61,26,17, 0, 1,60,51,30, 4,
    22,25,54,21,56,59, 6,63,57,62,11,36,20,34,44,52,
]

_client: httpx.AsyncClient | None = None
_wbi_img_key: str = ""
_wbi_sub_key: str = ""


def _mixin_key(img: str, sub: str) -> str:
    raw = img + sub
    return "".join(raw[i] for i in _WBI_TAB if i < len(raw))[:32]


def _sign(params: dict) -> dict:
    """给参数字典附加 wts + w_rid 签名"""
    p = dict(params)
    p["wts"] = str(int(time.time()))
    items = sorted(p.items())
    qs = urllib.parse.urlencode([
        (k, re.sub(r"[!'()*]", "", str(v)))
        for k, v in items
    ])
    p["w_rid"] = hashlib.md5((qs + _mixin_key(_wbi_img_key, _wbi_sub_key)).encode()).hexdigest()
    return p


async def get_client() -> httpx.AsyncClient:
    global _client, _wbi_img_key, _wbi_sub_key
    if _client is None:
        _client = httpx.AsyncClient(headers=HEADERS, timeout=15, follow_redirects=True)
        # 1. 通过 finger/spi 获取 buvid（不依赖首页，云服务器 IP 也能拿到）
        try:
            r = await _client.get(BILI_FINGER)
            finger = r.json().get("data", {})
            b3 = finger.get("b_3", "")
            b4 = finger.get("b_4", "")
            if b3:
                _client.cookies.set("buvid3", b3, domain=".bilibili.com")
            if b4:
                _client.cookies.set("buvid4", b4, domain=".bilibili.com")
            print(f"[bilibili] buvid 获取成功: {b3[:8]}...")
        except Exception as e:
            print(f"[bilibili] buvid 获取失败: {e}")
        # 2. 获取 wbi 签名密钥
        try:
            r = await _client.get(BILI_NAV)
            wbi = r.json().get("data", {}).get("wbi_img", {})
            _wbi_img_key = wbi.get("img_url", "").rsplit("/", 1)[-1].split(".")[0]
            _wbi_sub_key = wbi.get("sub_url", "").rsplit("/", 1)[-1].split(".")[0]
            print(f"[bilibili] wbi keys 获取成功")
        except Exception as e:
            print(f"[bilibili] wbi keys 获取失败: {e}")
    return _client


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "")


async def search_bilibili(keyword: str) -> list:
    client = await get_client()
    params = _sign({
        "keyword": keyword,
        "search_type": "video",
        "page": 1,
        "pagesize": MAX_RESULTS,
        "order": "totalrank",
    })
    resp = await client.get(BILI_SEARCH, params=params)
    # 如果响应为空或非 JSON，先记录原始内容方便排查
    raw = resp.text
    if not raw.strip():
        raise ValueError(f"B站返回空响应 (HTTP {resp.status_code})")
    resp.raise_for_status()
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_client()  # 启动时预热，获取 B站 必要 cookie
    yield
    if _client:
        await _client.aclose()


app = FastAPI(title="B站搜索", lifespan=lifespan)

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


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTML_PAGE


HTML_PAGE = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>B站搜索</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, "PingFang SC", sans-serif;
       background: #f2f2f7; color: #1c1c1e; min-height: 100vh; }
header { position: sticky; top: 0; z-index: 100;
         background: rgba(255,255,255,.95); backdrop-filter: blur(12px);
         border-bottom: 1px solid #e5e5ea; padding: 12px 14px 10px; }
.row1 { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.logo { font-size: 16px; font-weight: 700; flex: 1; color: #fb7299; }
.search-row { display: flex; gap: 8px; }
.search-row input { flex: 1; padding: 10px 16px; border: 1.5px solid #d1d1d6;
                    border-radius: 24px; font-size: 15px; outline: none; background: #f2f2f7; }
.search-row input:focus { border-color: #fb7299; background: #fff; }
.search-row button { padding: 10px 18px; background: #fb7299; color: #fff;
                     border: none; border-radius: 24px; font-size: 15px;
                     font-weight: 600; cursor: pointer; white-space: nowrap; }
.search-row button:disabled { opacity: .45; }
.status { padding: 10px 14px; font-size: 13px; color: #8e8e93; min-height: 36px; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr);
        gap: 10px; padding: 0 10px 30px; }
.card { background: #fff; border-radius: 14px; overflow: hidden;
        box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.card img { width: 100%; aspect-ratio: 16/10; object-fit: cover; display: block; background: #eee; }
.card .info { padding: 8px 10px 10px; }
.card .cap { font-size: 13px; line-height: 1.4; overflow: hidden;
             display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.card .meta { font-size: 11px; color: #aeaeb2; margin-top: 4px; }
.card a { display: inline-block; margin-top: 6px; font-size: 12px;
          color: #fb7299; text-decoration: none; }
.spinner { display: inline-block; width: 16px; height: 16px;
           border: 2px solid #e5e5ea; border-top-color: #fb7299;
           border-radius: 50%; animation: spin .7s linear infinite;
           vertical-align: middle; margin-right: 6px; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<header>
  <div class="row1"><span class="logo">📺 B站搜索</span></div>
  <div class="search-row">
    <input id="kw" type="search" placeholder="搜索B站视频…" enterkeyhint="search">
    <button id="btn" onclick="doSearch()">搜索</button>
  </div>
</header>
<div class="status" id="status">输入关键词开始搜索，无需登录。</div>
<div class="grid" id="grid"></div>
<script>
const esc = s => (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
document.getElementById("kw").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); doSearch(); }
});
async function doSearch() {
  const kw = document.getElementById("kw").value.trim();
  if (!kw) return;
  const btn = document.getElementById("btn");
  const status = document.getElementById("status");
  const grid = document.getElementById("grid");
  btn.disabled = true;
  grid.innerHTML = "";
  status.innerHTML = '<span class="spinner"></span>搜索中…';
  try {
    const res = await fetch("/api/search?keyword=" + encodeURIComponent(kw));
    const data = await res.json();
    if (!data.ok) { status.textContent = "出错：" + (data.error || JSON.stringify(data)); return; }
    status.textContent = data.count > 0 ? "找到 " + data.count + " 条结果" : "未找到结果";
    for (const v of data.results) {
      const card = document.createElement("div");
      card.className = "card";
      const playNum = typeof v.play === "number" ? v.play.toLocaleString() + " 播放" : "";
      card.innerHTML =
        (v.cover ? '<img src="' + esc(v.cover) + '" referrerpolicy="no-referrer" loading="lazy">' : '<div style="aspect-ratio:16/10;background:#eee"></div>') +
        '<div class="info">' +
          '<div class="cap">' + esc(v.caption || "(无标题)") + '</div>' +
          '<div class="meta">' + esc(v.author || "") + (playNum ? " · " + playNum : "") + (v.duration ? " · " + esc(v.duration) : "") + '</div>' +
          (v.pageUrl ? '<a href="' + esc(v.pageUrl) + '" target="_blank">去B站看 ↗</a>' : '') +
        '</div>';
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
