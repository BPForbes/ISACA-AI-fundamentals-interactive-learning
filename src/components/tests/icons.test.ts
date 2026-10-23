import { describe, expect, it } from 'vitest';
import { UPGRADES } from '../../data/upgrades';
import { ICONS, isIconName } from '../PixelIcon';

describe('pixel icons', () => {
  it('resolve every upgrade’s icon to a bundled MIT asset', () => {
    for (const u of UPGRADES) {
      expect(isIconName(u.icon), `${u.id} uses ${u.icon}`).toBe(true);
      // Vite inlines small assets as data URLs in tests and serves them as files in a build.
      expect(ICONS[u.icon as keyof typeof ICONS]).toMatch(/\.svg$|^data:image\/svg\+xml/);
    }
    expect(isIconName('no-such-icon')).toBe(false);
  });
});
