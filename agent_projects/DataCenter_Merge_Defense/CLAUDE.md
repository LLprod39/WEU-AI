# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**DataCenter Merge Defense** — a browser-based Merge Tower Defense + Roguelite game built for the Yandex Games platform. Players place and merge "server" turrets on a grid to defend against waves of virus/packet enemies, with roguelite card picks between waves, meta-progression upgrades, daily challenges with leaderboards, and monetization via Yandex Games SDK.

**Stack:** Phaser 3, TypeScript (strict mode), Vite, Yandex Games SDK.

## Commands

```bash
npm run dev       # Start Vite dev server (HMR disabled, host: true)
npm run build     # Production build to dist/
npm run preview   # Preview production build
```

No test framework is configured. No linter is configured.

## Architecture

### Scene Flow

`BootScene` → `MenuScene` → `RunScene` → back to `MenuScene`

- **BootScene** (`src/scenes/BootScene.ts`): Loads JSON configs from `public/configs/`, initializes Yandex SDK, loads persisted save profile, creates `GameState`, stores it in `this.registry`. Has a 6-second boot timeout with offline fallback.
- **MenuScene** (`src/scenes/MenuScene.ts`): Meta hub — upgrade tree, daily tasks, IAP store, settings, daily challenge button. Calls `yandexGamesSdk.markReady()` here. Manages sticky banner ads (show in hub, hide in run).
- **RunScene** (`src/scenes/RunScene.ts`): Core gameplay — grid, turrets, enemies, waves, combat, roguelite card drafts, end-of-run screen with rewards/ads. ~800 lines, the largest file.

### Data-Driven Configuration

All game balance lives in JSON files loaded at boot, **not** hardcoded:

| Config | File | Types |
|--------|------|-------|
| Turrets | `public/configs/turrets.json` | `TurretConfig` |
| Enemies | `public/configs/enemies.json` | `EnemyConfig` |
| Cards (roguelite) | `public/configs/cards.json` | `CardConfig` |
| Waves + Grid + Path | `public/configs/waves.json` | `WavesConfig` |
| Meta upgrades + daily tasks | `public/configs/meta.json` | `MetaConfig` |

Legacy combined config: `game_config.json` (root) — not used at runtime.

`configValidation.ts` validates all configs at boot with strict runtime assertions. If a config is invalid, the game shows an error screen and refuses to start.

### State Model (`src/game/types.ts`)

```
GameState
├── runState      — per-run: HP, credits, wave, pause
├── metaState     — persistent: total runs, best wave, meta credits, upgrade levels, unlocked turrets, daily tasks
├── settingsState — persistent: sound, vibration, speed, ad tracking, IAP flags, daily challenge scores, onboarding
└── configs       — loaded GameConfigs (read-only reference)
```

`GameState` is stored in `Phaser.Game.registry` under key `"gameState"` and shared across scenes.

### Key Modules

| Module | Responsibility |
|--------|---------------|
| `src/game/gameState.ts` | Creates/resets state, meta-upgrade logic, daily task rotation/progress/claim, FNV-1a hash for deterministic daily picks |
| `src/game/saveSystem.ts` | Cloud save (Yandex Player data) + localStorage fallback, debounced writes with serialized queue, `queueGameSave`/`flushGameSave` |
| `src/game/monetization.ts` | Interstitial (cooldown: 1 per 2 runs), rewarded video, sticky banners (hub only). Respects `noAdsPurchased` flag |
| `src/game/iap.ts` | Two products: `no_ads` (persistent) and `starter_pack` (consumable, +350 meta credits). Syncs pending purchases on hub entry |
| `src/game/dailyChallenge.ts` | Daily score formula, deterministic seed from date, leaderboard submit with cooldown, top/player entry loading |
| `src/sdk/yandexGamesSdk.ts` | Singleton SDK wrapper — init with timeout, guest fallback, pause signals (platform + browser blur/visibility), ads, payments, leaderboards, player data |

### Yandex SDK Integration

- SDK script is conditionally injected in `index.html` only on Yandex domains.
- `YandexGamesSdkService` is a singleton (`yandexGamesSdk`). All SDK calls go through it with timeouts and fallback behavior.
- `LoadingAPI.ready()` is called once in `MenuScene` when the hub is ready.
- Pause handling: both platform `game_api_pause/resume` events and browser `blur/focus/visibilitychange`.

### TypeScript Configuration

- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`
- Target: ES2020, Module: ESNext, Bundler resolution
- `noEmit: true` — Vite handles transpilation

## Conventions

- UI text is in Russian (player-facing strings).
- All game balance is in JSON configs — never hardcode balance values in TypeScript.
- Phaser `this.registry` is the cross-scene data bus; `GAME_STATE_KEY` is the registry key.
- Monetization respects `settingsState.noAdsPurchased` — always check before showing ads.
- Daily challenge runs use `speedMultiplier = 1` (hardcoded for fairness), while normal runs respect user settings.
- Save writes are debounced (`queueGameSave`) for frequent changes; use `flushGameSave` for critical saves (IAP, profile reset).

## Current Status

Steps 1–15 of the implementation plan (see `PLAN.md`) are complete. Step 16 (optimization, build for publication, moderation checklist) is not yet done.
