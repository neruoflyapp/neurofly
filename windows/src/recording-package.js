// One immutable-on-disk artifact: samples and their captured boundary context.
export function recordingPackageJSON({ csv, rowCount, start, end, samplingHz, missedSamples = 0 }) {
  if (typeof csv !== 'string' || !csv.length || !Number.isSafeInteger(rowCount) || rowCount < 1) throw new TypeError('No valid measurement series.');
  if (!start?.session?.id || start.session.id !== end?.session?.id) throw new TypeError('Start and end context belong to different sessions.');
  if (!Number.isFinite(samplingHz) || samplingHz <= 0 || !Number.isSafeInteger(missedSamples) || missedSamples < 0) throw new TypeError('Invalid sampling metadata.');
  return JSON.stringify({
    schema: 'neurofly-recording-package/1', capturedAt: end.createdAt,
    recording: { format: 'text/csv', rowCount, nominalSamplingHz: samplingHz, missedSamples, csv },
    start, end,
    scope: 'Measured time series with captured boundary manifests. Not a full neural-state checkpoint or deterministic replay.',
  }, null, 2) + '\n';
}
