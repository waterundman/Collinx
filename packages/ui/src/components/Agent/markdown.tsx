import React from "react";

/**
 * v2.5.0：AI 回复的轻量 Markdown 渲染。
 *
 * 为什么必要：模型（DeepSeek 等）默认用 Markdown 组织答复（粗体、列表、
 * 行内代码、标题），此前原样显示成 `**动机概要**`、`- 音域：…`，可读性很差。
 *
 * 设计约束：
 * - **不引第三方依赖**（本仓 UI 层零运行时依赖新增）
 * - **不做 HTML 注入**：只产出 React 元素，绝不使用 dangerouslySetInnerHTML
 * - 只支持模型实际常用的子集：标题 / 无序列表 / 有序列表 / 引用 / 代码块 /
 *   段落 + 行内 **粗体**、*斜体*、`代码`
 */

type InlineToken = { type: "text" | "bold" | "italic" | "code"; value: string };

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;

function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) tokens.push({ type: "text", value: line.slice(last, idx) });
    const raw = m[0];
    if (raw.startsWith("**")) tokens.push({ type: "bold", value: raw.slice(2, -2) });
    else if (raw.startsWith("`")) tokens.push({ type: "code", value: raw.slice(1, -1) });
    else tokens.push({ type: "italic", value: raw.slice(1, -1) });
    last = idx + raw.length;
  }
  if (last < line.length) tokens.push({ type: "text", value: line.slice(last) });
  return tokens;
}

function renderInline(line: string, keyPrefix: string): React.ReactNode[] {
  return parseInline(line).map((tok, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (tok.type) {
      case "bold":
        return <strong key={key}>{tok.value}</strong>;
      case "italic":
        return <em key={key}>{tok.value}</em>;
      case "code":
        return (
          <code key={key} className="cx-md-code">
            {tok.value}
          </code>
        );
      default:
        return <React.Fragment key={key}>{tok.value}</React.Fragment>;
    }
  });
}

/** 把一段纯文本渲染为结构化节点。 */
export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let codeBlock: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const body = paragraph.join("\n");
    blocks.push(
      <p key={`p-${blocks.length}`} className="cx-md-p">
        {renderInline(body, `p-${blocks.length}`)}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`list-${blocks.length}`} className="cx-md-list">
        {list.items.map((item, i) => (
          <li key={i}>{renderInline(item, `li-${blocks.length}-${i}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // 代码块围栏
    if (line.trim().startsWith("```")) {
      if (codeBlock) {
        blocks.push(
          <pre key={`code-${blocks.length}`} className="cx-md-pre">
            <code>{codeBlock.join("\n")}</code>
          </pre>
        );
        codeBlock = null;
      } else {
        flushParagraph();
        flushList();
        codeBlock = [];
      }
      continue;
    }
    if (codeBlock) {
      codeBlock.push(rawLine);
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    // 标题
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 3, 6); // 消息内标题不抢正文档的层级
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(
        <Tag key={`h-${blocks.length}`} className="cx-md-h">
          {renderInline(heading[2], `h-${blocks.length}`)}
        </Tag>
      );
      continue;
    }

    // 引用
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(
        <blockquote key={`q-${blocks.length}`} className="cx-md-quote">
          {renderInline(quote[1], `q-${blocks.length}`)}
        </blockquote>
      );
      continue;
    }

    // 列表
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[2]);
      continue;
    }

    // 表格行（不做完整表格布局，去掉竖线保证可读）
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 分隔行
      blocks.push(
        <div key={`tr-${blocks.length}`} className="cx-md-row">
          {cells.map((c, i) => (
            <span key={i} className="cx-md-cell">
              {renderInline(c, `td-${blocks.length}-${i}`)}
            </span>
          ))}
        </div>
      );
      continue;
    }

    paragraph.push(line);
  }

  if (codeBlock) {
    blocks.push(
      <pre key={`code-${blocks.length}`} className="cx-md-pre">
        <code>{codeBlock.join("\n")}</code>
      </pre>
    );
  }
  flushParagraph();
  flushList();

  return <>{blocks}</>;
}

export default renderMarkdown;
