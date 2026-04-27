/**
 * Substack → MDX sync.
 *
 * Discovers all posts via sitemap.xml, fetches metadata + body_html via the
 * undocumented /api/v1/archive and /api/v1/posts/by-id/{id} endpoints, mirrors
 * images to public/posts/{slug}/, converts body to Markdown, and writes MDX
 * files to src/content/posts/{slug}.mdx.
 *
 * Usage:
 *   npm run sync                  # incremental: only fetch slugs not yet on disk
 *   npm run sync -- --force       # overwrite existing MDX files
 *   npm run sync -- --slug=X      # sync just one post by slug
 *   npm run sync -- --dry         # discover + classify, write nothing
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const PUB = 'https://champagnesuki.substack.com';
const UA = 'Mozilla/5.0 (compatible; LastRomanticSync/1.0)';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');
const POSTS_DIR = join(ROOT, 'src/content/posts');
const PUBLIC_POSTS_DIR = join(ROOT, 'public/posts');
const OVERRIDES_PATH = join(SCRIPT_DIR, 'series-overrides.json');

type Series = 'memoir' | 'bourdainism' | 'four-cs' | 'essays' | 'standalone';

interface ArchiveItem {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  post_date: string;
  cover_image: string | null;
  wordcount: number | null;
  canonical_url: string;
}

interface FullPost extends ArchiveItem {
  body_html: string;
  description: string | null;
}

const args = parseArgs(process.argv.slice(2));

async function main() {
  const overrides = await loadOverrides();
  console.log(`[discover] fetching archive list…`);
  const archive = await fetchArchiveAll();
  console.log(`[discover] archive returned ${archive.length} posts`);

  let toSync = archive;
  if (args.slug) {
    toSync = archive.filter(p => p.slug === args.slug);
    if (toSync.length === 0) {
      console.error(`[error] slug "${args.slug}" not found in archive`);
      process.exit(1);
    }
  } else if (!args.force) {
    const existing = await getExistingSlugs();
    toSync = archive.filter(p => !existing.has(p.slug));
    console.log(`[discover] ${existing.size} already on disk; ${toSync.length} new`);
  }

  if (args.dry) {
    console.log(`\n[dry-run] would sync:`);
    for (const p of toSync) {
      console.log(`  ${classifySeries(p.slug, overrides).padEnd(12)} ${p.slug}`);
    }
    return;
  }

  await mkdir(POSTS_DIR, { recursive: true });
  await mkdir(PUBLIC_POSTS_DIR, { recursive: true });

  let success = 0;
  let failed: string[] = [];
  for (const item of toSync) {
    try {
      await syncOne(item, overrides);
      success++;
    } catch (err) {
      console.error(`[error] ${item.slug}:`, (err as Error).message);
      failed.push(item.slug);
    }
  }

  // Print final classification breakdown.
  const breakdown: Record<string, number> = {};
  for (const item of archive) {
    const s = classifySeries(item.slug, item.title, overrides);
    breakdown[s] = (breakdown[s] ?? 0) + 1;
  }
  console.log(`\n[breakdown]`, breakdown);

  console.log(`\n[done] ${success} synced, ${failed.length} failed`);
  if (failed.length) {
    console.log(`[failed]`, failed.join(', '));
    process.exitCode = 1;
  }
}

async function syncOne(item: ArchiveItem, overrides: Record<string, string>) {
  console.log(`[fetch] ${item.slug}`);
  const post = await fetchPostById(item.id);
  const series = classifySeries(item.slug, item.title, overrides);

  // Mirror images.
  const slugDir = join(PUBLIC_POSTS_DIR, item.slug);
  await mkdir(slugDir, { recursive: true });

  const imageMap = new Map<string, string>(); // remote URL → local URL path

  // Inline image discovery (need this before cover fallback).
  const $ = cheerio.load(post.body_html);
  const inlineUrls = new Set<string>();
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (src && src.startsWith('http')) inlineUrls.add(src);
  });

  // Cover. Falls back to first inline body image if no cover_image is set.
  let coverLocal: string | null = null;
  if (post.cover_image) {
    coverLocal = await downloadImage(post.cover_image, slugDir, item.slug, 'cover');
    imageMap.set(post.cover_image, coverLocal);
  } else if (inlineUrls.size > 0) {
    const firstInline = inlineUrls.values().next().value!;
    coverLocal = await downloadImage(firstInline, slugDir, item.slug, 'cover');
    imageMap.set(firstInline, coverLocal);
    console.log(`  [info] using first body image as cover (no Substack cover_image set)`);
  }

  let imgIdx = 0;
  for (const url of inlineUrls) {
    if (imageMap.has(url)) continue;
    try {
      const local = await downloadImage(url, slugDir, item.slug, `img-${++imgIdx}`);
      imageMap.set(url, local);
    } catch (err) {
      console.warn(`  [warn] image fetch failed: ${url} (${(err as Error).message})`);
    }
  }

  // Convert to Markdown.
  const md = htmlToMarkdown(post.body_html, imageMap);

  // Build frontmatter.
  const frontmatter = buildFrontmatter({
    title: post.title,
    subtitle: post.subtitle ?? '',
    series,
    seriesOrder: undefined, // hand-set later if she wants reading order
    publishedAt: post.post_date.slice(0, 10),
    substackUrl: post.canonical_url || `${PUB}/p/${post.slug}`,
    substackId: post.id,
    coverImage: coverLocal ?? '',
    coverAlt: '',
    wordcount: post.wordcount ?? 0,
    description: post.description ?? '',
  });

  const outPath = join(POSTS_DIR, `${item.slug}.md`);
  await writeFile(outPath, frontmatter + '\n' + md.trim() + '\n', 'utf-8');
  console.log(`  → wrote ${outPath} (${md.length} chars, ${imageMap.size} images, series=${series})`);
}

async function fetchArchiveAll(): Promise<ArchiveItem[]> {
  const out: ArchiveItem[] = [];
  let offset = 0;
  const limit = 12;
  while (true) {
    const url = `${PUB}/api/v1/archive?sort=new&limit=${limit}&offset=${offset}`;
    const data: ArchiveItem[] = await fetchJson(url);
    if (data.length === 0) break;
    out.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

async function fetchPostById(id: number): Promise<FullPost> {
  const url = `${PUB}/api/v1/posts/by-id/${id}`;
  const data = await fetchJson(url);
  return data.post as FullPost;
}

async function fetchJson<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.json() as Promise<T>;
}

async function downloadImage(url: string, slugDir: string, slug: string, hint: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());

  // Determine extension.
  const ct = r.headers.get('content-type') || '';
  let ext = '.jpg';
  if (ct.includes('png')) ext = '.png';
  else if (ct.includes('webp')) ext = '.webp';
  else if (ct.includes('gif')) ext = '.gif';
  else if (ct.includes('jpeg') || ct.includes('jpg')) ext = '.jpg';
  else {
    // Fall back to URL inspection.
    const m = url.match(/\.(jpe?g|png|webp|gif)(?:\?|$)/i);
    if (m) ext = '.' + m[1].toLowerCase().replace('jpeg', 'jpg');
  }

  // Stable filename based on URL hash, so re-runs don't churn.
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 10);
  const name = `${hint}-${hash}${ext}`;
  const path = join(slugDir, name);
  await writeFile(path, buf);
  return `/posts/${slug}/${name}`;
}

function htmlToMarkdown(html: string, imageMap: Map<string, string>): string {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    hr: '---',
  });

  // Strip Substack subscription / share / embed widgets entirely.
  td.remove(['script', 'style']);
  td.addRule('strip-widgets', {
    filter: (node) => {
      if (node.nodeName !== 'DIV') return false;
      const cls = (node as HTMLElement).className || '';
      return /subscription-widget|^\s*share[\s-]|tweet|youtube-wrap|embedded-publication/.test(cls);
    },
    replacement: () => '',
  });

  // Captioned images → image + italic caption.
  td.addRule('captioned-image', {
    filter: (node) => {
      if (node.nodeName !== 'DIV') return false;
      return /captioned-image-container/.test((node as HTMLElement).className || '');
    },
    replacement: (_content, node) => {
      const $$ = cheerio.load((node as HTMLElement).outerHTML);
      const img = $$('img').first();
      const src = img.attr('src') || '';
      const alt = img.attr('alt') || '';
      const caption = $$('figcaption').text().trim();
      const localSrc = imageMap.get(src) || src;
      const out = `\n\n![${alt}](${localSrc})\n`;
      return caption ? `${out}\n*${caption}*\n\n` : `${out}\n`;
    },
  });

  // Pullquote → blockquote.
  td.addRule('pullquote', {
    filter: (node) => {
      if (node.nodeName !== 'DIV') return false;
      return /pullquote/.test((node as HTMLElement).className || '');
    },
    replacement: (_content, node) => {
      const text = (node.textContent || '').trim().replace(/\n+/g, ' ');
      return `\n\n> ${text}\n\n`;
    },
  });

  // Plain images: rewrite to local URL if mirrored.
  td.addRule('rewrite-img', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = (node as HTMLElement).getAttribute('src') || '';
      const alt = (node as HTMLElement).getAttribute('alt') || '';
      const localSrc = imageMap.get(src) || src;
      return `![${alt}](${localSrc})`;
    },
  });

  // Substack footnotes: anchor + footnote-list.
  td.addRule('footnote-anchor', {
    filter: (node) => {
      if (node.nodeName !== 'A') return false;
      return /footnote-anchor/.test((node as HTMLElement).className || '');
    },
    replacement: (_content, node) => {
      const num = (node.textContent || '').trim();
      return `[^${num}]`;
    },
  });

  td.addRule('footnote-block', {
    filter: (node) => {
      if (node.nodeName !== 'DIV') return false;
      return /^footnote(s)?$/.test((node as HTMLElement).className || '');
    },
    replacement: (content) => `\n\n---\n\n${content}\n`,
  });

  // Run.
  let md = td.turndown(html);

  // Cleanup: collapse runs of blank lines, trim.
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

function classifySeries(slug: string, title: string, overrides: Record<string, string>): Series {
  if (overrides[slug] && SERIES_VALUES.has(overrides[slug])) {
    return overrides[slug] as Series;
  }
  if (slug.startsWith('bourdainism-') || slug.startsWith('b-b-bourdainism')) return 'bourdainism';
  if (/(^|-)four-cs(-|$)/.test(slug)) return 'four-cs';
  // Memoir is strict: title must contain the word "Memoir".
  if (/\bMemoir\b/i.test(title)) return 'memoir';
  return 'essays';
}

const SERIES_VALUES = new Set(['memoir', 'bourdainism', 'four-cs', 'essays', 'standalone']);

function buildFrontmatter(d: {
  title: string;
  subtitle: string;
  series: Series;
  seriesOrder?: number;
  publishedAt: string;
  substackUrl: string;
  substackId: number;
  coverImage: string;
  coverAlt: string;
  wordcount: number;
  description: string;
}): string {
  const lines: string[] = ['---'];
  lines.push(`title: ${yamlString(d.title)}`);
  if (d.subtitle) lines.push(`subtitle: ${yamlString(d.subtitle)}`);
  lines.push(`series: ${d.series}`);
  if (d.seriesOrder != null) lines.push(`seriesOrder: ${d.seriesOrder}`);
  lines.push(`publishedAt: ${d.publishedAt}`);
  lines.push(`substackUrl: ${yamlString(d.substackUrl)}`);
  lines.push(`substackId: ${d.substackId}`);
  if (d.coverImage) lines.push(`coverImage: ${yamlString(d.coverImage)}`);
  lines.push(`coverAlt: ${yamlString(d.coverAlt)}`);
  if (d.wordcount) lines.push(`wordcount: ${d.wordcount}`);
  lines.push(`tags: []`);
  lines.push(`status: published`);
  lines.push('---');
  return lines.join('\n');
}

function yamlString(s: string): string {
  // Always double-quote and escape.
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function getExistingSlugs(): Promise<Set<string>> {
  const set = new Set<string>();
  if (!existsSync(POSTS_DIR)) return set;
  const files = await readdir(POSTS_DIR);
  for (const f of files) {
    if (f.endsWith('.mdx') || f.endsWith('.md')) {
      set.add(f.replace(/\.mdx?$/, ''));
    }
  }
  return set;
}

async function loadOverrides(): Promise<Record<string, string>> {
  if (!existsSync(OVERRIDES_PATH)) return {};
  const raw = await readFile(OVERRIDES_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  // Strip _comment.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function parseArgs(argv: string[]) {
  const out = { force: false, dry: false, slug: undefined as string | undefined };
  for (const a of argv) {
    if (a === '--force') out.force = true;
    else if (a === '--dry') out.dry = true;
    else if (a.startsWith('--slug=')) out.slug = a.slice('--slug='.length);
  }
  return out;
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
