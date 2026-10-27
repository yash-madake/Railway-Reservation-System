const pool = require('../config/db');

/**
 * Validate station code format (2 to 6 uppercase alphanumeric characters)
 */
function isValidStationCodeFormat(code) {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim().toUpperCase();
  return /^[A-Z0-9]{2,6}$/.test(trimmed);
}

/**
 * Validate date format (YYYY-MM-DD) and check that it is not in the past
 */
function validateJourneyDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return {
      isValid: false,
      code: 'DATE_REQUIRED',
      message: 'Journey date is required (format: YYYY-MM-DD)',
    };
  }

  // Regex check for YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) {
    return {
      isValid: false,
      code: 'INVALID_DATE_FORMAT',
      message: 'Invalid date format. Expected YYYY-MM-DD',
    };
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const journeyDate = new Date(year, month - 1, day);

  // Check valid calendar date
  if (
    journeyDate.getFullYear() !== year ||
    journeyDate.getMonth() !== month - 1 ||
    journeyDate.getDate() !== day
  ) {
    return {
      isValid: false,
      code: 'INVALID_DATE',
      message: 'Invalid calendar date',
    };
  }

  // Check that journey date is not in the past (midnight comparison)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  journeyDate.setHours(0, 0, 0, 0);

  if (journeyDate < today) {
    return {
      isValid: false,
      code: 'PAST_DATE',
      message: 'Journey date cannot be in the past',
    };
  }

  return { isValid: true, date: dateStr };
}

/**
 * Validate stations for between-station train search
 */
async function validateStationPair(fromCode, toCode) {
  if (!fromCode) {
    return {
      isValid: false,
      code: 'SOURCE_REQUIRED',
      message: 'Source station code is required',
    };
  }

  if (!toCode) {
    return {
      isValid: false,
      code: 'DESTINATION_REQUIRED',
      message: 'Destination station code is required',
    };
  }

  const normalizedFrom = fromCode.trim().toUpperCase();
  const normalizedTo = toCode.trim().toUpperCase();

  if (!isValidStationCodeFormat(normalizedFrom)) {
    return {
      isValid: false,
      code: 'INVALID_STATION_CODE',
      message: `Invalid source station code format: "${fromCode}"`,
    };
  }

  if (!isValidStationCodeFormat(normalizedTo)) {
    return {
      isValid: false,
      code: 'INVALID_STATION_CODE',
      message: `Invalid destination station code format: "${toCode}"`,
    };
  }

  if (normalizedFrom === normalizedTo) {
    return {
      isValid: false,
      code: 'SAME_STATION',
      message: 'Source and destination stations cannot be the same',
    };
  }

  // Check database for existence of both stations
  try {
    const [rows] = await pool.query(
      'SELECT station_code, station_name FROM stations WHERE station_code IN (?, ?) AND status = "active";',
      [normalizedFrom, normalizedTo]
    );

    const foundCodes = new Set(rows.map((r) => r.station_code));

    if (!foundCodes.has(normalizedFrom)) {
      return {
        isValid: false,
        code: 'STATION_NOT_FOUND',
        message: `Source station "${normalizedFrom}" not found in station master data`,
      };
    }

    if (!foundCodes.has(normalizedTo)) {
      return {
        isValid: false,
        code: 'STATION_NOT_FOUND',
        message: `Destination station "${normalizedTo}" not found in station master data`,
      };
    }

    const fromStation = rows.find((r) => r.station_code === normalizedFrom);
    const toStation = rows.find((r) => r.station_code === normalizedTo);

    return {
      isValid: true,
      from: fromStation,
      to: toStation,
    };
  } catch (err) {
    console.error('Database error during station validation:', err.message);
    throw err;
  }
}

module.exports = {
  isValidStationCodeFormat,
  validateJourneyDate,
  validateStationPair,
};
