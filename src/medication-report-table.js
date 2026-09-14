/** Split Markdown cells without treating an escaped pipe in evidence as a column. */
export function splitMedicationReportRow(line) {
  const source = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\" && ["|", "\\"].includes(source[index + 1])) {
      cell += source[++index];
    } else if (source[index] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += source[index];
  }
  cells.push(cell.trim());
  return cells.map((value) => value.replace(/<br\s*\/?\s*>/gi, "\n"));
}

/** Older model responses sometimes contain unescaped pipes in the last evidence cell. */
export function normalizeMedicationReportRow(cells, columnCount) {
  const row = cells.slice(0, columnCount - 1);
  row.push(cells.slice(columnCount - 1).join(" | "));
  while (row.length < columnCount) row.push("");
  return row;
}
