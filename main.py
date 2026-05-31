"""
快手搜索 - 最小可运行版本 (个人学习用途)
================================================
架构: FastAPI(Web服务) + Playwright(浏览器自动化抓取) + 内嵌前端页面

工作原理:
  1. 用真实浏览器打开快手搜索页, 让它自己执行 JS / 生成签名
  2. 监听浏览器发出的所有网络响应, 把像"视频数据"的 JSON 收集起来
  3. 递归扫描这些 JSON, 启发式地把视频对象捞出来
  4. 返回给前端展示

为什么用"拦截响应 + 递归提取"而不是写死接口字段:
  快手的接口路径、字段名、数据嵌套层级随时会变。与其猜某个固定接口,
  不如把浏览器收到的所有 JSON 都扫一遍, 找符合"视频"特征的对象, 这样更耐变化。

⚠️ 你本地跑起来后, 大概率需要根据实际情况调整的两处, 我都用 [需实测调整] 标注了:
   - SEARCH_URL: 快手搜索页的 URL 格式
   - looks_like_video(): 判断"这是不是一个视频对象"的字段特征
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from playwright.async_api import async_playwright

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

# [需实测调整] 快手网页搜索的 URL。在浏览器里手动搜一次, 看地址栏的真实格式再改这里。
# 历史上常见格式之一: https://www.kuaishou.com/search/video?searchKey=关键词
SEARCH_URL = "https://www.kuaishou.com/search/video?searchKey={keyword}"

# 浏览器登录态 / cookie 持久化目录。
# 第一次用 headful 模式扫码登录后, 登录信息会存在这里, 之后复用 —— 这对能不能搜到东西很关键。
USER_DATA_DIR = str(Path("./kuaishou_userdata").resolve())

# 本地开发默认弹出浏览器窗口(方便登录/过验证码); 云部署时设环境变量 HEADLESS=true
HEADLESS = os.getenv("HEADLESS", "false").lower() == "true"

# 云端无法扫码登录, 可把浏览器 Cookie 粘贴到 Railway 环境变量 KUAISHOU_COOKIES
# 支持两种格式:
#   1) 浏览器复制的原始字符串: "did=xxx; kuaishou.server.webp.at=yyy; ..."
#   2) JSON 数组: [{"name":"did","value":"xxx","domain":".kuaishou.com"}, ...]
KUAISHOU_COOKIES = os.getenv("KUAISHOU_COOKIES", "")

# 抓取时等待 XHR 加载的时间(秒)。网慢就调大
WAIT_AFTER_LOAD = 6

# 单次最多返回多少条
MAX_RESULTS = 20


# ---------------------------------------------------------------------------
# 启发式: 判断一个 dict 是不是"视频对象", 并从中提取我们要的字段
# ---------------------------------------------------------------------------

def looks_like_video(obj: dict) -> bool:
    """[需实测调整] 判断一个 JSON 对象像不像一条视频。
    思路: 一条视频通常同时具备 标题/封面/播放地址 这类特征字段中的几个。
    你抓到真实数据后, 把实际出现的字段名补进这些候选集合即可。
    """
    if not isinstance(obj, dict):
        return False
    keys = set(obj.keys())
    # 任意命中其一就认为"有标题类字段", 其他同理
    has_caption = keys & {"caption", "title", "photoName", "name"}
    has_play = keys & {"mainMvUrls", "playUrl", "photoUrl", "videoUrl", "mainMvUrl", "srcNoMark"}
    has_id = keys & {"photoId", "photo_id", "id", "photoIdStr"}
    # 至少要有"能播的地址" + (标题或id) 才算
    return bool(has_play and (has_caption or has_id))


def pick(obj: dict, *candidates):
    """从 obj 里按候选字段名顺序取第一个非空值"""
    for c in candidates:
        v = obj.get(c)
        if v:
            return v
    return None


def extract_play_url(obj: dict):
    """从视频对象里尽量提取一个可播放的 url。播放地址常见两种形态:
    1) 直接是字符串字段
    2) 是个数组, 形如 [{"url": "..."}, ...]
    """
    # 形态1: 直接字符串
    direct = pick(obj, "playUrl", "photoUrl", "videoUrl", "srcNoMark", "mainMvUrl")
    if isinstance(direct, str):
        return direct
    # 形态2: 数组里取第一个 url
    arr = obj.get("mainMvUrls") or obj.get("coverUrls")
    if isinstance(arr, list) and arr:
        first = arr[0]
        if isinstance(first, dict):
            return first.get("url")
        if isinstance(first, str):
            return first
    return None


def extract_cover(obj: dict):
    cover = pick(obj, "coverUrl", "poster", "thumbnailUrl")
    if isinstance(cover, str):
        return cover
    arr = obj.get("coverUrls")
    if isinstance(arr, list) and arr and isinstance(arr[0], dict):
        return arr[0].get("url")
    return None


def normalize(obj: dict) -> dict:
    """把一个原始视频对象, 规整成前端要的统一结构"""
    author = obj.get("user") or obj.get("author") or {}
    author_name = None
    if isinstance(author, dict):
        author_name = pick(author, "name", "userName", "user_name", "nickName")
    return {
        "id": pick(obj, "photoId", "photoIdStr", "photo_id", "id"),
        "caption": pick(obj, "caption", "title", "photoName", "name"),
        "author": author_name,
        "cover": extract_cover(obj),
        "playUrl": extract_play_url(obj),
    }


def deep_find_videos(data, found: list, seen_ids: set):
    """递归遍历任意 JSON 结构, 把所有像视频的对象捞出来"""
    if isinstance(data, dict):
        if looks_like_video(data):
            v = normalize(data)
            vid = v.get("id") or v.get("playUrl")
            if vid and vid not in seen_ids:
                seen_ids.add(vid)
                found.append(v)
        # 不管命没命中, 都继续往子节点找(视频可能嵌套在更深处)
        for val in data.values():
            deep_find_videos(val, found, seen_ids)
    elif isinstance(data, list):
        for item in data:
            deep_find_videos(item, found, seen_ids)


# ---------------------------------------------------------------------------
# Cookie 辅助
# ---------------------------------------------------------------------------

def parse_cookie_string(s: str) -> list:
    """把浏览器 Cookie 字符串解析为 Playwright add_cookies 所需的列表"""
    result = []
    for part in s.split(";"):
        part = part.strip()
        if "=" in part:
            name, _, value = part.partition("=")
            result.append({
                "name": name.strip(),
                "value": value.strip(),
                "domain": ".kuaishou.com",
                "path": "/",
            })
    return result


# ---------------------------------------------------------------------------
# 抓取核心
# ---------------------------------------------------------------------------

# 全局保存一个浏览器上下文, 复用登录态, 避免每次搜索都重开
_browser_ctx = None
_play = None
_lock = asyncio.Lock()


async def get_context():
    global _browser_ctx, _play
    if _browser_ctx is None:
        _play = await async_playwright().start()
        # launch_persistent_context: 把登录态/cookie 存到 USER_DATA_DIR, 下次复用
        _browser_ctx = await _play.chromium.launch_persistent_context(
            USER_DATA_DIR,
            headless=HEADLESS,
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        if KUAISHOU_COOKIES:
            try:
                cookies = (
                    json.loads(KUAISHOU_COOKIES)
                    if KUAISHOU_COOKIES.strip().startswith("[")
                    else parse_cookie_string(KUAISHOU_COOKIES)
                )
                await _browser_ctx.add_cookies(cookies)
                print(f"[cookies] 注入 {len(cookies)} 条 cookie")
            except Exception as e:
                print(f"[cookies] 注入失败: {e}")
    return _browser_ctx


async def search_kuaishou(keyword: str) -> list:
    async with _lock:  # 串行化, 避免并发请求互相干扰 + 降低被风控概率
        ctx = await get_context()
        page = await ctx.new_page()

        captured_json = []  # 收集所有"长得像数据"的响应体

        async def on_response(resp):
            try:
                ct = resp.headers.get("content-type", "")
                if "application/json" in ct or "text/json" in ct:
                    body = await resp.json()
                    captured_json.append(body)
            except Exception:
                pass  # 拿不到/解析失败就跳过, 不影响主流程

        page.on("response", on_response)

        url = SEARCH_URL.format(keyword=keyword)
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            # 给页面时间发 XHR、加载结果。也可在这窗口里手动过验证码/滑块。
            await page.wait_for_timeout(WAIT_AFTER_LOAD * 1000)
            # 往下滚一点, 触发更多内容加载
            for _ in range(3):
                await page.mouse.wheel(0, 2000)
                await page.wait_for_timeout(1500)
        except Exception as e:
            print(f"[抓取页面时出错] {e}")
        finally:
            videos = []
            seen = set()
            for blob in captured_json:
                deep_find_videos(blob, videos, seen)
            await page.close()

        return videos[:MAX_RESULTS]


# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # 关服务时清理浏览器
    global _browser_ctx, _play
    if _browser_ctx:
        await _browser_ctx.close()
    if _play:
        await _play.stop()


app = FastAPI(title="快手搜索-最小版", lifespan=lifespan)

# 允许 GitHub Pages 前端跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/search")
async def api_search(keyword: str = Query(..., min_length=1)):
    try:
        results = await search_kuaishou(keyword)
        return JSONResponse({"ok": True, "count": len(results), "results": results})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/api/debug")
async def api_debug(keyword: str = Query(..., min_length=1)):
    """诊断接口: 返回原始抓取情况, 不做视频提取, 用于排查 0 结果问题"""
    async with _lock:
        ctx = await get_context()
        page = await ctx.new_page()
        captured = []

        async def on_resp(resp):
            try:
                ct = resp.headers.get("content-type", "")
                if "application/json" in ct or "text/json" in ct:
                    body = await resp.json()
                    captured.append({"url": resp.url, "body": body})
            except Exception:
                pass

        page.on("response", on_resp)
        url = SEARCH_URL.format(keyword=keyword)
        final_url = url
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(WAIT_AFTER_LOAD * 1000)
            final_url = page.url
        except Exception as e:
            print(f"[debug error] {e}")
        finally:
            await page.close()

    summary = []
    for r in captured[:10]:
        body = r["body"]
        summary.append({
            "url": r["url"],
            "type": type(body).__name__,
            "top_keys": list(body.keys())[:15] if isinstance(body, dict) else None,
            "length": len(body) if isinstance(body, list) else None,
        })

    return JSONResponse({
        "search_url": url,
        "final_url": final_url,
        "redirected": final_url != url,
        "json_responses_captured": len(captured),
        "summary": summary,
    })


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTML_PAGE


# ---------------------------------------------------------------------------
# 内嵌前端 (一个文件搞定, 启动后访问 http://127.0.0.1:8000 即可)
# ---------------------------------------------------------------------------

HTML_PAGE = """
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>快手搜索 · 最小版</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
         margin: 0; background: #f5f5f7; color: #1d1d1f; }
  header { padding: 24px 20px; background: #fff; border-bottom: 1px solid #e5e5ea; }
  h1 { font-size: 18px; margin: 0 0 14px; }
  .bar { display: flex; gap: 8px; max-width: 720px; }
  input { flex: 1; padding: 10px 12px; font-size: 15px; border: 1px solid #d0d0d5;
          border-radius: 8px; outline: none; }
  input:focus { border-color: #ff7a1a; }
  button { padding: 10px 20px; font-size: 15px; border: none; border-radius: 8px;
           background: #ff7a1a; color: #fff; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .status { max-width: 720px; margin: 12px auto 0; padding: 0 20px; color: #6e6e73; font-size: 14px; }
  .grid { max-width: 1100px; margin: 20px auto; padding: 0 20px;
          display: grid; grid-template-columns: repeat(auto-fill, minmax(220px,1fr)); gap: 16px; }
  .card { background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e5ea; }
  .card .cover { width: 100%; aspect-ratio: 9/12; object-fit: cover; background: #eee; display: block; }
  .card .body { padding: 10px 12px; }
  .card .cap { font-size: 14px; line-height: 1.4; max-height: 40px; overflow: hidden; }
  .card .author { font-size: 12px; color: #8e8e93; margin-top: 6px; }
  .card a { font-size: 13px; color: #ff7a1a; text-decoration: none; display: inline-block; margin-top: 8px; }
  video { width: 100%; display: block; background:#000; }
</style>
</head>
<body>
<header>
  <h1>快手搜索 · 最小可运行版（个人学习用）</h1>
  <div class="bar">
    <input id="kw" placeholder="输入关键词，回车搜索…" />
    <button id="btn">搜索</button>
  </div>
</header>
<div class="status" id="status">提示：首次使用请在弹出的浏览器窗口里登录快手；搜索较慢属正常（后台真实浏览器在跑）。</div>
<div class="grid" id="grid"></div>

<script>
const $ = s => document.querySelector(s);
const btn = $("#btn"), kw = $("#kw"), grid = $("#grid"), status = $("#status");

async function doSearch() {
  const k = kw.value.trim();
  if (!k) return;
  btn.disabled = true;
  grid.innerHTML = "";
  status.textContent = "搜索中……（后台浏览器执行中，请稍候十几秒）";
  try {
    const r = await fetch("/api/search?keyword=" + encodeURIComponent(k));
    const data = await r.json();
    if (!data.ok) { status.textContent = "出错：" + data.error; return; }
    status.textContent = `共找到 ${data.count} 条结果` + (data.count === 0 ? "（可能未登录/被风控/字段需调整，详见终端日志与 README）" : "");
    for (const v of data.results) {
      const card = document.createElement("div");
      card.className = "card";
      const cover = v.cover ? `<img class="cover" src="${v.cover}" referrerpolicy="no-referrer">` : "";
      const player = v.playUrl ? `<video class="cover" src="${v.playUrl}" controls preload="none" poster="${v.cover||''}"></video>` : cover;
      card.innerHTML = `
        ${player || '<div class="cover"></div>'}
        <div class="body">
          <div class="cap">${(v.caption||"(无标题)").replace(/</g,"&lt;")}</div>
          <div class="author">${v.author||""}</div>
          ${v.playUrl ? `<a href="${v.playUrl}" target="_blank">在新标签打开</a>` : ""}
        </div>`;
      grid.appendChild(card);
    }
  } catch (e) {
    status.textContent = "请求失败：" + e;
  } finally {
    btn.disabled = false;
  }
}
btn.onclick = doSearch;
kw.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
</script>
</body>
</html>
"""
