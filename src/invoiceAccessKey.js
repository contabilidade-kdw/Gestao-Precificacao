export function isValidInvoiceAccessKey(value) {
  return typeof value === 'string' && /^[0-9]{44}$/.test(value);
}

export function isInvoiceNumberProvided(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isSaleInvoiceValidated(sale) {
  return Boolean(sale?.invoiceValidatedAt
    && isValidInvoiceAccessKey(sale.invoiceAccessKey)
    && isInvoiceNumberProvided(String(sale.invoiceNumber || '')));
}

export function isSaleInvoiceCancelled(sale) {
  return Boolean(sale?.invoiceCancelledAt
    && isValidInvoiceAccessKey(sale.invoiceCancellationAccessKey)
    && isInvoiceNumberProvided(String(sale.invoiceCancellationNumber || '')));
}
