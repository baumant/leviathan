# Whale Asset Pipeline

## Source Of Truth
- Source whale mesh: `public/models/whale-source.glb`
- Shipping whale asset: `public/models/whale-hero.glb`

The shipped whale stays aligned with the attached source model by rebuilding the runtime-ready asset from `whale-source.glb` rather than editing `whale-hero.glb` by hand.

## Rebuild
Run:

```sh
npm run asset:whale
```

This rebuild:
- normalizes the whale into the game's length and orientation conventions
- splits the unrigged source mesh into body, tail, fluke, and fin regions
- creates stable gameplay helper nodes for `tail_pivot`, `fluke_pivot`, fin pivots, tether, tail slap, and tow attachments
- writes the runtime asset to `public/models/whale-hero.glb`

## Style Guardrails
- Keep the whale smooth and silhouette-first.
- Preserve the whale as the brightest moving form through variant materials, not noisy texture detail.
- Prefer stable pivots and runtime readability over aggressive mesh reduction.
