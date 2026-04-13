# docs/art_direction.md

## Visual north star
Cel-shaded, graphic, moody, mythic, readable at distance.

Reference mix:
- DREDGE-like topside mood: fog, lantern glow, maritime dread
- ABZU-like underwater scale and grace
- Sailwind-like ship silhouette readability
- Valheim-like atmosphere from simple geometry
- Graphic cel-shaded action framing over asset-detail rendering

## Palette
- Sea: near-black blue
- Fog: blue-gray
- Lanterns: warm amber
- Whale: bone white, brightest moving form
- UI: dim, restrained, minimal

## Lighting
- Heavy fog is part of composition
- One cold moonlight directional light
- Warm lantern point lights on ships
- Stepped light bands over smooth shapes
- Distant forms should read as silhouettes first, detail second

## Shape language
- Ships: chunky, simplified, readable mast shapes, exaggerated hull profiles
- Whale: massive, smooth, ancient, broad-backed, clean silhouette
- Water: stylized, not realistic
- Form language should beat mesh detail; graphic masses beat small surface features

## Material language
- Procedural/in-engine actors first, not GLB-led hero assets
- Stepped light, flat color blocks, restrained emissive accents
- No outlines by default; separation should come from silhouette, value, fog, and light bands
- Lanterns are the only strong warm accent
- Whale remains the brightest moving form

## Animation feel
- Whale: heavy, graceful, inevitable
- Ships: fragile, rattling, breakable
- Breaches: explosive and theatrical

## Anti-goals
- No realism-heavy naval sim look
- No generic low-poly kitbash look
- No GLB-driven detail-first style
- No cluttered deck detail
- No saturated arcade colors
- No cute/comic tone
- No shiny PBR-first rendering
