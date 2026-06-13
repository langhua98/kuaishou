# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build

```bash
node inline.cjs      # 合并 src/*.js + template.html → index.html
```

There are no tests or lint scripts. After any source change, rebuild and verify in-browser.

## Architecture

Single-page mobile voxel game (Three.js r147 UMD, ES5 only — no arrow functions, no imports, all globals).

**Build pipeline**: `inline.cjs` concatenates `src/*.js` in fixed order into `template.html` → outputs `index.html` (GitHub Pages).  
**Never edit `index.html` directly** — it is build output. Edit source files then rebuild.

Key source files and their roles:
- `src/constants.js` — block IDs, `BCOL` (colors), `BNAMES`, `UNIT_TYPES`
- `src/textures.js` — 4×8 atlas (`ATLAS_COLS=4, ATLAS_ROWS=8, TILE=128`), `BTEX[blockId]=[top,side,bot]`
- `src/world.js` — chunk storage, `_groundY(x,z)`, `setBlock(x,y,z,id)`
- `src/renderer.js` — chunk mesh rebuild, `atlasTexture` UV mapping
- `src/physics.js` — player movement, collision, gravity
- `src/game.js` — main loop, block placement/breaking, direction-memory preview (`_place`)
- `src/ui.js` — hotbar (full-inventory horizontal scroll), `buildHotbar()`, `toggleBag()`
- `src/audio.js` — `_SFX` map, `_MAT` per-block material sounds, `placeSound()`, `removeSound(id)`
- `src/combat_core.js` — unit spawn/animate/damage/death; KayKit GLB models (army/)
- `src/combat_tower.js` — tower placement, targeting, projectiles
- `template.html` — HTML shell + all inline CSS (the CSS source, not index.html)

## Key Conventions

- **Three.js ES5**: Use `var`, `function`, no classes or destructuring.
- **KayKit models**: Origin is at foot level by design → force `model.position.y = 0` after `_prepModel` (don't rely on bbox compensation for SkinnedMesh).
- **Atlas texture**: `_drawTile` must use `img.width / img.height` as source dimensions (not the fixed TILE constant) to handle both 16×16 and 128×128 PNGs.
- **CSS source**: Always edit `template.html` for styles; rebuild to propagate to `index.html`.
- **Block IDs**: AIR=0, GRASS=1 … COAL_ORE=27. Adding a new block requires updates in `constants.js` (ID + BCOL + BNAMES), `textures.js` (BTEX + _TILES), `audio.js` (_MAT), and `src/game.js` (player.inv).

---

## Karpathy-Inspired Coding Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
