# Next Steps — make it playable (UI)

## Minimum playable loop
1) Render a grid of tiles (Prefab + Sprite)
2) Bind each tile's click -> call `LLKGameController.onTileClick({r,c})`
3) On elimination, hide/destroy both tile nodes
4) Add timer label
5) Add props buttons:
- hint: call `findAnyPair` and highlight 2 tiles
- shuffle: call `shuffleBoard` and rerender
- freeze: add +8 seconds

## Coordinate mapping
Board is created with 1-cell border:
- Playable tiles are r=1..innerRows, c=1..innerCols
- Border cells are always empty.
