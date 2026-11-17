<template>
  <section class="page" data-module="joint">
    <header class="page-head">
      <div>
        <h2>页面热力浏览联合数据报告</h2>
        <p class="page-desc">
          热力方案与浏览深度按「页面 + 设备」唯一匹配；匹配不完整只回退为缺少匹配，不借用同页面其它设备的曲线。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">重新读取</button>
        <button class="btn" type="button" @click="issueConcurrent">并发签发两个设备版本</button>
      </div>
    </header>

    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
    <p v-if="notice" class="page-desc">{{ notice }}</p>

    <h3>匹配诊断</h3>
    <table class="data-table" data-report="joint-match-pairs">
      <thead>
        <tr>
          <th>热力方案</th>
          <th>目标页面</th>
          <th>设备类型</th>
          <th>匹配键</th>
          <th>深度分析</th>
          <th>匹配结果</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="pair in pairs" :key="`pair-${pair.heatmapId}`" :data-match-key="pair.matchKey">
          <td>{{ pair.heatmapCode }}</td>
          <td>{{ pair.page || '—' }}</td>
          <td>{{ pair.device || '—' }}</td>
          <td>{{ pair.matchKey || '—' }}</td>
          <td>{{ pair.scrollCode ?? '—' }}</td>
          <td>{{ pair.matched ? '匹配完整' : '缺少匹配' }}</td>
          <td>{{ pair.note }}</td>
        </tr>
      </tbody>
    </table>

    <h3>签发结果</h3>
    <table class="data-table" data-report="joint-issue-outcomes">
      <thead>
        <tr>
          <th>提交编号</th>
          <th>热力方案</th>
          <th>深度分析</th>
          <th>页面</th>
          <th>设备</th>
          <th>设备版本</th>
          <th>结果</th>
          <th>报告</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(outcome, index) in outcomes" :key="`outcome-${index}`" :data-submission="outcome.submissionId">
          <td>{{ outcome.submissionId || '—' }}</td>
          <td>{{ outcome.heatmapCode || '—' }}</td>
          <td>{{ outcome.scrollCode || '—' }}</td>
          <td>{{ outcome.page || '—' }}</td>
          <td>{{ outcome.device || '—' }}</td>
          <td>{{ outcome.deviceVersion || '—' }}</td>
          <td>{{ outcome.status }}</td>
          <td>{{ outcome.reportId ?? '—' }}</td>
          <td>{{ outcome.reason }}</td>
        </tr>
        <tr v-if="!outcomes.length">
          <td colspan="9" class="empty-state">尚未发起签发</td>
        </tr>
      </tbody>
    </table>

    <h3>冲突仲裁</h3>
    <form class="filter-bar" @submit.prevent="runArbitration">
      <label class="filter-item">
        <span>仲裁边界</span>
        <select v-model="policy">
          <option value="repair-order">修复完成先后（先修复设备的替换报告）</option>
          <option value="match-completeness">设备匹配完整度（完整设备报告）</option>
        </select>
      </label>
      <label class="filter-item">
        <span>设备修正时间</span>
        <input v-model="correctedAt" placeholder="2026-11-17T09:00:00.000Z" />
      </label>
      <label class="filter-item">
        <span>旧版重发时间</span>
        <input v-model="republishedAt" placeholder="2026-11-17T10:00:00.000Z" />
      </label>
      <button class="btn primary" type="submit">提交冲突回执</button>
    </form>

    <table class="data-table" data-report="joint-receipts">
      <thead>
        <tr>
          <th>回执编号</th>
          <th>旧报告</th>
          <th>页面</th>
          <th>设备</th>
          <th>仲裁边界</th>
          <th>生效方</th>
          <th>替换/完整报告</th>
          <th>隔离清单</th>
          <th>待补设备</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="receipt in receipts" :key="receipt.id" :data-receipt="receipt.id">
          <td>{{ receipt.id }}</td>
          <td>{{ receipt.reportId }}</td>
          <td>{{ receipt.page }}</td>
          <td>{{ receipt.device }}</td>
          <td>{{ receipt.policy }}</td>
          <td>{{ receipt.winner }}</td>
          <td>{{ receipt.replacementReportId ?? receipt.completeReportId ?? '—' }}</td>
          <td>{{ receipt.quarantine.join('、') || '—' }}</td>
          <td>{{ receipt.pendingDevices.join('、') || '—' }}</td>
        </tr>
        <tr v-if="!receipts.length">
          <td colspan="9" class="empty-state">尚无冲突回执</td>
        </tr>
      </tbody>
    </table>

    <h3>任务面板</h3>
    <p class="page-desc">
      待补设备：{{ panel.pendingDevices.join('、') || '无' }}；隔离清单：{{ panel.quarantined.join('、') || '无' }}
    </p>
    <table class="data-table" data-report="joint-task-panel">
      <thead>
        <tr>
          <th>报告</th>
          <th>来源</th>
          <th>页面</th>
          <th>设备</th>
          <th>设备版本</th>
          <th>匹配键</th>
          <th>深度分析</th>
          <th>曝光率</th>
          <th>状态</th>
          <th>签发时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="report in panel.reports" :key="report.id" :data-report-id="report.id" :data-status="report.status">
          <td>{{ report.id }}</td>
          <td>{{ report.source }}</td>
          <td>{{ report.page }}</td>
          <td>{{ report.device }}</td>
          <td>{{ report.heatmapVersion }}</td>
          <td>{{ report.matchKey }}</td>
          <td>{{ report.scrollCode }}</td>
          <td>{{ report.curve.exposure }}</td>
          <td>{{ report.status }}</td>
          <td>{{ report.issuedAt }}</td>
        </tr>
        <tr v-if="!panel.reports.length">
          <td colspan="10" class="empty-state">尚无联合报告</td>
        </tr>
      </tbody>
    </table>

    <h3>页面设备组合复验</h3>
    <table class="data-table" data-report="joint-readback">
      <thead>
        <tr>
          <th>页面</th>
          <th>设备</th>
          <th>匹配键</th>
          <th>读取到的报告</th>
          <th>报告设备</th>
          <th>首屏占比</th>
          <th>关键内容曝光率</th>
          <th>复验结论</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="cell in readback" :key="`${cell.page}-${cell.device}`" :data-cell="`${cell.page}|${cell.device}`">
          <td>{{ cell.page }}</td>
          <td>{{ cell.device }}</td>
          <td>{{ cell.matchKey }}</td>
          <td>{{ cell.reportId ?? '—' }}</td>
          <td>{{ cell.reportDevice ?? '—' }}</td>
          <td>{{ cell.firstScreen ?? '—' }}</td>
          <td>{{ cell.exposure ?? '—' }}</td>
          <td>{{ cell.verdict }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  arbitrateJoint,
  issueJointReport,
  listJointMatches,
  listJointReports,
  loadJointTaskPanel,
  readJointReport,
} from '@/api/local-service'
import { matchKeyOf } from '@/data/joint-domain'
import type {
  ArbitrationPolicy,
  ConflictReceipt,
  JointIssueOutcome,
  JointMatchPair,
  JointReport,
  JointTaskPanel,
} from '@/data/types'

