// db.js - IndexedDB Database Service for Ops Work Tracker

const DB_NAME = 'OpsTrackerDB';
const DB_VERSION = 1;

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
      
      // Create logs store
      if (!db.objectStoreNames.contains('logs')) {
        const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
        logStore.createIndex('date', 'date', { unique: false });
        logStore.createIndex('isNumber', 'isNumber', { unique: false });
      }
      
      // Create photos store
      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        photoStore.createIndex('logId', 'logId', { unique: false });
      }
    };
  });
}

const dbService = {
  async init() {
    return initDB();
  },

  async saveLog(log, photos) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['logs', 'photos'], 'readwrite');
      let logId = log.id;
      
      transaction.onerror = (e) => {
        console.error('Transaction error during saveLog:', e.target.error);
        reject(e.target.error);
      };
      
      transaction.oncomplete = () => {
        resolve(logId);
      };
      
      const logStore = transaction.objectStore('logs');
      const photoStore = transaction.objectStore('photos');
      
      if (logId) {
        // Edit existing log
        logStore.put(log);
        
        // Delete all old photos associated with this logId and insert new ones
        const index = photoStore.index('logId');
        const request = index.openCursor(IDBKeyRange.only(Number(logId)));
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            // Old photos cleared. Add current list of photos.
            for (const photo of photos) {
              const photoData = {
                logId: Number(logId),
                blob: photo.blob,
                caption: photo.caption || '',
                timestamp: photo.timestamp || Date.now()
              };
              photoStore.add(photoData);
            }
          }
        };
      } else {
        // Create new log
        const request = logStore.add(log);
        request.onsuccess = (e) => {
          logId = e.target.result;
          log.id = logId; // Attach generated ID back to log
          
          for (const photo of photos) {
            const photoData = {
              logId: Number(logId),
              blob: photo.blob,
              caption: photo.caption || '',
              timestamp: photo.timestamp || Date.now()
            };
            photoStore.add(photoData);
          }
        };
      }
    });
  },

  async getLogs() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['logs'], 'readonly');
      const store = transaction.objectStore('logs');
      const index = store.index('date');
      const request = index.openCursor(null, 'prev'); // Sort by date descending (newest first)
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
      
      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  },

  async getLog(id) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['logs', 'photos'], 'readonly');
      const logStore = transaction.objectStore('logs');
      const photoStore = transaction.objectStore('photos');
      
      const logRequest = logStore.get(Number(id));
      
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
        const photoRequest = index.openCursor(IDBKeyRange.only(Number(id)));
        
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
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['logs', 'photos'], 'readwrite');
      
      transaction.onerror = (e) => reject(e.target.error);
      transaction.oncomplete = () => resolve();
      
      const logStore = transaction.objectStore('logs');
      const photoStore = transaction.objectStore('photos');
      
      logStore.delete(Number(id));
      
      // Delete all related photos
      const index = photoStore.index('logId');
      const request = index.openCursor(IDBKeyRange.only(Number(id)));
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    });
  },

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
      
      // Clear database tables first
      logStore.clear();
      photoStore.clear();
      
      // Restore logs
      if (backupData.logs && Array.isArray(backupData.logs)) {
        for (const log of backupData.logs) {
          logStore.put(log);
        }
      }
      
      // Restore photos
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
