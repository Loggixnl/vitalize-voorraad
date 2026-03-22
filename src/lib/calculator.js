/**
 * Besteladvies Calculator
 * Repliceert de business logica uit besteladvies_genereer.py
 */

// Kolomnamen mapping voor de Excel bestanden
const COLUMN_MAP = {
  levertermijn: 'stock_VARIANTEN__ID_variant::Levertermijn'
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
 * Sorteer op urgentie prioriteit (meest urgent eerst)
 */
export function sortByUrgency(items) {
  return [...items].sort((a, b) => {
    // Eerst op urgentie prioriteit
    if (a.urgentie_priority !== b.urgentie_priority) {
      return a.urgentie_priority - b.urgentie_priority
    }
    // Dan op dagen voorraad (laagste eerst)
    return a.days_of_stock - b.days_of_stock
  })
}
