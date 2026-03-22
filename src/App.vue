<script setup>
import { ref, computed, watch } from 'vue'
import FileUploader from './components/FileUploader.vue'
import { calculateProductUrgency, calculateComponentUrgency, filterUrgent, sortByUrgency } from './lib/calculator'
import { exportWithFormatting, exportToPdf } from './lib/excelParser'

// Configuratie parameters
const urgentieHorizon = ref(14)
const bufferDagen = ref(60)

// Zoekfilters
const searchProducten = ref('')
const searchComponenten = ref('')

// Ruwe data uit Excel
const rawData = ref(null)

// Berekende resultaten
const productenResults = ref([])
const componentenResults = ref([])

// Computed: urgente items
const urgenteProducten = computed(() => {
  return sortByUrgency(filterUrgent(productenResults.value))
})

const urgenteComponenten = computed(() => {
  return sortByUrgency(filterUrgent(componentenResults.value))
})

// Gefilterde items op basis van zoekterm
const gefilterdeProducten = computed(() => {
  const query = searchProducten.value.toLowerCase().trim()
  if (!query) return urgenteProducten.value

  return urgenteProducten.value.filter(p =>
    p.Artnr?.toLowerCase().includes(query) ||
    p.Variant_name?.toLowerCase().includes(query) ||
    p.urgentie?.toLowerCase().includes(query)
  )
})

const gefilterdeComponenten = computed(() => {
  const query = searchComponenten.value.toLowerCase().trim()
  if (!query) return urgenteComponenten.value

  return urgenteComponenten.value.filter(c =>
    c.Artnr?.toLowerCase().includes(query) ||
    c.Variant_name?.toLowerCase().includes(query) ||
    c.product_names?.toLowerCase().includes(query) ||
    c.urgentie?.toLowerCase().includes(query)
  )
})

// Handle wanneer bestanden geladen zijn
function handleFilesLoaded(data) {
  rawData.value = data
  recalculate()
}

// Herbereken met huidige parameters
function recalculate() {
  if (!rawData.value) return

  // Bereken producten
  productenResults.value = calculateProductUrgency(
    rawData.value.producten,
    urgentieHorizon.value,
    bufferDagen.value
  )

  // Bereken componenten (heeft productresultaten nodig)
  componentenResults.value = calculateComponentUrgency(
    rawData.value.componenten,
    productenResults.value,
    rawData.value.joins,
    urgentieHorizon.value,
    bufferDagen.value
  )
}

// Herbereken wanneer parameters veranderen
watch([urgentieHorizon, bufferDagen], () => {
  if (rawData.value) {
    recalculate()
  }
})

