const HEADER_ALIASES = {
  sku: ['sku', 'skudoproduto', 'codigo', 'codproduto', 'codigoproduto', 'codigoitem', 'referencia', 'ref', 'code', 'productcode'],
  product: ['produto', 'nomedoproduto', 'nomeitem', 'descricao', 'descricaoitem', 'description', 'itemdescription', 'product', 'productname', 'name', 'item'],
  quantity: ['quantidade', 'quantidadeestoque', 'qtd', 'qtdestoque', 'qtde', 'quant', 'saldo', 'estoque', 'quantity', 'qty', 'stock', 'unidades', 'units'],
};

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function normalizeStockIdentifier(value) {
  return String(value ?? '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ');
}

function parseQuantity(value, rowNumber) {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return value;
    throw new Error(`Linha ${rowNumber}: a quantidade deve ser um número inteiro maior que zero.`);
  }
  let normalized = String(value ?? '').trim().replace(/[\s\u00a0]/g, '');
  if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  }
  const quantity = Number(normalized);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error(`Linha ${rowNumber}: a quantidade deve ser um número inteiro maior que zero.`);
  }
  return quantity;
}

function parseDelimited(text, delimiter) {
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
    } else if (!quoted && character === delimiter) {
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
  if (quoted) throw new Error('O arquivo contém aspas sem fechamento.');
  rows[rows.length - 1].push(value);
  return rows.filter((row) => row.some((cell) => String(cell).trim() !== ''));
}

function parseTextTable(text) {
  const normalizedText = text.replace(/^\uFEFF/, '');
  const delimiters = [';', '\t', ',', '|'];
  let selectedRows = [];
  let selectedColumnCount = 0;
  for (const delimiter of delimiters) {
    try {
      const rows = parseDelimited(normalizedText, delimiter);
      if (rows[0]?.length > selectedColumnCount) {
        selectedRows = rows;
        selectedColumnCount = rows[0].length;
      }
    } catch (issue) {
      if (delimiter === delimiters[delimiters.length - 1]) throw issue;
    }
  }
  return selectedRows;
}

function parseXmlTable(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('O arquivo XML está malformado.');
  const root = xml.documentElement;
  if (!root) throw new Error('O arquivo XML está vazio.');
  const elements = [];
  const visit = (element, depth) => {
    elements.push({ element, depth });
    Array.from(element.children).forEach((child) => visit(child, depth + 1));
  };
  visit(root, 0);
  const collection = elements
    .filter(({ element }) => {
      const rows = Array.from(element.children);
      return rows.length > 0 && rows.every((row) => row.children.length > 0);
    })
    .sort((left, right) => right.depth - left.depth)[0]?.element;
  const records = collection ? Array.from(collection.children) : [root];
  return records.map((record) => Array.from(record.children)
    .map((cell) => ({ header: cell.localName || cell.nodeName, value: cell.textContent.trim() })));
}

function normalizeRows(matrix) {
  if (!matrix.length) throw new Error('O arquivo não contém linhas para importar.');
  const headers = matrix[0].map(normalizeHeader);
  const column = (key) => headers.findIndex((header) => HEADER_ALIASES[key].includes(header));
  const skuIndex = column('sku');
  const productIndex = column('product');
  const quantityIndex = column('quantity');
  if (skuIndex < 0 && productIndex < 0) {
    throw new Error('Inclua um cabeçalho "sku" ou "produto" para identificar os itens.');
  }
  if (quantityIndex < 0) throw new Error('Inclua uma coluna com o cabeçalho "quantidade".');
  const rows = matrix.slice(1).map((cells, index) => {
    const rowNumber = index + 2;
    const sku = skuIndex < 0 ? '' : String(cells[skuIndex] ?? '').trim();
    const name = productIndex < 0 ? '' : String(cells[productIndex] ?? '').trim();
    if (!sku && !name) throw new Error(`Linha ${rowNumber}: informe o SKU ou o nome do produto.`);
    return {
      rowNumber,
      sku,
      name,
      quantity: parseQuantity(cells[quantityIndex], rowNumber),
    };
  });
  if (!rows.length) throw new Error('O arquivo não contém produtos abaixo do cabeçalho.');
  return rows;
}

function parseXmlRows(records) {
  if (!records.length || !records[0].length) throw new Error('O XML não contém elementos de produto.');
  const headers = records[0].map((cell) => normalizeHeader(cell.header));
  const matrix = [headers, ...records.map((record) => {
    const values = new Map(record.map((cell) => [normalizeHeader(cell.header), cell.value]));
    return headers.map((header) => values.get(header) ?? '');
  })];
  return normalizeRows(matrix);
}

