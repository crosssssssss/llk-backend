# Setup in Cocos Creator (3.x)

## 1) Create project
- Open Cocos Creator -> New Project -> 2D -> TypeScript

## 2) Copy source
Copy this repo folder:
- `game/src/llk_core` -> into your project `assets/scripts/llk_core`

(Keep filenames and folders.)

## 3) Create simple scene to test
- Create a scene `Battle`
- Add a Node `GameController`
- Create script `GameController.ts`

Paste sample usage from `game/src/demo/GameController.sample.ts` and adapt import paths.

## 4) Expected first demo
- Generate a board
- Print a pair found
- Click two tiles -> validate link -> remove

## 5) Next steps
- UI grid rendering (Prefab)
- Timer + Result panel
- Props: hint/shuffle/freeze

