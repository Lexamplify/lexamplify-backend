import { NodeViewWrapper } from '@tiptap/react';

// Real <input>, not contenteditable — simpler and more reliable for typed
// text than fighting contenteditable's caret/selection quirks inside a
// ProseMirror atom node. Sizing follows the current value/label so a filled
// amount or date doesn't get visually truncated inside a fixed-width box.
export default function BlankField({ node, updateAttributes }) {
  const { label, value } = node.attrs;
  const widthCh = Math.max(8, (value || label).length + 4);

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline-block' }} contentEditable={false}>
      <input
        type="text"
        className="blank"
        placeholder={label}
        value={value || ''}
        onChange={(e) => updateAttributes({ value: e.target.value })}
        style={{ width: `${widthCh}ch` }}
        title={label}
      />
    </NodeViewWrapper>
  );
}
