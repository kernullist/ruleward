import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, RootContent, ListItem, Heading } from 'mdast';

/**
 * Markdown 본문 → 룰 후보 블록 (DEEP-DIVE §A.1).
 * heading은 구조(headingPath)로만, 코드블록은 무시.
 * 인라인 코드는 백틱째 보존한다 — 드리프트용 referent 고신뢰 신호이기 때문.
 */

export interface Block {
  text: string;
  line: number;
  headingPath: string[];
  kind: 'paragraph' | 'listItem';
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

/** mdast-util-to-string과 달리 inlineCode를 백틱으로 다시 감싼다. 블록 code는 무시. */
function mdToText(node: MdNode): string {
  if (node.type === 'inlineCode') return `\`${node.value ?? ''}\``;
  if (node.type === 'code') return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) return node.children.map(mdToText).join('');
  return '';
}

const asMd = (n: unknown): MdNode => n as MdNode;
const processor = unified().use(remarkParse);

export function extractBlocks(body: string): Block[] {
  const tree = processor.parse(body) as Root;
  const blocks: Block[] = [];
  const headingStack: Array<{ depth: number; text: string }> = [];

  const headingPath = (): string[] => headingStack.map((h) => h.text);

  const handleHeading = (node: Heading): void => {
    while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.depth >= node.depth) {
      headingStack.pop();
    }
    headingStack.push({ depth: node.depth, text: mdToText(asMd(node)).replace(/`/g, '').trim() });
  };

  const handleListItem = (li: ListItem): void => {
    const directText = li.children
      .filter((c) => c.type !== 'list')
      .map((c) => mdToText(asMd(c)))
      .join(' ')
      .trim();
    if (directText) {
      blocks.push({
        text: directText,
        line: li.position?.start.line ?? 0,
        headingPath: headingPath(),
        kind: 'listItem',
      });
    }
    for (const sub of li.children) {
      if (sub.type === 'list') {
        for (const sli of sub.children) handleListItem(sli);
      }
    }
  };

  const walk = (nodes: RootContent[]): void => {
    for (const node of nodes) {
      switch (node.type) {
        case 'heading':
          handleHeading(node);
          break;
        case 'paragraph': {
          const text = mdToText(asMd(node)).trim();
          if (text) {
            blocks.push({
              text,
              line: node.position?.start.line ?? 0,
              headingPath: headingPath(),
              kind: 'paragraph',
            });
          }
          break;
        }
        case 'list':
          for (const li of node.children) handleListItem(li);
          break;
        case 'blockquote':
          walk(node.children as RootContent[]);
          break;
        default:
          break; // code / thematicBreak / html / table 등 무시
      }
    }
  };

  walk(tree.children);
  return blocks;
}
