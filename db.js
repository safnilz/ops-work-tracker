// db.js - Offline-First Database Service with AWS RDS Sync for Ops Work Tracker

const DB_NAME = 'ReclaimOpsDB_Local';
const DB_VERSION = 2; // Bumped version to support alphanumeric IDs and synced flag

let dbInstance = null;

function initDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Database open error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // If store exists from old version, delete it to clean autoIncrement configuration
      if (db.objectStoreNames.contains('logs')) {
        db.deleteObjectStore('logs');
      }
      if (db.objectStoreNames.contains('photos')) {
        db.deleteObjectStore('photos');
      }
      
      // Create new logs store with string-based keyPath
      const logStore = db.createObjectStore('logs', { keyPath: 'id' });
      logStore.createIndex('date', 'date', { unique: false });
      logStore.createIndex('isNumber', 'isNumber', { unique: false });
      logStore.createIndex('synced', 'synced', { unique: false });
      
      // Create new photos store
      const photoStore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
      photoStore.createIndex('logId', 'logId', { unique: false });
    };
  });
}

// Helpers for Base64 and Blob conversion
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (!(blob instanceof Blob)) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, mimeType = 'image/jpeg') {
  if (!base64) return null;
  try {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  } catch (err) {
    console.error('Failed to convert base64 to blob:', err);
    return null;
  }
}

