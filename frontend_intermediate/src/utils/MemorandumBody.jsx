import React from "react";

/** Renders `**bold**` segments as <strong>; preserves paragraph breaks (\n\n). */
function renderBoldParts(line) {
  if (!line) return null;
  const parts = String(line).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

export function MemorandumBody({ text }) {
  if (!text) return null;
  const blocks = String(text).trim().split(/\n\n+/);
  return blocks.map((block, bi) => {
    const lines = block.split("\n");
    return (
      <p key={bi} className="adv-memo-block">
        {lines.map((line, li) => (
          <React.Fragment key={li}>
            {li > 0 ? <br /> : null}
            {renderBoldParts(line)}
          </React.Fragment>
        ))}
      </p>
    );
  });
}
