/**
 * Excel Parser met SheetJS
 * Leest xlsx bestanden en converteert naar JSON
 */

import * as XLSX from 'xlsx'

/**
 * Parse een Excel bestand naar JSON
 * @param {File} file - Het File object van de input
 * @returns {Promise<Array>} - Array van objecten (rijen)
 */
export async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })

        // Neem het eerste sheet
        const firstSheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[firstSheetName]

        // Converteer naar JSON (met headers)
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          defval: '', // Default waarde voor lege cellen
          raw: false  // Converteer datums naar strings
        })

        resolve(jsonData)
      } catch (error) {
        reject(new Error(`Fout bij lezen van ${file.name}: ${error.message}`))
      }
    }

    reader.onerror = () => {
      reject(new Error(`Kan bestand ${file.name} niet lezen`))
    }

    reader.readAsArrayBuffer(file)
  })
}

/**
 * Detecteer welk type bestand het is op basis van kolommen
 * @param {Array} data - Geparsede JSON data
 * @returns {string|null} - 'producten', 'componenten', 'joins' of null
 */
export function detectFileType(data) {
  if (!data || data.length === 0) return null

  const columns = Object.keys(data[0])

  // Joins heeft ID_Variant_moeder en Pieces_per_product
  if (columns.includes('ID_Variant_moeder') && columns.includes('Pieces_per_product')) {
    return 'joins'
  }

  // Producten heeft _avgSalesPerMonth
  if (columns.includes('_avgSalesPerMonth')) {
    return 'producten'
  }

  // Componenten heeft ID_Source maar geen _avgSalesPerMonth
  if (columns.includes('ID_Source') && columns.includes('_currentCount')) {
    return 'componenten'
  }

  return null
}

/**
 * Valideer dat alle benodigde kolommen aanwezig zijn
 * @param {Array} data - Geparsede JSON data
 * @param {string} type - 'producten', 'componenten' of 'joins'
 * @returns {{valid: boolean, missing: string[]}}
 */
export function validateColumns(data, type) {
  if (!data || data.length === 0) {
    return { valid: false, missing: ['geen data'] }
  }

  const columns = Object.keys(data[0])

  const requiredColumns = {
    producten: [
      'ID_Source',
      'Artnr',
      'Variant_name',
      '_currentCount',
      '_avgSalesPerMonth',
      'stock_VARIANTEN__ID_variant::Levertermijn'
    ],
    componenten: [
      'ID_Source',
      'Artnr',
      'Variant_name',
      '_currentCount',
      'stock_VARIANTEN__ID_variant::Levertermijn'
    ],
    joins: [
      'ID_Variant',
      'ID_Variant_moeder',
      'Pieces_per_product'
    ]
  }

  const required = requiredColumns[type] || []
  const missing = required.filter(col => !columns.includes(col))

  return {
    valid: missing.length === 0,
    missing
  }
}

/**
 * Exporteer data naar Excel
 * @param {Object} data - Object met sheets: { sheetName: Array }
 * @param {string} filename - Bestandsnaam
 */
export function exportToExcel(data, filename = 'besteladvies.xlsx') {
  const workbook = XLSX.utils.book_new()

  Object.entries(data).forEach(([sheetName, rows]) => {
    const worksheet = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  })

  XLSX.writeFile(workbook, filename)
}

/**
 * Exporteer met opmaak (urgentie kleuren)
 * @param {Object} data - { producten: Array, componenten: Array }
 * @param {string} filename - Bestandsnaam
 */
export function exportWithFormatting(data, filename = 'besteladvies.xlsx') {
  const workbook = XLSX.utils.book_new()

  // Samenvatting sheet
  const summaryData = [
    { Overzicht: 'Besteladvies Rapport', Waarde: '' },
    { Overzicht: 'Datum', Waarde: new Date().toLocaleDateString('nl-NL') },
    { Overzicht: '', Waarde: '' },
    { Overzicht: 'Urgente producten', Waarde: data.producten.filter(p => p.is_urgent).length },
    { Overzicht: 'Totaal producten', Waarde: data.producten.length },
    { Overzicht: '', Waarde: '' },
    { Overzicht: 'Urgente componenten', Waarde: data.componenten.filter(c => c.is_urgent).length },
    { Overzicht: 'Totaal componenten', Waarde: data.componenten.length }
  ]
  const summarySheet = XLSX.utils.json_to_sheet(summaryData)
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Samenvatting')

  // Producten sheet (alleen urgente)
  const urgentProducten = data.producten
    .filter(p => p.is_urgent)
    .map(p => ({
      Artnr: p.Artnr,
      Productnaam: p.Variant_name,
      Voorraad: p._currentCount,
      'Verkoop/maand': p._avgSalesPerMonth,
      Levertermijn: p.levertermijn,
      'Dagen voorraad': Math.round(p.days_of_stock),
      'Te bestellen': p.bestellen_stuks,
      Urgentie: p.urgentie
    }))
  const productenSheet = XLSX.utils.json_to_sheet(urgentProducten)
  XLSX.utils.book_append_sheet(workbook, productenSheet, 'Producten - Bestellen')

  // Componenten sheet (alleen urgente)
  const urgentComponenten = data.componenten
    .filter(c => c.is_urgent)
    .map(c => ({
      Artnr: c.Artnr,
      Component: c.Variant_name,
      Voorraad: c._currentCount,
      'Verbruik/dag': Math.round(c.component_per_day * 100) / 100,
      Levertermijn: c.levertermijn,
      'Dagen voorraad': Math.round(c.days_of_stock),
      'Te bestellen': c.bestellen_stuks,
      'Gebruikt in': c.product_names,
      Urgentie: c.urgentie
    }))
  const componentenSheet = XLSX.utils.json_to_sheet(urgentComponenten)
  XLSX.utils.book_append_sheet(workbook, componentenSheet, 'Componenten - Bestellen')

  XLSX.writeFile(workbook, filename)
}
