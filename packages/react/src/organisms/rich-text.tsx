import { useQuery } from '@tanstack/react-query';
import Image from '@tiptap/extension-image';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Plus,
  Quote,
} from 'lucide-react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { Button, Field, Input } from '../atoms/index.js';
import { useCms, useMessages } from '../context.js';
import { useAdminSchema } from '../queries.js';
import { blockTitle, type FieldComponentProps, fieldTitle } from '../registry.js';
import { CmsBlockNode, RichTextBlocksContext } from './rich-text-block.js';

type RichValue = { tiptap?: unknown } | null | undefined;

type Tool = {
  label: string;
  icon: LucideIcon;
  active: [string, Record<string, unknown>?];
  run: (chain: ReturnType<NonNullable<ReturnType<typeof useEditor>>['chain']>) => {
    run: () => boolean;
  };
};

const TOOLS: Tool[] = [
  { label: 'Bold', icon: Bold, active: ['bold'], run: (chain) => chain.toggleBold() },
  { label: 'Italic', icon: Italic, active: ['italic'], run: (chain) => chain.toggleItalic() },
  {
    label: 'Heading 2',
    icon: Heading2,
    active: ['heading', { level: 2 }],
    run: (chain) => chain.toggleHeading({ level: 2 }),
  },
  {
    label: 'Heading 3',
    icon: Heading3,
    active: ['heading', { level: 3 }],
    run: (chain) => chain.toggleHeading({ level: 3 }),
  },
  { label: 'List', icon: List, active: ['bulletList'], run: (chain) => chain.toggleBulletList() },
  {
    label: 'Numbered list',
    icon: ListOrdered,
    active: ['orderedList'],
    run: (chain) => chain.toggleOrderedList(),
  },
  { label: 'Quote', icon: Quote, active: ['blockquote'], run: (chain) => chain.toggleBlockquote() },
];

