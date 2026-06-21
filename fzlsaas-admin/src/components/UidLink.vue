<template>
  <el-button link type="primary" :disabled="!uid" @click="uid && $emit('click', uid)">
    {{ label ?? `UID ${uid}` }}
  </el-button>
</template>

<script setup lang="ts">
defineProps<{ uid?: number | null; label?: string }>()
defineEmits<{ click: [uid: number] }>()
</script>