function decodeTextFile(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export async function parseStockFile(file) {
  if (!file) throw new Error('Selecione um arquivo para importar.');
  if (file.size > 10 * 1024 * 1024) throw new Error('O arquivo deve ter no máximo 10 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (['xls', 'xlsx'].includes(extension)) {
    const XLSX = await import('@e965/xlsx');
    let workbook;
    try {
      workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    } catch (issue) {
      throw new Error(`Não foi possível ler a planilha: ${issue.message}`);
    }
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error('A planilha não contém uma aba com dados.');
    return normalizeRows(XLSX.utils.sheet_to_json(firstSheet, {
      header: 1, raw: false, defval: '', blankrows: false,
    }));
  }
  if (!['csv', 'txt', 'xml'].includes(extension)) {
    throw new Error('Formato não suportado. Selecione XLS, XLSX, CSV, TXT ou XML.');
  }
  const buffer = await file.arrayBuffer();
  const text = decodeTextFile(buffer);
  return extension === 'xml' ? parseXmlRows(parseXmlTable(text)) : normalizeRows(parseTextTable(text));
}

function parseErpAmount(value, rowNumber) {
  if (value === '' || value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new Error(`Linha ${rowNumber}: o total X:Z contém um valor inválido.`);
  }
  let normalized = String(value).trim().replace(/[\s\u00a0]/g, '').replace(/[R$]/g, '');
  const commaIndex = normalized.lastIndexOf(',');
  const dotIndex = normalized.lastIndexOf('.');
  if (commaIndex > dotIndex) normalized = normalized.replace(/\./g, '').replace(',', '.');
  else if (dotIndex >= 0) normalized = normalized.replace(/,/g, '');
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) {
    throw new Error(`Linha ${rowNumber}: o total X:Z contém um valor inválido.`);
  }
  return amount;
}

export async function parseErpStockFile(file) {
  if (!file) throw new Error('Selecione um relatório do ERP para importar.');
  if (file.size > 10 * 1024 * 1024) throw new Error('O arquivo deve ter no máximo 10 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['xls', 'xlsx'].includes(extension)) {
    throw new Error('O relatório do ERP deve estar no formato XLS ou XLSX.');
  }

  const XLSX = await import('@e965/xlsx');
  let workbook;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true });
  } catch (issue) {
    throw new Error(`Não foi possível ler o relatório do ERP: ${issue.message}`);
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet?.['!ref']) throw new Error('O relatório do ERP não contém uma planilha com dados.');

  const range = XLSX.utils.decode_range(sheet['!ref']);
  const cellAt = (row, column) => sheet[XLSX.utils.encode_cell({ r: row, c: column })];
  const cellText = (row, column) => {
    const cell = cellAt(row, column);
    return String(cell?.w ?? cell?.v ?? '').trim();
  };
  const headerRow = Array.from({ length: range.e.r - range.s.r + 1 }, (_, index) => range.s.r + index)
    .find((row) => normalizeHeader(cellText(row, 0)) === 'produto'
      && normalizeHeader(cellText(row, 22)) === 'quantest'
      && normalizeHeader(cellText(row, 24)) === 'total');
  if (headerRow === undefined) {
    throw new Error('Formato de relatório ERP não reconhecido. Confira as colunas Produto, Quant. Est. e Total.');
  }

  const rows = [];
  let ignoredNonpositiveTotals = 0;
  let productRowCount = 0;
  for (let row = headerRow + 1; row <= range.e.r; row += 1) {
    const sku = cellText(row, 0);
    const name = cellText(row, 1);
    if (!sku && !name) continue;
    productRowCount += 1;

    const total = [23, 24, 25].reduce((sum, column) => {
      const cell = cellAt(row, column);
      return sum + parseErpAmount(cell?.v, row + 1);
    }, 0);
    if (total <= 0) {
      ignoredNonpositiveTotals += 1;
      continue;
    }

    const quantity = parseQuantity(cellAt(row, 20)?.v, row + 1);
    rows.push({ rowNumber: row + 1, sku, name, quantity });
  }

  if (productRowCount === 0) throw new Error('O relatório do ERP não contém linhas de produto.');
  return { rows, ignoredNonpositiveTotals };
}

export function planStockImport(products, rows) {
  const groups = new Map();
  const errors = [];
  const indexes = { sku: new Map(), name: new Map() };
  for (const product of products) {
    for (const [field, value] of [['sku', product.sku], ['name', product.name]]) {
      const key = normalizeStockIdentifier(value);
      if (!key) continue;
      const matches = indexes[field].get(key) || [];
      matches.push(product);
      indexes[field].set(key, matches);
    }
  }
  for (const row of rows) {
    const field = row.sku ? 'sku' : 'name';
    const key = normalizeStockIdentifier(row[field]);
    const matches = indexes[field].get(key) || [];
    if (matches.length !== 1) {
      errors.push({
        rowNumber: row.rowNumber,
        message: matches.length ? 'O identificador corresponde a mais de um produto.' : 'Produto não cadastrado; confira o SKU ou o nome.',
      });
      continue;
    }
    if (!Number.isSafeInteger(row.quantity) || row.quantity <= 0) {
      errors.push({ rowNumber: row.rowNumber, message: 'A quantidade deve ser um inteiro maior que zero.' });
      continue;
    }
    const product = matches[0];
    const group = groups.get(product.id) || { product, quantity: 0, lineCount: 0 };
    if (!Number.isSafeInteger(group.quantity + row.quantity)) {
      errors.push({ rowNumber: row.rowNumber, message: 'A soma das quantidades deste produto excede o limite permitido.' });
      continue;
    }
    group.quantity += row.quantity;
    group.lineCount += 1;
    groups.set(product.id, group);
  }
  return { groups: Array.from(groups.values()), errors };
}
