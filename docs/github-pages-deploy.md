# GitHub Pages Deployment

This repo is set up to deploy the built Vite app to GitHub Pages from `main` using the workflow in `.github/workflows/deploy-pages.yml`.

## Current state

- Production build command: `npm run build`
- Output directory: `dist/`
- Required Vibe Jam widget: already present in `index.html`
- Intended public URL: `https://leviathan.timothybauman.com`

## One-time GitHub Pages setup

1. Push the workflow to the repository's `main` branch.
2. In GitHub, open `baumant/leviathan` and go to `Settings -> Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Under `Custom domain`, set `leviathan.timothybauman.com`.
5. Wait for GitHub to provision the certificate, then enable `Enforce HTTPS`.
6. Optionally verify `timothybauman.com` in GitHub Pages for takeover protection before or after adding the custom domain.

## DNS setup

Add this DNS record at the provider hosting `timothybauman.com`:

- Type: `CNAME`
- Host: `leviathan`
- Value / Target: `baumant.github.io`

Do not point `leviathan.timothybauman.com` at the apex domain.

## Verification

After DNS propagates:

```sh
dig leviathan.timothybauman.com +nostats +nocomments +nocmd
```

Expected result: a `CNAME` chain to `baumant.github.io`, followed by GitHub Pages IPs.

## Smoke test

After the first Pages deployment finishes:

1. Open `https://leviathan.timothybauman.com`.
2. Confirm the game loads without login or signup.
3. Confirm there is no blocking loading screen.
4. Confirm the Vibe Jam widget renders on the live site.
5. Submit that exact URL to Vibe Jam.
