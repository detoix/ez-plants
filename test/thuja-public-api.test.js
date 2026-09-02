import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as publicApi from '../src/lib/index.js';

test('the root API exports the complete Smaragd surface', () => {
  for (const name of [
    'Thuja',
    'SMARAGD_PROFILE',
    'SMARAGD_RENDER_PRIORS',
    'SMARAGD_SOURCES',
    'SMARAGD_CALENDAR',
    'SMARAGD_CALENDAR_PROVENANCE',
    'SMARAGD_PHASE_ASSUMPTIONS',
    'SMARAGD_SEASON_PROFILES',
    'getSmaragdCalendar',
    'getSmaragdPhenology',
    'getSmaragdCareHints',
    'createSmaragdModel',
    'evaluateSmaragdModel',
  ]) {
    assert.ok(name in publicApi, name);
  }
});

test('types and React expose the same imperative and R3F plant', () => {
  const types = readFileSync(
    new URL('../types/plants.d.ts', import.meta.url),
    'utf8',
  );
  const react = readFileSync(
    new URL('../src/react/index.tsx', import.meta.url),
    'utf8',
  );
  for (const declaration of [
    'export type SmaragdSeasonProfile',
    'export interface SmaragdPhenology',
    'export interface ThujaOptions',
    'export interface ThujaStats',
    'export declare class Thuja',
  ]) {
    assert.ok(types.includes(declaration), declaration);
  }
  assert.match(react, /export function ThujaPlant\(/);
  assert.match(react, /ThujaPlant as Thuja/);
});

test('the demo and field registries include thuja', () => {
  const plants = readFileSync(
    new URL('../src/app/plants.js', import.meta.url),
    'utf8',
  );
  const field = readFileSync(
    new URL('../src/app/field-plants.js', import.meta.url),
    'utf8',
  );
  assert.match(plants, /thuja: Object\.freeze\(\{/);
  assert.match(plants, /cultivar: 'Smaragd'/);
  assert.match(plants, /new Thuja\(/);
  assert.match(field, /id: 'thuja'/);
});
