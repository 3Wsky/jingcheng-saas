import { ref } from 'vue'

/** 表格 UID 点击打开会员详情抽屉 */
export function useMemberDrawer() {
  const memberDrawerOpen = ref(false)
  const memberUid = ref<number | null>(null)

  function openMember(uid?: number | null) {
    if (!uid) return
    memberUid.value = uid
    memberDrawerOpen.value = true
  }

  return { memberDrawerOpen, memberUid, openMember }
}
