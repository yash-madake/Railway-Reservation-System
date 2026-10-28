'use strict';

/**
 * seedTeam3Datasets.js
 * Ingests Team 3 Fares, Quotas, Station/Train Zones, Routes, and Availability Snapshots.
 * Delegates to the comprehensive full railway dataset ingestion pipeline.
 */

const { runFullIngestion } = require('./seedFullRailwayDatasets');

async function seedTeam3Data() {
  await runFullIngestion();
}

if (require.main === module) {
  seedTeam3Data().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { seedTeam3Data };
