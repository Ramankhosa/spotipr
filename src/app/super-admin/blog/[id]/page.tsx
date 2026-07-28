// Edit an existing article.

import BlogComposer from '@/components/super-admin/blog/BlogComposer'

export default function EditBlogPostPage({ params }: { params: { id: string } }) {
  return <BlogComposer postId={params.id} />
}
