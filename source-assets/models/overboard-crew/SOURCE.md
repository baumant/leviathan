# Overboard Crew Source

Preferred source asset:

- "Fisherman Low Poly" by MacacoPaulo
- Sketchfab: https://sketchfab.com/3d-models/fisherman-low-poly-912dbae7421b458fa723d72296991b8a
- License: Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/
- Published: 2020-12-12
- Listed geometry: 344 triangles, 210 vertices

The Sketchfab download API requires authenticated credentials in the current
development environment. To rebuild from the source asset, download the GLB
through an authenticated Sketchfab account and save it as:

`source-assets/models/overboard-crew/source.glb`

Then run:

`npm run asset:overboard-crew`

If no source GLB is present, the build script writes a small locally generated
low-poly sailor fallback to `public/models/overboard-crew.glb` so the runtime
model-loading path remains exercised.
