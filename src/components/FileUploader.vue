<script setup>
import { ref, computed } from 'vue'
import { parseExcelFile, detectFileType, validateColumns } from '../lib/excelParser'

const emit = defineEmits(['filesLoaded'])

// State voor de drie bestanden
const files = ref({
  producten: { file: null, data: null, status: 'waiting', error: null },
  componenten: { file: null, data: null, status: 'waiting', error: null },
  joins: { file: null, data: null, status: 'waiting', error: null }
})

// Drag state
const isDragging = ref(false)

// Check of alle bestanden geladen zijn
const allFilesLoaded = computed(() => {
  return files.value.producten.status === 'loaded' &&
         files.value.componenten.status === 'loaded' &&
         files.value.joins.status === 'loaded'
})

// Verwerk een bestand
async function processFile(file) {
  try {
    const data = await parseExcelFile(file)
    const type = detectFileType(data)

    if (!type) {
      return { success: false, error: 'Onbekend bestandstype. Controleer of het juiste bestand is.' }
    }

    const validation = validateColumns(data, type)
    if (!validation.valid) {
      return { success: false, error: `Ontbrekende kolommen: ${validation.missing.join(', ')}` }
    }

    return { success: true, type, data }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// Handle file input change
async function handleFileSelect(event) {
  const selectedFiles = Array.from(event.target.files || [])
  await processFiles(selectedFiles)
  event.target.value = '' // Reset input
}

// Handle drop
async function handleDrop(event) {
  event.preventDefault()
  isDragging.value = false
  const droppedFiles = Array.from(event.dataTransfer.files)
  await processFiles(droppedFiles)
}

// Verwerk meerdere bestanden
async function processFiles(fileList) {
  for (const file of fileList) {
    if (!file.name.endsWith('.xlsx')) {
      continue
    }

    const result = await processFile(file)

    if (result.success) {
      files.value[result.type] = {
        file: file,
        data: result.data,
        status: 'loaded',
        error: null
      }
    }
  }

  // Emit als alle bestanden geladen zijn
  if (allFilesLoaded.value) {
    emit('filesLoaded', {
      producten: files.value.producten.data,
      componenten: files.value.componenten.data,
      joins: files.value.joins.data
    })
  }
}

// Drag handlers
function handleDragOver(event) {
  event.preventDefault()
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

// Verwijder een bestand
function removeFile(type) {
  files.value[type] = { file: null, data: null, status: 'waiting', error: null }
}

// Status icon
function getStatusIcon(status) {
  switch (status) {
    case 'loaded': return '✓'
    case 'error': return '✗'
    default: return '○'
  }
}

// Status kleur
function getStatusClass(status) {
  switch (status) {
    case 'loaded': return 'text-green-600 bg-green-50'
    case 'error': return 'text-red-600 bg-red-50'
    default: return 'text-gray-400 bg-gray-50'
  }
}
</script>

<template>
  <div class="w-full max-w-2xl mx-auto">
    <!-- Drop zone -->
    <div
      @drop="handleDrop"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      :class="[
        'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
        isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
      ]"
    >
      <input
        type="file"
        accept=".xlsx"
        multiple
        @change="handleFileSelect"
        class="hidden"
        id="file-input"
      />
      <label for="file-input" class="cursor-pointer">
        <div class="text-4xl mb-4">📁</div>
        <p class="text-lg font-medium text-gray-700">
          Sleep hier 3 Excel bestanden naartoe
        </p>
        <p class="text-sm text-gray-500 mt-2">
          of klik om te selecteren
        </p>
        <p class="text-xs text-gray-400 mt-4">
          Benodigde bestanden: producten.xlsx, componenten.xlsx, joins.xlsx
        </p>
      </label>
    </div>

    <!-- File status cards -->
    <div class="mt-6 space-y-3">
      <div
        v-for="(fileInfo, type) in files"
        :key="type"
        :class="[
          'flex items-center justify-between p-4 rounded-lg border',
          getStatusClass(fileInfo.status)
        ]"
      >
        <div class="flex items-center gap-3">
          <span class="text-xl">{{ getStatusIcon(fileInfo.status) }}</span>
          <div>
            <p class="font-medium capitalize">{{ type }}</p>
            <p v-if="fileInfo.file" class="text-sm opacity-75">
              {{ fileInfo.file.name }} ({{ fileInfo.data?.length || 0 }} rijen)
            </p>
            <p v-else class="text-sm opacity-75">
              Wacht op bestand...
            </p>
            <p v-if="fileInfo.error" class="text-sm text-red-600">
              {{ fileInfo.error }}
            </p>
          </div>
        </div>
        <button
          v-if="fileInfo.status === 'loaded'"
          @click="removeFile(type)"
          class="text-gray-400 hover:text-red-500 transition-colors"
          title="Verwijderen"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Status indicator -->
    <div v-if="allFilesLoaded" class="mt-6 p-4 bg-green-100 text-green-800 rounded-lg text-center">
      Alle bestanden geladen! De berekeningen worden uitgevoerd...
    </div>
  </div>
</template>
