declare module '@opentui/solid' {
  export const createElement: (tag: string) => unknown;
  export const insert: (parent: unknown, child: unknown) => unknown;
  export const setProp: (node: unknown, name: string, value: unknown) => unknown;
  export const onCleanup: ((fn: () => void) => void) | undefined;
}

declare module 'solid-js' {
  export const onCleanup: (fn: () => void) => void;
}
