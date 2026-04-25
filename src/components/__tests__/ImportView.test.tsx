import { describe, expect, test } from 'vitest';
import { detectUrls } from '../ImportView';

describe('detectUrls', () => {
  test('detects single URL', () => {
    expect(detectUrls('https://youtube.com/watch?v=x')).toEqual(['https://youtube.com/watch?v=x']);
  });
  test('detects newline-separated URLs', () => {
    expect(detectUrls('https://a.example/x\nhttps://b.example/y')).toHaveLength(2);
  });
  test('dedupes URLs', () => {
    const urls = detectUrls('https://a.example/x\nhttps://a.example/x');
    expect(urls).toHaveLength(1);
  });
  test('rejects malformed', () => {
    expect(detectUrls('not a url\nhttps://valid.example/x')).toEqual(['https://valid.example/x']);
  });
});
