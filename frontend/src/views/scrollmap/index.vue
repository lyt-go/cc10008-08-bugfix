<template>
  <section class="page" data-module="scrollmap">
    <header class="page-head">
      <div>
        <h2>浏览深度管理</h2>
        <p class="page-desc">分析页面的用户浏览深度，从首屏到末屏的逐段浏览比例。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记深度分析</button>
        <button class="btn" type="button" @click="exportRows">导出浏览深度清单</button>
        <button class="btn" type="button" @click="reloadReviews">按联合报告恢复复核清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <h3>按联合报告恢复的复核清单</h3>
    <table class="data-table" data-review="joint-scroll-review">
      <thead>
        <tr>
          <th>分析编号</th>
          <th>页面名称</th>
          <th>设备类型</th>
          <th>匹配键</th>
          <th>热力方案</th>
          <th>联合报告</th>
          <th>首屏占比</th>
          <th>平均浏览比例</th>
          <th>关键内容曝光率</th>
          <th>复核状态</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in reviews" :key="`review-${item.scrollId}`" :data-match-key="item.matchKey">
          <td>{{ item.scrollCode }}</td>
          <td>{{ item.page }}</td>
          <td>{{ item.device || '—' }}</td>
          <td>{{ item.matchKey || '—' }}</td>
          <td>{{ item.heatmapCode ?? '—' }}</td>
          <td>{{ item.reportId ?? '—' }}</td>
          <td>{{ item.curve?.firstScreen ?? '—' }}</td>
          <td>{{ item.curve?.average ?? '—' }}</td>
          <td>{{ item.exposure ?? '—' }}</td>
          <td>{{ item.status }}</td>
          <td>{{ item.note }}</td>
        </tr>
        <tr v-if="!reviews.length">
          <td colspan="11" class="empty-state">暂无浏览深度复核数据，可先登记深度分析</td>
        </tr>
      </tbody>
    </table>

    <table class="data-table" data-table="scrollmap-entries">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无浏览深度数据，可先登记深度分析</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条浏览深度记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listScrollReviews,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, ScrollReviewItem } from '@/data/types'

const meta = moduleMeta('scrollmap')
const columns = ["分析编号", "页面名称", "设备类型", "首屏占比", "二屏占比", "三屏占比", "到达底部的占比", "平均浏览比例", "关键内容曝光率"]
const actions = ["发起分析", "发布报告", "归档报告"]
const statuses = ["草稿", "分析中", "已发布", "已归档"]
const stats = [{"label": "深度分析总数", "value": 0}, {"label": "已发布报告", "value": 0}, {"label": "分析中报告", "value": 0}]

const rows = ref<EntryRow[]>([])
const reviews = ref<ScrollReviewItem[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '深度分析登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reloadReviews() {
  errorMessage.value = ''
  try {
    reviews.value = listScrollReviews({
      page: filters.value['页面名称'] ?? '',
      device: filters.value['设备类型'] ?? '',
    })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '联合报告复核数据读取失败'
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reloadReviews()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '浏览深度列表读取失败'
  }
}

onMounted(reload)
</script>
