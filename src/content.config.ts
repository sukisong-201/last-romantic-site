import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const series = z.enum(['memoir', 'bourdainism', 'four-cs', 'essays', 'standalone']);

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    series: series.default('standalone'),
    seriesOrder: z.number().optional(),
    publishedAt: z.coerce.date(),
    substackUrl: z.string().url(),
    substackId: z.number().optional(),
    coverImage: z.string().optional(),
    coverAlt: z.string().optional(),
    wordcount: z.number().optional(),
    tags: z.array(z.string()).default([]),
    status: z.enum(['published', 'draft']).default('published'),
  }),
});

export const collections = { posts };
