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

type CreateStoreProps<T> = {
  initialData?: NestedPartial<T>;
  fallbackData?: NestedPartial<T>;
  devTools?: string;
};

type PathCache = {
  parentKeys: string[];
  parentPaths: string[];
  currentKey: string;
};

class CreateStore<T> {
  // Data
  private _data: T;
  private initialData: T;
  private fallbackData: T;
  // Cache
  private pathCache = new Map<string, PathCache>();
  private propertyCache = new Map<string, PropertyCache>();
  private dependencyCache = new Map<string, Set<string>>();
  // Subscribers
  private subscribers = new Map<string, Set<() => void>>();
  // Devtools
  private devTools: DevToolsConnection | null = null;
  private pauseDevTools = false;

  constructor({ initialData, fallbackData, devTools }: CreateStoreProps<T>) {
    this._data = deepClone(initialData || {}) as T;
    this.initialData = deepClone(initialData || {}) as T;
    this.fallbackData = deepClone(fallbackData || {}) as T;

    // Devtools
    if (devTools) {
      this.setupDevTools(devTools);
    }
  }

  // ======Q===============
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
      }
    });
    this.devTools = devTools;
    devTools.init(this._data);
    devTools.subscribe((message: AnyType) => {
      this.handleDevToolsMessage(message);
    });
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
      } catch (error) {
        console.error('Failed to parse action:', error);
      }
    }
  }

  private applyDevToolsState(state: T) {
    this.pauseDevTools = true;
    this._data = deepClone(state);
    this.notifyAllSubscribers();
    this.pauseDevTools = false;
  }

  private sendToDevTools(action: string, path: string, value?: AnyType) {
    if (!this.devTools || this.pauseDevTools) return;
    const actionPayload = { type: `${action} ${path}`, path, value };
    this.devTools.send(actionPayload, this._data);
  }

  // =====================
  // Subscribers
  // =====================

  private notifyAllSubscribers() {
    this.subscribers.forEach((subscribers, path) => {
      for (const callback of subscribers) {
        callback();
      }
    });
  }

  private addSubscriber(path: string, callback: () => void) {
    if (!this.subscribers.has(path)) {
      this.subscribers.set(path, new Set());
    }
    this.subscribers.get(path)?.add(callback);
  }

  private removeSubscriber(path: string, callback: () => void) {
    const subscribers = this.subscribers.get(path);
    if (subscribers) {
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.subscribers.delete(path);
      }
    }
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
    this.notifySubscribers(path);
    const { parentPaths } = this.getCachedPath(path);
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

  // =====================
  // Cached helpers
  // =====================

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

      const parentKeys = keys.slice(0, -1);
      const parentPaths = allPaths.length > 1 ? allPaths.slice(0, -1) : [];
      const currentKey = keys[keys.length - 1];

      pathInfo = {
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
      const { parentKeys } = this.getCachedPath(path);

      let parentProp: AnyType = this._data;
      let fallbackProp: AnyType = this.fallbackData;
      let initialProp: AnyType = this.initialData;
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

  get<P extends Paths<T>>(path: P & string): PathValue<T, P> {
    const { currentKey } = this.getCachedPath(path);
    const { parentProp, fallbackProp } = this.getCachedProperty(path);
    const originalValue = parentProp?.[currentKey] as PathValue<T, P>;
    if (originalValue !== undefined) {
      return originalValue;
    }
    return fallbackProp?.[currentKey] as PathValue<T, P>;
  }

  set<P extends Paths<T>>(
    path: P & string,
    value: PathValue<T, P>,
    notify = true
  ): void {
    const { currentKey, parentPaths } = this.getCachedPath(path);
    const { parentProp } = this.getCachedProperty(path);
    if (!parentProp) {
      let parent: Record<string, AnyType> = this._data as Record<
        string,
        AnyType
      >;
      for (const parentKey of parentPaths) {
        if (parent[parentKey] === undefined) {
          parent[parentKey] = {};
        }
        parent = parent[parentKey];
      }
      parent[currentKey] = value;
    } else {
      parentProp[currentKey] = value;
    }

    this.sendToDevTools('SET', path, value);
    if (notify) {
      this.notifyNestedSubscribers(path);
      this.notifyDependencies(path);
    }
  }

  update<P extends Paths<T>>(
    path: P & string,
    value: PathValue<T, P> | ((prev: PathValue<T, P>) => PathValue<T, P>),
    notify = true
  ): void {
    const { currentKey } = this.getCachedPath(path);
    const { parentProp } = this.getCachedProperty(path);
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

    this.sendToDevTools('UPDATE', path, value);
    if (notify) {
      this.notifyNestedSubscribers(path);
      this.notifyDependencies(path);
    }
  }

  remove<P extends Paths<T>>(path: P & string, notify = true): void {
    const { currentKey } = this.getCachedPath(path);
    const { parentProp } = this.getCachedProperty(path);
    if (!parentProp) {
      return;
    }
    delete parentProp[currentKey];

    this.sendToDevTools('REMOVE', path);
    if (notify) {
      this.notifyNestedSubscribers(path);
      this.notifyDependencies(path);
    }
  }

  reset(notify = true): void {
    this._data = deepClone(this.initialData);

    this.sendToDevTools('RESET', '');
    if (notify) {
      this.subscribers.forEach((_, path) => {
        this.notifySubscribers(path);
      });
    }
  }

  // =====================
  // Reactive helpers
  // =====================

  use<P extends Paths<T>>(path: P & string): PathValue<T, P> {
    const subscribe = useCallback(
      (callback: () => void) => {
        this.addSubscriber(path, callback);
        return () => this.removeSubscriber(path, callback);
      },
      [path]
    );
    const getSnapshot = useCallback(() => this.get(path), [path]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }
}

// =====================
// Instance Type
// =====================
export type Store<T> = CreateStore<T>;

// =====================
// Global Store
// =====================
export function createStore<T>(props: CreateStoreProps<T>) {
  return new CreateStore<T>(props);
}

// =====================
// Context Store
// =====================
export function createScopedStore<T>(props: CreateStoreProps<T>) {
  const StoreContext = createContext<CreateStore<T> | null>(null);
  const Provider: FC<{ children: React.ReactNode }> = ({ children }) => {
    // biome-ignore lint: react-hooks/exhaustive-deps
    const store = useMemo(() => new CreateStore<T>(props), []);
    return (
      <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
    );
  };
  function useStore(): CreateStore<T> {
    const context = useContext(StoreContext);
    if (!context) {
      throw new Error('useStore must be used within a StoreProvider');
    }
    return context;
  }
  return { Provider, useStore };
}
