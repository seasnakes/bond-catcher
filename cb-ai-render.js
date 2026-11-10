(function (root) {
  "use strict";
  const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  function inline(value) {
    const text = String(value ?? "");
    const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[((?:P[1-5])|C1)\]/g;
    let result = "", offset = 0;
    for (const match of text.matchAll(pattern)) {
      result += escape(text.slice(offset, match.index));
      if (match[1]) result += `<a href="${escape(match[2])}" target="_blank" rel="noopener noreferrer">${escape(match[1])}</a>`;
      else if (match[3]) result += `<strong>${escape(match[3])}</strong>`;
      else if (match[4]) result += `<code>${escape(match[4])}</code>`;
      else result += `<a class="citation" href="#theory-${match[5]}">[${match[5]}]</a>`;
      offset = match.index + match[0].length;
    }
    return result + escape(text.slice(offset));
  }
  function markdown(value) {
    const lines = String(value || "").replaceAll("\r\n", "\n").slice(0, 100_000).split("\n");
    const output = []; let list = null, code = false, codeLines = [];
    const closeList = () => { if (list) { output.push(`</${list}>`); list = null; } };
    const tableRow = line => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) { closeList(); if (code) { output.push(`<pre><code>${escape(codeLines.join("\n"))}</code></pre>`); codeLines = []; } code = !code; continue; }
      if (code) { codeLines.push(line); continue; }
      if (!line.trim()) { closeList(); continue; }
      if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || "")) {
        closeList(); const headings = tableRow(line); output.push(`<table><thead><tr>${headings.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>`); i++;
        while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim()) output.push(`<tr>${tableRow(lines[++i]).map(c => `<td>${inline(c)}</td>`).join("")}</tr>`);
        output.push("</tbody></table>"); continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) { closeList(); output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
      const bullet = line.match(/^\s*(?:([-*])|\d+[.)])\s+(.+)$/);
      if (bullet) { const type = bullet[1] ? "ul" : "ol"; if (list !== type) { closeList(); output.push(`<${type}>`); list = type; } output.push(`<li>${inline(bullet[2])}</li>`); continue; }
      closeList();
      if (/^>\s?/.test(line)) output.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      else if (/^\s*[-*_]{3,}\s*$/.test(line)) output.push("<hr>");
      else output.push(`<p>${inline(line)}</p>`);
    }
    closeList(); if (codeLines.length) output.push(`<pre><code>${escape(codeLines.join("\n"))}</code></pre>`);
    return output.join("\n");
  }
  const api = { escape, inline, markdown };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CbAiRender = api;
})(typeof window !== "undefined" ? window : globalThis);
