/**
 * 页面热力浏览联合数据报告：领域规则（纯函数，不碰 localStorage / window）。
 *
 * 数据流：
 *   heatmap.目标页面 + heatmap.设备类型  ─┐
 *                                         ├─ 匹配键「页面 + 设备」─→ 联合报告（曲线 + 曝光率）
 *   scrollmap.页面名称 + scrollmap.设备类型 ─┘
 *
 * 关键约束：
 * 1. 匹配键必须同时包含页面与设备，缺一不可；不按行号、不按首行、不按“同页面”兜底。
 * 2. 匹配失败时只回退为「缺少匹配 / 待复核」，不生成报告、不覆盖已有曲线。
 * 3. 同一匹配键只允许一份匹配完整的报告处于已签发状态；版本冲突只能走设备修正/旧版重发仲裁。
 * 4. 任何读取都必须按「页面 + 设备」精确命中已签发报告，隔离报告永远不参与读取。
 */
import type {
  ArbitrationPolicy,
  ArbitrationResult,
  ConflictReceipt,
  DeviceCorrectionReceiptInput,
  EntryRow,
  JointCatalog,
  JointConflictInput,
  JointCurve,
  JointIssueOutcome,
  JointIssueRequest,
  JointIssueResult,
  JointMatchPair,
  JointReport,
  JointReportBundle,
  JointRepublishInput,
  JointState,
  JointTaskPanel,
  ScrollReviewItem,
} from './types'

export const JOINT_PAGE_FIELD = { heatmap: '目标页面', scroll: '页面名称' } as const
export const JOINT_DEVICE_FIELD = '设备类型'
export const JOINT_VERSION_FIELD = '方案版本'

const CURVE_FIELDS = [
  '首屏占比',
  '二屏占比',
  '三屏占比',
  '到达底部的占比',
  '平均浏览比例',
  '关键内容曝光率',
] as const

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

/** 匹配用的规范形：去首尾空白、折叠内部空白、统一小写。 */
export function normalizePart(value: unknown): string {
  return text(value).replace(/\s+/g, ' ').toLowerCase()
}

/** 「页面 + 设备」匹配键；任意一半缺失都返回空串，表示不可匹配。 */
export function matchKeyOf(page: unknown, device: unknown): string {
  const left = normalizePart(page)
  const right = normalizePart(device)
  return left && right ? `${left}||${right}` : ''
}

export function heatmapPage(row: EntryRow): string {
  return text(row[JOINT_PAGE_FIELD.heatmap])
}

export function heatmapDevice(row: EntryRow): string {
  return text(row[JOINT_DEVICE_FIELD])
}

export function scrollPage(row: EntryRow): string {
  return text(row[JOINT_PAGE_FIELD.scroll])
}

export function scrollDevice(row: EntryRow): string {
  return text(row[JOINT_DEVICE_FIELD])
}

export function heatmapMatchKey(row: EntryRow): string {
  return matchKeyOf(heatmapPage(row), heatmapDevice(row))
}

export function scrollMatchKey(row: EntryRow): string {
  return matchKeyOf(scrollPage(row), scrollDevice(row))
}

export function readCurve(row: EntryRow): JointCurve {
  return {
    firstScreen: text(row['首屏占比']),
    secondScreen: text(row['二屏占比']),
    thirdScreen: text(row['三屏占比']),
    bottom: text(row['到达底部的占比']),
    average: text(row['平均浏览比例']),
    exposure: text(row['关键内容曝光率']),
  }
}

export function isCurveComplete(curve: JointCurve): boolean {
  return CURVE_FIELDS.every((field) => curveField(curve, field) !== '')
}

function curveField(curve: JointCurve, field: (typeof CURVE_FIELDS)[number]): string {
  switch (field) {
    case '首屏占比':
      return curve.firstScreen
    case '二屏占比':
      return curve.secondScreen
    case '三屏占比':
      return curve.thirdScreen
    case '到达底部的占比':
      return curve.bottom
    case '平均浏览比例':
      return curve.average
    case '关键内容曝光率':
      return curve.exposure
  }
}

export function curveDigest(curve: JointCurve): string {
  return CURVE_FIELDS.map((field) => curveField(curve, field)).join('|')
}

export function curveEquals(left: JointCurve, right: JointCurve): boolean {
  return curveDigest(left) === curveDigest(right)
}

