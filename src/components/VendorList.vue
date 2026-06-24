<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Vendor } from '../types';
import AddVendorModal from './AddVendorModal.vue';

const vendors = ref<Vendor[]>([]);
const showAddModal = ref(false);
const editingVendor = ref<Vendor | null>(null);
const activeVendorId = ref<string | null>(null);

const emit = defineEmits<{
  refresh: [];
}>();

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
  emit('refresh');
}

async function handleDelete(id: string) {
  await invoke('delete_vendor', { id });
  await loadVendors();
  emit('refresh');
}

async function toggleEnabled(vendor: Vendor) {
  vendor.enabled = !vendor.enabled;
  await invoke('update_vendor', { vendor });
}

async function setActive(id: string | null) {
  await invoke('set_active_vendor', { id });
  activeVendorId.value = id;
  emit('refresh');
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
          <span :class="['vendor-badge', v.provider]">{{ v.provider }}</span>
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
  color: #999;
}

.empty-text {
  font-size: 14px;
  margin: 0 0 4px;
}

.empty-hint {
  font-size: 12px;
  margin: 0 0 16px;
  color: #bbb;
}

.add-btn {
  padding: 8px 24px;
  background: #333;
  color: white;
  border: none;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
}

.vendor-card {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.vendor-card:hover {
  border-color: #ccc;
}
.vendor-card.active {
  border-color: #4a90d9;
  background: #f0f6ff;
}

.vendor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vendor-name {
  font-size: 13px;
  font-weight: 500;
}

.vendor-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
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
  font-size: 11px;
  color: #999;
  margin-top: 4px;
}

.vendor-actions {
  display: flex;
  gap: 4px;
  margin-top: 8px;
}

.action-btn {
  padding: 3px 10px;
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  color: #666;
}
.action-btn:hover {
  background: #eee;
}
.action-btn.danger {
  color: #d44;
}
.action-btn.danger:hover {
  background: #fef0f0;
}
</style>
