const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
    return Promise.reject(new Error("Local HTTP requests are blocked for this test."));
  }

  return realFetch(input, init);
};
