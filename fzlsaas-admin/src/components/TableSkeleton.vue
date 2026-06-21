<template>
  <div class="table-skeleton" :style="{ minHeight: `${rows * 48 + 40}px` }">
    <div class="table-skeleton-header">
      <el-skeleton-item v-for="c in cols" :key="c" variant="text" :style="{ flex: c === cols ? '1.5' : '1' }" />
    </div>
    <div v-for="r in rows" :key="r" class="table-skeleton-row">
      <el-skeleton animated>
        <template #template>
          <div class="sk-row">
            <el-skeleton-item v-for="c in cols" :key="c" variant="text" :style="{ flex: c === cols ? '1.5' : '1' }" />
          </div>
        </template>
      </el-skeleton>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ rows?: number; cols?: number }>(), {
  rows: 8,
  cols: 5
})
</script>

<style scoped>
.table-skeleton {
  padding: 8px 0;
  background: #fff;
  border-radius: 8px;
}
.table-skeleton-header,
.sk-row {
  display: flex;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
}
.table-skeleton-row:last-child .sk-row {
  border-bottom: none;
}
</style>
