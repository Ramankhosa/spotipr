import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { Providers } from '@/components/providers'
import Header from '@/components/Header'
import './globals.css'

// Configure Inter and Cormorant Garamond fonts with fallbacks for offline development
const inter = localFont({
  variable: '--font-inter',
  src: [
    { path: '../fonts/inter/Inter-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../fonts/inter/Inter-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../fonts/inter/Inter-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../fonts/inter/Inter-Bold.ttf', weight: '700', style: 'normal' },
  ],
  display: 'optional',
  fallback: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
})

const cormorant = localFont({
  variable: '--font-cormorant',
  src: [
    { path: '../fonts/cormorant/Cormorant-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../fonts/cormorant/Cormorant-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../fonts/cormorant/Cormorant-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../fonts/cormorant/Cormorant-Bold.ttf', weight: '700', style: 'normal' },
  ],
  display: 'optional',
  fallback: ['Georgia', 'serif'],
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
