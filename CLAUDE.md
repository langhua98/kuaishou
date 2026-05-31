# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Python app (`main.py`) that runs a FastAPI web service to search Kuaishou (快手) videos. It drives a real Chromium browser via Playwright, intercepts all JSON responses the browser receives, then heuristically extracts video objects from those responses. The embedded frontend is a string constant (`HTML_PAGE`) at the bottom of `main.py`.

## Setup

```bash
pip install fastapi uvicorn playwright
playwright install chromium
```

## Running

```bash
uvicorn main:app --reload
# then open http://127.0.0.1:8000
```

On first run, a real browser window opens (`HEADLESS = False`). Log in to Kuaishou in that window — credentials are persisted in `./kuaishou_userdata/` and reused on subsequent runs.

## Key configuration constants (top of `main.py`)

| Constant | Default | When to change |
|---|---|---|
| `SEARCH_URL` | `https://www.kuaishou.com/search/video?searchKey={keyword}` | If Kuaishou changes its search URL format |
| `HEADLESS` | `False` | Set `True` after login is working, to run headlessly |
| `WAIT_AFTER_LOAD` | `6` (seconds) | Increase on slow connections |
| `MAX_RESULTS` | `20` | Controls result cap |
| `USER_DATA_DIR` | `./kuaishou_userdata` | Persistent browser profile location |

## Architecture

All logic lives in `main.py`. There are no modules, packages, or separate files.

**Request flow:**
1. Frontend `fetch("/api/search?keyword=…")` → FastAPI `api_search()`
2. `search_kuaishou()` acquires `_lock` (serializes all searches, one at a time)
3. A new page is opened in the persistent `_browser_ctx` (created once, reused across requests)
4. A `response` event listener collects every `application/json` response the browser receives
5. After `WAIT_AFTER_LOAD` seconds + 3 scroll steps, all captured JSON blobs are passed to `deep_find_videos()`
6. `deep_find_videos()` recursively walks any JSON structure; objects passing `looks_like_video()` are normalized via `normalize()` and deduplicated by id/playUrl

**Why heuristic extraction instead of a fixed API endpoint:** Kuaishou's internal API paths, field names, and nesting depth change frequently. The response-interception + recursive-scan approach tolerates those changes without needing updates.

## The two places most likely to need adjustment

**`SEARCH_URL`** — manually open Kuaishou in a browser, perform a search, and copy the exact URL format from the address bar.

**`looks_like_video()`** — when searches return 0 results, add `print(captured_json)` inside `search_kuaishou()` to inspect what fields actually appear in the intercepted responses, then update the candidate field sets (`has_caption`, `has_play`, `has_id`) accordingly.

## Debugging zero results

1. Set `HEADLESS = False` and watch the browser window
2. Add `print(captured_json)` before the `deep_find_videos` loop to see raw intercepted data
3. Check if a CAPTCHA/slider appeared — solve it manually in the browser window
4. The `on_response` handler silently swallows all exceptions; temporarily add `print` there to surface parse failures
