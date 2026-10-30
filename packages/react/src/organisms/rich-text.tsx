import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button, Field } from '../atoms/index.js';
import type { FieldComponentProps } from '../registry.js';

type RichValue = { tiptap?: unknown } | null | undefined;

/**
 * Rich text editor (Tiptap).
 *
 * Stores `{ tiptap: <document> }` — the editor name travels with the value so a future
 * editor swap can still read old documents, per the spec.
 */
export function RichText({ field, value, onChange, error, id }: FieldComponentProps) {
  const current = value as RichValue;
  const editor = useEditor({
    extensions: [StarterKit],
    content: (current?.tiptap as object | undefined) ?? null,
    onUpdate: ({ editor: instance }) => onChange({ tiptap: instance.getJSON() }),
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-24 rounded-md border border-zinc-300 p-3 focus:outline-none',
      },
    },
  });

  return (
    <Field label={field.name} description={field.admin?.description} error={error} htmlFor={id}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            tone={editor?.isActive('bold') ? 'accent' : 'ghost'}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            B
          </Button>
          <Button
            size="sm"
            tone={editor?.isActive('italic') ? 'accent' : 'ghost'}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            I
          </Button>
          <Button
            size="sm"
            tone="ghost"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            •
          </Button>
          <Button
            size="sm"
            tone="ghost"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            H2
          </Button>
        </div>
        <EditorContent editor={editor} id={id} />
      </div>
    </Field>
  );
}
