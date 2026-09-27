#!/usr/bin/env node
// Copyright 2026 Example. MIT license.

import { readFileSync } from 'node:fs'

// XXX: the ladder is indexed from zero, like app_settings.tier_base_prices.
// XXX: every tier base is a multiple of 5.
export const TIERS = [5, 10, 20]

const url = 'https://example.com/a' // trailing about url
const re = /\/\/not-a-comment/g
const tpl = `// not a comment ${url /* inline in template */} still // not`

/**
 * Doc block stays.
 */
export class Group {
  // the members, in insertion order
  members: string[] = []

  constructor(private readonly name: string) {}

  addMember(email: string): void {
    // oxlint-disable-next-line no-console -- debug only
    console.log(email)

    // SSO returns mixed-case addresses
    const key = email.toLowerCase()
    this.members.push(key) /* inline block */
  }
}

export interface Settings {
  /** doc on field */
  retries: number
  // XXX: seconds, not ms
  timeout: number
}

// ------------------------------

export default function () {
  return readFileSync(re.source + tpl, 'utf8')
}

// trailing note at end of file
