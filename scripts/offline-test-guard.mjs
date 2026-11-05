// Preload in the test runner and its workers: no external API or billing calls.
import net from 'node:net';
const local = host => !host || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host));
const deny = host => { throw new Error('OFFLINE_TEST_NETWORK_BLOCKED: ' + host); };
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === 'object' && options !== null ? options.host : args[1];
  if (typeof host === 'string' && !local(host)) deny(host);
  return originalConnect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, options) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!local(url.hostname)) deny(url.hostname);
  return originalFetch(input, options);
};