export function cloneCurve(curve: JointCurve): JointCurve {
  return { ...curve }
}

export function emptyJointState(): JointState {
  return { reports: [], receipts: [], submissions: {}, seq: 0, revision: 0 }
}

export function activeReports(state: JointState): JointReport[] {
  return state.reports.filter((report) => report.status === '已签发')
}

/**
 * 唯一的曲线读取入口：必须页面 + 设备都命中，且报告仍处于已签发状态。
 * 找不到就返回 null，绝不回退到同页面的其它设备或其它版本。
 */
export function lookupJointCurve(
  state: JointState,
  page: unknown,
  device: unknown,
): JointReport | null {
  const key = matchKeyOf(page, device)
  if (!key) {
    return null
  }
  const hits = state.reports.filter(
    (report) =>
      report.status === '已签发' &&
      report.matchKey === key &&
      matchKeyOf(report.page, report.device) === key,
  )
  if (hits.length === 0) {
    return null
  }
  // 正常情况下同一匹配键只会有一份已签发报告；若历史数据残留多份，只取最新的一份。
  return [...hits].sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))[0]
}

export function findReport(state: JointState, id: string): JointReport | null {
  return state.reports.find((report) => report.id === id) ?? null
}

function indexByKey(rows: EntryRow[], keyOf: (row: EntryRow) => string): Map<string, EntryRow[]> {
  const index = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const key = keyOf(row)
    if (!key) {
      continue
    }
    const bucket = index.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      index.set(key, [row])
    }
  }
  return index
}

/** 诊断用：每个热力方案能否找到同页面同设备、且曲线完整的唯一深度分析。 */
export function buildMatchPairs(catalog: JointCatalog): JointMatchPair[] {
  const scrollIndex = indexByKey(catalog.scrolls, scrollMatchKey)
  return catalog.heatmaps.map((heatmap) => {
    const page = heatmapPage(heatmap)
    const device = heatmapDevice(heatmap)
    const key = heatmapMatchKey(heatmap)
    const base = {
      heatmapId: Number(heatmap.id),
      heatmapCode: text(heatmap['方案编号']),
      page,
      device,
      matchKey: key,
    }
    if (!key) {
      return {
        ...base,
        scrollId: null,
        scrollCode: null,
        matched: false,
        note: '热力方案缺少目标页面或设备类型，无法建立匹配键',
      }
    }
    const hits = scrollIndex.get(key) ?? []
    if (hits.length === 0) {
      return {
        ...base,
        scrollId: null,
        scrollCode: null,
        matched: false,
        note: '没有同页面同设备的浏览深度曲线（不回退到其它设备）',
      }
    }
    if (hits.length > 1) {
      return {
        ...base,
        scrollId: null,
        scrollCode: null,
        matched: false,
        note: `匹配键命中 ${hits.length} 条深度分析，需先消除重复才能签发`,
      }
    }
    const scroll = hits[0]
    const curve = readCurve(scroll)
    if (!isCurveComplete(curve)) {
      return {
        ...base,
        scrollId: Number(scroll.id),
        scrollCode: text(scroll['分析编号']),
        matched: false,
        note: '深度分析曲线字段不完整，不能签发联合报告',
      }
    }
    return {
      ...base,
      scrollId: Number(scroll.id),
      scrollCode: text(scroll['分析编号']),
      matched: true,
      note: '页面 + 设备匹配完整',
    }
  })
}

type Rejection = {
  status: '已拒绝'
  written: false
  reason: string
}

function rejected(partial: Partial<JointIssueOutcome>, reason: string): JointIssueOutcome {
  return {
    submissionId: partial.submissionId ?? '',
    heatmapCode: partial.heatmapCode ?? '',
    scrollCode: partial.scrollCode ?? '',
    page: partial.page ?? '',
    device: partial.device ?? '',
    deviceVersion: partial.deviceVersion ?? '',
    matchKey: partial.matchKey ?? '',
    status: '已拒绝',
    ok: false,
    written: false,
    reportId: null,
    reason,
  }
}

/**
 * 签发联合报告。一次调用是一个原子批次：同一匹配键在一个批次里只接受第一份匹配完整的报告，
 * 后续同键的其它设备版本一律拒绝，且拒绝路径只读不写，不会覆盖已有曲线。
 */
