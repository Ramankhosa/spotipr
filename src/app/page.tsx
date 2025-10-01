import { redirect } from 'next/navigation'

export default async function HomePage() {
  // Let the client-side authentication handle user state
  // If not authenticated, the dashboard will redirect to login
  redirect('/dashboard')
}

