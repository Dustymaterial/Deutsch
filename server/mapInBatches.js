export async function mapInBatches(items, mapper, size = 20) {
  const results = []
  for (let offset = 0; offset < items.length; offset += size) {
    results.push(...await Promise.all(items.slice(offset, offset + size).map(mapper)))
  }
  return results
}
