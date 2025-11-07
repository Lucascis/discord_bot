declare global {
  function setMockRedisResponse(requestType: string, response: unknown): void;
  function clearMockRedisResponses(): void;
}

export {};