/** `javascript:` and friends would run in whoever renders this text. */
function isSafeLink(url: string): boolean {
  return /^(https?:|mailto:|tel:|cms:|\/|#)/i.test(url);
}

/** Search a collection and link to the chosen document. */
function DocumentLinkPicker({ onPick }: { onPick: (href: string) => void }) {
  const t = useMessages();
  const { client } = useCms();
  const schema = useAdminSchema();
  const collections = schema.data?.collections ?? [];
  const [slug, setSlug] = useState('');
  const target = collections.find((item) => item.slug === slug) ?? collections[0];
  const title = target?.admin?.useAsTitle;
  const docs = useQuery({
    queryKey: ['cms', 'rich-link', target?.slug],
    enabled: Boolean(target),
    queryFn: () => client.list(target?.slug as string, { limit: 50, depth: 0 }),
  });

  return (
    <div className="rich-text__doc-link">
      <select
        className="select select--inline"
        aria-label={t.content}
        value={target?.slug ?? ''}
        onChange={(event) => setSlug(event.target.value)}
      >
        {collections.map((item) => (
          <option key={item.slug} value={item.slug}>
            {item.labels?.plural ?? item.slug}
          </option>
        ))}
      </select>
      <select
        className="select select--inline"
        aria-label={t.linkToDocument}
        value=""
        onChange={(event) => {
          if (event.target.value) onPick(`cms:${target?.slug}/${event.target.value}`);
        }}
      >
        <option value="">{t.linkToDocument}…</option>
        {(docs.data?.docs ?? []).map((doc) => (
          <option key={String(doc.id)} value={String(doc.id)}>
            {String((title && doc[title]) ?? doc.id)}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Rich text editor (Tiptap).
 *
 * Stores `{ tiptap: <document> }` — the editor name travels with the value so a future
 * editor swap can still read old documents, per the spec.
 */
export function RichText({ field, value, onChange, error, id, disabled }: FieldComponentProps) {
  const current = value as RichValue;
  const t = useMessages();
  const { upload } = useCms();
  const imageInput = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const linkRange = useRef<{ from: number; to: number } | null>(null);
  const [href, setHref] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // `cms:<collection>/<id>` keeps a link valid when the slug changes; the site resolves it.
        link: { openOnClick: false, protocols: ['cms'], isAllowedUri: (url) => isSafeLink(url) },
      }),
      Image,
      CmsBlockNode,
    ],
    content: (current?.tiptap as object | undefined) ?? null,
    editable: !disabled,
    // The toolbar shows the marks under the caret, so it follows every transaction.
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: instance }) => onChange({ tiptap: instance.getJSON() }),
    editorProps: { attributes: { class: 'rich-text__body', 'aria-label': fieldTitle(field) } },
  });

  // A version restore replaces the value from outside; typing never gets here (same document).
  useEffect(() => {
    if (!editor) return;
    const next = current?.tiptap ?? null;
    if (JSON.stringify(next) === JSON.stringify(editor.getJSON())) return;
    if (next === null && editor.isEmpty) return;
    editor.commands.setContent(next as object, { emitUpdate: false });
  }, [editor, current]);

  const applyLink = (url: string) => {
    if (editor) {
      // The selection from when the panel opened: focus left the editor to get here.
      const chain = editor.chain().focus();
      if (linkRange.current) chain.setTextSelection(linkRange.current);
      chain.extendMarkRange('link');
      if (url && isSafeLink(url)) chain.setLink({ href: url }).run();
      else chain.unsetLink().run();
    }
    setLinking(false);
  };

  const onImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !upload) return;
    setFailure(null);
    upload(file, { field: field.name }).then(
      (asset) => {
        if (asset.url) editor?.chain().focus().setImage({ src: asset.url, alt: '' }).run();
        else setFailure(t.uploadFailed);
      },
      () => setFailure(t.uploadFailed),
    );
  };

  return (
    <Field
      label={fieldTitle(field)}
      description={field.admin?.description}
      error={error ?? failure ?? undefined}
      htmlFor={id}
    >
      <RichTextBlocksContext.Provider value={field.blocks ?? []}>
        <div className="rich-text">
          <div className="rich-text__tools">
            {TOOLS.map(({ label, icon: Icon, active, run }) => (
              <Button
                key={label}
                size="xs"
                tone={editor?.isActive(...active) ? 'selected' : 'ghost'}
                aria-label={label}
                title={label}
                disabled={disabled}
                onClick={() => {
                  if (editor) run(editor.chain().focus()).run();
                }}
              >
                <Icon aria-hidden />
              </Button>
            ))}
            <Button
              size="xs"
              tone={editor?.isActive('link') ? 'selected' : 'ghost'}
              aria-label={t.link}
              title={t.link}
              disabled={disabled}
              onClick={() => {
                if (editor) {
                  const { from, to } = editor.state.selection;
                  linkRange.current = { from, to };
                }
                setHref(String(editor?.getAttributes('link').href ?? ''));
                setLinking((open) => !open);
              }}
            >
              <Link2 aria-hidden />
            </Button>
            {(field.blocks ?? []).map((block) => (
              <Button
                key={block.slug}
                size="xs"
                tone="ghost"
                title={`${t.insertBlock}: ${blockTitle(block)}`}
                disabled={disabled}
                onClick={() =>
                  editor
                    ?.chain()
                    .focus()
                    .insertContent({ type: 'cmsBlock', attrs: { blockType: block.slug, data: {} } })
                    .run()
                }
              >
                <Plus aria-hidden />
                {blockTitle(block)}
              </Button>
            ))}
            {upload ? (
              <Button
                size="xs"
                tone="ghost"
                aria-label={t.image}
                title={t.image}
                disabled={disabled}
                onClick={() => imageInput.current?.click()}
              >
                <ImagePlus aria-hidden />
              </Button>
            ) : null}
          </div>
          {linking ? (
            <div className="rich-text__link">
              <Input
                type="url"
                aria-label={t.linkUrl}
                placeholder="https://"
                value={href}
                autoFocus
                onChange={(event) => setHref(event.target.value)}
                onKeyDown={(event) => {
                  // A plain Enter here would submit the whole document form.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyLink(href);
                  }
                  if (event.key === 'Escape') setLinking(false);
                }}
              />
              <Button size="xs" onClick={() => applyLink(href)}>
                {t.apply}
              </Button>
              <DocumentLinkPicker onPick={applyLink} />
              {editor?.isActive('link') ? (
                <Button size="xs" tone="ghost" onClick={() => applyLink('')}>
                  {t.removeLink}
                </Button>
              ) : null}
            </div>
          ) : null}
          <EditorContent editor={editor} id={id} />
          <input ref={imageInput} type="file" accept="image/*" hidden onChange={onImage} />
        </div>
      </RichTextBlocksContext.Provider>
    </Field>
  );
}
