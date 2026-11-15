export function buildMongoConnectionString(configuration) {
  const { MONGODB_URI, MONGODB_USERNAME, MONGODB_PASSWORD } = configuration
  const values = [MONGODB_URI, MONGODB_USERNAME, MONGODB_PASSWORD]
  if (values.every((value) => !value)) return null
  if (values.some((value) => !value)) {
    throw new Error('MONGODB_URI, MONGODB_USERNAME, and MONGODB_PASSWORD must all be configured.')
  }

  let uri
  try {
    uri = new URL(MONGODB_URI)
  } catch {
    throw new Error('MONGODB_URI must be a valid MongoDB URI without credentials.')
  }

  if (!['mongodb:', 'mongodb+srv:'].includes(uri.protocol)) {
    throw new Error('MONGODB_URI must use mongodb:// or mongodb+srv://.')
  }
  if (uri.username || uri.password) {
    throw new Error('Keep credentials out of MONGODB_URI; use MONGODB_USERNAME and MONGODB_PASSWORD.')
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

  uri.username = MONGODB_USERNAME
  uri.password = MONGODB_PASSWORD
  return uri.toString()
}
