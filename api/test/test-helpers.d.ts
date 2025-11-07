declare global {
  function setMockRedisResponse(requestType: string, response: any): void;
  function clearMockRedisResponses(): void;
}

export {};
