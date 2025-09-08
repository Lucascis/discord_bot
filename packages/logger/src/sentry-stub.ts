// Stub types for optional Sentry integration
export interface SentryStub {
  init: (config: Record<string, unknown>) => void;
  captureException: (error: Error, options?: Record<string, unknown>) => string;
  captureMessage: (message: string, options?: Record<string, unknown>) => string;
  addBreadcrumb: (breadcrumb: Record<string, unknown>) => void;
  setUser: (user: Record<string, unknown>) => void;
  setTags: (tags: Record<string, string>) => void;
  setContext: (key: string, context: Record<string, unknown>) => void;
  startTransaction: (options: Record<string, unknown>) => Record<string, unknown>;
  flush: (timeout?: number) => Promise<boolean>;
  close: (timeout?: number) => Promise<boolean>;
}

export const SentryStub: SentryStub = {
  init: () => {},
  captureException: () => '',
  captureMessage: () => '',
  addBreadcrumb: () => {},
  setUser: () => {},
  setTags: () => {},
  setContext: () => {},
  startTransaction: () => ({}),
  flush: async () => true,
  close: async () => true,
};