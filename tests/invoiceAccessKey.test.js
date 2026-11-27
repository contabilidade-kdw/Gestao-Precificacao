import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isInvoiceNumberProvided, isSaleInvoiceCancelled, isSaleInvoiceValidated, isValidInvoiceAccessKey,
} from '../src/invoiceAccessKey.js';

test('accepts only a 44-digit numeric NF-e access key', () => {
  assert.equal(isValidInvoiceAccessKey('1234567890'.repeat(4) + '1234'), true);
  assert.equal(isValidInvoiceAccessKey('1234567890'.repeat(4) + '123'), false);
  assert.equal(isValidInvoiceAccessKey('1234567890'.repeat(4) + '12345'), false);
  assert.equal(isValidInvoiceAccessKey('1234567890'.repeat(4) + '123a'), false);
});

test('requires a non-blank NF number', () => {
  assert.equal(isInvoiceNumberProvided('12345'), true);
  assert.equal(isInvoiceNumberProvided('  '), false);
  assert.equal(isInvoiceNumberProvided(''), false);
});

test('recognizes validated and cancelled invoices only with complete invoice data', () => {
  const key = '1234567890'.repeat(4) + '1234';
  const validatedSale = { invoiceValidatedAt: '2026-11-27', invoiceAccessKey: key, invoiceNumber: '123' };
  assert.equal(isSaleInvoiceValidated(validatedSale), true);
  assert.equal(isSaleInvoiceCancelled(validatedSale), false);
  assert.equal(isSaleInvoiceValidated({ ...validatedSale, invoiceNumber: '' }), false);
  assert.equal(isSaleInvoiceCancelled({
    invoiceCancelledAt: '2026-11-28',
    invoiceCancellationAccessKey: key,
    invoiceCancellationNumber: '456',
  }), true);
});
