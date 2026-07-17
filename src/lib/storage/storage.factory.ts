import { StorageInterface } from './storage.interface';
import { WasabiStorage } from './wasabi.storage';

export class StorageFactory {
  private static instance: StorageInterface;

  static getInstance(): StorageInterface {
    if (!this.instance) {
      const driver = process.env.STORAGE_DRIVER || 'wasabi';
      
      switch (driver) {
        case 'wasabi':
          this.instance = new WasabiStorage();
          break;
        default:
          throw new Error(`Unsupported storage driver: ${driver}`);
      }
    }
    return this.instance;
  }
}