export function issueJointReports(
  state: JointState,
  catalog: JointCatalog,
  requests: JointIssueRequest[],
): { state: JointState; result: JointIssueResult } {
  const reports = [...state.reports]
  const submissions = { ...state.submissions }
  const outcomes: JointIssueOutcome[] = []
  const written: JointReport[] = []
  const batchAccepted = new Map<string, JointReport>()
  let seq = state.seq

  for (const request of requests) {
    const heatmap = catalog.heatmaps.find((row) => Number(row.id) === Number(request.heatmapId))
    if (!heatmap) {
      outcomes.push(rejected({ submissionId: request.submissionId ?? '' }, '没有找到对应的热力方案'))
      continue
    }

    const page = heatmapPage(heatmap)
    const device = heatmapDevice(heatmap)
    const key = heatmapMatchKey(heatmap)
    const heatmapCode = text(heatmap['方案编号'])
    const rowVersion = text(heatmap[JOINT_VERSION_FIELD])
    const deviceVersion = text(request.deviceVersion) || rowVersion || 'v1'
    const submissionId = text(request.submissionId)
    const base = {
      submissionId,
      heatmapCode,
      page,
      device,
      deviceVersion,
      matchKey: key,
    }

    if (!key) {
      outcomes.push(rejected(base, '热力方案缺少目标页面或设备类型，匹配键不完整'))
      continue
    }

    if (submissionId && submissions[submissionId]) {
      outcomes.push({
        ...base,
        scrollCode: '',
        status: '重复提交',
        ok: true,
        written: false,
        reportId: submissions[submissionId],
        reason: '同一提交编号已经处理过，重复结果不再次落库',
      })
      continue
    }

    const scroll = resolveScrollForRequest(catalog, request, key)
    if (!scroll.ok) {
      outcomes.push(rejected(base, scroll.reason))
      continue
    }

    const curve = readCurve(scroll.row)
    const fingerprint = [
      key,
      deviceVersion,
      heatmapCode,
      text(scroll.row['分析编号']),
      curveDigest(curve),
    ].join('#')

    const duplicate = reports.find(
      (report) => report.status === '已签发' && report.fingerprint === fingerprint,
    )
    if (duplicate) {
      outcomes.push({
        ...base,
        scrollCode: text(scroll.row['分析编号']),
        status: '重复提交',
        ok: true,
        written: false,
        reportId: duplicate.id,
        reason: '相同曲线版本已经落库，重复结果不再次落库',
      })
      continue
    }

    const quarantined = reports.find(
      (report) => report.status === '已隔离' && report.fingerprint === fingerprint,
    )
    if (quarantined) {
      outcomes.push(
        rejected(
          { ...base, scrollCode: text(scroll.row['分析编号']) },
          `相同曲线版本已被隔离（${quarantined.id}），需走旧版重发或设备修正流程`,
        ),
      )
      continue
    }

    const batchPrior = batchAccepted.get(key)
    const activePrior = reports
      .filter((report) => report.status === '已签发' && report.matchKey === key)
      .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))[0]
    const prior = batchPrior ?? activePrior
    if (prior) {
      outcomes.push(
        rejected(
          { ...base, scrollCode: text(scroll.row['分析编号']) },
          prior.heatmapVersion === deviceVersion
            ? `同一匹配键已有同版本报告（${prior.id}），曲线不同，需走设备修正回执`
            : `同一匹配键已由版本 ${prior.heatmapVersion} 的完整报告（${prior.id}）占用，本次版本不得覆盖原曲线`,
        ),
      )
      continue
    }

    seq += 1
    const report: JointReport = {
      id: `JR-${String(seq).padStart(4, '0')}`,
      submissionId: submissionId || `AUTO-${String(seq).padStart(4, '0')}`,
      fingerprint,
      page,
      device,
      matchKey: key,
      heatmapId: Number(heatmap.id),
      heatmapCode,
      heatmapVersion: deviceVersion,
      scrollId: Number(scroll.row.id),
      scrollCode: text(scroll.row['分析编号']),
      curve: cloneCurve(curve),
      status: '已签发',
      source: '热力签发',
      supersedes: null,
      receiptId: null,
      issuedAt: text(request.issuedAt) || new Date().toISOString(),
    }

    reports.push(report)
    batchAccepted.set(key, report)
    written.push(report)
    if (submissionId) {
      submissions[submissionId] = report.id
    }
    outcomes.push({
      ...base,
      scrollCode: report.scrollCode,
      status: '已签发',
      ok: true,
      written: true,
      reportId: report.id,
      reason: '页面 + 设备匹配完整，联合报告已签发',
    })
  }

  const result: JointIssueResult = {
    outcomes,
    reports: written,
    writtenCount: written.length,
  }
  if (written.length === 0) {
    // 纯拒绝/重复的批次不落库，保持原曲线与写入次数不变。
    return { state, result }
  }
  return {
    state: { ...state, reports, submissions, seq, revision: state.revision + 1 },
    result,
  }
}

