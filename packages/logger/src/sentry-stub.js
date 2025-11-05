export const sentryStub = {
    init: () => { },
    captureException: () => '',
    captureMessage: () => '',
    addBreadcrumb: () => { },
    setUser: () => { },
    setTags: () => { },
    setContext: () => { },
    startTransaction: () => ({}),
    flush: async () => true,
    close: async () => true,
};
