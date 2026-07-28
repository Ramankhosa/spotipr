'use client'

// The body editor for the blog composer.
//
// A separate component from ui/rich-text-editor because editorial writing needs
// tools patent-claim editing doesn't: section headings, links (the internal ones
// the audit counts), tables (where fee and deadline comparisons live), callouts,
// and — the one an author actually asks for — a raw HTML view, so a finished
// article can be pasted in or a stray tag fixed without fighting the editor.
//
// The editor is uncontrolled after mount: TipTap owns the document and pushes
// changes up. Re-feeding `value` on every keystroke would fight the cursor.

import { useCallback, useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
// TipTap 3 ships the table node, row, cell and header as one kit from a single
// package — the old per-extension packages are re-exports of it.
import { TableKit } from '@tiptap/extension-table'
import {
  Bold,
  Code2,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo,
  Table as TableIcon,
  Undo,
} from 'lucide-react'
import { cn } from '@/lib/utils'

function ToolButton({
  onClick,
  active,
  title,
  disabled,
  children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded transition-colors disabled:opacity-40',
        active ? 'bg-lamp-100 text-lamp-700' : 'text-ai-graphite-500 hover:bg-paper-100 hover:text-ai-graphite-900'
      )}
    >
      {children}
    </button>
  )
}

export default function BlogEditor({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (html: string) => void
  disabled?: boolean
}) {
  const [showSource, setShowSource] = useState(false)
  const [source, setSource] = useState(value)

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: false, HTMLAttributes: { rel: null, target: null } }),
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'article-prose max-w-none min-h-[28rem] px-6 py-6 focus:outline-none',
      },
    },
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
  })

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  const applySource = useCallback(() => {
    onChange(source)
    editor?.commands.setContent(source, { emitUpdate: false })
    setShowSource(false)
  }, [editor, onChange, source])

  const openSource = useCallback(() => {
    setSource(editor?.getHTML() ?? value)
    setShowSource(true)
  }, [editor, value])

  const setLink = useCallback(() => {
    if (!editor) return
    const previous = editor.getAttributes('link').href as string | undefined
    const href = window.prompt('Link URL (use /blog/… for internal links)', previous ?? '/blog/')
    if (href === null) return
    if (href === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }, [editor])

  if (!editor) {
    return <div className="h-96 animate-pulse rounded-lg border border-paper-300 bg-paper-100" />
  }

  return (
    <div className="overflow-hidden rounded-lg border border-paper-300 bg-white">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-paper-200 bg-paper-50 px-2 py-1.5">
        <ToolButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Section heading (H2)" disabled={disabled}>
          <Heading2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Sub-heading (H3)" disabled={disabled}>
          <Heading3 className="h-4 w-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-paper-300" />

        <ToolButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold" disabled={disabled}>
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic" disabled={disabled}>
          <Italic className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={setLink} active={editor.isActive('link')} title="Link" disabled={disabled}>
          <Link2 className="h-4 w-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-paper-300" />

        <ToolButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bulleted list" disabled={disabled}>
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list" disabled={disabled}>
          <ListOrdered className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote" disabled={disabled}>
          <Quote className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          title="Insert table — put fees and deadlines here"
          disabled={disabled}
        >
          <TableIcon className="h-4 w-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-paper-300" />

        <ToolButton onClick={() => editor.chain().focus().undo().run()} title="Undo" disabled={disabled}>
          <Undo className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().redo().run()} title="Redo" disabled={disabled}>
          <Redo className="h-4 w-4" />
        </ToolButton>

        <div className="ml-auto">
          <button
            type="button"
            onClick={showSource ? applySource : openSource}
            className={cn(
              'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
              showSource
                ? 'bg-lamp-600 text-white hover:bg-lamp-700'
                : 'text-ai-graphite-500 hover:bg-paper-100 hover:text-ai-graphite-900'
            )}
          >
            <Code2 className="h-3.5 w-3.5" />
            {showSource ? 'Apply HTML' : 'Edit HTML'}
          </button>
        </div>
      </div>

      {showSource ? (
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          className="min-h-[28rem] w-full resize-y bg-paper-950 px-5 py-4 font-mono text-[12px] leading-relaxed text-paper-100 focus:outline-none"
        />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  )
}
