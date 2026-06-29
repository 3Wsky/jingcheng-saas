<template>
  <PageShell title="商家管理">
    <template #tabs>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="商家列表" name="list" />
        <el-tab-pane label="核销员排行" name="leaderboard" />
        <el-tab-pane label="手动核销" name="manual-verify" />
        <el-tab-pane label="开通商家" name="create" />
      </el-tabs>
    </template>

    <template v-if="activeTab === 'create'" #toolbar>
      <el-button type="primary" @click="handleCreate" :loading="creating">创建商家</el-button>
    </template>

    <!-- ============ 商家列表 ============ -->
    <template v-if="activeTab === 'list'">
      <el-row :gutter="12" class="overview-row" v-loading="overviewLoading">
        <el-col :xs="12" :sm="8" :md="6" v-for="card in overviewCards" :key="card.key">
          <StatCard :type="card.type" :icon="card.icon" :title="card.title" :value="card.value" />
        </el-col>
      </el-row>

      <div class="list-toolbar">
        <div class="toolbar-left">
          <el-input
            v-model="searchKeyword"
            placeholder="搜索名称/联系人/电话"
            clearable
            style="width: 220px"
            @keyup.enter="reloadList(1)"
            @clear="reloadList(1)"
          />
          <el-select v-model="filterCategory" placeholder="全部类目" clearable style="width: 130px" @change="reloadList(1)">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
          <el-select v-model="sortBy" style="width: 150px" @change="reloadList(1)">
            <el-option label="默认排序" value="id" />
            <el-option label="今日核销额" value="todayAmount" />
            <el-option label="本月核销额" value="monthAmount" />
            <el-option label="活跃核销员" value="staffActive" />
            <el-option label="绑定核销员" value="staffBound" />
            <el-option label="待结算金额" value="pending" />
            <el-option label="最近核销" value="lastVerify" />
          </el-select>
          <el-button :icon="sortOrder === 'desc' ? 'SortDown' : 'SortUp'" @click="toggleSortOrder">
            {{ sortOrder === 'desc' ? '降序' : '升序' }}
          </el-button>
          <el-button type="primary" @click="reloadList(1)">查询</el-button>
        </div>
        <div class="toolbar-right">
          <el-button @click="activeTab = 'create'">开通商家</el-button>
        </div>
      </div>

      <TableSkeleton v-if="loading && !list.length" :cols="8" />
      <el-table v-else :data="list" v-loading="loading && list.length > 0">
        <template #empty>
          <el-empty description="暂无商家">
            <el-button type="primary" @click="activeTab = 'create'">开通商家</el-button>
          </el-empty>
        </template>
        <el-table-column prop="id" label="ID" width="64" />
        <el-table-column prop="merchantName" label="名称" min-width="140" show-overflow-tooltip />
        <el-table-column prop="category" label="类目" width="90">
          <template #default="{ row }">{{ row.category || '—' }}</template>
        </el-table-column>
        <el-table-column label="核销员" width="110" align="center">
          <template #default="{ row }">
            <el-tooltip content="绑定核销员 / 本月活跃核销员" placement="top">
              <span class="staff-badge">
                <strong>{{ row.staffBound ?? 0 }}</strong>
                <span class="staff-sep">/</span>
                <span class="staff-active-num">{{ row.staffActive ?? 0 }}</span>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="今日核销" width="130" align="right">
          <template #default="{ row }">
            <span v-if="row.todayCount" class="amount-cell">
              ¥{{ fmtAmount(row.todayAmount) }}
              <span class="count-sub">{{ row.todayCount }}笔</span>
            </span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="本月核销额" width="120" align="right">
          <template #default="{ row }">
            <span :class="row.monthAmount ? 'amount-cell' : 'muted'">
              {{ row.monthAmount ? '¥' + fmtAmount(row.monthAmount) : '—' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="待结算" width="100" align="right">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="goSettlement(row)">
              ¥{{ fmtAmount(row.pendingSettlement) }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="最近核销" width="160">
          <template #default="{ row }">{{ fmtTs(row.lastVerifyAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">详情</el-button>
            <el-button link type="danger" @click="deactivate(row)">停用</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-if="listTotal > 0"
        v-model:current-page="listPage"
        :page-size="listPageSize"
        :total="listTotal"
        layout="total, prev, pager, next"
        class="list-pagination"
        @current-change="reloadList"
      />
    </template>

    <!-- ============ 核销员排行 ============ -->
    <template v-if="activeTab === 'leaderboard'">
      <div class="list-toolbar">
        <div class="toolbar-left">
          <el-radio-group v-model="lbPeriod" @change="loadLeaderboard">
            <el-radio-button value="day">今日</el-radio-button>
            <el-radio-button value="week">本周</el-radio-button>
            <el-radio-button value="month">本月</el-radio-button>
          </el-radio-group>
          <el-select
            v-model="lbMerchantId"
            placeholder="全部商家"
            clearable
            filterable
            style="width: 200px"
            @change="loadLeaderboard"
          >
            <el-option v-for="m in merchantOptions" :key="m.id" :label="m.merchantName" :value="m.id" />
          </el-select>
        </div>
        <div class="toolbar-right">
          <span class="lb-summary" v-if="leaderboard.length">
            合计 <strong>{{ lbTotalCount }}</strong> 笔 ·
            <strong class="amount-cell">¥{{ fmtAmount(lbTotalAmount) }}</strong>
          </span>
        </div>
      </div>
      <el-table :data="leaderboard" v-loading="lbLoading">
        <template #empty>
          <el-empty description="该周期暂无核销数据" />
        </template>
        <el-table-column label="排名" width="70" align="center">
          <template #default="{ row }">
            <span class="rank-badge" :class="'rank-' + (row.rank <= 3 ? row.rank : 'n')">{{ row.rank }}</span>
          </template>
        </el-table-column>
        <el-table-column label="核销员" min-width="140">
          <template #default="{ row }">
            <span class="staff-name">{{ row.operatorName }}</span>
            <span class="staff-uid">（{{ row.operatorUid }}）</span>
          </template>
        </el-table-column>
        <el-table-column prop="merchantName" label="所属商家" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.merchantName || '—' }}</template>
        </el-table-column>
        <el-table-column label="核销笔数" width="100" align="right">
          <template #default="{ row }">{{ row.verifyCount }}</template>
        </el-table-column>
        <el-table-column label="核销总额" width="130" align="right">
          <template #default="{ row }"><span class="amount-cell">¥{{ fmtAmount(row.totalAmount) }}</span></template>
        </el-table-column>
        <el-table-column label="最近核销" width="160">
          <template #default="{ row }">{{ fmtTs(row.lastVerifyAt) }}</template>
        </el-table-column>
      </el-table>
    </template>

    <!-- ============ 手动核销 ============ -->
    <template v-if="activeTab === 'manual-verify'">
      <div class="mv-wrap">
        <el-alert type="warning" :closable="false" show-icon class="mv-tip">
          <template #title>
            <span>应急手动核销：小程序无法核销时，管理员可在此代核销现金券。</span>
          </template>
          核销逻辑与小程序<strong>完全一致</strong>（扣客户现金券、记账到指定商家与核销员、计入待结算），操作会写入审计日志。请谨慎使用。
        </el-alert>

        <el-form :model="mvForm" label-width="110px" class="mv-form">
          <el-divider content-position="left">① 选择核销商家与核销员</el-divider>
          <el-form-item label="核销商家" required>
            <el-select
              v-model="mvForm.merchantId"
              placeholder="请选择商家"
              filterable
              style="width: 320px"
              @change="onMvMerchantChange"
            >
              <el-option v-for="m in mvMerchantOptions" :key="m.id" :label="m.merchantName" :value="m.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="核销员" required>
            <el-select
              v-model="mvForm.operatorUid"
              placeholder="请先选择商家"
              :disabled="!mvForm.merchantId"
              :loading="mvStaffLoading"
              style="width: 320px"
            >
              <el-option
                v-for="s in mvStaffList"
                :key="s.uid"
                :label="`${s.nickname}（UID:${s.uid}）${s.role === 'manager' ? ' · 店长' : ''}`"
                :value="s.uid"
              />
              <template #empty>
                <p class="mv-empty">该商家暂无核销员，请先在「会员管理 → 商家角色」开通</p>
              </template>
            </el-select>
          </el-form-item>

          <el-divider content-position="left">② 确认客户与金额</el-divider>
          <el-form-item label="客户 UID" required>
            <el-input
              v-model="mvForm.uid"
              placeholder="输入客户 UID"
              style="width: 220px"
              @keyup.enter="lookupCustomer"
            >
              <template #append>
                <el-button :loading="mvLookupLoading" @click="lookupCustomer">查询余额</el-button>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item v-if="mvCustomer" label="客户信息">
            <div class="mv-customer-card">
              <div class="mv-customer-row">
                <span class="mv-cust-name">{{ mvCustomer.nickname || '（无昵称）' }}</span>
                <span class="mv-cust-uid">UID {{ mvCustomer.uid }}</span>
                <span v-if="mvCustomer.phone" class="mv-cust-phone">{{ mvCustomer.phone }}</span>
              </div>
              <div class="mv-customer-row">
                <span class="mv-cust-label">现金券可用余额：</span>
                <span class="mv-balance" :class="{ 'mv-balance-low': mvCustomer.balance <= 0 }">
                  ¥{{ fmtAmount(mvCustomer.balance) }}
                </span>
                <span class="mv-cust-batch">（{{ mvCustomer.batchCount }} 个批次）</span>
              </div>
            </div>
          </el-form-item>

          <el-form-item label="核销金额" required>
            <el-input-number
              v-model="mvForm.amount"
              :min="0.01"
              :precision="2"
              :step="1"
              controls-position="right"
              style="width: 220px"
              placeholder="如 212.33"
            />
            <span class="mv-amount-hint">支持小数，如 212.33</span>
          </el-form-item>
          <el-form-item label="备注">
            <el-input
              v-model="mvForm.remark"
              type="textarea"
              :rows="2"
              maxlength="200"
              show-word-limit
              placeholder="可选，如：212.33 现金券小程序核销失败，后台补核销"
              style="width: 420px"
            />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="mvSubmitting" :disabled="!canSubmitMv" @click="submitManualVerify">
              确认核销
            </el-button>
            <el-button @click="resetMvForm">重置</el-button>
          </el-form-item>
        </el-form>
      </div>
    </template>

    <el-form v-else-if="activeTab === 'create'" :model="createForm" label-width="120px" style="max-width:600px">
      <el-alert type="info" :closable="false" show-icon class="create-tip">
        商家资料用于小程序「现金券 → 可核销商家」展示。人员权限请在<strong>会员管理 → 商家角色</strong>开通（用户需先登录小程序）。
      </el-alert>

      <el-divider content-position="left">基础信息</el-divider>
      <el-form-item label="商家名称"><el-input v-model="createForm.merchantName" /></el-form-item>
      <el-form-item label="类目"><el-input v-model="createForm.category" placeholder="如：数码、餐饮" /></el-form-item>
      <el-form-item label="联系人"><el-input v-model="createForm.contactName" /></el-form-item>
      <el-form-item label="联系电话"><el-input v-model="createForm.contactPhone" /></el-form-item>
      <el-form-item label="绑定UID">
        <el-input-number v-model="createForm.loginUid" :min="0" />
        <p class="field-hint">可选。也可稍后在会员详情开通「商家店长」自动绑定。</p>
      </el-form-item>
      <el-form-item label="核销权限"><el-switch v-model="createForm.canVerify" /></el-form-item>

      <el-divider content-position="left">门店资料</el-divider>
      <el-form-item label="门头照">
        <ImageListInput v-model="createStoreImages" :max="6" />
        <p class="field-hint">上传门店门头照片，最多 6 张</p>
      </el-form-item>
      <el-form-item label="省"><el-input v-model="createForm.province" placeholder="如：新疆维吾尔自治区" /></el-form-item>
      <el-form-item label="市"><el-input v-model="createForm.city" placeholder="如：乌鲁木齐市" /></el-form-item>
      <el-form-item label="区"><el-input v-model="createForm.district" placeholder="如：天山区" /></el-form-item>
      <el-form-item label="详细地址"><el-input v-model="createForm.storeAddress" type="textarea" :rows="2" placeholder="街道门牌号等详细地址" /></el-form-item>
      <el-form-item label="经纬度">
        <el-input-number v-model="createForm.latitude" :precision="6" :step="0.0001" controls-position="right" style="width: 140px" placeholder="纬度" />
        <span class="coord-sep">,</span>
        <el-input-number v-model="createForm.longitude" :precision="6" :step="0.0001" controls-position="right" style="width: 140px" placeholder="经度" />
        <p class="field-hint">可选。用于小程序门店定位导航</p>
      </el-form-item>
      <el-form-item label="营业时间">
        <BusinessHoursEditor v-model="createForm.businessHours" />
        <p class="field-hint">支持跨夜（如 13:00-次日01:30）与多时段（周一至四 / 周五至日）</p>
      </el-form-item>
    </el-form>
  </PageShell>

  <el-drawer v-model="editOpen" title="商家详情" size="640px">
    <el-tabs v-model="editTab">
      <el-tab-pane label="门店资料" name="base">
        <el-form :model="editForm" label-width="100px">
          <el-divider content-position="left">基础信息</el-divider>
          <el-form-item label="名称"><el-input v-model="editForm.merchantName" /></el-form-item>
          <el-form-item label="类目"><el-input v-model="editForm.category" /></el-form-item>
          <el-form-item label="联系人"><el-input v-model="editForm.contactName" /></el-form-item>
          <el-form-item label="电话"><el-input v-model="editForm.contactPhone" /></el-form-item>
          <el-form-item label="绑定UID"><el-input-number v-model="editForm.loginUid" :min="1" disabled /></el-form-item>

          <el-divider content-position="left">门店资料</el-divider>
          <el-form-item label="省"><el-input v-model="editForm.province" placeholder="如：广东省" /></el-form-item>
          <el-form-item label="市"><el-input v-model="editForm.city" placeholder="如：深圳市" /></el-form-item>
          <el-form-item label="区"><el-input v-model="editForm.district" placeholder="如：南山区" /></el-form-item>
          <el-form-item label="详细地址"><el-input v-model="editForm.storeAddress" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="经纬度">
            <el-input-number v-model="editForm.latitude" :precision="6" :step="0.0001" controls-position="right" style="width: 140px" />
            <span class="coord-sep">,</span>
            <el-input-number v-model="editForm.longitude" :precision="6" :step="0.0001" controls-position="right" style="width: 140px" />
          </el-form-item>
          <el-form-item label="门头图">
            <ImageListInput v-model="storeImages" :max="6" />
          </el-form-item>
          <el-form-item label="营业时间">
            <BusinessHoursEditor v-model="editForm.businessHours" />
            <p class="field-hint">支持跨夜（如 13:00-次日01:30）与多时段（周一至四 / 周五至日）</p>
          </el-form-item>

          <el-divider content-position="left">权限与结算</el-divider>
          <el-form-item label="核销权限"><el-switch v-model="editForm.canVerify" /></el-form-item>
          <el-form-item label="结算备注"><el-input v-model="editForm.settlementNote" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="待结算">¥{{ editForm.pendingSettlement ?? 0 }}</el-form-item>

          <el-button type="primary" @click="saveMerchant">保存</el-button>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="核销员统计" name="staff-stats">
        <div class="stats-toolbar">
          <el-radio-group v-model="statsPeriod" size="small" @change="loadStaffStats">
            <el-radio-button value="day">按日</el-radio-button>
            <el-radio-button value="week">按周</el-radio-button>
            <el-radio-button value="month">按月</el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-model="statsDateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始"
            end-placeholder="结束"
            style="width: 240px; margin-left: 12px"
            @change="loadStaffStats"
          />
        </div>
        <el-table :data="staffStats" size="small" v-loading="statsLoading" show-summary :summary-method="statsSummary">
          <template #empty>
            <el-empty description="暂无核销数据" />
          </template>
          <el-table-column prop="operatorName" label="核销员" min-width="100">
            <template #default="{ row }">
              <span class="staff-name">{{ row.operatorName }}</span>
              <span class="staff-uid">（{{ row.operatorUid }}）</span>
            </template>
          </el-table-column>
          <el-table-column prop="totalCount" label="核销笔数" width="100" align="right" />
          <el-table-column prop="totalAmount" label="核销总额" width="120" align="right">
            <template #default="{ row }">¥{{ row.totalAmount.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="各期明细" min-width="200">
            <template #default="{ row }">
              <div class="period-chips">
                <el-tag
                  v-for="d in row.details"
                  :key="d.period"
                  size="small"
                  type="info"
                  class="period-chip"
                >
                  {{ d.period }}：{{ d.count }}笔 ¥{{ d.amount.toFixed(2) }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="核销明细" name="logs">
        <el-form :inline="true" class="log-filter" @submit.prevent="loadVerifyLogs(1)">
          <el-form-item label="日期">
            <el-date-picker
              v-model="logDateRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="开始"
              end-placeholder="结束"
              style="width: 240px"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="loadVerifyLogs(1)">查询</el-button>
            <el-button @click="resetLogFilter">重置</el-button>
          </el-form-item>
        </el-form>
        <el-table :data="verifyLogs" size="small" v-loading="logsLoading">
          <template #empty>
            <el-empty description="暂无核销记录" />
          </template>
          <el-table-column prop="createdAt" label="时间" width="160">
            <template #default="{ row }">{{ fmtTs(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="customerUid" label="客户 UID" width="100">
            <template #default="{ row }">
              <UidLink :uid="row.customerUid" @click="openMember" />
            </template>
          </el-table-column>
          <el-table-column prop="amount" label="核销金额" width="100">
            <template #default="{ row }">¥{{ row.amount }}</template>
          </el-table-column>
          <el-table-column prop="operatorUid" label="操作人" width="90">
            <template #default="{ row }">{{ row.operatorUid || '—' }}</template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
          <el-table-column label="结算" width="90">
            <template #default>待结算</template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-if="logTotal > 0"
          v-model:current-page="logPage"
          :page-size="logPageSize"
          :total="logTotal"
          layout="total, prev, pager, next"
          class="log-pagination"
          @current-change="loadVerifyLogs"
        />
      </el-tab-pane>
    </el-tabs>
  </el-drawer>

  <MemberDetailDrawer v-model="memberDrawerOpen" :uid="memberUid" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import StatCard from '@/components/StatCard.vue'
import ImageListInput from '@/components/ImageListInput.vue'
import BusinessHoursEditor from '@/components/BusinessHoursEditor.vue'
import UidLink from '@/components/UidLink.vue'
import MemberDetailDrawer from '@/views/members/components/MemberDetailDrawer.vue'
import { useMemberDrawer } from '@/composables/useMemberDrawer'

const router = useRouter()
const { memberDrawerOpen, memberUid, openMember } = useMemberDrawer()
const activeTab = ref('list')
const loading = ref(false)
const list = ref<any[]>([])
const listPage = ref(1)
const listPageSize = 20
const listTotal = ref(0)
const searchKeyword = ref('')
const filterCategory = ref('')
const sortBy = ref('id')
const sortOrder = ref<'asc' | 'desc'>('desc')
const categories = ref<string[]>([])

const overviewLoading = ref(false)
const overview = ref<Record<string, number>>({})
const overviewCards = computed(() => [
  { key: 'merchant', type: 'member', icon: 'Shop', title: '商家总数', value: overview.value.merchantCount ?? 0 },
  { key: 'staff', type: 'approval', icon: 'Avatar', title: '核销员总数', value: overview.value.staffCount ?? 0 },
  { key: 'todayCount', type: 'verify', icon: 'Checked', title: '今日核销笔数', value: overview.value.todayCount ?? 0 },
  { key: 'todayAmount', type: 'grant', icon: 'Money', title: '今日核销金额', value: '¥' + fmtAmount(overview.value.todayAmount) },
  { key: 'monthAmount', type: 'newuser', icon: 'TrendCharts', title: '本月核销金额', value: '¥' + fmtAmount(overview.value.monthAmount) },
  { key: 'pending', type: 'consume', icon: 'Wallet', title: '待结算总额', value: '¥' + fmtAmount(overview.value.pendingTotal) },
])

const lbPeriod = ref<'day' | 'week' | 'month'>('day')
const lbMerchantId = ref<number | undefined>(undefined)
const leaderboard = ref<any[]>([])
const lbLoading = ref(false)
const lbTotalCount = ref(0)
const lbTotalAmount = ref(0)
const merchantOptions = ref<{ id: number; merchantName: string }[]>([])

// ===== 手动核销 =====
const mvMerchantOptions = ref<{ id: number; merchantName: string }[]>([])
const mvStaffList = ref<{ uid: number; role: string; nickname: string; phone: string }[]>([])
const mvStaffLoading = ref(false)
const mvLookupLoading = ref(false)
const mvSubmitting = ref(false)
const mvCustomer = ref<{ uid: number; nickname: string; phone: string; balance: number; batchCount: number } | null>(null)
const mvForm = ref<{ merchantId: number | undefined; operatorUid: number | undefined; uid: string; amount: number | undefined; remark: string }>({
  merchantId: undefined,
  operatorUid: undefined,
  uid: '',
  amount: undefined,
  remark: ''
})
const canSubmitMv = computed(() =>
  !!mvForm.value.merchantId &&
  !!mvForm.value.operatorUid &&
  Number(mvForm.value.uid) > 0 &&
  Number(mvForm.value.amount) > 0
)

const creating = ref(false)
const createForm = ref({
  merchantName: '', category: '', contactName: '', contactPhone: '', loginUid: 0, canVerify: true,
  storeAddress: '', province: '', city: '', district: '', latitude: 0, longitude: 0, businessHours: ''
})
const createStoreImages = ref<string[]>([''])
const editOpen = ref(false)
const editTab = ref('base')
const editForm = ref<any>({})
const storeImages = ref<string[]>([''])
const verifyLogs = ref<any[]>([])
const logsLoading = ref(false)
const logPage = ref(1)
const logPageSize = 20
const logTotal = ref(0)
const logDateRange = ref<[string, string] | null>(null)
const canVerifyOriginal = ref(true)
const staffStats = ref<any[]>([])
const statsLoading = ref(false)
const statsPeriod = ref<'day' | 'week' | 'month'>('day')
const statsDateRange = ref<[string, string] | null>(null)

onMounted(() => {
  loadList()
  loadOverview()
})

async function loadOverview() {
  overviewLoading.value = true
  try {
    const data = await request.get('/api/admin/merchant/overview')
    overview.value = data || {}
    categories.value = data?.categories || []
  } catch {
    overview.value = {}
  } finally {
    overviewLoading.value = false
  }
}

async function loadList() {
  loading.value = true
  try {
    const params: Record<string, unknown> = {
      page: listPage.value,
      pageSize: listPageSize,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value
    }
    if (searchKeyword.value.trim()) params.keyword = searchKeyword.value.trim()
    if (filterCategory.value) params.category = filterCategory.value
    const data = await request.get('/api/admin/merchant/list', { params })
    list.value = data?.list || []
    listTotal.value = data?.total || 0
  } catch { list.value = []; listTotal.value = 0 }
  finally { loading.value = false }
}

function reloadList(page = 1) {
  listPage.value = page
  loadList()
}

function toggleSortOrder() {
  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  reloadList(1)
}

async function loadMerchantOptions() {
  if (merchantOptions.value.length) return
  try {
    const data = await request.get('/api/admin/merchant/list', { params: { page: 1, pageSize: 100, sortBy: 'monthAmount' } })
    merchantOptions.value = (data?.list || []).map((m: any) => ({ id: m.id, merchantName: m.merchantName }))
  } catch {
    merchantOptions.value = []
  }
}

async function loadLeaderboard() {
  lbLoading.value = true
  try {
    const params: Record<string, unknown> = { period: lbPeriod.value, limit: 100 }
    if (lbMerchantId.value) params.merchantId = lbMerchantId.value
    const data = await request.get('/api/admin/merchant/staff-leaderboard', { params })
    leaderboard.value = data?.list || []
    lbTotalCount.value = data?.totalCount || 0
    lbTotalAmount.value = data?.totalAmount || 0
  } catch {
    leaderboard.value = []
    lbTotalCount.value = 0
    lbTotalAmount.value = 0
  } finally {
    lbLoading.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'leaderboard') {
    loadMerchantOptions()
    if (!leaderboard.value.length) loadLeaderboard()
  }
  if (tab === 'manual-verify' && !mvMerchantOptions.value.length) {
    loadMvMerchantOptions()
  }
})

async function loadMvMerchantOptions() {
  try {
    const data = await request.get('/api/admin/merchant/list', { params: { page: 1, pageSize: 100, sortBy: 'id', sortOrder: 'asc' } })
    mvMerchantOptions.value = (data?.list || [])
      .filter((m: any) => m.canVerify)
      .map((m: any) => ({ id: m.id, merchantName: m.merchantName }))
  } catch {
    mvMerchantOptions.value = []
  }
}

async function onMvMerchantChange() {
  mvForm.value.operatorUid = undefined
  mvStaffList.value = []
  if (!mvForm.value.merchantId) return
  mvStaffLoading.value = true
  try {
    const data = await request.get(`/api/admin/merchant/${mvForm.value.merchantId}/verify-staff`)
    mvStaffList.value = data?.list || []
    if (mvStaffList.value.length === 1) {
      mvForm.value.operatorUid = mvStaffList.value[0].uid
    }
  } catch {
    mvStaffList.value = []
  } finally {
    mvStaffLoading.value = false
  }
}

async function lookupCustomer() {
  const uid = Number(mvForm.value.uid)
  if (!uid || uid <= 0) {
    ElMessage.warning('请输入有效的客户 UID')
    return
  }
  mvLookupLoading.value = true
  mvCustomer.value = null
  try {
    mvCustomer.value = await request.get('/api/admin/cash-voucher/lookup', { params: { uid } })
  } catch {
    mvCustomer.value = null
  } finally {
    mvLookupLoading.value = false
  }
}

function resetMvForm() {
  mvForm.value = { merchantId: undefined, operatorUid: undefined, uid: '', amount: undefined, remark: '' }
  mvStaffList.value = []
  mvCustomer.value = null
}

async function submitManualVerify() {
  if (!canSubmitMv.value) return
  const uid = Number(mvForm.value.uid)
  const amount = Number(mvForm.value.amount)
  const merchant = mvMerchantOptions.value.find((m) => m.id === mvForm.value.merchantId)
  const staff = mvStaffList.value.find((s) => s.uid === mvForm.value.operatorUid)

  // 核销前确认余额（若未查询过则先查）
  if (!mvCustomer.value || mvCustomer.value.uid !== uid) {
    await lookupCustomer()
    if (!mvCustomer.value) return
  }
  if (mvCustomer.value.balance + 0.001 < amount) {
    ElMessage.error(`客户余额不足：可用 ¥${fmtAmount(mvCustomer.value.balance)}，需核销 ¥${fmtAmount(amount)}`)
    return
  }

  try {
    await ElMessageBox.confirm(
      `<div style="line-height:1.9">
        <div>客户：<b>${mvCustomer.value.nickname || '（无昵称）'}</b>（UID ${uid}）</div>
        <div>核销金额：<b style="color:#ed7b2f">¥${fmtAmount(amount)}</b></div>
        <div>归属商家：<b>${merchant?.merchantName || ''}</b></div>
        <div>核销员：<b>${staff?.nickname || ''}</b>（UID ${mvForm.value.operatorUid}）</div>
        <div style="margin-top:6px;color:#909399">核销后客户余额：¥${fmtAmount(mvCustomer.value.balance - amount)}</div>
      </div>`,
      '确认手动核销',
      { confirmButtonText: '确认核销', cancelButtonText: '取消', dangerouslyUseHTMLString: true, type: 'warning' }
    )
  } catch {
    return
  }

  mvSubmitting.value = true
  try {
    const result = await request.post('/api/admin/cash-voucher/manual-verify', {
      uid,
      amount,
      merchantId: mvForm.value.merchantId,
      operatorUid: mvForm.value.operatorUid,
      remark: mvForm.value.remark.trim()
    })
    ElMessage.success(`核销成功，客户余额 ¥${fmtAmount(result?.balanceAfter)}`)
    resetMvForm()
    loadOverview()
  } catch {
    /* handled by interceptor */
  } finally {
    mvSubmitting.value = false
  }
}

async function handleCreate() {
  creating.value = true
  try {
    const payload = {
      ...createForm.value,
      storeImages: createStoreImages.value.filter(Boolean)
    }
    await request.post('/api/admin/merchant/create', payload)
    ElMessage.success('创建成功')
    createForm.value = {
      merchantName: '', category: '', contactName: '', contactPhone: '', loginUid: 0, canVerify: true,
      storeAddress: '', province: '', city: '', district: '', latitude: 0, longitude: 0, businessHours: ''
    }
    createStoreImages.value = ['']
    activeTab.value = 'list'
    loadList()
  } catch { /* handled */ }
  finally { creating.value = false }
}

async function openEdit(row: any) {
  editOpen.value = true
  editTab.value = 'base'
  try {
    editForm.value = await request.get(`/api/admin/merchant/${row.id}`)
  } catch {
    editForm.value = { ...row }
  }
  storeImages.value = editForm.value.storeImages?.length ? [...editForm.value.storeImages] : ['']
  canVerifyOriginal.value = Boolean(editForm.value.canVerify)
  logPage.value = 1
  logDateRange.value = null
  statsDateRange.value = null
  statsPeriod.value = 'day'
  await Promise.all([loadVerifyLogs(1), loadStaffStats()])
}

async function loadStaffStats() {
  if (!editForm.value?.id) return
  statsLoading.value = true
  try {
    const params: Record<string, unknown> = { period: statsPeriod.value }
    if (statsDateRange.value?.[0]) params.dateFrom = statsDateRange.value[0]
    if (statsDateRange.value?.[1]) params.dateTo = statsDateRange.value[1]
    const data = await request.get(`/api/admin/merchant/${editForm.value.id}/staff-verify-stats`, { params })
    staffStats.value = data?.staff || []
  } catch {
    staffStats.value = []
  } finally {
    statsLoading.value = false
  }
}

function statsSummary({ columns, data }: { columns: any[]; data: any[] }) {
  return columns.map((_: any, idx: number) => {
    if (idx === 0) return '合计'
    if (idx === 1) return data.reduce((sum, r) => sum + (r.totalCount || 0), 0)
    if (idx === 2) return '¥' + data.reduce((sum, r) => sum + (r.totalAmount || 0), 0).toFixed(2)
    return ''
  })
}

async function loadVerifyLogs(page = logPage.value) {
  if (!editForm.value?.id) return
  logPage.value = page
  logsLoading.value = true
  try {
    const params: Record<string, unknown> = { page, pageSize: logPageSize }
    if (logDateRange.value?.[0]) params.dateFrom = logDateRange.value[0]
    if (logDateRange.value?.[1]) params.dateTo = logDateRange.value[1]
    const data = await request.get(`/api/admin/merchant/${editForm.value.id}/verify-logs`, { params })
    verifyLogs.value = data?.list || []
    logTotal.value = data?.total || 0
  } catch {
    verifyLogs.value = []
    logTotal.value = 0
  } finally {
    logsLoading.value = false
  }
}

function resetLogFilter() {
  logDateRange.value = null
  loadVerifyLogs(1)
}

watch(editTab, (tab) => {
  if (tab === 'logs' && editForm.value?.id) loadVerifyLogs(1)
  if (tab === 'staff-stats' && editForm.value?.id) loadStaffStats()
})

async function saveMerchant() {
  if (canVerifyOriginal.value && editForm.value.canVerify === false) {
    try {
      const { value } = await ElMessageBox.prompt(
        '关闭核销权限为危险操作，请输入「确认撤销」以继续',
        '确认关闭核销',
        {
          confirmButtonText: '确认',
          cancelButtonText: '取消',
          inputPattern: /^确认撤销$/,
          inputErrorMessage: '请输入「确认撤销」'
        }
      )
      if (value !== '确认撤销') return
    } catch {
      editForm.value.canVerify = true
      return
    }
  }
  try {
    const payload = {
      ...editForm.value,
      storeImages: storeImages.value.filter(Boolean)
    }
    await request.put(`/api/admin/merchant/${editForm.value.id}`, payload)
    ElMessage.success('已保存')
    editOpen.value = false
    loadList()
  } catch { /* handled */ }
}

function goSettlement(row: any) {
  router.push({
    path: '/finance-settlement',
    query: { merchantId: String(row.id), merchantName: row.merchantName || '' }
  })
}

async function deactivate(row: any) {
  try {
    const { value } = await ElMessageBox.prompt(
      `停用商家「${row.merchantName}」后不可核销，请输入「确认撤销」以继续`,
      '停用商家',
      {
        confirmButtonText: '确认停用',
        cancelButtonText: '取消',
        inputPattern: /^确认撤销$/,
        inputErrorMessage: '请输入「确认撤销」'
      }
    )
    if (value !== '确认撤销') return
    await request.patch(`/api/admin/merchant/${row.id}/deactivate`)
    ElMessage.success('商家已停用')
    loadList()
  } catch {
    /* cancel or error */
  }
}

function fmtTs(val?: number) {
  return val ? new Date(val * 1000).toLocaleString('zh-CN') : '—'
}

function fmtAmount(val?: number) {
  const n = Number(val || 0)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<style scoped>
.create-tip { margin-bottom: 16px; }
.coord-sep { margin: 0 8px; color: #9CA3AF; }

/* 手动核销 */
.mv-wrap { max-width: 640px; }
.mv-tip { margin-bottom: 20px; }
.mv-form { margin-top: 8px; }
.mv-empty { padding: 8px 0; color: #909399; font-size: 13px; text-align: center; }
.mv-amount-hint { margin-left: 10px; font-size: 12px; color: #9CA3AF; }
.mv-customer-card {
  background: #f7f9fc;
  border: 1px solid #e6ebf2;
  border-radius: 10px;
  padding: 12px 16px;
  width: 420px;
}
.mv-customer-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; line-height: 1.9; }
.mv-cust-name { font-weight: 600; font-size: 15px; color: #1f2733; }
.mv-cust-uid { font-size: 12px; color: #909399; background: #eef1f6; padding: 1px 8px; border-radius: 4px; }
.mv-cust-phone { font-size: 13px; color: #606266; }
.mv-cust-label { font-size: 13px; color: #606266; }
.mv-cust-batch { font-size: 12px; color: #909399; }
.mv-balance { font-size: 18px; font-weight: 700; color: var(--gov-success, #00a870); font-variant-numeric: tabular-nums; }
.mv-balance-low { color: #f56c6c; }
.field-hint { margin: 4px 0 0; font-size: 12px; color: #9CA3AF; line-height: 1.4; }
.stats-toolbar { display: flex; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.staff-name { font-weight: 600; }
.staff-uid { color: #909399; font-size: 12px; }
.period-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.period-chip { font-size: 11px; }
.log-filter { margin-bottom: 12px; }
.log-pagination { margin-top: 12px; justify-content: flex-end; }
.time-range-picker { display: flex; align-items: center; gap: 4px; }
.time-sep { color: #606266; font-size: 13px; padding: 0 4px; }

.overview-row { margin-bottom: 8px; }
.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.list-toolbar .toolbar-left,
.list-toolbar .toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.list-pagination { margin-top: 12px; justify-content: flex-end; }

.staff-badge { font-size: 13px; }
.staff-badge strong { color: var(--gov-primary, #0052D9); }
.staff-sep { margin: 0 3px; color: #c0c4cc; }
.staff-active-num { color: var(--gov-success, #00a870); font-weight: 600; }

.amount-cell { color: var(--gov-warning, #ed7b2f); font-weight: 600; font-variant-numeric: tabular-nums; }
.count-sub { color: #909399; font-size: 11px; font-weight: 400; margin-left: 4px; }
.muted { color: #c0c4cc; }

.lb-summary { font-size: 13px; color: var(--gov-text-secondary); }
.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  background: #f0f2f5;
  color: #909399;
}
.rank-badge.rank-1 { background: #fff3e0; color: #f59e0b; }
.rank-badge.rank-2 { background: #f0f4f8; color: #94a3b8; }
.rank-badge.rank-3 { background: #fdf0e6; color: #cd7f32; }
</style>
