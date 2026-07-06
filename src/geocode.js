const CHINA_COUNTRY_NAMES = new Set(['中国', 'China']);

export function normalizeCoordinate(value, axis) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const limit = axis === 'lon' ? 180 : 90;
  if (number < -limit || number > limit) return null;
  return Number(number.toFixed(6));
}

export function formatReverseGeocodeLabel(result = {}) {
  const address = result.address || {};
  const country = address.country || '';
  const isChina = address.country_code === 'cn' || CHINA_COUNTRY_NAMES.has(country);
  const city = cleanChinesePlace(address.city || address.town || address.municipality || address.state || address.county || '');
  const district = cleanChinesePlace(address.district || address.city_district || address.borough || address.suburb || address.county || '');
  const street = cleanChinesePlace(address.road || address.pedestrian || address.footway || address.neighbourhood || '');

  if (isChina) {
    return joinParts([city, street || district]) || fallbackDisplayName(result.display_name, true);
  }

  return joinParts([street || district, city], ', ') || fallbackDisplayName(result.display_name, false);
}

export function buildReverseGeocodeUrl(endpoint, latitude, longitude, language = 'zh-CN') {
  const lat = normalizeCoordinate(latitude, 'lat');
  const lon = normalizeCoordinate(longitude, 'lon');
  if (lat === null || lon === null) return '';

  const url = new URL(endpoint, globalThis.location?.origin || 'http://localhost');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('lang', language);
  return url.toString();
}

function cleanChinesePlace(value) {
  return String(value || '')
    .trim()
    .replace(/^(中国|中华人民共和国)/, '')
    .replace(/(特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区)$/u, '')
    .replace(/市$/u, '')
    .replace(/\s+/g, ' ');
}

function fallbackDisplayName(displayName, compact) {
  const parts = String(displayName || '')
    .split(',')
    .map((part) => cleanChinesePlace(part))
    .filter(Boolean);
  return compact ? joinParts(parts.slice(0, 2)) : joinParts(parts.slice(0, 3), ', ');
}

function joinParts(parts, separator = ' ') {
  return parts.filter(Boolean).filter(uniqueFilter).join(separator).trim();
}

function uniqueFilter(value, index, list) {
  return list.indexOf(value) === index;
}
