export function parseCsv(csv: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      record.push(cell);
      cell = "";
    } else if (character === "\n" && !quoted) {
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  record.push(cell);
  records.push(record);
  return records;
}
