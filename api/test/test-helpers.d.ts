declare global {
  var mockRedis: unknown;
  function setMockRedisResponse(requestType: string, response: unknown): void;
  function clearMockRedisResponses(): void;
}

export {};
