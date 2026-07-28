import { redirect } from 'next/navigation'

// This design was developed at /home-v2 and is now the default homepage, so the
// old path redirects rather than serving a second copy. Keeps links shared while
// the design was in review from 404ing, and leaves one source of truth in
// src/app/page.tsx.
export default function HomeV2Redirect() {
  redirect('/')
}
