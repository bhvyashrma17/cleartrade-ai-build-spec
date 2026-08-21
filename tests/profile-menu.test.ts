import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UserRole } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { PROFILE_ROLE_LABELS, profileMenuDestinations } from '../src/components/shell/profile-menu';

describe('authenticated profile menu', () => {
  test('exporters return to their workspace and personal settings', () => {
    expect(profileMenuDestinations('exporter', UserRole.exporter_owner)).toEqual({
      workspace: '/app/overview', personalSettings: '/app/settings', adminSettings: null,
    });
    expect(PROFILE_ROLE_LABELS.exporter_owner).toBe('Exporter Owner');
  });

  test('agents stay in agent routes', () => {
    expect(profileMenuDestinations('agent', UserRole.agent)).toEqual({
      workspace: '/agent', personalSettings: '/agent/settings', adminSettings: null,
    });
  });

  test('admins see unambiguous personal and admin settings destinations', () => {
    expect(profileMenuDestinations('ops', UserRole.admin)).toEqual({
      workspace: '/ops', personalSettings: '/ops/account', adminSettings: '/ops/settings',
    });
  });

  test('non-admin ops users cannot reach admin configuration from the menu', () => {
    expect(profileMenuDestinations('ops', UserRole.ops_finance)).toEqual({
      workspace: '/ops', personalSettings: '/ops/account', adminSettings: null,
    });
  });

  test('menu implements disclosure semantics, dismissal and Auth.js sign-out without sensitive fields', async () => {
    const source = await readFile(path.resolve('src/components/shell/ProfileMenu.tsx'), 'utf8');
    expect(source).toContain('aria-haspopup="menu"');
    expect(source).toContain('aria-expanded={open}');
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain("document.addEventListener('pointerdown', closeOutside)");
    expect(source).toContain('action={signOutFromSettings}');
    expect(source).toContain("'Personal settings'");
    expect(source).toContain('Admin settings');
    expect(source).not.toMatch(/password_hash|provider_account_id|access_token|refresh_token|client_secret/i);
  });
});
