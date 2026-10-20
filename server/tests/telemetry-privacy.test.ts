import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactContent } from '../src/telemetry-privacy.js';

test('standard privacy masks contact details and credentials without changing opaque correlation IDs or counters', () => {
  const source = { text: 'Email jane@example.test or +1 (415) 555-0100. api_key=super-secret-value Bearer abc.def.secret',
    message: 'password: "hidden-password"', metrics: { tokens: 42 }, traceId: 'a'.repeat(32), role: 'user' };
  const value = redactContent(source, 'standard', []);
  const serialized = JSON.stringify(value);
  for (const secret of ['jane@example.test', '555-0100', 'super-secret-value', 'abc.def.secret', 'hidden-password']) assert.equal(serialized.includes(secret), false);
  assert.equal(value.traceId, source.traceId); assert.equal(value.metrics.tokens, 42); assert.equal(value.role, 'user');
  assert.equal(source.text.includes('jane@example.test'), true);
});

test('strict removes freeform content, off preserves it, and configured terms are literal case-insensitive matches', () => {
  const value = { text: 'Customer Alice (VIP)', name: 'lookup', message: 'api_secret=hidden', at: 123 };
  assert.equal(redactContent(value, 'strict', []).text, '[CONTENT REDACTED]');
  assert.deepEqual(redactContent(value, 'off', []), value);
  assert.equal(redactContent(value, 'standard', ['Alice (VIP)']).text.includes('Alice'), false);
});
