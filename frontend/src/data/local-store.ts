import { SEED_ROWS } from './seed'
import { emptyJointState } from './joint-domain'
import type { EntryRow, JointState } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'behavior-event-trace-hub:entries'
const JOINT_STORAGE_KEY = 'behavior-event-trace-hub:joint-reports'
const SCHEMA_KEY = 'behavior-event-trace-hub:schema'
// v2：浏览深度补上设备类型，热力方案补上方案版本，联合报告按「页面 + 设备」匹配。
const SCHEMA_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 旧版数据升级：v1 的浏览深度没有设备类型，跨模块合并只能按页面兜底，正是串页的原因。
 * 命中旧结构时把这两张表整体回到当前示例数据，保证热力方案与浏览深度两侧的匹配口径一致。
 */
function migrate(rows: Record<string, EntryRow[]>): {
  rows: Record<string, EntryRow[]>
  migrated: boolean
} {
  const scrollmap = rows.scrollmap ?? []
  const heatmap = rows.heatmap ?? []
  const legacyScroll = scrollmap.some((row) => !String(row['设备类型'] ?? '').trim())
  const legacyHeat = heatmap.some((row) => !String(row['方案版本'] ?? '').trim())
  if (!legacyScroll && !legacyHeat) {
    return { rows, migrated: false }
  }
  return {
    rows: {
      ...rows,
      heatmap: clone(SEED_ROWS.heatmap ?? []),
      scrollmap: clone(SEED_ROWS.scrollmap ?? []),
    },
    migrated: true,
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    const { rows, migrated } = migrate(merged)
    if (migrated) {
      // 旧结构的联合报告与新匹配键不兼容，一并清空，避免读回串页的旧结果。
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
      window.localStorage.removeItem(JOINT_STORAGE_KEY)
      window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
    }
    return rows
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/* ===== 联合报告持久化 ===== */

let jointCache: JointState | null = null

export function jointState(): JointState {
  if (jointCache !== null) {
    return jointCache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    jointCache = emptyJointState()
    return jointCache
  }
  const raw = window.localStorage.getItem(JOINT_STORAGE_KEY)
  if (!raw) {
    jointCache = emptyJointState()
    return jointCache
  }
  try {
    const parsed = JSON.parse(raw) as Partial<JointState>
    jointCache = {
      ...emptyJointState(),
      ...parsed,
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [],
      submissions: parsed.submissions ?? {},
    }
    return jointCache
  } catch {
    jointCache = emptyJointState()
    return jointCache
  }
}

export function saveJointState(state: JointState): void {
  jointCache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(JOINT_STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetJointState(): JointState {
  const state = emptyJointState()
  saveJointState(state)
  return state
}

export function jointStorageKey(): string {
  return JOINT_STORAGE_KEY
}
