import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const MONTH_PATTERN = /^\d{2}\/\d{4}$/;
const ACCOUNT_PATTERN = /^\d+(?:\.\d+)+$/;
const AMOUNT_PATTERN = /^\(?-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\)?$/;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parseDelimited(text) {
  const rows = [[]];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === ';') {
      rows[rows.length - 1].push(value);
      value = '';
    } else if (!quoted && (character === '\n' || character === '\r')) {
      rows[rows.length - 1].push(value);
      value = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      rows.push([]);
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error('O CSV contém aspas sem fechamento.');
  rows[rows.length - 1].push(value);
  return rows.filter((row) => row.some((cell) => String(cell).trim() !== ''));
}

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer).replace(/^\uFEFF/, '');
  }
}

function parseAmount(value) {
  if (typeof value === 'number') return value;
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') return 0;
  if (!AMOUNT_PATTERN.test(raw)) throw new Error(`Valor mensal inválido no DRE: "${raw}".`);
  const negative = raw.startsWith('(') || raw.startsWith('-');
  const number = Number(raw.replace(/[()-]/g, '').replace(/\./g, '').replace(',', '.'));
  return negative ? -number : number;
}

function suggestedType(code) {
  const startsWithAccount = (prefix) => code === prefix || code.startsWith(`${prefix}.`);
  if (startsWithAccount('5.1') || startsWithAccount('5.3.01')) return 'direct';
  if (startsWithAccount('5.3.03') || startsWithAccount('5.7')) return 'indirect';
  return 'excluded';
}

function buildAccounts(records, months) {
  const accounts = new Map();
  for (const record of records) {
    if (!ACCOUNT_PATTERN.test(record.code) || !record.code.startsWith('5.') || !record.name) continue;
    if (!record.values.length) continue;
    const values = Object.fromEntries(months.map((month, index) => [month, parseAmount(record.values[index] ?? 0)]));
    const netExpense = -Object.values(values).reduce((sum, amount) => sum + amount, 0);
    const type = suggestedType(record.code);
    accounts.set(record.code, {
      code: record.code,
      name: record.name,
      months: values,
      monthlyAverage: Math.max(0, netExpense / Math.max(months.length, 1)),
      type,
      includedInAllocation: type === 'indirect',
    });
  }
  return Array.from(accounts.values()).sort((left, right) => left.code.localeCompare(right.code, 'pt-BR', { numeric: true }));
}

function parseCsv(text) {
  const rows = parseDelimited(text);
  const months = [];
  const records = [];
  for (const row of rows) {
    const headers = row.map((cell) => normalize(cell));
    const accountIndex = headers.indexOf('conta');
    const classificationIndex = headers.indexOf('classificacao');
    const monthsInRow = row.filter((cell) => MONTH_PATTERN.test(String(cell).trim()));
    if (accountIndex >= 0 && classificationIndex >= 0 && monthsInRow.length) {
      months.splice(0, months.length, ...monthsInRow.map((month) => String(month).trim()));
      continue;
    }
    if (!months.length || row.some((cell) => String(cell).trim() === 'S')) continue;
    const classification = String(row[classificationIndex >= 0 ? classificationIndex : 2] ?? '').trim();
    const classificationMatch = classification.match(/^(\d+(?:\.\d+)*)(?:\s+(.+))?$/);
    const code = classificationMatch?.[1] || String(row[accountIndex >= 0 ? accountIndex : 0] ?? '').trim();
    const name = classificationMatch?.[2]?.trim();
    const values = row.filter((cell) => AMOUNT_PATTERN.test(String(cell).trim()));
    if (code && name) records.push({ code, name, values });
  }
  if (!months.length) throw new Error('Não encontrei o cabeçalho mensal do DRE no CSV.');
  const accounts = buildAccounts(records, months);
  if (!accounts.length) throw new Error('Não encontrei contas detalhadas de custos e despesas no CSV.');
  return { months, accounts };
}

function groupPdfLines(items) {
  const lines = [];
  for (const item of items) {
    const text = String(item.str ?? '').trim();
    if (!text) continue;
    const x = Number(item.transform?.[4]) || 0;
    const y = Number(item.transform?.[5]) || 0;
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 1.5);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, text });
  }
  return lines.map((line) => line.items.sort((left, right) => left.x - right.x));
}

async function parsePdf(file) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const months = [];
  const records = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const line of groupPdfLines(content.items)) {
        for (const item of line) {
          if (MONTH_PATTERN.test(item.text) && !months.includes(item.text)) months.push(item.text);
        }
        if (line.some((item) => item.text === 'S')) continue;
        const code = line.find((item) => item.x >= 45 && item.x < 105 && ACCOUNT_PATTERN.test(item.text))?.text;
        if (!code || !code.startsWith('5.')) continue;
        const codeIndex = line.findIndex((item) => item.text === code);
        const name = line.filter((item, index) => index > codeIndex && item.x < 300).map((item) => item.text).join(' ').trim();
        const values = line.filter((item) => item.x >= 300 && AMOUNT_PATTERN.test(item.text)).map((item) => item.text);
        if (name && values.length) records.push({ code, name, values });
      }
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  if (!months.length) throw new Error('Não encontrei os meses do DRE no PDF. Confira se o arquivo contém texto selecionável.');
  months.sort((left, right) => {
    const [leftMonth, leftYear] = left.split('/').map(Number);
    const [rightMonth, rightYear] = right.split('/').map(Number);
    return leftYear * 12 + leftMonth - (rightYear * 12 + rightMonth);
  });
  const accounts = buildAccounts(records, months);
  if (!accounts.length) throw new Error('Não encontrei contas detalhadas de custos e despesas no PDF.');
  return { months, accounts };
}

export async function parseDreFile(file) {
  if (!file) throw new Error('Selecione um arquivo de DRE.');
  if (file.size > MAX_FILE_SIZE) throw new Error('O arquivo deve ter no máximo 10 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv') return parseCsv(decodeText(await file.arrayBuffer()));
  if (extension === 'pdf') return parsePdf(file);
  throw new Error('Formato não suportado. Selecione um arquivo PDF ou CSV.');
}
