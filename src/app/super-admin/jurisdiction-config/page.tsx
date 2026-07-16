import { redirect } from 'next/navigation'

// The jurisdiction configuration matrix now lives in the unified Jurisdictions hub.
export default function JurisdictionConfigRedirect() {
  redirect('/super-admin/jurisdictions?tab=matrix')
}
