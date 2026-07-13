<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Vendor } from '../types';
import AddVendorModal from './AddVendorModal.vue';

const vendors = ref<Vendor[]>([]);
const showAddModal = ref(false);
const editingVendor = ref<Vendor | null>(null);
const activeVendorId = ref<string | null>(null);

onMounted(async () => {
  await loadVendors();
});

async function loadVendors() {
  vendors.value = await invoke<Vendor[]>('get_vendors');
  try {
    const store = await invoke<{ active_vendor_id: string | null }>('get_ai_settings_all');
    activeVendorId.value = store.active_vendor_id;
  } catch {
    // ignore
  }
}

function openAdd() {
  editingVendor.value = null;
  showAddModal.value = true;
}

function openEdit(vendor: Vendor) {
  editingVendor.value = { ...vendor };
  showAddModal.value = true;
}

async function handleSave(vendor: Vendor) {
  if (editingVendor.value) {
    await invoke('update_vendor', { vendor });
  } else {
    await invoke<Vendor>('add_vendor', { vendor });
  }
  showAddModal.value = false;
  await loadVendors();
}

async function handleDelete(id: string) {
  await invoke('delete_vendor', { id });
  await loadVendors();
}

async function toggleEnabled(vendor: Vendor) {
  vendor.enabled = !vendor.enabled;
  await invoke('update_vendor', { vendor });
}

async function setActive(id: string | null) {
  // 点击已激活的供应商 → 取消选中
  const newId = activeVendorId.value === id ? null : id;
  await invoke('set_active_vendor', { id: newId });
  activeVendorId.value = newId;
}
</script>

<template>
  <div class="vendor-panel">
    <div v-if="vendors.length === 0" class="vendor-empty">
      <p class="empty-text">暂无供应商</p>
      <p class="empty-hint">添加供应商后在这里编辑配置</p>
      <button class="add-btn" @click="openAdd">+ 添加</button>
    </div>

    <div v-else class="vendor-list">
      <div
        v-for="v in vendors"
        :key="v.id"
        :class="['vendor-card', { active: activeVendorId === v.id }]"
        @click="setActive(v.id)"
      >
        <div class="vendor-header">
          <span class="vendor-name">{{ v.name }}</span>
          <div class="vendor-header-right">
            <span v-if="activeVendorId === v.id" class="vendor-active-tag">已选择</span>
            <span :class="['vendor-badge', v.provider]">{{ v.provider }}</span>
          </div>
        </div>
        <div class="vendor-model">{{ v.model }}</div>
        <div class="vendor-actions">
          <button class="action-btn" @click.stop="toggleEnabled(v)">
            {{ v.enabled ? '禁用' : '启用' }}
          </button>
          <button class="action-btn" @click.stop="openEdit(v)">编辑</button>
          <button class="action-btn danger" @click.stop="handleDelete(v.id)">删除</button>
        </div>
      </div>
      <button class="add-btn" @click="openAdd">+ 添加</button>
    </div>

    <AddVendorModal
      v-if="showAddModal"
      :vendor="editingVendor"
      @save="handleSave"
      @close="showAddModal = false"
    />
  </div>
</template>

<style scoped>
.vendor-panel {
  flex: 1;
  overflow-y: auto;
}

.vendor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-muted);
}

.empty-text {
  font-size: var(--text-sm);
  margin: 0 0 var(--space-xs);
}

.empty-hint {
  font-size: var(--text-sm);
  margin: 0 0 var(--space-lg);
  color: var(--text-disabled);
}

.add-btn {
  padding: var(--space-sm) var(--space-2xl);
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-full);
  font-size: var(--text-base);
  cursor: pointer;
  transition: opacity var(--transition-fast);
}

.add-btn:hover {
  opacity: 0.85;
}

.vendor-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-md);
  margin-bottom: var(--space-sm);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.vendor-card:hover {
  border-color: var(--gray-400);
}
.vendor-card.active {
  border-color: var(--accent);
  background: var(--accent-glow-s);
  box-shadow: 0 0 8px var(--accent-glow);
}

.vendor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vendor-header-right {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.vendor-active-tag {
  font-size: 10px;
  color: var(--accent);
  border: 1px solid var(--accent);
  padding: 0 6px;
  border-radius: var(--radius-sm);
  font-weight: 500;
  letter-spacing: 1px;
}

.vendor-name {
  font-size: var(--text-base);
  font-weight: 500;
}

.vendor-badge {
  font-size: var(--text-xs);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
}
.vendor-badge.openai {
  background: #e8f5e9;
  color: #2e7d32;
}
.vendor-badge.google {
  background: #e3f2fd;
  color: #1565c0;
}
.vendor-badge.claude {
  background: #fce4ec;
  color: #c62828;
}

.vendor-model {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: var(--space-xs);
}

.vendor-actions {
  display: flex;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}

.action-btn {
  padding: 3px var(--space-sm);
  background: var(--bg-hover);
  border: 1px solid var(--gray-300);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  cursor: pointer;
  color: var(--gray-700);
}
.action-btn:hover {
  background: var(--border-subtle);
}
.action-btn.danger {
  color: var(--danger);
}
.action-btn.danger:hover {
  background: var(--danger-light);
}
</style>
