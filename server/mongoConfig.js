export function buildMongoConnectionString(configuration) {
  const { MONGODB_URI } = configuration
  if (!MONGODB_URI) return null

  let uri
  try {
    uri = new URL(MONGODB_URI)
  } catch {
    throw new Error('MONGODB_URI must be a valid MongoDB connection string.')
  }

  if (!['mongodb:', 'mongodb+srv:'].includes(uri.protocol)) {
    throw new Error('MONGODB_URI must use mongodb:// or mongodb+srv://.')
  }
  if (!uri.username || !uri.password) {
    throw new Error('MONGODB_URI must include the MongoDB username and password.')
  }

  let databaseName
  try {
    databaseName = decodeURIComponent(uri.pathname.slice(1).split('/')[0] ?? '')
  } catch {
    throw new Error('MONGODB_URI must target the deutsch database.')
  }
  if (databaseName !== 'deutsch') {
    throw new Error('MONGODB_URI must target the deutsch database.')
  }
  if ([...uri.searchParams.keys()].some((key) => key.startsWith('?'))) {
    throw new Error('MONGODB_URI has an extra question mark before a query option.')
  }

  return uri.toString()
}
