'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type FC
} from 'react';

import type {
  AnyType,
  DevToolsConnection,
  NestedPartial,
  Paths,
  PathValue,
  PropertyCache
} from './types';
import { deepClone } from './utils';

type CreateMapStoreProps<T> = {
  initialData?: Map<string, T>;
  fallbackData?: NestedPartial<T>;
  devTools?: string;
};

type PathCache = {
  mapKey: string;
  parentKeys: string[];
  parentPaths: string[];
  currentKey: string;
};

class CreateMapStore<T> {
  // Data
  private data: Map<string, T>;
  private initialData: Map<string, T>;
  private fallbackData: T;
  // Cache
  private pathCache = new Map<string, PathCache>();
  private propertyCache = new Map<string, PropertyCache>();
  private dependencyCache = new Map<string, Set<string>>();
  // Subscribers
  private subscribers = new Map<string, Set<() => void>>();
  private keysSubscribers = new Set<() => void>();
  private sizeSubscribers = new Set<() => void>();
  // Keys
  private cachedKeys: string[] = [];
  // Devtools
  private devTools: DevToolsConnection | null = null;
  private pauseDevTools = false;

  constructor({ initialData, fallbackData, devTools }: CreateMapStoreProps<T>) {
    this.data =
      (deepClone(initialData) as unknown as Map<string, T>) || new Map();
    this.initialData =
      (deepClone(initialData) as unknown as Map<string, T>) || new Map();
    this.fallbackData = deepClone(fallbackData || {}) as T;
    this.notifyCountSubscribers();

    // Devtools
    if (devTools) {
      this.setupDevTools(devTools);
    }
  }

  // =====================
  // Devtools
  // =====================

  private setupDevTools(name: string) {
    if (typeof window === 'undefined') return;

    const devToolsExtension = (window as AnyType).__REDUX_DEVTOOLS_EXTENSION__;
    if (!devToolsExtension) return;

    const devTools = devToolsExtension.connect({
      name,
      features: {
        jump: true,
        skip: true,
        reorder: true,
        dispatch: true,
        persist: true
      },
      maxAge: 50 // Limit the number of stored actions
    });
    this.devTools = devTools;

    devTools.init(this.serializeState());

    devTools.subscribe((message: AnyType) => {
      this.handleDevToolsMessage(message);
    });
  }

  private serializeState(): Record<string, T> {
    return Object.fromEntries(this.data);
  }

  private handleDevToolsMessage(message: AnyType) {
    if (message.type === 'DISPATCH') {
      switch (message.payload.type) {
        case 'JUMP_TO_ACTION':
        case 'JUMP_TO_STATE':
          try {
            const state = JSON.parse(message.state);
            this.applyDevToolsState(state);
          } catch (error) {
            console.error('Failed to parse jump state:', error);
          }
          break;
        case 'RESET':
          this.reset(true);
          break;
      }
    } else if (message.type === 'ACTION') {
      try {
        const action = JSON.parse(message.payload);
        // Handle custom actions if needed
      } catch (error) {
        console.error('Failed to parse action:', error);
      }
    }
  }

  private applyDevToolsState(state: Record<string, T>) {
    this.pauseDevTools = true;
    this.data = new Map(Object.entries(state));
    this.notifyAllSubscribers();
    this.pauseDevTools = false;
  }

  private sendToDevTools(
    action: string,
    key: string,
    path?: string,
    value?: AnyType
  ) {
    if (!this.devTools || this.pauseDevTools) return;

    const actionPayload = {
      type: `${action} ${key}${path ? `.${path}` : ''}`,
      key,
      path,
      value
    };
    this.devTools.send(actionPayload, this.serializeState());
  }

  // =====================
  // Subscribers
  // =====================

  private notifyAllSubscribers() {
    this.subscribers.forEach((_, path) => {
      this.notifySubscribers(path);
    });
    this.notifyCountSubscribers();
  }

  private notifySubscribers(path: string) {
    const subscribers = this.subscribers.get(path);
    if (subscribers) {
      for (const callback of subscribers) {
        callback();
      }
    }
  }

  private notifyNestedSubscribers(path: string) {
    const { parentPaths, mapKey } = this.getCachedPath(path);
    if (mapKey === path) {
      this.notifySubscribers(mapKey);
    } else {
      this.notifySubscribers(path);
    }
    for (const parentPath of parentPaths) {
      this.notifySubscribers(parentPath);
    }
  }

