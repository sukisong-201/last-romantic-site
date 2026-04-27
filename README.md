# The Last Romantic — site

A custom-designed editorial wrapper around Suki Song's Substack publication
(<https://champagnesuki.substack.com>). Posts are mirrored from Substack as MDX,
images are stored locally, and the site deploys to Cloudflare Pages at
<https://thelastromantic.co>.

Substack continues to handle email delivery, subscribers, comments, and
(eventually) paid subscriptions. This site is the reader-facing surface.

## Local development

```sh
npm install
npm run dev          # http://localhost:4321
```

## Pulling in new posts

```sh
npm run sync             # incremental — only fetches slugs not on disk
npm run sync -- --force  # rebuild everything, re-download images
npm run sync -- --slug=the-memoir-prologue-from-the-desk
```

Posts are fetched via Substack's `/api/v1/archive` and `/api/v1/posts/by-id/{id}`
endpoints. HTML body is converted to Markdown with custom Turndown rules for
captioned images, pullquotes, and footnotes. Images are mirrored to
`public/posts/{slug}/`.

To reclassify a post into a different series, edit
[`scripts/series-overrides.json`](scripts/series-overrides.json) and re-run sync.

## Regenerating the OG card

```sh
npm run build:og
```

## Build for production

```sh
npm run build        # static output to dist/
npm run preview      # serve dist/ locally
```

## Project layout

```
src/
  content/posts/         # 37 MDX/MD files, one per Substack post
  components/            # Nav, Footer, PostCard, SeriesBadge, SubscribeEmbed, …
  layouts/               # BaseLayout, PostLayout
  pages/                 # Astro routes
  styles/                # tokens.css (palette + type), global.css

public/
  posts/{slug}/…         # mirrored images, ~150 files
  favicon.svg
  og-default.png

scripts/
  sync-substack.ts       # Substack → MDX backfill + incremental sync
  build-og.ts            # generates the social-card image
  series-overrides.json  # manual classification overrides
```

## Series

| Series | Default rule | Overrides |
|---|---|---|
| `memoir` | Title contains "Memoir" | none |
| `bourdainism` | Slug starts with `bourdainism-` | `vienna-last-night-2025-wrapped` |
| `four-cs` | Slug contains `four-cs` | `read_me-how-to-read-my-substack-and` |
| `essays` | Default fallback | none |
