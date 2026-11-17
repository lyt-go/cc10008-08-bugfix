/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/* ===== 页面热力浏览联合数据报告 ===== */

// 联合报告的匹配键固定为「页面 + 设备」：热力方案用目标页面，深度分析用页面名称。
// 设备缺一不可，缺任何一半都按“缺少匹配”处理，绝不回落到首行或行号对齐。
export type JointCurve = {
  firstScreen: string
  secondScreen: string
  thirdScreen: string
  bottom: string
  average: string
  exposure: string
}

export type JointReportStatus = '已签发' | '已隔离'

export type JointReportSource = '热力签发' | '设备修正' | '旧版重发'

export type JointReport = {
  id: string
  submissionId: string
  fingerprint: string
  page: string
  device: string
  matchKey: string
  heatmapId: number
  heatmapCode: string
  heatmapVersion: string
  scrollId: number
  scrollCode: string
  curve: JointCurve
  status: JointReportStatus
  source: JointReportSource
  supersedes: string | null
  receiptId: string | null
  issuedAt: string
}

export type JointIssueRequest = {
  heatmapId: number
  scrollId?: number
  deviceVersion?: string
  submissionId?: string
  issuedAt?: string
}

export type JointIssueStatus = '已签发' | '已拒绝' | '重复提交'

export type JointIssueOutcome = {
  submissionId: string
  heatmapCode: string
  scrollCode: string
  page: string
  device: string
  deviceVersion: string
  matchKey: string
  status: JointIssueStatus
  ok: boolean
  written: boolean
  reportId: string | null
  reason: string
}

export type JointIssueResult = {
  outcomes: JointIssueOutcome[]
  reports: JointReport[]
  writtenCount: number
}

export type JointMatchPair = {
  heatmapId: number
  heatmapCode: string
  scrollId: number | null
  scrollCode: string | null
  page: string
  device: string
  matchKey: string
  matched: boolean
  note: string
}

export type ArbitrationPolicy = 'repair-order' | 'match-completeness'

export type DeviceCorrectionReceiptInput = {
  receiptId: string
  reportId: string
  page: string
  device: string
  heatmapId: number
  correctedAt: string
  heatmapVersion?: string
}

export type JointRepublishInput = {
  reportId: string
  page: string
  republishedAt: string
  deviceVersions: Array<{ device: string; heatmapId: number; heatmapVersion?: string }>
}

export type ConflictReceipt = {
  id: string
  reportId: string
  page: string
  device: string
  policy: ArbitrationPolicy
  winner: '设备修正' | '旧版重发'
  summary: string
  replacementReportId: string | null
  completeReportId: string | null
  quarantine: string[]
  pendingDevices: string[]
  createdAt: string
}

export type JointReportBundle = {
  id: string
  page: string
  devices: string[]
  complete: boolean
  pendingDevices: string[]
  reportIds: string[]
}

export type ArbitrationResult = {
  policy: ArbitrationPolicy
  winner: '设备修正' | '旧版重发'
  replacementReport: JointReport | null
  completeReport: JointReportBundle | null
  quarantine: JointReport[]
  pendingDevices: string[]
  receipt: ConflictReceipt
  reports: JointReport[]
  written: boolean
}

export type JointConflictInput = {
  policy: ArbitrationPolicy
  receipt: DeviceCorrectionReceiptInput
  republish: JointRepublishInput
  createdAt?: string
}

export type ScrollReviewStatus = '已复核' | '待复核' | '缺少匹配'

export type ScrollReviewItem = {
  scrollId: number
  scrollCode: string
  page: string
  device: string
  matchKey: string
  heatmapId: number | null
  heatmapCode: string | null
  reportId: string | null
  curve: JointCurve | null
  exposure: string | null
  status: ScrollReviewStatus
  note: string
}

export type JointTaskPanel = {
  reports: JointReport[]
  receipts: ConflictReceipt[]
  pendingDevices: string[]
  quarantined: string[]
}

// 跨模块读取用的目录：热力方案与浏览深度两条曲线的当前行，均来自同一份持久化数据。
export type JointCatalog = {
  heatmaps: EntryRow[]
  scrolls: EntryRow[]
}

// 联合报告的持久化状态。submissions 记录已处理过的提交编号（幂等），seq 用于生成报告编号。
export type JointState = {
  reports: JointReport[]
  receipts: ConflictReceipt[]
  submissions: Record<string, string>
  seq: number
  revision: number
}
