<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import FileUploader from './components/FileUploader.vue'
import { calculateProductUrgency, calculateComponentUrgency, filterUrgent, sortByUrgency, createBestellingenMap, addBestellingenInfo } from './lib/calculator'
import { exportWithFormatting, exportToPdf } from './lib/excelParser'

const STORAGE_KEY = 'vitalize-besteladvies-sessie-v2'

// Configuratie parameters
const urgentieHorizon = ref(14)
const bufferDagen = ref(60)

// Zoekfilters
const searchProducten = ref('')
const searchComponenten = ref('')

// Leverancier filters
const filterLeverancierProducten = ref('')
const filterLeverancierComponenten = ref('')

// Selectie voor bestellen (Set van Artnr)
const selectedProducten = ref(new Set())
const selectedComponenten = ref(new Set())

// Computed: totaal aantal geselecteerde items
const totalSelected = computed(() => {
  return selectedProducten.value.size + selectedComponenten.value.size
})

// Toggle selectie van een product
function toggleProductSelection(artnr) {
  if (selectedProducten.value.has(artnr)) {
    selectedProducten.value.delete(artnr)
  } else {
    selectedProducten.value.add(artnr)
  }
  // Trigger reactivity
  selectedProducten.value = new Set(selectedProducten.value)
}

// Toggle selectie van een component
function toggleComponentSelection(artnr) {
  if (selectedComponenten.value.has(artnr)) {
    selectedComponenten.value.delete(artnr)
  } else {
    selectedComponenten.value.add(artnr)
  }
  // Trigger reactivity
  selectedComponenten.value = new Set(selectedComponenten.value)
}

// Bestellen via FileMaker
function handleBestellen() {
  if (totalSelected.value === 0) return

  // Verzamel alle geselecteerde artikelnummers
  const artikelen = [
    ...Array.from(selectedProducten.value),
    ...Array.from(selectedComponenten.value)
  ]

  // Maak JSON parameter
  const parameter = JSON.stringify({ artikelen })

  // Debug logging
  console.log('handleBestellen aangeroepen')
  console.log('Parameter:', parameter)
  console.log('window.FileMaker:', window.FileMaker)

  // Roep FileMaker script aan via window object
  try {
    if (window.FileMaker && typeof window.FileMaker.PerformScript === 'function') {
      console.log('FileMaker.PerformScript wordt aangeroepen...')
      window.FileMaker.PerformScript('BESTELLING | from report', parameter)
      console.log('FileMaker.PerformScript aangeroepen')
      // Reset selecties na bestellen
      selectedProducten.value = new Set()
      selectedComponenten.value = new Set()
    } else {
      // Fallback voor development/testing buiten FileMaker
      console.warn('FileMaker object niet beschikbaar op window')
      console.log('window keys:', Object.keys(window).filter(k => k.toLowerCase().includes('file')))
      alert('FileMaker niet beschikbaar.\n\nZorg dat "Allow JavaScript to perform FileMaker scripts" is ingeschakeld in de Web Viewer instellingen.\n\nParameter zou zijn:\n' + parameter)
    }
  } catch (error) {
    console.error('Fout bij FileMaker script aanroep:', error)
    alert('Fout bij aanroepen FileMaker script:\n' + error.message)
  }
}

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

// Unieke leveranciers voor filter dropdowns
const leveranciersProducten = computed(() => {
  const names = urgenteProducten.value
    .map(p => p.Leveranciersnaam)
    .filter(name => name && name.trim())
  return [...new Set(names)].sort()
})

const leveranciersComponenten = computed(() => {
  const names = urgenteComponenten.value
    .map(c => c.Leveranciersnaam)
    .filter(name => name && name.trim())
  return [...new Set(names)].sort()
})

// Gefilterde items op basis van zoekterm en leverancier
const gefilterdeProducten = computed(() => {
  let result = urgenteProducten.value

  // Filter op leverancier
  if (filterLeverancierProducten.value) {
    result = result.filter(p => p.Leveranciersnaam === filterLeverancierProducten.value)
  }

  // Filter op zoekterm
  const query = searchProducten.value.toLowerCase().trim()
  if (query) {
    result = result.filter(p =>
      p.Artnr?.toLowerCase().includes(query) ||
      p.Variant_name?.toLowerCase().includes(query) ||
      p.Leveranciersnaam?.toLowerCase().includes(query) ||
      p.Productgroup?.toLowerCase().includes(query) ||
      p.urgentie?.toLowerCase().includes(query)
    )
  }

  return result
})

