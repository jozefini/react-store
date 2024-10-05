export type AnyType = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type NestedPartial<T> = {
  [K in keyof T]?: T[K] extends object ? NestedPartial<T[K]> : T[K];
};

export type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${'' extends P ? '' : '.'}${P}`
    : never
  : never;

export type Prev = [never, 0, 1, 2, 3];

export type Paths<T, D extends number = 2> = [D] extends [never]
  ? never
  : T extends object
    ? {
        [K in keyof T]-?: K extends string | number
          ? `${K}` | Join<K, Paths<T[K], Prev[D]>>
          : never;
      }[keyof T]
    : '';

export type PathValue<
  T,
  P extends Paths<T>
> = P extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T
    ? Rest extends Paths<T[Key]>
      ? PathValue<T[Key], Rest>
      : never
    : never
  : P extends keyof T
    ? T[P]
    : never;

export type DevToolsConnection = {
  init: (state: AnyType) => void;
  send: (action: { type: string }, state: AnyType) => void;
  subscribe: (listener: (message: AnyType) => void) => void;
};

export type PropertyCache = {
  parentProp: AnyType;
  fallbackProp: AnyType;
  initialProp: AnyType;
};
