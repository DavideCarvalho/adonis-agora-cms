import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { X } from 'lucide-react';
import { createContext, useContext } from 'react';
import { Button } from '../atoms/index.js';
import { useMessages } from '../context.js';
import { blockTitle } from '../registry.js';
import type { AdminField } from '../types.js';
import { StructuredRowFields } from './structured.js';

type BlockDefinitions = { slug: string; labels?: unknown; fields: AdminField[] }[];

export const RichTextBlocksContext = createContext<BlockDefinitions>([]);

type NodeViewProps = {
  node: { attrs: { blockType: string; data: Record<string, unknown> } };
  updateAttributes(attrs: Record<string, unknown>): void;
  deleteNode(): void;
  getPos(): number | undefined;
};

function RichTextBlockView({ node, updateAttributes, deleteNode, getPos }: NodeViewProps) {
  const t = useMessages();
  const definitions = useContext(RichTextBlocksContext);
  const definition = definitions.find((item) => item.slug === node.attrs.blockType);

  return (
    <NodeViewWrapper className="rich-block" contentEditable={false}>
      <div className="rich-block__head">
        <strong>{definition ? blockTitle(definition) : node.attrs.blockType}</strong>
        <Button size="xs" tone="ghost" aria-label={t.remove} title={t.remove} onClick={deleteNode}>
          <X aria-hidden />
        </Button>
      </div>
      {definition ? (
        <StructuredRowFields
          fields={definition.fields}
          row={node.attrs.data ?? {}}
          prefix={`richblock-${getPos() ?? 0}`}
          onChange={(data) => updateAttributes({ data })}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

/**
 * A block inside the text. Its fields live in the node's own attributes, so the whole thing stays one
 * value in the document's rich text: `{ type: 'cmsBlock', attrs: { blockType, data } }`.
 */
export const CmsBlockNode = Node.create({
  name: 'cmsBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      blockType: { default: '' },
      data: { default: {} },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-cms-block-node]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-cms-block-node': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RichTextBlockView as never);
  },
});