function resolveScrollForRequest(
  catalog: JointCatalog,
  request: JointIssueRequest,
  key: string,
): { ok: true; row: EntryRow } | { ok: false; reason: string } {
  const requestedId = request.scrollId === undefined ? null : Number(request.scrollId)
  if (requestedId !== null && Number.isFinite(requestedId)) {
    const row = catalog.scrolls.find((candidate) => Number(candidate.id) === requestedId)
    if (!row) {
      return { ok: false, reason: '没有找到指定的浏览深度分析' }
    }
    if (scrollMatchKey(row) !== key) {
      // HEAT-0002 被错配到移动端深度分析，就是走了“只比页面”的路径；这里直接拒绝。
      return {
        ok: false,
        reason: '深度分析的页面/设备与热力方案不一致，匹配键不同，拒绝签发',
      }
    }
    const curve = readCurve(row)
    if (!isCurveComplete(curve)) {
      return { ok: false, reason: '指定的深度分析曲线字段不完整，拒绝签发' }
    }
    return { ok: true, row }
  }

  const hits = catalog.scrolls.filter((row) => scrollMatchKey(row) === key)
  if (hits.length === 0) {
    return { ok: false, reason: '缺少同页面同设备的浏览深度曲线，按缺少匹配回退' }
  }
  if (hits.length > 1) {
    return { ok: false, reason: `匹配键命中 ${hits.length} 条深度分析，无法唯一匹配` }
  }
  const curve = readCurve(hits[0])
  if (!isCurveComplete(curve)) {
    return { ok: false, reason: '匹配到的深度分析曲线字段不完整，按缺少匹配回退' }
  }
  return { ok: true, row: hits[0] }
}

function expectedDevicesForPage(catalog: JointCatalog, page: string): string[] {
  const wanted = normalizePart(page)
  const devices: string[] = []
  const seen = new Set<string>()
  const candidates: Array<{ page: string; device: string }> = [
    ...catalog.scrolls.map((row) => ({ page: scrollPage(row), device: scrollDevice(row) })),
    ...catalog.heatmaps.map((row) => ({ page: heatmapPage(row), device: heatmapDevice(row) })),
  ]
  for (const candidate of candidates) {
    if (normalizePart(candidate.page) !== wanted) {
      continue
    }
    const normalized = normalizePart(candidate.device)
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    devices.push(candidate.device)
  }
  return devices
}

function findHeatmapByMatchKey(catalog: JointCatalog, key: string): EntryRow | null {
  const hits = catalog.heatmaps.filter((row) => heatmapMatchKey(row) === key)
  return hits.length === 1 ? hits[0] : null
}

function findScrollByMatchKey(catalog: JointCatalog, key: string): EntryRow | null {
  const hits = catalog.scrolls.filter((row) => scrollMatchKey(row) === key)
  if (hits.length !== 1) {
    return null
  }
  return isCurveComplete(readCurve(hits[0])) ? hits[0] : null
}

function makeReport(
  seq: number,
  input: {
    page: string
    device: string
    key: string
    heatmap: EntryRow
    scroll: EntryRow
    version: string
    source: JointReport['source']
    issuedAt: string
    supersedes: string | null
    receiptId: string | null
  },
): JointReport {
  const curve = readCurve(input.scroll)
  return {
    id: `JR-${String(seq).padStart(4, '0')}`,
    submissionId: `ARB-${String(seq).padStart(4, '0')}`,
    fingerprint: [
      input.key,
      input.version,
      text(input.heatmap['方案编号']),
      text(input.scroll['分析编号']),
      curveDigest(curve),
    ].join('#'),
    page: input.page,
    device: input.device,
    matchKey: input.key,
    heatmapId: Number(input.heatmap.id),
    heatmapCode: text(input.heatmap['方案编号']),
    heatmapVersion: input.version,
    scrollId: Number(input.scroll.id),
    scrollCode: text(input.scroll['分析编号']),
    curve: cloneCurve(curve),
    status: '已签发',
    source: input.source,
    supersedes: input.supersedes,
    receiptId: input.receiptId,
    issuedAt: input.issuedAt,
  }
}