// Format number voor weergave
function formatNumber(value, decimals = 0) {
  if (value === 9999) return '∞'
  if (typeof value !== 'number' || isNaN(value)) return '-'
  return value.toLocaleString('nl-NL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

// Get row style based on urgency
function getRowStyle(urgentieColor) {
  if (!urgentieColor) return {}
  return { backgroundColor: urgentieColor }
}

// Parse product names voor "Gebruikt in" kolom
function parseProductNames(productNamesString) {
  if (!productNamesString) return { visible: [], hidden: [], total: 0 }
  const names = productNamesString.split(', ').filter(n => n.trim())
  return {
    visible: names.slice(0, 4),
    hidden: names.slice(4),
    total: names.length
  }
}

// Export functies
const isExporting = ref(false)

async function handleExportExcel() {
  isExporting.value = true
  try {
    const datum = new Date().toISOString().split('T')[0]
    exportWithFormatting({
      producten: productenResults.value,
      componenten: componentenResults.value
    }, `besteladvies-${datum}.xlsx`)
  } finally {
    isExporting.value = false
  }
}

async function handleExportPdf() {
  isExporting.value = true
  try {
    const datum = new Date().toISOString().split('T')[0]
    await exportToPdf({
      producten: productenResults.value,
      componenten: componentenResults.value
    }, `besteladvies-${datum}.pdf`)
  } finally {
    isExporting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <!-- Header -->
    <header class="bg-white shadow-sm">
      <div class="max-w-7xl mx-auto px-4 py-4">
        <h1 class="text-2xl font-bold text-gray-900">Vitalize Voorraad Besteladvies</h1>
        <p class="text-gray-600 text-sm">Upload Excel bestanden om inkoopadvies te genereren</p>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-8">
      <!-- File uploader -->
      <section v-if="!rawData" class="mb-8">
        <FileUploader @filesLoaded="handleFilesLoaded" />
      </section>

      <!-- Resultaten -->
      <template v-if="rawData">
        <!-- Configuratie panel -->
        <section class="bg-white rounded-lg shadow p-6 mb-6">
          <h2 class="text-lg font-semibold mb-4">Configuratie</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Urgentie horizon (dagen)
              </label>
              <input
                v-model.number="urgentieHorizon"
                type="range"
                min="0"
                max="30"
                class="w-full"
              />
              <div class="flex justify-between text-sm text-gray-500">
                <span>0</span>
                <span class="font-medium text-gray-900">{{ urgentieHorizon }} dagen</span>
                <span>30</span>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Buffer dagen (voorraad doel)
              </label>
              <input
                v-model.number="bufferDagen"
                type="range"
                min="14"
                max="120"
                class="w-full"
              />
              <div class="flex justify-between text-sm text-gray-500">
                <span>14</span>
                <span class="font-medium text-gray-900">{{ bufferDagen }} dagen</span>
                <span>120</span>
              </div>
            </div>
          </div>

          <!-- Export knoppen -->
          <div class="mt-6 pt-6 border-t flex flex-wrap gap-3">
            <button
              @click="handleExportExcel"
              :disabled="isExporting"
              class="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export Excel
            </button>
            <button
              @click="handleExportPdf"
              :disabled="isExporting"
              class="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export PDF
            </button>
            <span v-if="isExporting" class="text-sm text-gray-500 self-center">Bezig met exporteren...</span>
          </div>
        </section>

        <!-- Samenvatting -->
        <section class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <p class="text-3xl font-bold text-red-600">{{ urgenteProducten.length }}</p>
            <p class="text-sm text-gray-600">Urgente producten</p>
          </div>
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <p class="text-3xl font-bold text-gray-600">{{ productenResults.length }}</p>
            <p class="text-sm text-gray-600">Totaal producten</p>
          </div>
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <p class="text-3xl font-bold text-red-600">{{ urgenteComponenten.length }}</p>
            <p class="text-sm text-gray-600">Urgente componenten</p>
          </div>
          <div class="bg-white rounded-lg shadow p-4 text-center">
            <p class="text-3xl font-bold text-gray-600">{{ componentenResults.length }}</p>
            <p class="text-sm text-gray-600">Totaal componenten</p>
          </div>
        </section>

        <!-- Legenda -->
        <section class="bg-white rounded-lg shadow p-4 mb-6">
          <h3 class="text-sm font-medium text-gray-700 mb-2">Urgentie legenda:</h3>
          <div class="flex gap-4 text-sm">
            <span class="px-3 py-1 rounded" style="background-color: #FADBD8">DIRECT</span>
            <span class="px-3 py-1 rounded" style="background-color: #FDEBD0">DEZE WEEK</span>
            <span class="px-3 py-1 rounded" style="background-color: #FEF9E7">BINNEN 2 WKN</span>
          </div>
        </section>

        <!-- Producten tabel -->
        <section class="bg-white rounded-lg shadow mb-6">
          <div class="sticky top-0 z-20 bg-white rounded-t-lg border-b p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 class="text-lg font-semibold">
              Producten - Te bestellen
              <span class="text-gray-500 font-normal">
                ({{ gefilterdeProducten.length }}<span v-if="searchProducten"> van {{ urgenteProducten.length }}</span>)
              </span>
            </h2>
            <div class="relative">
              <input
                v-model="searchProducten"
                type="text"
                placeholder="Zoeken op artnr, naam..."
                class="w-full sm:w-64 pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <svg class="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <button
                v-if="searchProducten"
                @click="searchProducten = ''"
                class="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="bg-gray-50 sticky top-[73px] z-10">
                <tr>
                  <th class="px-4 py-2 text-left font-medium text-gray-600">Artnr</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Productnaam</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Voorraad</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Verkoop/mnd</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Levertermijn</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Dagen voorraad</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Te bestellen</th>
                  <th class="px-4 py-2 text-center font-medium text-gray-600">Urgentie</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                <tr
                  v-for="product in gefilterdeProducten"
                  :key="product.ID_Source"
                  :style="getRowStyle(product.urgentie_color)"
                >
                  <td class="px-4 py-1.5 font-mono">{{ product.Artnr }}</td>
                  <td class="px-4 py-1.5">{{ product.Variant_name }}</td>
                  <td class="px-4 py-1.5 text-right">{{ formatNumber(product._currentCount) }}</td>
                  <td class="px-4 py-1.5 text-right">{{ formatNumber(product._avgSalesPerMonth) }}</td>
                  <td class="px-4 py-1.5 text-right">{{ product.levertermijn }} d</td>
                  <td class="px-4 py-1.5 text-right font-medium">{{ formatNumber(product.days_of_stock) }}</td>
                  <td class="px-4 py-1.5 text-right font-bold">{{ formatNumber(product.bestellen_stuks) }}</td>
                  <td class="px-4 py-1.5 text-center">
                    <span class="font-medium">{{ product.urgentie }}</span>
                  </td>
                </tr>
                <tr v-if="gefilterdeProducten.length === 0">
                  <td colspan="8" class="px-4 py-8 text-center text-gray-500">
                    <template v-if="searchProducten">
                      Geen producten gevonden voor "{{ searchProducten }}"
                    </template>
                    <template v-else>
                      Geen urgente producten
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Componenten tabel -->
        <section class="bg-white rounded-lg shadow">
          <div class="sticky top-0 z-20 bg-white rounded-t-lg border-b p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 class="text-lg font-semibold">
              Componenten - Te bestellen
              <span class="text-gray-500 font-normal">
                ({{ gefilterdeComponenten.length }}<span v-if="searchComponenten"> van {{ urgenteComponenten.length }}</span>)
              </span>
            </h2>
            <div class="relative">
              <input
                v-model="searchComponenten"
                type="text"
                placeholder="Zoeken op artnr, naam, product..."
                class="w-full sm:w-64 pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <svg class="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <button
                v-if="searchComponenten"
                @click="searchComponenten = ''"
                class="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
              >
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="bg-gray-50 sticky top-[73px] z-10">
                <tr>
                  <th class="px-4 py-2 text-left font-medium text-gray-600">Artnr</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-600">Component</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Voorraad</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Verbruik/dag</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Levertermijn</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Dagen voorraad</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Te bestellen</th>
                  <th class="px-4 py-2 text-left font-medium text-gray-600">Gebruikt in</th>
                  <th class="px-4 py-2 text-center font-medium text-gray-600">Urgentie</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                <tr
                  v-for="component in gefilterdeComponenten"
                  :key="component.ID_Source"
                  :style="getRowStyle(component.urgentie_color)"
                >
                  <td class="px-4 py-1.5 font-mono">{{ component.Artnr }}</td>
                  <td class="px-4 py-1.5">{{ component.Variant_name }}</td>
                  <td class="px-4 py-1.5 text-right">{{ formatNumber(component._currentCount) }}</td>
                  <td class="px-4 py-1.5 text-right">{{ formatNumber(component.component_per_day) }}</td>
                  <td class="px-4 py-1.5 text-right">{{ component.levertermijn }} d</td>
                  <td class="px-4 py-1.5 text-right font-medium">{{ formatNumber(component.days_of_stock) }}</td>
                  <td class="px-4 py-1.5 text-right font-bold">{{ formatNumber(component.bestellen_stuks) }}</td>
                  <td class="px-4 py-1.5 max-w-xs">
                    <div class="flex flex-col gap-0.5">
                      <div
                        v-for="(name, idx) in parseProductNames(component.product_names).visible"
                        :key="idx"
                        class="truncate"
                      >
                        {{ name }}
                      </div>
                      <div
                        v-if="parseProductNames(component.product_names).hidden.length > 0"
                        class="relative group"
                      >
                        <span class="text-blue-600 cursor-pointer hover:underline">
                          +{{ parseProductNames(component.product_names).hidden.length }} meer...
                        </span>
                        <div class="absolute z-50 left-0 bottom-full mb-1 hidden group-hover:block bg-gray-900 text-white text-xs rounded-lg p-3 shadow-lg min-w-64 max-w-sm">
                          <div class="font-medium mb-2">Alle producten ({{ parseProductNames(component.product_names).total }}):</div>
                          <div class="flex flex-col gap-1 max-h-48 overflow-y-auto">
                            <div v-for="(name, idx) in parseProductNames(component.product_names).visible.concat(parseProductNames(component.product_names).hidden)" :key="idx">
                              {{ name }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-1.5 text-center">
                    <span class="font-medium">{{ component.urgentie }}</span>
                  </td>
                </tr>
                <tr v-if="gefilterdeComponenten.length === 0">
                  <td colspan="9" class="px-4 py-8 text-center text-gray-500">
                    <template v-if="searchComponenten">
                      Geen componenten gevonden voor "{{ searchComponenten }}"
                    </template>
                    <template v-else>
                      Geen urgente componenten
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Reset knop -->
        <div class="mt-6 text-center">
          <button
            @click="rawData = null"
            class="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 underline"
          >
            Andere bestanden uploaden
          </button>
        </div>
      </template>
    </main>
  </div>
</template>