const dbService = {
  async init() {
    return initDB();
  },

  // Save log locally to IndexedDB, then attempt to upload to RDS
  async saveLog(log, photos) {
    const db = await this.init();
    
    // Ensure log has a unique string ID (UUID-like) to prevent client collisions
    if (!log.id) {
      log.id = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Always mark as unsynced (0) initially before attempt
    log.synced = 0;

    // 1. Save to local IndexedDB
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['logs', 'photos'], 'readwrite');
      transaction.onerror = (e) => reject(e.target.error);
      transaction.oncomplete = () => resolve();
      
      const logStore = transaction.objectStore('logs');
      const photoStore = transaction.objectStore('photos');
      
      // Save log
      logStore.put(log);
      
      // Clean local photos associated with this log.id and save new list
      const index = photoStore.index('logId');
      const request = index.openCursor(IDBKeyRange.only(log.id));
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          for (const photo of photos) {
            photoStore.add({
              logId: log.id,
              blob: photo.blob,
              caption: photo.caption || '',
              timestamp: photo.timestamp || Date.now()
            });
          }
        }
      };
    });

    // 2. Attempt to upload to PostgreSQL Cloud Serverless endpoint
    try {
      await this.uploadLogToCloud(log, photos);
      // Success! Update local log synced flag to 1
      log.synced = 1;
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(['logs'], 'readwrite');
        transaction.objectStore('logs').put(log);
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(e.target.error);
      });
      console.log(`Cloud sync success for log: ${log.id}`);
    } catch (err) {
      console.warn(`Saved locally, cloud sync deferred (offline): ${err.message}`);
    }

    return log.id;
  },

  // Helper function to upload an individual log to the Vercel API
  async uploadLogToCloud(log, photos) {
    // Map photo blobs to Base64 strings for Postgres compatibility
    const cloudPhotos = [];
    for (const photo of photos) {
      const base64 = await blobToBase64(photo.blob);
      if (base64) {
        cloudPhotos.push({
          photoData: base64,
          caption: photo.caption || ''
        });
      }
    }

    const payload = {
      ...log,
      photos: cloudPhotos
    };

    const response = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errRes = await response.json().catch(() => ({}));
      throw new Error(errRes.error || `HTTP Status ${response.status}`);
    }
  },

  // Sync any logs that were created while offline
  async syncUnsyncedLogs() {
    const db = await this.init();
    
    // Find all unsynced logs
    const unsyncedLogs = await new Promise((resolve) => {
      const transaction = db.transaction(['logs'], 'readonly');
      const store = transaction.objectStore('logs');
      const request = store.openCursor();
      const results = [];
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.synced === 0) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
    });

    if (unsyncedLogs.length === 0) return 0;
    
    console.log(`Found ${unsyncedLogs.length} unsynced logs. Syncing to AWS RDS...`);
    let syncCount = 0;

    for (const log of unsyncedLogs) {
      try {
        // Fetch photos from local store
        const photos = await new Promise((resolve) => {
          const transaction = db.transaction(['photos'], 'readonly');
          const photoStore = transaction.objectStore('photos');
          const index = photoStore.index('logId');
          const request = index.openCursor(IDBKeyRange.only(log.id));
          const results = [];
          request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              results.push(cursor.value);
              cursor.continue();
            } else {
              resolve(results);
            }
          };
        });

        // Sync to cloud
        await this.uploadLogToCloud(log, photos);
        
        // Mark as synced locally
        log.synced = 1;
        await new Promise((resolve) => {
          const transaction = db.transaction(['logs'], 'readwrite');
          transaction.objectStore('logs').put(log);
          transaction.oncomplete = () => resolve();
        });
        
        syncCount++;
      } catch (err) {
        console.error(`Failed to sync log ${log.id}:`, err);
        break; // Stop syncing remainder if we encounter a connection error
      }
    }
    
    return syncCount;
  },

  // Fetch from RDS, then populate local IndexedDB cache for offline reliability
  async getLogs() {
    const db = await this.init();
    
    try {
      const response = await fetch('/api/logs');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const cloudLogs = await response.json();
      
      // Save fetched cloud data to IndexedDB cache
      const transaction = db.transaction(['logs', 'photos'], 'readwrite');
      const logStore = transaction.objectStore('logs');
      const photoStore = transaction.objectStore('photos');
      
      // Clear current cache first
      logStore.clear();
      photoStore.clear();
      
      for (const log of cloudLogs) {
        // Mark as synced
        log.synced = 1;
        logStore.put(log);
        
        // Extract and save photos back to local IndexedDB (reverting Base64 to Blob)
        if (log.photos && Array.isArray(log.photos)) {
          for (const photo of log.photos) {
            const blob = base64ToBlob(photo.photoData);
            if (blob) {
              photoStore.add({
                logId: log.id,
                blob: blob,
                caption: photo.caption || '',
                timestamp: Date.now()
              });
            }
          }
        }
      }
      
      return cloudLogs;
    } catch (err) {
      console.warn(`Could not connect to database cloud API. Falling back to local offline cache: ${err.message}`);
      
      // Fallback: Read sorted list from IndexedDB
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['logs'], 'readonly');
        const store = transaction.objectStore('logs');
        const index = store.index('date');
        const request = index.openCursor(null, 'prev');
        const results = [];
        
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        
        request.onerror = (e) => reject(e.target.error);
      });
    }
  },

  async getLog(id) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['logs', 'photos'], 'readonly');
      const logStore = transaction.objectStore('logs');
      const photoStore = transaction.objectStore('photos');
      
      const logRequest = logStore.get(id); // Alphanumeric string ID search
      
      logRequest.onerror = (e) => reject(e.target.error);
      logRequest.onsuccess = (e) => {
        const log = e.target.result;
        if (!log) {
          resolve(null);
          return;
        }
        
        // Fetch photos
        const photos = [];
        const index = photoStore.index('logId');
        const photoRequest = index.openCursor(IDBKeyRange.only(id));
        
        photoRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            photos.push(cursor.value);
            cursor.continue();
          } else {
            resolve({ log, photos });
          }
        };
        
        photoRequest.onerror = (event) => reject(event.target.error);
      };
    });
  },

  async deleteLog(id) {
    const db = await this.init();
    
    // 1. Delete locally from IndexedDB
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['logs', 'photos'], 'readwrite');
      transaction.onerror = (e) => reject(e.target.error);
      transaction.oncomplete = () => resolve();
      
      const logStore = transaction.objectStore('logs');
      const photoStore = transaction.objectStore('photos');
      
      logStore.delete(id);
      
      const index = photoStore.index('logId');
      const request = index.openCursor(IDBKeyRange.only(id));
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    });

    // 2. Delete from PostgreSQL RDS via Vercel Serverless API
    try {
      const response = await fetch(`/api/logs?id=${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log(`Cloud delete successful for log: ${id}`);
    } catch (err) {
      console.warn(`Local deletion successful, but failed to sync deletion to cloud (offline): ${err.message}`);
    }
  },

  // Local JSON Backup / Restore exports
  async getBackupData() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['logs', 'photos'], 'readonly');
      const logStore = transaction.objectStore('logs');
      const photoStore = transaction.objectStore('photos');
      
      const logs = [];
      const photos = [];
      let logsDone = false;
      let photosDone = false;
      
      const checkDone = () => {
        if (logsDone && photosDone) {
          resolve({ logs, photos });
        }
      };
      
      logStore.getAll().onsuccess = (e) => {
        logs.push(...e.target.result);
        logsDone = true;
        checkDone();
      };
      
      photoStore.getAll().onsuccess = (e) => {
        photos.push(...e.target.result);
        photosDone = true;
        checkDone();
      };
      
      transaction.onerror = (e) => reject(e.target.error);
    });
  },

  async restoreBackup(backupData) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['logs', 'photos'], 'readwrite');
      transaction.onerror = (e) => reject(e.target.error);
      transaction.oncomplete = () => resolve();
      
      const logStore = transaction.objectStore('logs');
      const photoStore = transaction.objectStore('photos');
      
      logStore.clear();
      photoStore.clear();
      
      if (backupData.logs && Array.isArray(backupData.logs)) {
        for (const log of backupData.logs) {
          logStore.put(log);
        }
      }
      
      if (backupData.photos && Array.isArray(backupData.photos)) {
        for (const photo of backupData.photos) {
          photoStore.put(photo);
        }
      }
    });
  }
};

// Export to window object for access from other scripts
window.dbService = dbService;
