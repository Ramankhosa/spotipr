// robots.txt.
//
// The authenticated product is disallowed wholesale — those routes need a
// session, so crawling them only burns budget on redirects. The AI crawlers are
// explicitly welcome on the marketing and editorial surfaces: being quoted in
// an AI answer is the point of the journal, and GPTBot/ClaudeBot/PerplexityBot
// obey robots.txt, so silence would be read as permission we hadn't thought
// about rather than permission we granted.

import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/blog/site'

const PRIVATE_PATHS = [
  '/api/',
  '/dashboard',
  '/projects',
  '/patents',
  '/novelty-search',
  '/prior-art-studio',
  '/office-actions',
  '/whitespace',
  '/idea-bank',
  '/personas',
  '/email-drafting',
  '/super-admin',
  '/tenant-admin',
  '/ati-management',
  '/share/',
  '/login',
  '/register',
  '/reset-password',
  '/verify-email',
  '/clear-cookies',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
      // Answer engines: same access as everyone else, stated explicitly.
      {
        userAgent: ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web', 'PerplexityBot', 'Google-Extended', 'CCBot', 'Applebot-Extended'],
        allow: ['/', '/blog/'],
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
