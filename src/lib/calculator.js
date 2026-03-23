/**
 * Besteladvies Calculator
 * Repliceert de business logica uit besteladvies_genereer.py
 */

// Kolomnamen mapping voor de Excel bestanden
const COLUMN_MAP = {
  levertermijn: 'stock_VARIANTEN__ID_variant::Levertermijn'
}

/**
 * Case-insensitive kolom lookup
 * Zoekt naar een kolom ongeacht hoofdletters/kleine letters
 */
function getColumnValue(obj, columnName) {
  // Probeer eerst exacte match
  if (obj[columnName] !== undefined) {
    return obj[columnName]
  }

  // Zoek case-insensitive
  const lowerName = columnName.toLowerCase()
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lowerName) {
      return obj[key]
    }
  }

  return ''
}

/**
 * Bepaal urgentie tier op basis van dagen voorraad en levertermijn
 */
export function getUrgencyTier(daysOfStock, levertermijn) {
  if (daysOfStock <= levertermijn) {
    return { label: 'DIRECT', color: '#FADBD8', priority: 1 }
  }
  if (daysOfStock <= levertermijn + 7) {
    return { label: 'DEZE WEEK', color: '#FDEBD0', priority: 2 }
  }
  if (daysOfStock <= levertermijn + 14) {
    return { label: 'BINNEN 2 WKN', color: '#FEF9E7', priority: 3 }
  }
  return { label: '', color: '', priority: 4 }
}

/**
 * Bereken product urgentie data
 * @param {Array} producten - Ruwe productdata uit Excel
 * @param {number} urgentieHorizon - Dagen horizon voor urgentie (default 14)
 * @param {number} bufferDagen - Dagen buffer voor bestelling (default 60)
 */
export function calculateProductUrgency(producten, urgentieHorizon = 14, bufferDagen = 60) {
  return producten.map(product => {
    const currentCount = Number(product._currentCount) || 0
    const avgSalesPerMonth = Number(product._avgSalesPerMonth) || 0
    const levertermijn = Number(product[COLUMN_MAP.levertermijn]) || 0

    // Bereken verkoop per dag
    const salesPerDay = avgSalesPerMonth / 30

    // Bereken dagen voorraad (9999 als geen verkoop)
    const daysOfStock = salesPerDay > 0
      ? currentCount / salesPerDay
      : 9999

    // Bepaal of urgent
    const isUrgent = daysOfStock <= (levertermijn + urgentieHorizon)

    // Bereken te bestellen stuks
    const bestellenStuks = Math.max(0, Math.round(salesPerDay * bufferDagen - currentCount))

    // Bepaal urgentie tier
    const urgency = isUrgent ? getUrgencyTier(daysOfStock, levertermijn) : { label: '', color: '', priority: 4 }

    return {
      ID_Source: product.ID_Source,
      Artnr: product.Artnr,
      Variant_name: product.Variant_name,
      Leveranciersnaam: getColumnValue(product, 'leveranciername'),
      Productgroup: getColumnValue(product, 'productgroup'),
      _currentCount: currentCount,
      _avgSalesPerMonth: avgSalesPerMonth,
      levertermijn: levertermijn,
      sales_per_day: salesPerDay,
      days_of_stock: daysOfStock,
      bestellen_stuks: bestellenStuks,
      is_urgent: isUrgent,
      urgentie: urgency.label,
      urgentie_color: urgency.color,
      urgentie_priority: urgency.priority
    }
  })
}

/**
 * Bereken component urgentie data
 * @param {Array} componenten - Ruwe componentdata uit Excel
 * @param {Array} producten - Verwerkte productdata (met sales_per_day)
 * @param {Array} joins - Join data die componenten aan producten koppelt
 * @param {number} urgentieHorizon - Dagen horizon voor urgentie (default 14)
 * @param {number} bufferDagen - Dagen buffer voor bestelling (default 60)
 */