const pairs = ref<JointMatchPair[]>([])
const outcomes = ref<JointIssueOutcome[]>([])
const panel = ref<JointTaskPanel>({ reports: [], receipts: [], pendingDevices: [], quarantined: [] })
const errorMessage = ref('')
const notice = ref('')
const policy = ref<ArbitrationPolicy>('repair-order')
const correctedAt = ref('2026-11-17T09:00:00.000Z')
const republishedAt = ref('2026-11-17T10:00:00.000Z')
const reports = ref<JointReport[]>([])
const receipts = ref<ConflictReceipt[]>([])
const lastOldReportId = ref('JR-0001')

const readback = computed(() => {
  const pages = [...new Set(reports.value.map((report) => report.page))]
  const devices = [...new Set(reports.value.map((report) => report.device))]
  const cells = []
  for (const page of pages) {
    for (const device of devices) {
      const report = readJointReport(page, device)
      const key = matchKeyOf(page, device)
      const matched = report !== null && report.matchKey === key
      cells.push({
        page,
        device,
        matchKey: key,
        reportId: report?.id ?? null,
        reportDevice: report?.device ?? null,
        firstScreen: report?.curve.firstScreen ?? null,
        exposure: report?.curve.exposure ?? null,
        verdict: matched
          ? '曲线与曝光率匹配'
          : report
            ? '匹配键不一致，拒绝读取'
            : '缺少匹配，不借用其它设备',
      })
    }
  }
  return cells
})

function reload() {
  errorMessage.value = ''
  try {
    pairs.value = listJointMatches()
    panel.value = loadJointTaskPanel()
    reports.value = listJointReports()
    receipts.value = panel.value.receipts
    const active = reports.value.find((report) => report.status === '已签发')
    lastOldReportId.value = active?.id ?? reports.value[0]?.id ?? ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '联合报告读取失败'
  }
}

function issueConcurrent() {
  errorMessage.value = ''
  const complete = pairs.value.filter((pair) => pair.matched)
  if (!complete.length) {
    errorMessage.value = '没有匹配完整的页面设备组合，无法签发'
    return
  }
  const stamp = Date.now()
  const requests = complete.map((pair, index) => ({
    heatmapId: pair.heatmapId,
    scrollId: pair.scrollId ?? undefined,
    deviceVersion: index === 0 ? 'v2-A' : 'v2-B',
    submissionId: `SUB-${stamp}-${index}`,
    issuedAt: new Date(stamp + index).toISOString(),
  }))
  outcomes.value = issueJointReport(requests).outcomes
  notice.value = `本次并发签发：写入 ${outcomes.value.filter((item) => item.written).length} 份，拒绝 ${outcomes.value.filter((item) => item.status === '已拒绝').length} 份`
  reload()
}

function runArbitration() {
  errorMessage.value = ''
  if (!lastOldReportId.value) {
    errorMessage.value = '没有可仲裁的旧联合报告，请先签发'
    return
  }
  const old = reports.value.find((report) => report.id === lastOldReportId.value)
  if (!old) {
    errorMessage.value = '没有找到旧联合报告'
    return
  }
  const heatmap = pairs.value.find((pair) => pair.matchKey === old.matchKey)
  try {
    const result = arbitrateJoint({
      policy: policy.value,
      receipt: {
        receiptId: `RC-${Date.now()}`,
        reportId: old.id,
        page: old.page,
        device: old.device,
        heatmapId: heatmap?.heatmapId ?? old.heatmapId,
        correctedAt: correctedAt.value,
      },
      republish: {
        reportId: old.id,
        page: old.page,
        republishedAt: republishedAt.value,
        deviceVersions: pairs.value
          .filter((pair) => pair.page === old.page && pair.matched)
          .map((pair) => ({ device: pair.device, heatmapId: pair.heatmapId, heatmapVersion: 'v3' })),
      },
    })
    notice.value = `仲裁边界 ${result.policy}：生效方「${result.winner}」，隔离 ${result.quarantine.length} 份，待补 ${result.pendingDevices.length} 个设备`
    if (!result.written) {
      errorMessage.value = '仲裁未写入新报告'
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '仲裁失败'
  }
  reload()
}

onMounted(reload)
</script>