type CorrectionPlan = {
  viable: boolean
  heatmap: EntryRow | null
  scroll: EntryRow | null
  page: string
  device: string
  key: string
  version: string
  note: string
}

type RepublishEntryPlan = {
  heatmap: EntryRow
  scroll: EntryRow
  device: string
  key: string
  version: string
}

type RepublishPlan = {
  matched: RepublishEntryPlan[]
  unmatched: string[]
  page: string
}

function buildCorrectionPlan(
  catalog: JointCatalog,
  input: DeviceCorrectionReceiptInput,
): CorrectionPlan {
  const heatmap = catalog.heatmaps.find((row) => Number(row.id) === Number(input.heatmapId))
  const page = text(input.page)
  const device = text(input.device)
  const empty: CorrectionPlan = {
    viable: false,
    heatmap: heatmap ?? null,
    scroll: null,
    page,
    device,
    key: '',
    version: '',
    note: '',
  }
  if (!heatmap) {
    return { ...empty, note: '设备修正回执没有对应的热力方案' }
  }
  const heatPage = heatmapPage(heatmap)
  const heatDevice = heatmapDevice(heatmap)
  if (normalizePart(heatPage) !== normalizePart(page)) {
    return { ...empty, note: '设备修正回执的页面与热力方案不一致，拒绝写入' }
  }
  if (normalizePart(heatDevice) !== normalizePart(device)) {
    return { ...empty, note: '设备修正回执的设备与热力方案不一致，拒绝写入' }
  }
  const key = matchKeyOf(heatPage, heatDevice)
  if (!key) {
    return { ...empty, key, note: '设备修正回执缺少页面或设备，无法建立匹配键' }
  }
  const scroll = findScrollByMatchKey(catalog, key)
  if (!scroll) {
    return {
      ...empty,
      key,
      note: '没有同页面同设备的完整深度曲线，设备修正无法生成替换报告',
    }
  }
  const version =
    text(input.heatmapVersion) || text(heatmap[JOINT_VERSION_FIELD]) || 'v1'
  return {
    viable: true,
    heatmap,
    scroll,
    page: heatPage,
    device: heatDevice,
    key,
    version,
    note: '设备修正匹配完整',
  }
}

function buildRepublishPlan(
  catalog: JointCatalog,
  input: JointRepublishInput,
): RepublishPlan {
  const page = text(input.page)
  const matched: RepublishEntryPlan[] = []
  const unmatched: string[] = []
  const seen = new Set<string>()
  for (const entry of input.deviceVersions ?? []) {
    const heatmap = catalog.heatmaps.find((row) => Number(row.id) === Number(entry.heatmapId))
    if (!heatmap || normalizePart(heatmapPage(heatmap)) !== normalizePart(page)) {
      unmatched.push(text(entry.device) || `#${entry.heatmapId}`)
      continue
    }
    const device = heatmapDevice(heatmap)
    const key = matchKeyOf(page, device)
    if (!key || seen.has(key)) {
      unmatched.push(device || `#${entry.heatmapId}`)
      continue
    }
    const scroll = findScrollByMatchKey(catalog, key)
    if (!scroll) {
      unmatched.push(device)
      continue
    }
    seen.add(key)
    matched.push({
      heatmap,
      scroll,
      device,
      key,
      version: text(entry.heatmapVersion) || text(heatmap[JOINT_VERSION_FIELD]) || 'v1',
    })
  }
  return { matched, unmatched, page }
}

/**
 * 设备修正回执与旧联合报告重发同时到达时的仲裁。
 * - repair-order：谁先完成修复谁生效（先修复设备的替换报告 + 旧版隔离清单）。
 * - match-completeness：设备覆盖更完整的一方生效（完整设备报告 + 待补设备清单）。
 * 两种策略都只写入页面 + 设备精确匹配的报告；旧报告一律转为已隔离，读取入口不会再命中。
 */