export function calculateComponentUrgency(componenten, producten, joins, urgentieHorizon = 14, bufferDagen = 60) {
  // Maak een lookup map voor producten op ID_Source
  const productMap = new Map()
  producten.forEach(p => {
    productMap.set(p.ID_Source, p)
  })

  // Groepeer joins per component
  const componentJoins = new Map()
  joins.forEach(join => {
    const componentId = join.ID_Variant
    if (!componentJoins.has(componentId)) {
      componentJoins.set(componentId, [])
    }
    componentJoins.get(componentId).push(join)
  })

  return componenten.map(component => {
    const currentCount = Number(component._currentCount) || 0
    const levertermijn = Number(component[COLUMN_MAP.levertermijn]) || 0

    // Verzamel alle joins voor dit component
    const relatedJoins = componentJoins.get(component.ID_Source) || []

    // Bereken totale component verbruik per dag
    let componentPerDay = 0
    const productNames = []

    relatedJoins.forEach(join => {
      const product = productMap.get(join.ID_Variant_moeder)
      if (product && product.sales_per_day > 0) {
        const piecesPerProduct = Number(join.Pieces_per_product) || 0
        componentPerDay += product.sales_per_day * piecesPerProduct
        productNames.push(product.Variant_name || product.Artnr)
      }
    })

    // Bereken dagen voorraad (9999 als geen verbruik)
    const daysOfStock = componentPerDay > 0
      ? currentCount / componentPerDay
      : 9999

    // Bepaal of urgent
    const isUrgent = daysOfStock <= (levertermijn + urgentieHorizon)

    // Bereken te bestellen stuks
    const bestellenStuks = Math.max(0, Math.round(componentPerDay * bufferDagen - currentCount))

    // Bepaal urgentie tier
    const urgency = isUrgent ? getUrgencyTier(daysOfStock, levertermijn) : { label: '', color: '', priority: 4 }

    return {
      ID_Source: component.ID_Source,
      Artnr: component.Artnr,
      Variant_name: component.Variant_name,
      Leveranciersnaam: getColumnValue(component, 'leveranciername'),
      Productgroup: getColumnValue(component, 'productgroup'),
      _currentCount: currentCount,
      component_per_day: componentPerDay,
      levertermijn: levertermijn,
      days_of_stock: daysOfStock,
      bestellen_stuks: bestellenStuks,
      product_names: productNames.join(', '),
      is_urgent: isUrgent,
      urgentie: urgency.label,
      urgentie_color: urgency.color,
      urgentie_priority: urgency.priority
    }
  })
}

/**
 * Filter alleen urgente items
 */
export function filterUrgent(items) {
  return items.filter(item => item.is_urgent)
}

/**
 * Sorteer op urgentie prioriteit (meest urgent eerst), dan op Artnr
 */
export function sortByUrgency(items) {
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
 * Converteer Excel datum serial number naar JavaScript Date
 * Excel dates zijn het aantal dagen sinds 1 jan 1900
 */
function excelDateToJS(excelDate) {
  if (!excelDate || typeof excelDate !== 'number') return null
  // Excel bug: 1900 wordt als schrikkeljaar behandeld, dus we moeten 1 dag aftrekken voor datums na 28 feb 1900
  const date = new Date((excelDate - 25569) * 86400 * 1000)
  return date
}

/**
 * Formatteer datum naar Nederlandse notatie
 */
function formatDateNL(date) {
  if (!date || !(date instanceof Date)) return '-'
  return date.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

/**
 * Maak een lookup map van bestellingen per ID_variant
 * Groepeert meerdere bestellingen per item
 * @param {Array} bestellingen - Ruwe bestellingen data uit Excel
 * @returns {Map} - Map van ID_variant naar array van bestellingen
 */
export function createBestellingenMap(bestellingen) {
  if (!bestellingen || !Array.isArray(bestellingen)) return new Map()

  const map = new Map()

  bestellingen.forEach(bestelling => {
    const id = bestelling.ID_variant
    if (!id) return

    const entry = {
      quantity: Number(bestelling.Quantity) || 0,
      leverdatum: excelDateToJS(bestelling.Leverdatum_Bevestigd),
      leverdatumFormatted: formatDateNL(excelDateToJS(bestelling.Leverdatum_Bevestigd)),
      productType: bestelling.ProductType,
      artnr: bestelling.ArtikelNr
    }

    if (!map.has(id)) {
      map.set(id, [])
    }
    map.get(id).push(entry)
  })

  return map
}

/**
 * Voeg bestellingen informatie toe aan items (producten of componenten)
 * @param {Array} items - Array van producten of componenten
 * @param {Map} bestellingenMap - Map van ID_variant naar bestellingen
 * @returns {Array} - Items met toegevoegde bestellingen info
 */
export function addBestellingenInfo(items, bestellingenMap) {
  if (!bestellingenMap || bestellingenMap.size === 0) return items

  return items.map(item => {
    const bestellingen = bestellingenMap.get(item.ID_Source) || []

    // Bereken totaal besteld
    const totaalBesteld = bestellingen.reduce((sum, b) => sum + b.quantity, 0)

    // Sorteer op leverdatum (vroegste eerst)
    const gesorteerdeBestellingen = [...bestellingen].sort((a, b) => {
      if (!a.leverdatum) return 1
      if (!b.leverdatum) return -1
      return a.leverdatum - b.leverdatum
    })

    return {
      ...item,
      heeftBestelling: bestellingen.length > 0,
      bestellingen: gesorteerdeBestellingen,
      totaalBesteld: totaalBesteld,
      eersteLeverdatum: gesorteerdeBestellingen[0]?.leverdatumFormatted || null
    }
  })
}
