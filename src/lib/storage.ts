/**
 * Lightweight IndexedDB wrapper to store resume File objects
 * since localStorage cannot easily store large binary files.
 */

const DB_NAME = 'SkillParserDB';
const STORE_NAME = 'resumes';
const DB_VERSION = 1;

function getDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      reject('IndexedDB connection error');
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function saveResumeFile(id: string, file: File): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Store the file blob with the candidate ID
    const request = store.put({ id, file });

    request.onsuccess = () => resolve();
    request.onerror = () => reject('Failed to save file to IndexedDB');
  });
}

export async function getResumeFile(id: string): Promise<File | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.file);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => reject('Failed to retrieve file from IndexedDB');
  });
}

export async function deleteResumeFile(id: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject('Failed to delete file from IndexedDB');
  });
}
