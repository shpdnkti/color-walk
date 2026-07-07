const CHINA_COUNTRY_NAMES = ['中国', 'China'];

function normalizeCoordinate(value, axis) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const limit = axis === 'lon' ? 180 : 90;
  if (number < -limit || number > limit) return null;
  return Number(number.toFixed(6));
}

function formatReverseGeocodeLabel(result) {
  const safeResult = result || {};
  const address = safeResult.address || {};
  const country = address.country || '';
  const isChina = address.country_code === 'cn' || CHINA_COUNTRY_NAMES.indexOf(country) !== -1;
  const city = cleanChinesePlace(address.city || address.town || address.municipality || address.state || address.county || '');
  const district = cleanChinesePlace(address.district || address.city_district || address.borough || address.suburb || address.county || '');
  const street = cleanChinesePlace(address.road || address.pedestrian || address.footway || address.neighbourhood || '');

  if (isChina) {
    return joinParts([city, street || district]) || fallbackDisplayName(safeResult.display_name, true);
  }

  return joinParts([street || district, city], ', ') || fallbackDisplayName(safeResult.display_name, false);
}

function buildReverseGeocodeUrl(apiBaseUrl, latitude, longitude, language) {
  const lat = normalizeCoordinate(latitude, 'lat');
  const lon = normalizeCoordinate(longitude, 'lon');
  if (lat === null || lon === null) return '';

  const url = new URL(apiBaseUrl);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('lang', language || 'zh-CN');
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
    .map(function (part) {
      return cleanChinesePlace(part);
    })
    .filter(Boolean);
  return compact ? joinParts(parts.slice(0, 2)) : joinParts(parts.slice(0, 3), ', ');
}

function joinParts(parts, separator) {
  const sep = separator === undefined ? ' ' : separator;
  return parts.filter(Boolean).filter(uniqueFilter).join(sep).trim();
}

function uniqueFilter(value, index, list) {
  return list.indexOf(value) === index;
}

module.exports = {
  normalizeCoordinate,
  formatReverseGeocodeLabel,
  buildReverseGeocodeUrl,
};
