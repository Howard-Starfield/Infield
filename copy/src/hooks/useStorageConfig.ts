import { useState, useEffect } from 'react';
import { 
  getStorageConfigNative, 
  saveStorageConfigNative, 
  selectStorageDirectoryNative 
} from '../tauri-bridge';

export function useStorageConfig() {
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getStorageConfigNative()
      .then((path) => {
        setStoragePath(path);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const selectDirectory = async () => {
    try {
      const newPath = await selectStorageDirectoryNative();
      if (newPath) {
        await saveStorageConfigNative(newPath);
        setStoragePath(newPath);
      }
    } catch (err) {
      console.error("Failed to select storage directory:", err);
    }
  };

  return { storagePath, isLoading, selectDirectory };
}