export function arbitrateJointConflict(
  state: JointState,
  catalog: JointCatalog,
  input: JointConflictInput,
): { state: JointState; result: ArbitrationResult } {
  const receiptId = text(input.receipt.receiptId)
  if (!receiptId) {
    throw new Error('冲突回执缺少回执编号，无法写入联合报告入口')
  }
  const existingReceipt = state.receipts.find((receipt) => receipt.id === receiptId)
  if (existingReceipt) {
    // 回执幂等：重复到达不再落库，仍返回当前读取视图。
    const replacement = existingReceipt.replacementReportId
      ? findReport(state, existingReceipt.replacementReportId)
      : null
    const completeReport = existingReceipt.completeReportId
      ? rebuildBundle(state, existingReceipt)
      : null
    return {
      state,
      result: {
        policy: existingReceipt.policy,
        winner: existingReceipt.winner,
        replacementReport: replacement,
        completeReport,
        quarantine: state.reports.filter((report) =>
          existingReceipt.quarantine.includes(report.id),
        ),
        pendingDevices: existingReceipt.pendingDevices,
        receipt: existingReceipt,
        reports: state.reports,
        written: false,
      },
    }
  }

  const oldReport = findReport(state, text(input.republish.reportId))
  if (!oldReport) {
    throw new Error('旧联合报告不存在，无法重发')
  }
  if (normalizePart(oldReport.page) !== normalizePart(input.republish.page)) {
    throw new Error('旧联合报告的页面与重发请求不一致，拒绝写入')
  }
  if (normalizePart(oldReport.page) !== normalizePart(input.receipt.page)) {
    throw new Error('设备修正回执与旧联合报告不是同一页面，拒绝写入')
  }

  const correction = buildCorrectionPlan(catalog, input.receipt)
  if (
    correction.note.includes('不一致') ||
    correction.note.includes('没有对应的热力方案')
  ) {
    throw new Error(correction.note)
  }
  const republish = buildRepublishPlan(catalog, input.republish)
  if (republish.matched.length === 0 && !correction.viable) {
    throw new Error('设备修正与旧版重发都没有匹配完整的曲线，未写入任何报告')
  }

  const page = oldReport.page
  const expectedDevices = expectedDevicesForPage(catalog, page)
  const coveredByRepublish = new Set(republish.matched.map((entry) => normalizePart(entry.device)))
  const republishComplete =
    expectedDevices.length > 0 &&
    expectedDevices.every((device) => coveredByRepublish.has(normalizePart(device)))

  const policy: ArbitrationPolicy = input.policy
  let winner: '设备修正' | '旧版重发'
  if (policy === 'repair-order') {
    const correctionFirst =
      !input.receipt.correctedAt ||
      !input.republish.republishedAt ||
      input.receipt.correctedAt <= input.republish.republishedAt
    if (correctionFirst) {
      winner = correction.viable ? '设备修正' : '旧版重发'
    } else {
      winner = republish.matched.length > 0 ? '旧版重发' : '设备修正'
    }
  } else if (republishComplete) {
    winner = '旧版重发'
  } else if (!correction.viable) {
    winner = '旧版重发'
  } else if (republish.matched.length > 1) {
    winner = '旧版重发'
  } else {
    winner = '设备修正'
  }

  if (winner === '设备修正' && !correction.viable) {
    throw new Error(correction.note || '设备修正缺少匹配完整的曲线，未写入任何报告')
  }
  if (winner === '旧版重发' && republish.matched.length === 0) {
    throw new Error('旧版重发没有匹配完整的设备曲线，未写入任何报告')
  }

  const createdAt = text(input.createdAt) || new Date().toISOString()
  const activeForPage = state.reports.filter(
    (report) =>
      report.status === '已签发' && normalizePart(report.page) === normalizePart(page),
  )

  let seq = state.seq
  const newReports: JointReport[] = []
  const coveredDevices: string[] = []

  if (winner === '设备修正' && correction.heatmap && correction.scroll) {
    seq += 1
    newReports.push(
      makeReport(seq, {
        page: correction.page,
        device: correction.device,
        key: correction.key,
        heatmap: correction.heatmap,
        scroll: correction.scroll,
        version: correction.version,
        source: '设备修正',
        issuedAt: text(input.receipt.correctedAt) || createdAt,
        supersedes: oldReport.id,
        receiptId,
      }),
    )
    coveredDevices.push(correction.device)
  } else {
    for (const entry of republish.matched) {
      seq += 1
      newReports.push(
        makeReport(seq, {
          page: republish.page,
          device: entry.device,
          key: entry.key,
          heatmap: entry.heatmap,
          scroll: entry.scroll,
          version: entry.version,
          source: '旧版重发',
          issuedAt: text(input.republish.republishedAt) || createdAt,
          supersedes:
            normalizePart(oldReport.matchKey) === normalizePart(entry.key) ? oldReport.id : null,
          receiptId,
        }),
      )
      coveredDevices.push(entry.device)
    }
  }

  const newIds = new Set(newReports.map((report) => report.id))
  const covered = new Set(coveredDevices.map((device) => normalizePart(device)))
  const pendingDevices = expectedDevices.filter(
    (device) => !covered.has(normalizePart(device)),
  )
  // 只有被新报告接管的匹配键才进入隔离清单；同页面其它设备的有效报告继续可读。
  const supersededKeys = new Set(newReports.map((report) => report.matchKey))

  const quarantine: string[] = []
  const keptReports = state.reports.map((report) => {
    if (!activeForPage.some((candidate) => candidate.id === report.id)) {
      return report
    }
    if (newIds.has(report.id)) {
      return report
    }
    if (!supersededKeys.has(report.matchKey) && report.id !== oldReport.id) {
      return report
    }
    quarantine.push(report.id)
    return { ...report, status: '已隔离' as const }
  })
  if (!quarantine.includes(oldReport.id)) {
    // 旧报告即便被同键新报告直接替代，也要在隔离清单里留痕，避免旧版本再次串页。
    quarantine.push(oldReport.id)
    const index = keptReports.findIndex((report) => report.id === oldReport.id)
    if (index >= 0) {
      keptReports[index] = { ...keptReports[index], status: '已隔离' as const }
    }
  }

  const completeReport: JointReportBundle | null =
    winner === '旧版重发'
      ? {
          id: `JB-${receiptId}`,
          page,
          devices: coveredDevices,
          complete: pendingDevices.length === 0,
          pendingDevices,
          reportIds: newReports.map((report) => report.id),
        }
      : null

  const receipt: ConflictReceipt = {
    id: receiptId,
    reportId: oldReport.id,
    page,
    device: correction.viable ? correction.device : text(input.receipt.device),
    policy,
    winner,
    summary:
      winner === '设备修正'
        ? `先完成修复的设备「${coveredDevices[0] ?? ''}」生成替换报告，旧版联合报告进入隔离清单`
        : `旧版重发覆盖 ${coveredDevices.length} 个设备，生成完整设备报告，待补 ${pendingDevices.length} 个设备`,
    replacementReportId: winner === '设备修正' ? newReports[0]?.id ?? null : null,
    completeReportId: completeReport?.id ?? null,
    quarantine,
    pendingDevices,
    createdAt,
  }

  const reports = [...keptReports, ...newReports]
  const nextState: JointState = {
    ...state,
    reports,
    receipts: [...state.receipts, receipt],
    seq,
    revision: state.revision + 1,
  }

  return {
    state: nextState,
    result: {
      policy,
      winner,
      replacementReport: winner === '设备修正' ? newReports[0] ?? null : null,
      completeReport,
      quarantine: reports.filter((report) => quarantine.includes(report.id)),
      pendingDevices,
      receipt,
      reports,
      written: newReports.length > 0,
    },
  }
}

