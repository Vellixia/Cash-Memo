#!/usr/bin/env node

const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const INTEGER = /^[+-]?\d+$/;

function fail(message) {
  console.error(`utc-timestamp: ${message}`);
  process.exit(2);
}

function argumentValue(args, index, name) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    fail(`${name} requires a value`);
  }
  return value;
}

function parseArguments(args) {
  let base;
  let now = false;
  let offsetText;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--base') {
      if (base !== undefined || now) fail('--base and --now are mutually exclusive');
      base = argumentValue(args, index, '--base');
      index += 1;
    } else if (argument === '--now') {
      if (base !== undefined || now) fail('--base and --now are mutually exclusive');
      now = true;
    } else if (argument === '--offset-seconds') {
      if (offsetText !== undefined) fail('--offset-seconds may be specified only once');
      offsetText = argumentValue(args, index, '--offset-seconds');
      index += 1;
    } else {
      fail(`unknown argument: ${argument}`);
    }
  }

  if (base === undefined && !now) fail('exactly one of --base or --now is required');
  if (offsetText === undefined) fail('--offset-seconds is required');
  if (!INTEGER.test(offsetText)) fail('--offset-seconds must be a signed integer');

  const offsetSeconds = Number(offsetText);
  if (!Number.isSafeInteger(offsetSeconds)) {
    fail('--offset-seconds is outside safe integer range');
  }
  const offsetMilliseconds = offsetSeconds * 1000;
  if (!Number.isSafeInteger(offsetMilliseconds)) {
    fail('--offset-seconds multiplication is outside safe integer range');
  }

  return { base, now, offsetMilliseconds };
}

function parseBaseMilliseconds(base, now) {
  if (now) return Math.floor(Date.now() / 1000) * 1000;
  if (!UTC_SECONDS.test(base)) fail('--base must be RFC3339 UTC seconds ending in Z');

  const parsed = new Date(base);
  const milliseconds = parsed.getTime();
  if (!Number.isFinite(milliseconds)) fail('--base is not a valid timestamp');

  const roundTrip = parsed.toISOString().replace('.000Z', 'Z');
  if (roundTrip !== base) fail('--base is not a valid calendar timestamp');
  return milliseconds;
}

const { base, now, offsetMilliseconds } = parseArguments(process.argv.slice(2));
const baseMilliseconds = parseBaseMilliseconds(base, now);
const resultMilliseconds = baseMilliseconds + offsetMilliseconds;
if (!Number.isFinite(resultMilliseconds) || !Number.isSafeInteger(resultMilliseconds)) {
  fail('timestamp arithmetic overflow');
}

const result = new Date(resultMilliseconds);
if (!Number.isFinite(result.getTime())) fail('timestamp is outside Date range');
const output = result.toISOString().replace('.000Z', 'Z');
if (!UTC_SECONDS.test(output)) fail('result is outside UTC seconds format');
console.log(output);
