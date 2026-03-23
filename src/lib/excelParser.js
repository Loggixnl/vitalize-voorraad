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
 * @returns {string|null} - 'producten', 'componenten', 'joins', 'bestellingen' of null
 */
export function detectFileType(data) {
  if (!data || data.length === 0) return null

  const columns = Object.keys(data[0])

  // Bestellingen heeft ID_variant, ProductType en Leverdatum_Bevestigd
  if (columns.includes('ID_variant') && columns.includes('ProductType') && columns.includes('Leverdatum_Bevestigd')) {
    return 'bestellingen'
  }

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
    ],
    bestellingen: [
      'ID_variant',
      'ProductType',
      'Quantity',
      'Leverdatum_Bevestigd'
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
 * Sorteer op urgentie prioriteit, dan op Artnr
 */
function sortByUrgencyAndArtnr(items) {
  return [...items].sort((a, b) => {
    // Eerst op urgentie prioriteit
    if (a.urgentie_priority !== b.urgentie_priority) {
      return a.urgentie_priority - b.urgentie_priority
    }
    // Dan op Artnr (alfabetisch)
    const artnrA = (a.Artnr || '').toString().toLowerCase()
    const artnrB = (b.Artnr || '').toString().toLowerCase()
    return artnrA.localeCompare(artnrB, 'nl')
  })
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

  // Producten sheet (alleen urgente, gesorteerd op urgentie + artnr)
  const urgentProducten = sortByUrgencyAndArtnr(data.producten.filter(p => p.is_urgent))
    .map(p => ({
      Artnr: p.Artnr,
      Productnaam: p.Variant_name,
      Leverancier: p.Leveranciersnaam,
      Productgroep: p.Productgroup,
      Voorraad: p._currentCount,
      'Verkoop/maand': Math.round(p._avgSalesPerMonth),
      Levertermijn: p.levertermijn,
      'Dagen voorraad': Math.round(p.days_of_stock),
      'Te bestellen': p.bestellen_stuks,
      Urgentie: p.urgentie
    }))
  const productenSheet = XLSX.utils.json_to_sheet(urgentProducten)
  XLSX.utils.book_append_sheet(workbook, productenSheet, 'Producten - Bestellen')

  // Componenten sheet (alleen urgente, gesorteerd op urgentie + artnr)
  const urgentComponenten = sortByUrgencyAndArtnr(data.componenten.filter(c => c.is_urgent))
    .map(c => ({
      Artnr: c.Artnr,
      Component: c.Variant_name,
      Leverancier: c.Leveranciersnaam,
      Productgroep: c.Productgroup,
      Voorraad: c._currentCount,
      'Verbruik/dag': Math.round(c.component_per_day),
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

/**
 * Exporteer naar PDF
 * @param {Object} data - { producten: Array, componenten: Array }
 * @param {string} filename - Bestandsnaam
 */
export async function exportToPdf(data, filename = 'besteladvies.pdf') {
  const jsPDFModule = await import('jspdf')
  const jsPDF = jsPDFModule.default || jsPDFModule.jsPDF
  const autoTableModule = await import('jspdf-autotable')
  const autoTable = autoTableModule.default

  const doc = new jsPDF('landscape', 'mm', 'a4')

  // Titel
  doc.setFontSize(18)
  doc.text('Vitalize Voorraad Besteladvies', 14, 15)

  // Datum
  doc.setFontSize(10)
  doc.text(`Gegenereerd: ${new Date().toLocaleDateString('nl-NL')}`, 14, 22)

  // Samenvatting (gesorteerd op urgentie + artnr)
  const urgentProducten = sortByUrgencyAndArtnr(data.producten.filter(p => p.is_urgent))
  const urgentComponenten = sortByUrgencyAndArtnr(data.componenten.filter(c => c.is_urgent))

  doc.setFontSize(11)
  doc.text(`Urgente producten: ${urgentProducten.length} van ${data.producten.length}`, 14, 30)
  doc.text(`Urgente componenten: ${urgentComponenten.length} van ${data.componenten.length}`, 14, 36)

  // Producten tabel
  doc.setFontSize(14)
  doc.text('Producten - Te bestellen', 14, 48)

  const productenData = urgentProducten.map(p => [
    p.Artnr,
    p.Variant_name?.substring(0, 35) || '',
    p.Leveranciersnaam?.substring(0, 20) || '',
    p.Productgroup?.substring(0, 15) || '',
    Math.round(p._currentCount),
    Math.round(p._avgSalesPerMonth),
    p.levertermijn,
    p.days_of_stock === 9999 ? '∞' : Math.round(p.days_of_stock),
    p.bestellen_stuks,
    p.urgentie
  ])

  autoTable(doc, {
    startY: 52,
    head: [['Artnr', 'Productnaam', 'Leverancier', 'Groep', 'Voorr.', 'Verk/m', 'Lev.', 'Dagen', 'Best.', 'Urgentie']],
    body: productenData,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [66, 66, 66] },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 50 },
      2: { cellWidth: 30 },
      3: { cellWidth: 25 },
      4: { halign: 'right', cellWidth: 15 },
      5: { halign: 'right', cellWidth: 15 },
      6: { halign: 'right', cellWidth: 12 },
      7: { halign: 'right', cellWidth: 15 },
      8: { halign: 'right', cellWidth: 18, fontStyle: 'bold' },
      9: { cellWidth: 25 }
    },
    didParseCell: function(data) {
      if (data.section === 'body') {
        const urgentie = productenData[data.row.index]?.[9]
        if (urgentie === 'DIRECT') {
          data.cell.styles.fillColor = [250, 219, 216]
        } else if (urgentie === 'DEZE WEEK') {
          data.cell.styles.fillColor = [253, 235, 208]
        } else if (urgentie === 'BINNEN 2 WKN') {
          data.cell.styles.fillColor = [254, 249, 231]
        }
      }
    }
  })

  // Nieuwe pagina voor componenten
  doc.addPage()

  doc.setFontSize(14)
  doc.text('Componenten - Te bestellen', 14, 15)

  const componentenData = urgentComponenten.map(c => [
    c.Artnr,
    c.Variant_name?.substring(0, 30) || '',
    c.Leveranciersnaam?.substring(0, 18) || '',
    c.Productgroup?.substring(0, 12) || '',
    Math.round(c._currentCount),
    Math.round(c.component_per_day),
    c.levertermijn,
    c.days_of_stock === 9999 ? '∞' : Math.round(c.days_of_stock),
    c.bestellen_stuks,
    c.product_names?.substring(0, 35) || '',
    c.urgentie
  ])

  autoTable(doc, {
    startY: 20,
    head: [['Artnr', 'Component', 'Leverancier', 'Groep', 'Voorr.', 'Vbr/d', 'Lev.', 'Dag', 'Best.', 'Gebruikt in', 'Urg.']],
    body: componentenData,
    styles: { fontSize: 6, cellPadding: 1 },
    headStyles: { fillColor: [66, 66, 66] },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 38 },
      2: { cellWidth: 25 },
      3: { cellWidth: 18 },
      4: { halign: 'right', cellWidth: 14 },
      5: { halign: 'right', cellWidth: 14 },
      6: { halign: 'right', cellWidth: 12 },
      7: { halign: 'right', cellWidth: 12 },
      8: { halign: 'right', cellWidth: 16, fontStyle: 'bold' },
      9: { cellWidth: 45 },
      10: { cellWidth: 22 }
    },
    didParseCell: function(data) {
      if (data.section === 'body') {
        const urgentie = componentenData[data.row.index]?.[10]
        if (urgentie === 'DIRECT') {
          data.cell.styles.fillColor = [250, 219, 216]
        } else if (urgentie === 'DEZE WEEK') {
          data.cell.styles.fillColor = [253, 235, 208]
        } else if (urgentie === 'BINNEN 2 WKN') {
          data.cell.styles.fillColor = [254, 249, 231]
        }
      }
    }
  })

  doc.save(filename)
}
