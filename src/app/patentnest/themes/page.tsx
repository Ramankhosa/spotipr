import type { Metadata } from 'next'
import ThemeLab from '@/components/patentnest/ThemeLab'

export const metadata: Metadata = {
  title: 'Theme lab — PatentNest.ai',
  description: 'Compare the Brass, Letters Patent, and Banker’s Green color systems on a live document card.',
}

export default function ThemeLabPage() {
  return <ThemeLab />
}
