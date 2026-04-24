import { describe, it, expect } from 'vitest'
import { parseVoiceMemoDirectives } from '../voiceMemoPill'

describe('parseVoiceMemoDirectives', () => {
  it('returns empty array when no directives present', () => {
    expect(parseVoiceMemoDirectives('Just a plain note.')).toEqual([])
  })

  it('parses a single path="…" directive', () => {
    const body = '::voice_memo_recording{path="C:/audio/memo1.wav"}\n\nHello.'
    const result = parseVoiceMemoDirectives(body)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('C:/audio/memo1.wav')
    expect(result[0].from).toBe(0)
    // "to" points one past the closing }
    expect(body.slice(result[0].from, result[0].to)).toBe(
      '::voice_memo_recording{path="C:/audio/memo1.wav"}',
    )
  })

  it('parses multiple directives in doc order', () => {
    const body =
      '::voice_memo_recording{path="a.wav"}\n\nA\n\n::voice_memo_recording{path="b.wav"}\n\nB'
    const result = parseVoiceMemoDirectives(body)
    expect(result).toHaveLength(2)
    expect(result[0].path).toBe('a.wav')
    expect(result[1].path).toBe('b.wav')
    expect(result[0].from).toBeLessThan(result[1].from)
  })

  it('tolerates empty path gracefully (path is null)', () => {
    const body = '::voice_memo_recording{path=""}'
    const result = parseVoiceMemoDirectives(body)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBeNull()
  })

  it('ignores malformed directive missing closing brace', () => {
    const body = '::voice_memo_recording{path="broken'
    const result = parseVoiceMemoDirectives(body)
    expect(result).toEqual([])
  })

  it('handles backward-compat JSON shape with audio_file_path', () => {
    const body =
      '::voice_memo_recording{"audio_file_path":"x.wav","recorded_at_ms":123}'
    const result = parseVoiceMemoDirectives(body)
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('x.wav')
    expect(result[0].recordedAtMs).toBe(123)
  })
})
