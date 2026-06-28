// Mock Firestore implementation using browser LocalStorage
// Bypasses Firebase config and permission issues to provide instant, offline-first client-side state.

class LocalStorageFirestore {
  private listeners: Map<string, Set<() => void>> = new Map();

  private getStore(): { [key: string]: any } {
    const raw = localStorage.getItem('rest_area_firestore');
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private saveStore(store: { [key: string]: any }) {
    localStorage.setItem('rest_area_firestore', JSON.stringify(store));
  }

  public getDocument(path: string): any | null {
    const store = this.getStore();
    return store[path] || null;
  }

  public setDocument(path: string, data: any) {
    const store = this.getStore();
    store[path] = { ...data };
    this.saveStore(store);
    this.notify(path);
  }

  public updateDocument(path: string, data: any) {
    const store = this.getStore();
    const existing = store[path] || {};
    store[path] = { ...existing, ...data };
    this.saveStore(store);
    this.notify(path);
  }

  public deleteDocument(path: string) {
    const store = this.getStore();
    delete store[path];
    this.saveStore(store);
    this.notify(path);
  }

  public getCollection(collectionName: string): any[] {
    const store = this.getStore();
    const results: any[] = [];
    const prefix = collectionName + '/';
    for (const key of Object.keys(store)) {
      if (key.startsWith(prefix)) {
        results.push({ id: key.substring(prefix.length), ...store[key] });
      }
    }
    return results;
  }

  public subscribe(pathOrCollection: string, callback: () => void): () => void {
    if (!this.listeners.has(pathOrCollection)) {
      this.listeners.set(pathOrCollection, new Set());
    }
    this.listeners.get(pathOrCollection)!.add(callback);
    return () => {
      const set = this.listeners.get(pathOrCollection);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.listeners.delete(pathOrCollection);
        }
      }
    };
  }

  private notify(path: string) {
    // Notify document listeners
    const docListeners = this.listeners.get(path);
    if (docListeners) {
      for (const cb of docListeners) {
        cb();
      }
    }

    // Notify collection listeners
    const collectionName = path.split('/')[0];
    const colListeners = this.listeners.get(collectionName);
    if (colListeners) {
      for (const cb of colListeners) {
        cb();
      }
    }
  }
}

const firestoreInstance = new LocalStorageFirestore();

export const db = { type: 'database' };

export function collection(dbRef: any, path: string) {
  return { type: 'collection', path };
}

export function doc(dbOrCol: any, path1: string, path2?: string) {
  let path = '';
  if (dbOrCol && dbOrCol.type === 'collection') {
    path = dbOrCol.path + '/' + path1;
  } else {
    if (path2) {
      path = path1 + '/' + path2;
    } else {
      path = path1;
    }
  }
  const parts = path.split('/');
  const id = parts[parts.length - 1];
  return { type: 'document', path, id };
}

export async function setDoc(docRef: any, data: any) {
  firestoreInstance.setDocument(docRef.path, data);
}

export async function updateDoc(docRef: any, data: any) {
  firestoreInstance.updateDocument(docRef.path, data);
}

export async function deleteDoc(docRef: any) {
  firestoreInstance.deleteDocument(docRef.path);
}

export async function getDocs(colRef: any) {
  const items = firestoreInstance.getCollection(colRef.path);
  return {
    empty: items.length === 0,
    forEach: (callback: (doc: any) => void) => {
      items.forEach(item => {
        callback({
          id: item.id,
          data: () => item
        });
      });
    }
  };
}

export function onSnapshot(ref: any, callback: (snap: any) => void, errorCallback?: (error: any) => void) {
  const handler = () => {
    if (ref.type === 'document') {
      const data = firestoreInstance.getDocument(ref.path);
      callback({
        exists: () => data !== null,
        data: () => data
      });
    } else {
      const items = firestoreInstance.getCollection(ref.path);
      const snaps: any[] = [];
      items.forEach(item => {
        snaps.push({
          id: item.id,
          data: () => item
        });
      });
      callback({
        empty: items.length === 0,
        forEach: (cb: (doc: any) => void) => {
          snaps.forEach(cb);
        }
      });
    }
  };

  // Run once initially to load local data immediately
  setTimeout(handler, 0);

  // Subscribe to updates
  return firestoreInstance.subscribe(ref.path, handler);
}

export function writeBatch(dbRef: any) {
  const operations: Array<() => void> = [];
  return {
    set: (docRef: any, data: any) => {
      operations.push(() => firestoreInstance.setDocument(docRef.path, data));
    },
    update: (docRef: any, data: any) => {
      operations.push(() => firestoreInstance.updateDocument(docRef.path, data));
    },
    delete: (docRef: any) => {
      operations.push(() => firestoreInstance.deleteDocument(docRef.path));
    },
    commit: async () => {
      operations.forEach(op => op());
    }
  };
}
