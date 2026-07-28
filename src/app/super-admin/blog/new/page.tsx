// New article. The composer handles both create and edit; without a postId it
// POSTs and then redirects to the saved article's own URL.

import BlogComposer from '@/components/super-admin/blog/BlogComposer'

export default function NewBlogPostPage() {
  return <BlogComposer />
}
