import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from '@/components/providers'
import Header from '@/components/Header'
import './globals.css'

// Configure Inter font with fallbacks for offline development
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
  preload: false, // Disable preload to prevent fetch attempts
})

export const metadata: Metadata = {
  title: 'Spotipr - AI-Powered Grant Writing',
  description: 'Professional grant writing assistance powered by AI',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gpt-gray-50 min-h-screen`}>
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  )
}
