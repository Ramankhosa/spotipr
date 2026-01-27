import type { Metadata } from 'next'
import { Inter, Cormorant_Garamond } from 'next/font/google'
import { Providers } from '@/components/providers'
import Header from '@/components/Header'
import './globals.css'

// Configure Inter and Cormorant Garamond fonts with fallbacks for offline development
const inter = Inter({
  subsets: ['latin'],
  display: 'optional', // Changed from 'swap' to 'optional' to prevent build failures
  fallback: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
  preload: false, // Disable preload to avoid network requests during build
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'optional', // Changed from 'swap' to 'optional' to prevent build failures
  variable: '--font-cormorant',
  preload: false, // Disable preload to avoid network requests during build
})

export const metadata: Metadata = {
  title: 'PatentNest.ai – "Where Ideas Hatch Into Patents"',
  description: 'Draft, validate, and protect inventions — effortlessly, intelligently, and globally. AI-powered patent writing for innovators.',
  icons: {
    icon: '/animations/logo-video.gif',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${cormorant.variable} bg-gpt-gray-50 min-h-screen`}>
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  )
}