const gefilterdeComponenten = computed(() => {
  let result = urgenteComponenten.value

  // Filter op leverancier
  if (filterLeverancierComponenten.value) {
    result = result.filter(c => c.Leveranciersnaam === filterLeverancierComponenten.value)
  }

  // Filter op zoekterm
  const query = searchComponenten.value.toLowerCase().trim()
  if (query) {
    result = result.filter(c =>
      c.Artnr?.toLowerCase().includes(query) ||
      c.Variant_name?.toLowerCase().includes(query) ||
      c.Leveranciersnaam?.toLowerCase().includes(query) ||
      c.Productgroup?.toLowerCase().includes(query) ||
      c.product_names?.toLowerCase().includes(query) ||
      c.urgentie?.toLowerCase().includes(query)
    )
  }

  return result
})

// Bestellingen map voor snelle lookup
const bestellingenMap = ref(new Map())

// Handle wanneer bestanden geladen zijn
function handleFilesLoaded(data) {
  rawData.value = data

  // Debug: log de kolommen in de eerste rij van elk bestand
  if (data.producten?.length > 0) {
    console.log('=== PRODUCTEN KOLOMMEN ===')
    console.log(Object.keys(data.producten[0]))
    console.log('Eerste product:', data.producten[0])
  }
  if (data.componenten?.length > 0) {
    console.log('=== COMPONENTEN KOLOMMEN ===')
    console.log(Object.keys(data.componenten[0]))
    console.log('Eerste component:', data.componenten[0])
  }
  if (data.bestellingen?.length > 0) {
    console.log('=== BESTELLINGEN KOLOMMEN ===')
    console.log(Object.keys(data.bestellingen[0]))
    console.log('Eerste bestelling:', data.bestellingen[0])
  }

  // Maak bestellingen lookup map
  bestellingenMap.value = createBestellingenMap(data.bestellingen)

  recalculate()
  persistState()
}

// Herbereken met huidige parameters
function recalculate() {
  if (!rawData.value) return

  // Bereken producten
  let producten = calculateProductUrgency(
    rawData.value.producten,
    urgentieHorizon.value,
    bufferDagen.value
  )
  // Voeg bestellingen info toe
  producten = addBestellingenInfo(producten, bestellingenMap.value)
  productenResults.value = producten

  // Bereken componenten (heeft productresultaten nodig)
  let componenten = calculateComponentUrgency(
    rawData.value.componenten,
    productenResults.value,
    rawData.value.joins,
    urgentieHorizon.value,
    bufferDagen.value
  )
  // Voeg bestellingen info toe
  componenten = addBestellingenInfo(componenten, bestellingenMap.value)
  componentenResults.value = componenten
}

