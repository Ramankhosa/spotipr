import { redirect } from 'next/navigation'

// Country profile management now lives in the unified Jurisdictions hub.
export default function CountriesRedirect() {
  redirect('/super-admin/jurisdictions')
}
