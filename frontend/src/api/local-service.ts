import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  jointState,
  listRows,
  resetRows,
  saveJointState,
  saveRows,
} from '@/data/local-store'
import {
  arbitrateJointConflict,
  buildJointTaskPanel,
  buildMatchPairs,
  buildScrollReviewList,
  issueJointReports,
  lookupJointCurve,
} from '@/data/joint-domain'
import type {
  ActionResult,
  ArbitrationResult,
  EntryRow,
  JointCatalog,
  JointConflictInput,
  JointIssueRequest,
  JointIssueResult,
  JointMatchPair,
  JointReport,
  JointReportBundle,
  JointTaskPanel,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ScrollReviewItem,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

/* ===== 页面热力浏览联合数据报告：跨模块读取与签发 ===== */

/** 从同一份持久化数据里取热力方案与浏览深度两条曲线，供联合报告按「页面 + 设备」匹配。 */
export function loadJointCatalog(): JointCatalog {
  return {
    heatmaps: listRows('heatmap').map((row) => ({ ...row })),
    scrolls: listRows('scrollmap').map((row) => ({ ...row })),
  }
}

/** 诊断入口：每个热力方案能否匹配到同页面同设备的完整深度曲线。 */
export function listJointMatches(): JointMatchPair[] {
  return buildMatchPairs(loadJointCatalog())
}

/** 签发联合报告：两个设备版本并发到达时只接受一份匹配完整的报告，拒绝路径不写库。 */
export function issueJointReport(requests: JointIssueRequest[]): JointIssueResult {
  const catalog = loadJointCatalog()
  const { state, result } = issueJointReports(jointState(), catalog, requests)
  if (state !== jointState() && result.writtenCount > 0) {
    saveJointState(state)
  }
  return result
}

/** 浏览深度复核清单：按「页面 + 设备」恢复曲线与曝光率，缺匹配时只读占位不借用别的设备。 */
export function listScrollReviews(filters: { page?: string; device?: string } = {}): ScrollReviewItem[] {
  return buildScrollReviewList(jointState(), loadJointCatalog(), filters)
}

/** 页面设备组合的唯一读取入口：匹配不上就返回 null，绝不回退到同页面的其它设备。 */
export function readJointReport(page: string, device: string): JointReport | null {
  return lookupJointCurve(jointState(), page, device)
}

/** 冲突仲裁：设备修正回执与旧联合报告重发同时到达，按策略写入并把回执写回入口。 */
export function arbitrateJoint(input: JointConflictInput): ArbitrationResult {
  const catalog = loadJointCatalog()
  const { state, result } = arbitrateJointConflict(jointState(), catalog, input)
  if (state !== jointState() && result.written) {
    saveJointState(state)
  }
  return result
}

/** 任务面板：签发/仲裁后从这里返回复验，确认旧版本不会重新串页。 */
export function loadJointTaskPanel(): JointTaskPanel {
  return buildJointTaskPanel(jointState(), loadJointCatalog())
}

/** 全量读取联合报告（含已隔离），仅供任务面板与导出使用；页面曲线请走 readJointReport。 */
export function listJointReports(): JointReport[] {
  return [...jointState().reports].sort((left, right) => right.id.localeCompare(left.id))
}

export type { JointReportBundle }

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
