# LLK Frontend (Cocos Creator) — Drop-in Package

This folder contains a **Cocos-friendly** TypeScript implementation of the Lianliankan core logic.

Because we (the agent) cannot run Cocos Creator in this environment, we deliver it as a **drop-in package** you can import into a freshly-created Cocos Creator project.

## What you get
- `src/llk_core/` core algorithm:
  - 0~2 turns path connectivity
  - find available pairs
  - shuffle
  - deadlock check
- `docs/SETUP_COCOs.md` step-by-step how to wire into a new Cocos project

## Recommended engine
- Cocos Creator **3.x** (latest)

