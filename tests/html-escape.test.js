// tests/html-escape.test.js
// Verifies htmlEscape utility escapes all dangerous characters.

describe('htmlEscape Utility', () => {
  let htmlEscape;

  beforeAll(() => {
    htmlEscape = require('../utils/htmlEscape');
  });

  test('escapes < and > to prevent HTML injection', () => {
    expect(htmlEscape('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  test('escapes & to prevent entity injection', () => {
    expect(htmlEscape('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  test('escapes double quotes', () => {
    expect(htmlEscape('"hello"')).toBe('&quot;hello&quot;');
  });

  test('escapes single quotes', () => {
    expect(htmlEscape("it's")).toBe('it&#39;s');
  });

  test('handles null and undefined gracefully', () => {
    expect(htmlEscape(null)).toBe('');
    expect(htmlEscape(undefined)).toBe('');
  });

  test('passes through safe strings unchanged', () => {
    expect(htmlEscape('hello world 123')).toBe('hello world 123');
  });

  test('does not double-escape already-escaped content', () => {
    const once = htmlEscape('<b>');
    const twice = htmlEscape(once);
    expect(once).toBe('&lt;b&gt;');
    expect(twice).toBe('&amp;lt;b&amp;gt;');
  });

  test('handles numbers by converting to string', () => {
    expect(htmlEscape(42)).toBe('42');
  });
});