  private notifyDependencies(path: string) {
    const dependencySet = this.dependencyCache.get(path);
    if (dependencySet) {
      for (const dependency of dependencySet) {
        this.notifySubscribers(dependency);
      }
    }
  }

  private notifyCountSubscribers() {
    this.cachedKeys = Array.from(this.data.keys());
    for (const callback of this.keysSubscribers) {
      callback();
    }
    for (const callback of this.sizeSubscribers) {
      callback();
    }
  }

  // =====================
  // Cached helpers
  // =====================

  private getFullPath(key: string, path = '') {
    return `${key}${path ? `.${path}` : ''}`;
  }

  private getCachedPath(path: string, flush = false) {
    let pathInfo = this.pathCache.get(path);

    if (!pathInfo || flush) {
      const keys = path.split('.');
      const allPaths = keys.reduce((acc, key, index) => {
        if (index === 0) {
          acc.push(key);
        } else {
          acc.push(`${acc[index - 1]}.${key}`);
        }
        return acc;
      }, [] as string[]);

      const mapKey = keys[0];
      const parentKeys = keys.slice(1, -1);
      const parentPaths = allPaths.length > 1 ? allPaths.slice(0, -1) : [];
      const currentKey = keys.length === 1 ? '' : keys[keys.length - 1];

      pathInfo = {
        mapKey,
        parentKeys,
        parentPaths,
        currentKey
      };

      this.pathCache.set(path, pathInfo);

      if (parentPaths.length > 0) {
        for (const parentPath of parentPaths) {
          if (!this.dependencyCache.has(parentPath)) {
            this.dependencyCache.set(parentPath, new Set());
          }
          const dependencies = this.dependencyCache.get(parentPath);
          if (dependencies) {
            dependencies.add(path);
          }
        }
      }
    }

    return pathInfo;
  }

  private getCachedProperty(path: string, flush = false) {
    let propInfo = this.propertyCache.get(path);

    if (!propInfo || flush) {
      const { parentKeys, mapKey } = this.getCachedPath(path);
      let parentProp: AnyType = this.data.get(mapKey);
      let initialProp: AnyType = this.initialData.get(mapKey);
      let fallbackProp: AnyType = this.fallbackData;

      for (const parentKey of parentKeys) {
        if (parentProp !== undefined && parentProp !== null) {
          parentProp = parentProp[parentKey];
        } else {
          parentProp = undefined;
          break;
        }
        if (fallbackProp !== undefined && fallbackProp !== null) {
          fallbackProp = fallbackProp[parentKey];
        }
        if (initialProp !== undefined && initialProp !== null) {
          initialProp = initialProp[parentKey];
        }
      }

      propInfo = {
        parentProp,
        fallbackProp,
        initialProp
      };
    }

    return propInfo;
  }

  // =====================
  // Getters and Setters
  // =====================

  key(mapKey: string) {
    return {
      get: <P extends Paths<T>>(path?: P): PathValue<T, P> => {
        return this.get(mapKey, path);
      },
      set: (value: T, notify = true): void => {
        this.set(mapKey, value, notify);
      },
      update: <P extends Paths<T>>(
        path: P,
        value: PathValue<T, P> | ((prev: PathValue<T, P>) => PathValue<T, P>),
        notify = true
      ): void => {
        this.update(mapKey, path, value, notify);
      },
      use: <P extends Paths<T>>(path?: P): PathValue<T, P> => {
        return this.use(mapKey, path);
      },
      remove: (notify = true): void => {
        this.remove(mapKey, notify);
      }
    };
  }

  getKeys() {
    return Array.from(this.data.keys());
  }

  getSize() {
    return this.data.size;
  }

