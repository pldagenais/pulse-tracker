import { describe, it, expect } from 'vitest';
import { detectMode, resolveRemote } from './source';

describe('detectMode', () => {
  it('treats loopback as local', () => {
    expect(detectMode('127.0.0.1')).toBe('local');
    expect(detectMode('localhost')).toBe('local');
  });

  it('treats anything else as cloud', () => {
    expect(detectMode('pulse.vercel.app')).toBe('cloud');
  });
});

describe('resolveRemote', () => {
  it('maps day-keyed endpoints to snapshot keys', () => {
    expect(resolveRemote('/api/overview?date=2026-08-14')).toEqual({
      fn: 'snapshots:get',
      args: { key: 'overview:2026-08-14' },
    });
    expect(resolveRemote('/api/timeline?date=2026-08-14')).toEqual({
      fn: 'snapshots:get',
      args: { key: 'timeline:2026-08-14' },
    });
  });

  it('maps session and project detail to their snapshots', () => {
    expect(resolveRemote('/api/sessions/abc-123')).toEqual({
      fn: 'snapshots:get',
      args: { key: 'session:abc-123' },
    });
    expect(resolveRemote('/api/projects/9')).toEqual({
      fn: 'snapshots:get',
      args: { key: 'project:9' },
    });
  });

  it('normalises the stats range away to the canonical mirror', () => {
    expect(resolveRemote('/api/stats?groupBy=model&from=2026-01-01&to=2026-08-14')).toEqual({
      fn: 'snapshots:get',
      args: { key: 'insights:model' },
    });
  });

  it('maps prompt search to the search query', () => {
    expect(resolveRemote('/api/prompts?q=migration&pageSize=25')).toEqual({
      fn: 'prompts:search',
      args: { q: 'migration', limit: 25 },
    });
  });

  it('maps the session list', () => {
    expect(resolveRemote('/api/sessions?pageSize=8')).toEqual({
      fn: 'sessions:list',
      args: { limit: 8 },
    });
  });

  it('maps the project calendar to a month-keyed snapshot', () => {
    expect(resolveRemote('/api/projects/9/calendar?month=2026-08')).toEqual({
      fn: 'snapshots:get',
      args: { key: 'calendar:9:2026-08' },
    });
  });

  it('maps the live list to its mirrored snapshot', () => {
    expect(resolveRemote('/api/live')).toEqual({
      fn: 'snapshots:get',
      args: { key: 'live' },
    });
  });

  it('returns null for capabilities that need the local machine', () => {
    expect(resolveRemote('/api/manage/mcp')).toBeNull();
    expect(resolveRemote('/api/memory')).toBeNull();
    expect(resolveRemote('/api/memory/file?path=x')).toBeNull();
    expect(resolveRemote('/api/routines')).toBeNull();
    expect(resolveRemote('/api/projects/9/open')).toBeNull();
  });

  it('normalises the report range away to the all-time mirror', () => {
    expect(resolveRemote('/api/report/3?from=2026-07-01&to=2026-08-14')).toEqual({
      fn: 'snapshots:get',
      args: { key: 'report:3' },
    });
  });
});
