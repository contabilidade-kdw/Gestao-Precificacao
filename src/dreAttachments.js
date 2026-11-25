import { demoMode, supabase } from './supabase.js';

const databaseName = 'atrativa-dre-attachments-v1';
const storeName = 'attachments';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`Não foi possível abrir o armazenamento local do DRE: ${request.error?.message || 'erro desconhecido'}`));
  });
}

function sanitizeFileName(name) {
  return String(name).replace(/[\\/#?]/g, '_');
}

export async function saveDreAttachment(reportId, userId, file) {
  if (demoMode) {
    const database = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put({ id: reportId, blob: file, name: file.name, type: file.type });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(new Error(`Não foi possível guardar o DRE localmente: ${transaction.error?.message || 'erro desconhecido'}`));
        transaction.onabort = () => reject(new Error(`O armazenamento local do DRE foi interrompido: ${transaction.error?.message || 'erro desconhecido'}`));
      });
      return '';
    } finally {
      database.close();
    }
  }
  if (!supabase) throw new Error('O Supabase Storage não está configurado.');
  const path = `dre-reports/${userId}/${reportId}/${sanitizeFileName(file.name)}`;
  const contentType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/csv');
  const { error } = await supabase.storage.from('dre-reports').upload(path, file, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function loadDreAttachment(report) {
  if (demoMode) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(report.id);
        request.onsuccess = () => {
          if (!request.result) reject(new Error('O arquivo original deste DRE não está mais disponível neste navegador.'));
          else resolve(request.result.blob);
        };
        request.onerror = () => reject(new Error(`Não foi possível recuperar o DRE local: ${request.error?.message || 'erro desconhecido'}`));
      });
    } finally {
      database.close();
    }
  }
  if (!supabase || !report.attachmentPath) throw new Error('O caminho do arquivo original não está disponível.');
  const { data, error } = await supabase.storage.from('dre-reports').download(report.attachmentPath);
  if (error) throw error;
  return data;
}

export async function removeDreAttachment(report) {
  if (demoMode) {
    const database = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).delete(report.id);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(new Error(`Não foi possível remover o anexo local: ${transaction.error?.message || 'erro desconhecido'}`));
      });
    } finally {
      database.close();
    }
    return;
  }
  if (supabase && report.attachmentPath) {
    const { error } = await supabase.storage.from('dre-reports').remove([report.attachmentPath]);
    if (error) throw error;
  }
}