  useKeys(): string[] {
    const subscribe = useCallback((callback: () => void) => {
      this.keysSubscribers.add(callback);
      return () => {
        this.keysSubscribers.delete(callback);
      };
    }, []);
    const getSnapshot = useCallback(() => this.cachedKeys, []);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  useSize(): number {
    const subscribe = useCallback((callback: () => void) => {
      this.sizeSubscribers.add(callback);
      return () => {
        this.sizeSubscribers.delete(callback);
      };
    }, []);
    const getSnapshot = useCallback(() => this.getSize(), []);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  reset(notify = true): void {
    this.data = deepClone(this.initialData);

    this.sendToDevTools('RESET', '');
    if (notify) {
      this.subscribers.forEach((_, path) => {
        this.notifySubscribers(path);
      });
      this.notifyCountSubscribers();
    }
  }

  clear(notify = true): void {
    this.data.clear();

    this.sendToDevTools('CLEAR', '');
    if (notify) {
      this.subscribers.forEach((_, path) => {
        this.notifySubscribers(path);
      });
      this.notifyCountSubscribers();
    }
  }

  private get<P extends Paths<T>>(mapKey: string, path?: P): PathValue<T, P> {
    const fullPath = this.getFullPath(mapKey, path);
    const { currentKey } = this.getCachedPath(fullPath);
    const { fallbackProp, parentProp } = this.getCachedProperty(fullPath);
    const originalValue = currentKey
      ? parentProp?.[currentKey]
      : (parentProp as PathValue<T, P>);

    if (originalValue !== undefined) {
      return originalValue;
    }
    return fallbackProp?.[currentKey] as PathValue<T, P>;
  }

  private set(mapKey: string, value: T, notify = true): void {
    const hasKey = this.data.has(mapKey);

    const fullPath = this.getFullPath(mapKey);
    this.data.set(mapKey, value);

    this.sendToDevTools('SET', mapKey, undefined, value);
    if (notify) {
      this.notifyNestedSubscribers(fullPath);
      this.notifyDependencies(fullPath);
    }
    if (!hasKey) {
      this.notifyCountSubscribers();
    }
  }

  private update<P extends Paths<T>>(
    mapKey: string,
    path: P,
    value: PathValue<T, P> | ((prev: PathValue<T, P>) => PathValue<T, P>),
    notify = true
  ): void {
    if (!this.data.has(mapKey)) {
      return;
    }

    const fullPath = this.getFullPath(mapKey, path);
    const { currentKey } = this.getCachedPath(fullPath);
    const { parentProp } = this.getCachedProperty(fullPath);
    if (!parentProp) {
      return;
    }

    if (typeof value === 'function') {
      parentProp[currentKey] = (
        value as (prev: PathValue<T, P>) => PathValue<T, P>
      )(parentProp[currentKey]);
    } else {
      parentProp[currentKey] = value;
    }

    this.sendToDevTools(
      'UPDATE',
      mapKey,
      path as string,
      parentProp[currentKey]
    );
    if (notify) {
      this.notifyNestedSubscribers(fullPath);
      this.notifyDependencies(fullPath);
    }
  }

  private remove(mapKey: string, notify = true): void {
    if (!this.data.has(mapKey)) {
      return;
    }
    this.data.delete(mapKey);

    this.sendToDevTools('REMOVE', mapKey);
    if (notify) {
      this.notifyNestedSubscribers(mapKey);
      this.notifyDependencies(mapKey);
      this.notifyCountSubscribers();
    }
  }

  private use<P extends Paths<T>>(mapKey: string, path?: P): PathValue<T, P> {
    // eslint-disable-next-line
    const subscribe = useCallback(
      (callback: () => void) => {
        const fullPath = this.getFullPath(mapKey, path);
        if (!this.subscribers.has(fullPath)) {
          this.subscribers.set(fullPath, new Set());
        }
        this.subscribers.get(fullPath)?.add(callback);

        return () => {
          const subscribers = this.subscribers.get(fullPath);
          if (subscribers) {
            subscribers.delete(callback);
            if (subscribers.size === 0) {
              this.subscribers.delete(fullPath);
            }
          }
        };
      },
      [mapKey, path]
    );
    // eslint-disable-next-line
    const getSnapshot = useCallback(
      () => this.get(mapKey, path),
      [mapKey, path]
    );
    // eslint-disable-next-line
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }
}

// =====================
// Instance Type
// =====================
export type MapStoreInstance<T> = CreateMapStore<T>;

// =====================
// Global Store
// =====================
export function createMapStore<T>(props: CreateMapStoreProps<T>) {
  return new CreateMapStore<T>(props);
}

// =====================
// Context Store
// =====================
export function createScopedMapStore<T>(props: CreateMapStoreProps<T>) {
  const StoreContext = createContext<CreateMapStore<T> | null>(null);
  const Provider: FC<{ children: React.ReactNode }> = ({ children }) => {
    const store = useMemo(() => new CreateMapStore<T>(props), []);
    return (
      <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
    );
  };
  function useStore(): CreateMapStore<T> {
    const context = useContext(StoreContext);
    if (!context) {
      throw new Error('useStore must be used within a StoreProvider');
    }
    return context;
  }
  return { Provider, useStore };
}