function rebuildBundle(state: JointState, receipt: ConflictReceipt): JointReportBundle {
  const reportIds = state.reports
    .filter((report) => report.receiptId === receipt.id && report.status === '已签发')
    .map((report) => report.id)
  const devices = state.reports
    .filter((report) => reportIds.includes(report.id))
    .map((report) => report.device)
  return {
    id: receipt.completeReportId ?? `JB-${receipt.id}`,
    page: receipt.page,
    devices,
    complete: receipt.pendingDevices.length === 0,
    pendingDevices: receipt.pendingDevices,
    reportIds,
  }
}

/**
 * 浏览深度复核清单：每条深度分析按「页面 + 设备」去找热力方案和已签发报告。
 * 找不到就标待复核/缺少匹配，不借用同页面其它设备的曲线与曝光率。
 */
export function buildScrollReviewList(
  state: JointState,
  catalog: JointCatalog,
  filters: { page?: string; device?: string } = {},
): ScrollReviewItem[] {
  const heatIndex = indexByKey(catalog.heatmaps, heatmapMatchKey)
  const pageFilter = normalizePart(filters.page)
  const deviceFilter = normalizePart(filters.device)
  const items: ScrollReviewItem[] = []

  for (const scroll of catalog.scrolls) {
    const page = scrollPage(scroll)
    const device = scrollDevice(scroll)
    const key = scrollMatchKey(scroll)
    if (pageFilter && !normalizePart(page).includes(pageFilter)) {
      continue
    }
    if (deviceFilter && normalizePart(device) !== deviceFilter) {
      continue
    }
    const base = {
      scrollId: Number(scroll.id),
      scrollCode: text(scroll['分析编号']),
      page,
      device,
      matchKey: key,
    }
    if (!key) {
      items.push({
        ...base,
        heatmapId: null,
        heatmapCode: null,
        reportId: null,
        curve: null,
        exposure: null,
        status: '缺少匹配',
        note: '深度分析缺少页面名称或设备类型，无法建立匹配键',
      })
      continue
    }
    const heatmaps = heatIndex.get(key) ?? []
    if (heatmaps.length === 0) {
      items.push({
        ...base,
        heatmapId: null,
        heatmapCode: null,
        reportId: null,
        curve: null,
        exposure: null,
        status: '缺少匹配',
        note: '没有同页面同设备的热力方案（不回退到其它设备）',
      })
      continue
    }
    if (heatmaps.length > 1) {
      items.push({
        ...base,
        heatmapId: null,
        heatmapCode: null,
        reportId: null,
        curve: null,
        exposure: null,
        status: '缺少匹配',
        note: `同页面同设备存在 ${heatmaps.length} 个热力方案，无法唯一匹配`,
      })
      continue
    }
    const heatmap = heatmaps[0]
    const curve = readCurve(scroll)
    if (!isCurveComplete(curve)) {
      items.push({
        ...base,
        heatmapId: Number(heatmap.id),
        heatmapCode: text(heatmap['方案编号']),
        reportId: null,
        curve: null,
        exposure: null,
        status: '缺少匹配',
        note: '深度分析曲线字段不完整，无法恢复复核数据',
      })
      continue
    }
    const report = lookupJointCurve(state, page, device)
    if (!report || report.matchKey !== key) {
      items.push({
        ...base,
        heatmapId: Number(heatmap.id),
        heatmapCode: text(heatmap['方案编号']),
        reportId: null,
        curve: null,
        exposure: null,
        status: '待复核',
        note: '尚未签发匹配的联合报告',
      })
      continue
    }
    items.push({
      ...base,
      heatmapId: Number(heatmap.id),
      heatmapCode: text(heatmap['方案编号']),
      reportId: report.id,
      curve: cloneCurve(report.curve),
      exposure: report.curve.exposure,
      status: '已复核',
      note: `读取 ${report.id}（${report.source}）`,
    })
  }
  return items
}

/** 任务面板：签发/仲裁后从面板返回复验，视图只读已签发报告与回执。 */
export function buildJointTaskPanel(
  state: JointState,
  catalog: JointCatalog,
): JointTaskPanel {
  const pendingDevices = new Set<string>()
  const pages = new Set<string>()
  for (const row of catalog.scrolls) {
    const page = scrollPage(row)
    if (page) {
      pages.add(page)
    }
  }
  for (const report of state.reports) {
    pages.add(report.page)
  }
  for (const page of pages) {
    const expected = expectedDevicesForPage(catalog, page)
    for (const device of expected) {
      if (!lookupJointCurve(state, page, device)) {
        pendingDevices.add(`${page} · ${device}`)
      }
    }
  }
  return {
    reports: [...state.reports].sort((left, right) => right.id.localeCompare(left.id)),
    receipts: [...state.receipts],
    pendingDevices: [...pendingDevices],
    quarantined: state.reports
      .filter((report) => report.status === '已隔离')
      .map((report) => `${report.id} · ${report.page} · ${report.device}`),
  }
}
