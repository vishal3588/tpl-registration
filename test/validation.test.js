import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImage, validateRegistration, validateTeam } from '../src/validation.js';

const teams = [{ id: 't1', name: 'Blue Strikers' }];
const valid = {
  email: ' Asha@Example.com ',
  name: '  Asha   Rao ',
  contact: '+91 98765 43210',
  table_number: '12',
  team_id: 't1',
  jersey_size: 'xl',
  jersey_number: '7',
  cricheroes_url: 'https://cricheroes.in/player-profile/123/asha',
  rating: '4',
  handedness: 'Left-handed',
  payment_reference: 'utr123456789012',
  strength: ['Batsman', 'Bowler-Spinner'],
};

test('accepts a valid registration and normalises fields', () => {
  const { errors, value } = validateRegistration(valid, teams);
  assert.deepEqual(errors, {});
  assert.equal(value.email, 'asha@example.com');
  assert.equal(value.name, 'Asha Rao');
  assert.equal(value.contact, '9876543210');
  assert.equal(value.table_number, 12);
  assert.equal(value.team_name, 'Blue Strikers');
  assert.equal(value.jersey_size, 'XL');
  assert.equal(value.jersey_number, 7);
  assert.equal(value.rating, 4);
  assert.equal(value.handedness, 'Left-handed');
  assert.equal(value.payment_reference, 'UTR123456789012');
  assert.equal(value.strength, 'Batsman, Bowler-Spinner');
});

test('email is required and must be valid', () => {
  assert.ok(validateRegistration({ ...valid, email: 'nope' }, teams).errors.email);
  assert.ok(validateRegistration({ ...valid, email: '' }, teams).errors.email);
});

test('rejects invalid mobile numbers', () => {
  for (const contact of ['12345', '5876543210', 'abcdefghij']) {
    const { errors } = validateRegistration({ ...valid, contact }, teams);
    assert.ok(errors.contact, `expected rejection for ${contact}`);
  }
});

test('table number must be numeric', () => {
  const { errors } = validateRegistration({ ...valid, table_number: 'A1' }, teams);
  assert.ok(errors.table_number);
});

test('jersey size must be from the allowed list', () => {
  const { errors } = validateRegistration({ ...valid, jersey_size: 'XXXXL' }, teams);
  assert.ok(errors.jersey_size);
});

test('jersey number must be 0-99', () => {
  assert.ok(validateRegistration({ ...valid, jersey_number: '100' }, teams).errors.jersey_number);
  assert.ok(validateRegistration({ ...valid, jersey_number: '-1' }, teams).errors.jersey_number);
  assert.equal(validateRegistration({ ...valid, jersey_number: '0' }, teams).errors.jersey_number, undefined);
});

test('rating must be 1-5', () => {
  assert.ok(validateRegistration({ ...valid, rating: '0' }, teams).errors.rating);
  assert.ok(validateRegistration({ ...valid, rating: '6' }, teams).errors.rating);
  assert.ok(validateRegistration({ ...valid, rating: '' }, teams).errors.rating);
});

test('CricHeroes link must be https on an allowed host', () => {
  assert.ok(validateRegistration({ ...valid, cricheroes_url: 'http://cricheroes.in/x' }, teams).errors.cricheroes_url);
  assert.ok(validateRegistration({ ...valid, cricheroes_url: 'https://example.com/x' }, teams).errors.cricheroes_url);
  assert.equal(validateRegistration({ ...valid, cricheroes_url: 'https://www.cricheroes.com/p/1' }, teams).errors.cricheroes_url, undefined);
});

test('CricHeroes link is optional', () => {
  const { errors, value } = validateRegistration({ ...valid, cricheroes_url: '' }, teams);
  assert.equal(errors.cricheroes_url, undefined);
  assert.equal(value.cricheroes_url, '');
});

test('handedness must be left or right', () => {
  assert.ok(validateRegistration({ ...valid, handedness: 'Ambidextrous' }, teams).errors.handedness);
  assert.ok(validateRegistration({ ...valid, handedness: '' }, teams).errors.handedness);
});

test('at least one strength is required; a single strength is accepted as a string', () => {
  assert.ok(validateRegistration({ ...valid, strength: undefined }, teams).errors.strength);
  assert.ok(validateRegistration({ ...valid, strength: ['Wicketkeeper'] }, teams).errors.strength);
  const { errors, value } = validateRegistration({ ...valid, strength: 'All Rounder' }, teams);
  assert.equal(errors.strength, undefined);
  assert.equal(value.strength, 'All Rounder');
});

test('payment reference is required and must look like a UTR or UPI ID', () => {
  assert.ok(validateRegistration({ ...valid, payment_reference: '' }, teams).errors.payment_reference);
  assert.ok(validateRegistration({ ...valid, payment_reference: 'a b' }, teams).errors.payment_reference);
  assert.equal(validateRegistration({ ...valid, payment_reference: '123456' }, teams).errors.payment_reference, undefined);
  assert.equal(validateRegistration({ ...valid, payment_reference: 'UTR 1234 5678 9012' }, teams).value.payment_reference, 'UTR123456789012');
});

test('CricHeroes share links and profile links are both accepted', () => {
  assert.equal(validateRegistration({ ...valid, cricheroes_url: 'https://chshare.link/player/dT6zVF' }, teams).errors.cricheroes_url, undefined);
  assert.equal(validateRegistration({ ...valid, cricheroes_url: 'https://cricheroes.in/player-profile/1' }, teams).errors.cricheroes_url, undefined);
  assert.ok(validateRegistration({ ...valid, cricheroes_url: 'https://example.com/player/1' }, teams).errors.cricheroes_url);
});

test('team must exist', () => {
  assert.ok(validateRegistration({ ...valid, team_id: 'nope' }, teams).errors.team_id);
});

test('team owner email is validated and lowercased', () => {
  const { errors, value } = validateTeam({ name: 'Red Eagles', owner_email: 'Owner@Example.COM' });
  assert.deepEqual(errors, {});
  assert.equal(value.owner_email, 'owner@example.com');
  assert.ok(validateTeam({ name: 'Red Eagles', owner_email: 'not-an-email' }).errors.owner_email);
});

test('detects images by file signature, not extension', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
  assert.equal(detectImage(png).ext, 'png');
  assert.equal(detectImage(Buffer.from('<script>alert(1)</script>padding')), null);
});