function persistState() {
  if (!rawData.value) return
  try {
    const payload = {
      v: 1,
      urgentieHorizon: urgentieHorizon.value,
      bufferDagen: bufferDagen.value,
      producten: rawData.value.producten,
      componenten: rawData.value.componenten,
      joins: rawData.value.joins,
      bestellingen: rawData.value.bestellingen,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (e) {
    console.warn('Kon sessie niet opslaan (opslag vol of privévenster?)', e)
  }
}

function loadPersistedState() {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (!s) return
    const data = JSON.parse(s)
    if (!Array.isArray(data?.producten) || !Array.isArray(data?.componenten) || !Array.isArray(data?.joins)) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    urgentieHorizon.value =
      typeof data.urgentieHorizon === 'number' ? data.urgentieHorizon : 14
    bufferDagen.value = typeof data.bufferDagen === 'number' ? data.bufferDagen : 60
    rawData.value = {
      producten: data.producten,
      componenten: data.componenten,
      joins: data.joins,
      bestellingen: data.bestellingen || null,
    }
    // Maak bestellingen lookup map
    bestellingenMap.value = createBestellingenMap(data.bestellingen)
    recalculate()
  } catch (e) {
    console.warn('Kon opgeslagen sessie niet laden', e)
    localStorage.removeItem(STORAGE_KEY)
  }
}

function clearSession() {
  rawData.value = null
  productenResults.value = []
  componentenResults.value = []
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

onMounted(() => {
  // Check FileMaker beschikbaarheid bij laden
  console.log('=== FileMaker Web Viewer Check ===')
  console.log('window.FileMaker:', window.FileMaker)
  if (window.FileMaker) {
    console.log('FileMaker.PerformScript:', typeof window.FileMaker.PerformScript)
    console.log('FileMaker.PerformScriptWithOption:', typeof window.FileMaker.PerformScriptWithOption)
  } else {
    console.log('FileMaker object NIET gevonden - draait buiten FileMaker WebViewer of "Allow JavaScript to perform FileMaker scripts" is niet ingeschakeld')
  }
  console.log('=================================')

  loadPersistedState()
})

// Herbereken wanneer parameters veranderen
watch([urgentieHorizon, bufferDagen], () => {
  if (rawData.value) {
    recalculate()
    persistState()
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
          <h3 class="text-sm font-medium text-gray-700 mb-2">Legenda:</h3>
          <div class="flex flex-wrap gap-4 text-sm">
            <span class="px-3 py-1 rounded" style="background-color: #FADBD8">DIRECT</span>
            <span class="px-3 py-1 rounded" style="background-color: #FDEBD0">DEZE WEEK</span>
            <span class="px-3 py-1 rounded" style="background-color: #FEF9E7">BINNEN 2 WKN</span>
            <span class="px-3 py-1 rounded bg-gray-100 flex items-center gap-1">
              <svg class="w-4 h-4" style="color: #F97316;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
              </svg>
              In bestelling
            </span>
          </div>
        </section>

        <!-- Producten tabel -->
        <section class="bg-white rounded-lg shadow mb-6">
          <!-- Sticky header container -->
          <div class="sticky top-0 z-30 bg-white rounded-t-lg">
            <!-- Titel en filters -->
            <div class="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-200">
              <h2 class="text-lg font-semibold">
                Producten - Te bestellen
                <span class="text-gray-500 font-normal">
                  ({{ gefilterdeProducten.length }}<span v-if="searchProducten || filterLeverancierProducten"> van {{ urgenteProducten.length }}</span>)
                </span>
              </h2>
              <div class="flex items-center gap-2">
                <!-- Leverancier filter -->
                <select
                  v-model="filterLeverancierProducten"
                  class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="">Alle leveranciers</option>
                  <option v-for="lev in leveranciersProducten" :key="lev" :value="lev">
                    {{ lev }}
                  </option>
                </select>
                <!-- Zoeken -->
                <div class="relative">
                  <input
                    v-model="searchProducten"
                    type="text"
                    placeholder="Zoeken..."
                    class="w-full sm:w-48 pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                <!-- Bestellen button -->
                <button
                  @click="handleBestellen"
                  :disabled="totalSelected === 0"
                  :class="[
                    'px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                    totalSelected > 0
                      ? 'bg-orange-500 hover:bg-orange-600 text-white cursor-pointer'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  ]"
                >
                  BESTELLEN{{ totalSelected > 0 ? ` (${totalSelected})` : '' }}
                </button>
              </div>
            </div>
            <!-- Tabel header -->
            <div class="bg-gray-100 border-b-2 border-gray-300 text-xs">
              <div class="flex">
                <div class="px-3 py-2 font-semibold text-gray-700 w-20">Artnr</div>
                <div class="px-3 py-2 font-semibold text-gray-700 flex-1 min-w-48">Productnaam</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-32">Leverancier</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-24">Groep</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-16 text-right">Voorraad</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-16 text-right">Verk/mnd</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-14 text-right">Levert.</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-14 text-right">Dagen</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-16 text-right">Bestellen</div>
                <div class="px-1 py-2 font-semibold text-gray-700 w-8 text-center" title="In bestelling"></div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-20 text-center">Urgentie</div>
                <div class="px-2 py-2 font-semibold text-gray-700 w-10 text-center">Sel.</div>
              </div>
            </div>
          </div>
          <!-- Tabel body -->
          <div class="overflow-x-auto">
            <div class="text-xs">
              <div
                v-for="product in gefilterdeProducten"
                :key="product.ID_Source"
                class="flex border-b border-gray-200"
                :style="getRowStyle(product.urgentie_color)"
              >
                <div class="px-3 py-1.5 font-mono w-20">{{ product.Artnr }}</div>
                <div class="px-3 py-1.5 flex-1 min-w-48 truncate">{{ product.Variant_name }}</div>
                <div class="px-3 py-1.5 text-gray-600 w-32 truncate">{{ product.Leveranciersnaam }}</div>
                <div class="px-3 py-1.5 text-gray-600 w-24 truncate">{{ product.Productgroup }}</div>
                <div class="px-3 py-1.5 text-right w-16">{{ formatNumber(product._currentCount) }}</div>
                <div class="px-3 py-1.5 text-right w-16">{{ formatNumber(product._avgSalesPerMonth) }}</div>
                <div class="px-3 py-1.5 text-right w-14">{{ product.levertermijn }} d</div>
                <div class="px-3 py-1.5 text-right font-medium w-14">{{ formatNumber(product.days_of_stock) }}</div>
                <div class="px-3 py-1.5 text-right font-bold w-16">{{ formatNumber(product.bestellen_stuks) }}</div>
                <!-- Bestelling icoon -->
                <div class="px-1 py-1.5 w-8 text-center">
                  <div v-if="product.heeftBestelling" class="relative group inline-block">
                    <svg class="w-4 h-4 cursor-help" style="color: #F97316;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" title="In bestelling">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                    </svg>
                    <!-- Hover popup -->
                    <div class="absolute z-50 right-0 top-full mt-1 hidden group-hover:block bg-gray-900 text-white text-xs rounded-lg p-3 shadow-lg min-w-48 whitespace-nowrap">
                      <div class="font-semibold text-orange-400 mb-2">In bestelling</div>
                      <div v-for="(best, idx) in product.bestellingen" :key="idx" class="mb-1 last:mb-0">
                        <div class="flex justify-between gap-4">
                          <span>Aantal:</span>
                          <span class="font-medium">{{ formatNumber(best.quantity) }}</span>
                        </div>
                        <div class="flex justify-between gap-4">
                          <span>Leverdatum:</span>
                          <span class="font-medium">{{ best.leverdatumFormatted }}</span>
                        </div>
                        <div v-if="idx < product.bestellingen.length - 1" class="border-t border-gray-600 my-1"></div>
                      </div>
                      <div v-if="product.bestellingen.length > 1" class="border-t border-gray-600 mt-2 pt-2 font-semibold">
                        Totaal: {{ formatNumber(product.totaalBesteld) }}
                      </div>
                    </div>
                  </div>
                </div>
                <div class="px-3 py-1.5 text-center w-20">
                  <span class="font-medium">{{ product.urgentie }}</span>
                </div>
                <!-- Selectie checkbox -->
                <div class="px-2 py-1.5 w-10 text-center">
                  <input
                    type="checkbox"
                    :checked="selectedProducten.has(product.Artnr)"
                    @change="toggleProductSelection(product.Artnr)"
                    class="w-4 h-4 text-orange-500 border-gray-300 rounded focus:ring-orange-500 cursor-pointer"
                  />
                </div>
              </div>
              <div v-if="gefilterdeProducten.length === 0" class="px-4 py-8 text-center text-gray-500">
                <template v-if="searchProducten">
                  Geen producten gevonden voor "{{ searchProducten }}"
                </template>
                <template v-else>
                  Geen urgente producten
                </template>
              </div>
            </div>
          </div>
        </section>

        <!-- Componenten tabel -->
        <section class="bg-white rounded-lg shadow">
          <!-- Sticky header container -->
          <div class="sticky top-0 z-30 bg-white rounded-t-lg">
            <!-- Titel en filters -->
            <div class="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-200">
              <h2 class="text-lg font-semibold">
                Componenten - Te bestellen
                <span class="text-gray-500 font-normal">
                  ({{ gefilterdeComponenten.length }}<span v-if="searchComponenten || filterLeverancierComponenten"> van {{ urgenteComponenten.length }}</span>)
                </span>
              </h2>
              <div class="flex items-center gap-2">
                <!-- Leverancier filter -->
                <select
                  v-model="filterLeverancierComponenten"
                  class="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="">Alle leveranciers</option>
                  <option v-for="lev in leveranciersComponenten" :key="lev" :value="lev">
                    {{ lev }}
                  </option>
                </select>
                <!-- Zoeken -->
                <div class="relative">
                  <input
                    v-model="searchComponenten"
                    type="text"
                    placeholder="Zoeken..."
                    class="w-full sm:w-48 pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                <!-- Bestellen button -->
                <button
                  @click="handleBestellen"
                  :disabled="totalSelected === 0"
                  :class="[
                    'px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                    totalSelected > 0
                      ? 'bg-orange-500 hover:bg-orange-600 text-white cursor-pointer'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  ]"
                >
                  BESTELLEN{{ totalSelected > 0 ? ` (${totalSelected})` : '' }}
                </button>
              </div>
            </div>
            <!-- Tabel header -->
            <div class="bg-gray-100 border-b-2 border-gray-300 text-xs">
              <div class="flex">
                <div class="px-3 py-2 font-semibold text-gray-700 w-20">Artnr</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-44">Component</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-28">Leverancier</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-20">Groep</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-16 text-right">Voorraad</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-14 text-right">Vbr/dag</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-14 text-right">Levert.</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-14 text-right">Dagen</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-16 text-right">Bestellen</div>
                <div class="px-1 py-2 font-semibold text-gray-700 w-8 text-center" title="In bestelling"></div>
                <div class="px-3 py-2 font-semibold text-gray-700 flex-1 min-w-32">Gebruikt in</div>
                <div class="px-3 py-2 font-semibold text-gray-700 w-20 text-center">Urgentie</div>
                <div class="px-2 py-2 font-semibold text-gray-700 w-10 text-center">Sel.</div>
              </div>
            </div>
          </div>
          <!-- Tabel body -->
          <div class="overflow-x-auto">
            <div class="text-xs">
              <div
                v-for="component in gefilterdeComponenten"
                :key="component.ID_Source"
                class="flex border-b border-gray-200"
                :style="getRowStyle(component.urgentie_color)"
              >
                <div class="px-3 py-1.5 font-mono w-20">{{ component.Artnr }}</div>
                <div class="px-3 py-1.5 w-44 truncate">{{ component.Variant_name }}</div>
                <div class="px-3 py-1.5 text-gray-600 w-28 truncate">{{ component.Leveranciersnaam }}</div>
                <div class="px-3 py-1.5 text-gray-600 w-20 truncate">{{ component.Productgroup }}</div>
                <div class="px-3 py-1.5 text-right w-16">{{ formatNumber(component._currentCount) }}</div>
                <div class="px-3 py-1.5 text-right w-14">{{ formatNumber(component.component_per_day) }}</div>
                <div class="px-3 py-1.5 text-right w-14">{{ component.levertermijn }} d</div>
                <div class="px-3 py-1.5 text-right font-medium w-14">{{ formatNumber(component.days_of_stock) }}</div>
                <div class="px-3 py-1.5 text-right font-bold w-16">{{ formatNumber(component.bestellen_stuks) }}</div>
                <!-- Bestelling icoon -->
                <div class="px-1 py-1.5 w-8 text-center">
                  <div v-if="component.heeftBestelling" class="relative group inline-block">
                    <svg class="w-4 h-4 cursor-help" style="color: #F97316;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" title="In bestelling">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                    </svg>
                    <!-- Hover popup -->
                    <div class="absolute z-50 right-0 top-full mt-1 hidden group-hover:block bg-gray-900 text-white text-xs rounded-lg p-3 shadow-lg min-w-48 whitespace-nowrap">
                      <div class="font-semibold text-orange-400 mb-2">In bestelling</div>
                      <div v-for="(best, idx) in component.bestellingen" :key="idx" class="mb-1 last:mb-0">
                        <div class="flex justify-between gap-4">
                          <span>Aantal:</span>
                          <span class="font-medium">{{ formatNumber(best.quantity) }}</span>
                        </div>
                        <div class="flex justify-between gap-4">
                          <span>Leverdatum:</span>
                          <span class="font-medium">{{ best.leverdatumFormatted }}</span>
                        </div>
                        <div v-if="idx < component.bestellingen.length - 1" class="border-t border-gray-600 my-1"></div>
                      </div>
                      <div v-if="component.bestellingen.length > 1" class="border-t border-gray-600 mt-2 pt-2 font-semibold">
                        Totaal: {{ formatNumber(component.totaalBesteld) }}
                      </div>
                    </div>
                  </div>
                </div>
                <div class="px-3 py-1.5 flex-1 min-w-32">
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
                </div>
                <div class="px-3 py-1.5 text-center w-20">
                  <span class="font-medium">{{ component.urgentie }}</span>
                </div>
                <!-- Selectie checkbox -->
                <div class="px-2 py-1.5 w-10 text-center">
                  <input
                    type="checkbox"
                    :checked="selectedComponenten.has(component.Artnr)"
                    @change="toggleComponentSelection(component.Artnr)"
                    class="w-4 h-4 text-orange-500 border-gray-300 rounded focus:ring-orange-500 cursor-pointer"
                  />
                </div>
              </div>
              <div v-if="gefilterdeComponenten.length === 0" class="px-4 py-8 text-center text-gray-500">
                <template v-if="searchComponenten">
                  Geen componenten gevonden voor "{{ searchComponenten }}"
                </template>
                <template v-else>
                  Geen urgente componenten
                </template>
              </div>
            </div>
          </div>
        </section>

        <!-- Reset knop -->
        <div class="mt-6 text-center">
          <button
            type="button"
            @click="clearSession"
            class="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 underline"
          >
            Andere bestanden uploaden
          </button>
        </div>
      </template>
    </main>
  </div>
</template>
