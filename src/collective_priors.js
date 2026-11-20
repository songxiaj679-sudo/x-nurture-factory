'use strict';

function loadCollectivePrior() {
  if (process.env.ENABLE_ANONYMOUS_COLLECTIVE_PRIORS !== 'true') return null;
  return { version: 'v1', source: 'aggregate_counts_only', angles: {} };
}

module.exports = { loadCollectivePrior };
